// Copia los datos de Supabase (PostgreSQL de Lovable Cloud) a la base MySQL de UNA sucursal.
//
//   SUPABASE_DB_URL='postgresql://postgres:...@db.<proyecto>.supabase.co:5432/postgres?sslmode=require' \
//     npm run tenant:import-supabase -- <sucursal> [--dry-run]
//
// Opcional, para copiar también los comprobantes del bucket "receipts":
//   SUPABASE_URL=https://<proyecto>.supabase.co  SUPABASE_SERVICE_ROLE_KEY=...
//
// - La sucursal debe estar recién creada (sin usuarios, doctores ni pacientes): los ADMIN vienen de Supabase.
// - Se conservan los mismos IDs y las contraseñas (bcrypt de auth.users): nadie tiene que cambiarla.
// - Todo va en UNA transacción: si algo falla, no queda nada a medias. --dry-run hace todo y deshace.
// - Al final compara conteos y sumas de dinero entre Supabase y MySQL.
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import pg from "pg";
import { db, withTransaction, type Db } from "../db.js";
import { audit } from "../lib/audit.js";
import { detectFileKind } from "../lib/files.js";
import { toCents, fromCents } from "../lib/money.js";
import { putReceipt } from "../lib/private-storage.js";
import { RECEIPT_TYPES } from "../routes/receipts.routes.js";
import { tenancy } from "../tenancy/index.js";

const [tenantId] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const dryRun = process.argv.includes("--dry-run");
const receiptsOnly = process.argv.includes("--receipts-only");
const sourceUrl = process.env.SUPABASE_DB_URL;
if (!tenantId || (!sourceUrl && !receiptsOnly)) {
  console.error("Uso: SUPABASE_DB_URL=postgresql://... npm run tenant:import-supabase -- <sucursal> [--dry-run]");
  process.exit(1);
}

// Tipos de PostgreSQL como los necesita MySQL: DATE como texto (sin zona horaria), NUMERIC e INT8 como número
pg.types.setTypeParser(1082, (v) => v);
pg.types.setTypeParser(1700, (v) => Number(v));
pg.types.setTypeParser(20, (v) => Number(v));

type Row = Record<string, any>;
const notes: string[] = [];
const note = (msg: string) => notes.push(msg);

/** timestamptz → 'YYYY-MM-DD HH:MM:SS' UTC (se trunca: redondear podría pasar al día siguiente). */
const dt = (v: Date | string | null) => (v == null ? null : new Date(v).toISOString().slice(0, 19).replace("T", " "));

async function insertMany(tx: Db, table: string, columns: string[], rows: unknown[][]) {
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    if (chunk.length) await tx.query(`INSERT INTO ${table} (${columns.join(", ")}) VALUES ?`, [chunk]);
  }
}

async function main() {
  const source = new pg.Client({ connectionString: sourceUrl });
  await source.connect();
  const read = async (sql: string) => (await source.query(sql)).rows as Row[];

  console.log(`Leyendo Supabase…`);
  const src = {
    users: await read(`SELECT p.id, p.username, p.full_name, p.email, p.active, p.approved, p.created_at, au.encrypted_password
                         FROM public.profiles p LEFT JOIN auth.users au ON au.id = p.id ORDER BY p.created_at`),
    user_roles: await read("SELECT user_id, role::text AS role FROM public.user_roles"),
    permissions: await read("SELECT key, description, category FROM public.permissions"),
    role_permissions: await read("SELECT role::text AS role, permission_key FROM public.role_permissions"),
    app_params: await read("SELECT key, value_num, value_text, value_bool, description, updated_at, updated_by FROM public.app_params"),
    doctors: await read("SELECT * FROM public.doctors ORDER BY created_at"),
    patients: await read("SELECT * FROM public.patients ORDER BY created_at"),
    studies: await read("SELECT * FROM public.studies ORDER BY created_at"),
    study_prices: await read("SELECT * FROM public.study_prices ORDER BY created_at"),
    patient_studies: await read("SELECT * FROM public.patient_studies ORDER BY created_at, id"),
    commissions: await read("SELECT * FROM public.commissions ORDER BY created_at"),
    cashbox: await read("SELECT * FROM public.cashbox ORDER BY created_at, id"),
    bank_deposits: await read("SELECT * FROM public.bank_deposits ORDER BY created_at"),
    third_party_payments: await read("SELECT * FROM public.third_party_payments ORDER BY created_at"),
    appointments: await read("SELECT * FROM public.appointments ORDER BY starts_at"),
    notifications: await read("SELECT * FROM public.notifications ORDER BY created_at"),
    notification_recipients: await read("SELECT * FROM public.notification_recipients ORDER BY created_at"),
    audit_logs: await read("SELECT * FROM public.audit_logs ORDER BY id"),
  };
  await source.end();

  const result = await tenancy.run(tenantId, async () => {
    const [{ n }] = await db().query<{ n: number }[]>(
      "SELECT (SELECT COUNT(*) FROM users) + (SELECT COUNT(*) FROM doctors) + (SELECT COUNT(*) FROM patients) AS n",
    );
    if (Number(n) > 0) {
      throw new Error(`La sucursal "${tenantId}" ya tiene datos. Crea una sucursal nueva para importar (sin crear el ADMIN antes).`);
    }

    const inserted: Record<string, number> = {};
    const outcome = await withTransaction(async (tx) => {
      // ---------- Usuarios (auth.users + profiles) ----------
      const userIds = new Set<string>();
      const usernames = new Set<string>();
      const userRows = src.users.map((u) => {
        let username = String(u.username ?? u.email.split("@")[0]).slice(0, 100);
        // MySQL compara sin distinguir mayúsculas: "Ana" y "ana" chocarían
        while (usernames.has(username.toLowerCase())) {
          const renamed = `${username}-${userIds.size}`;
          note(`Usuario "${username}" repetido (sin distinguir mayúsculas): se importó como "${renamed}".`);
          username = renamed;
        }
        usernames.add(username.toLowerCase());
        userIds.add(u.id);
        let hash = u.encrypted_password as string | null;
        if (!hash || !/^\$2[aby]\$/.test(hash)) {
          hash = bcrypt.hashSync(randomBytes(24).toString("hex"), 10);
          note(`El usuario ${u.email} no tenía contraseña bcrypt: deberá recibir una contraseña nueva de un ADMIN.`);
        }
        return [u.id, username, u.full_name, String(u.email).toLowerCase(), hash, u.active ?? true, u.approved ?? true, dt(u.created_at)];
      });
      await insertMany(tx, "users", ["id", "username", "full_name", "email", "password_hash", "active", "approved", "created_at"], userRows);
      inserted.users = userRows.length;
      const user = (id: string | null) => (id && userIds.has(id) ? id : null);

      const roleRows = src.user_roles.filter((r) => userIds.has(r.user_id)).map((r) => [r.user_id, r.role]);
      await insertMany(tx, "user_roles", ["user_id", "role"], roleRows);
      inserted.user_roles = roleRows.length;

      // ---------- Permisos y parámetros (la matriz personalizada de Supabase reemplaza la por defecto) ----------
      // Permisos que existan solo en Supabase (los ya sembrados se ignoran)
      const permRowsCatalog = src.permissions.map((p) => [p.key, p.description, p.category ?? "general"]);
      if (permRowsCatalog.length) await tx.query("INSERT IGNORE INTO permissions (`key`, description, category) VALUES ?", [permRowsCatalog]);
      await tx.query("DELETE FROM role_permissions WHERE role <> 'ADMIN'");
      const permRows = src.role_permissions.filter((r) => r.role !== "ADMIN").map((r) => [r.role, r.permission_key]);
      const adminPerms = src.role_permissions.length - permRows.length;
      if (adminPerms) note(`${adminPerms} permiso(s) del rol ADMIN no se copian: ADMIN siempre tiene todos.`);
      if (permRows.length) await tx.query("INSERT IGNORE INTO role_permissions (role, permission_key) VALUES ?", [permRows]);
      inserted.role_permissions = permRows.length;
      for (const p of src.app_params) {
        await tx.query(
          `INSERT INTO app_params (\`key\`, value_num, value_text, value_bool, description, updated_by) VALUES (?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE value_num = VALUES(value_num), value_text = VALUES(value_text), value_bool = VALUES(value_bool)`,
          [p.key, p.value_num, p.value_text, p.value_bool, p.description, user(p.updated_by)],
        );
      }
      inserted.app_params = src.app_params.length;

      // ---------- Clínico ----------
      await insertMany(tx, "doctors",
        ["id", "full_name", "clinic_address", "phone", "email", "bank_account", "status", "use_percentage", "default_commission_pct", "agreement_discount_pct", "created_by", "created_at"],
        src.doctors.map((d) => [d.id, d.full_name, d.clinic_address, d.phone, d.email, d.bank_account, d.status, d.use_percentage ?? false,
          d.default_commission_pct, d.agreement_discount_pct ?? 0, user(d.created_by), dt(d.created_at)]));
      inserted.doctors = src.doctors.length;
      const doctorIds = new Set(src.doctors.map((d) => d.id));

      const patients = src.patients.filter((p) => {
        if (doctorIds.has(p.doctor_id)) return true;
        note(`Paciente ${p.full_name} (${p.id}) sin doctor válido: no se importó.`);
        return false;
      });
      await insertMany(tx, "patients",
        ["id", "doctor_id", "full_name", "birth_date", "phone", "email", "notes", "status", "created_by", "created_at"],
        patients.map((p) => [p.id, p.doctor_id, p.full_name, p.birth_date, p.phone, p.email, p.notes, p.status ?? true, user(p.created_by), dt(p.created_at)]));
      inserted.patients = patients.length;
      const patientIds = new Set(patients.map((p) => p.id));

      await insertMany(tx, "studies", ["id", "name", "description", "fixed_commission", "active", "created_at"],
        src.studies.map((s) => [s.id, s.name, s.description, s.fixed_commission ?? 0, s.active, dt(s.created_at)]));
      inserted.studies = src.studies.length;
      const studyIds = new Set(src.studies.map((s) => s.id));

      await insertMany(tx, "study_prices", ["id", "study_id", "price_with_report", "price_without_report", "effective_date", "is_active", "created_at"],
        src.study_prices.map((p) => [p.id, p.study_id, p.price_with_report, p.price_without_report, p.effective_date, p.is_active, dt(p.created_at)]));
      inserted.study_prices = src.study_prices.length;

      let overpaidCents = 0;
      const psRows = src.patient_studies.filter((r) => patientIds.has(r.patient_id)).map((r) => {
        const totalCents = toCents(r.price) + toCents(r.invoice_surcharge ?? 0) - toCents(r.discount ?? 0);
        let paid = r.amount_paid ?? 0;
        if (toCents(paid) > totalCents) {
          // Bug del sistema actual: el frontend cobraba sin el descuento por convenio
          overpaidCents += toCents(paid) - totalCents;
          note(`Atención ${r.id}: pagado ${paid} > total ${fromCents(totalCents)}; se registró ${fromCents(totalCents)} (saldo a favor ${fromCents(toCents(paid) - totalCents)}).`);
          paid = fromCents(totalCents);
        }
        return [r.id, r.patient_id, r.study_id, doctorIds.has(r.doctor_id) ? r.doctor_id : null, r.clinic_name, r.price, r.has_report, r.is_voucher,
          r.with_invoice ?? false, r.invoice_number, r.invoice_surcharge ?? 0, r.discount ?? 0, paid, r.payment_method, r.delivery_date,
          dt(r.delivered_at), user(r.delivered_by), user(r.created_by), dt(r.created_at)];
      });
      await insertMany(tx, "patient_studies",
        ["id", "patient_id", "study_id", "doctor_id", "clinic_name", "price", "has_report", "is_voucher", "with_invoice", "invoice_number",
          "invoice_surcharge", "discount", "amount_paid", "payment_method", "delivery_date", "delivered_at", "delivered_by", "created_by", "created_at"],
        psRows);
      inserted.patient_studies = psRows.length;
      const psIds = new Set(psRows.map((r) => r[0]));

      const comRows = src.commissions.filter((c) => psIds.has(c.patient_study_id))
        .map((c) => [c.id, c.doctor_id, c.patient_study_id, c.commission_amount, c.percentage, dt(c.created_at)]);
      await insertMany(tx, "commissions", ["id", "doctor_id", "patient_study_id", "commission_amount", "percentage", "created_at"], comRows);
      inserted.commissions = comRows.length;

      // ---------- Finanzas ----------
      let running = 0;
      let mismatches = 0;
      const cashRows = src.cashbox.filter((c) => {
        const ok = (c.income ?? 0) >= 0 && (c.expense ?? 0) >= 0 && ((c.income ?? 0) > 0 || (c.expense ?? 0) > 0);
        if (!ok) note(`Movimiento de caja ${c.id} ("${c.description}") con ingreso ${c.income} y gasto ${c.expense}: no se importó.`);
        return ok;
      }).map((c) => {
        running += toCents(c.income ?? 0) - toCents(c.expense ?? 0);
        if (toCents(c.balance) !== running) mismatches++;
        return [c.id, c.description, c.income ?? 0, c.expense ?? 0, c.balance, user(c.created_by), dt(c.created_at)];
      });
      await insertMany(tx, "cashbox", ["id", "description", "income", "expense", "balance", "created_by", "created_at"], cashRows);
      inserted.cashbox = cashRows.length;
      const lastBalance = cashRows.length ? Number(cashRows[cashRows.length - 1][4]) : 0;
      await tx.query("UPDATE cashbox_state SET balance = ? WHERE id = 1", [lastBalance]);
      if (mismatches) {
        note(`Caja chica: ${mismatches} movimiento(s) con saldo guardado distinto al recalculado (probable efecto de movimientos simultáneos en Supabase). ` +
          `Saldo guardado: ${lastBalance}; saldo recalculado: ${fromCents(running)}. Se dejó el guardado; revisar y, si corresponde, registrar un ajuste.`);
      }

      const positive = (label: string) => (r: Row) => {
        if (Number(r.amount) > 0) return true;
        note(`${label} ${r.id} con monto ${r.amount}: no se importó.`);
        return false;
      };
      const deps = src.bank_deposits.filter(positive("Depósito"));
      await insertMany(tx, "bank_deposits", ["id", "amount", "deposit_date", "reference", "receipt_url", "created_by", "created_at"],
        deps.map((d) => [d.id, d.amount, d.deposit_date, d.reference, d.receipt_url ?? null, user(d.created_by), dt(d.created_at)]));
      inserted.bank_deposits = deps.length;
      const tpps = src.third_party_payments.filter(positive("Pago a terceros"));
      await insertMany(tx, "third_party_payments",
        ["id", "provider_name", "service_type", "amount", "service_date", "payment_date", "receipt_url", "created_by", "created_at"],
        tpps.map((t) => [t.id, t.provider_name, t.service_type, t.amount, t.service_date, t.payment_date, t.receipt_url ?? null, user(t.created_by), dt(t.created_at)]));
      inserted.third_party_payments = tpps.length;

      // ---------- Agenda y notificaciones ----------
      const STATUSES = ["SCHEDULED", "CONFIRMED", "DONE", "CANCELLED", "NO_SHOW"];
      const apRows = src.appointments.map((a) => {
        let duration = Number(a.duration_min ?? 30);
        if (duration < 5 || duration > 480) {
          note(`Cita ${a.id}: duración ${duration} min fuera de rango, se ajustó.`);
          duration = Math.min(480, Math.max(5, duration));
        }
        const status = STATUSES.includes(a.status) ? a.status : "SCHEDULED";
        if (status !== a.status) note(`Cita ${a.id}: estado "${a.status}" desconocido, se importó como SCHEDULED.`);
        return [a.id, patientIds.has(a.patient_id) ? a.patient_id : null, a.patient_name, a.patient_phone, doctorIds.has(a.doctor_id) ? a.doctor_id : null,
          studyIds.has(a.study_id) ? a.study_id : null, dt(a.starts_at), duration, status, a.notes, user(a.created_by), dt(a.created_at), dt(a.updated_at ?? a.created_at)];
      });
      await insertMany(tx, "appointments",
        ["id", "patient_id", "patient_name", "patient_phone", "doctor_id", "study_id", "starts_at", "duration_min", "status", "notes", "created_by", "created_at", "updated_at"],
        apRows);
      inserted.appointments = apRows.length;

      const notifs = src.notifications.filter((n) => userIds.has(n.sender_id));
      await insertMany(tx, "notifications", ["id", "sender_id", "title", "body", "created_at"],
        notifs.map((n) => [n.id, n.sender_id, String(n.title).slice(0, 200), n.body, dt(n.created_at)]));
      inserted.notifications = notifs.length;
      const notifIds = new Set(notifs.map((n) => n.id));
      const recRows = src.notification_recipients.filter((r) => notifIds.has(r.notification_id) && userIds.has(r.user_id))
        .map((r) => [r.id, r.notification_id, r.user_id, dt(r.read_at), dt(r.created_at)]);
      await insertMany(tx, "notification_recipients", ["id", "notification_id", "user_id", "read_at", "created_at"], recRows);
      inserted.notification_recipients = recRows.length;

      // ---------- Auditoría (se conserva el historial; los ids nuevos son correlativos) ----------
      const auditRows = src.audit_logs.map((a) => [a.user_id, String(a.action).slice(0, 50), String(a.table_name).slice(0, 100),
        a.record_id == null ? null : String(a.record_id).slice(0, 100), a.data == null ? null : JSON.stringify(a.data), dt(a.timestamp)]);
      await insertMany(tx, "audit_logs", ["user_id", "action", "table_name", "record_id", "data", "`timestamp`"], auditRows);
      inserted.audit_logs = auditRows.length;

      await audit(tx, null, "IMPORT_SUPABASE", "tenancy", tenantId, { inserted, notes: notes.length, dry_run: dryRun });

      // ---------- Verificación: Supabase vs MySQL (dentro de la misma transacción) ----------
      const sum = (rows: Row[], k: string) => fromCents(rows.reduce((s, r) => s + toCents(r[k] ?? 0), 0));
      const [m] = await tx.query<Row[]>(`SELECT
          (SELECT COALESCE(SUM(price),0) FROM patient_studies) AS ps_price,
          (SELECT COALESCE(SUM(invoice_surcharge),0) FROM patient_studies) AS ps_surcharge,
          (SELECT COALESCE(SUM(discount),0) FROM patient_studies) AS ps_discount,
          (SELECT COALESCE(SUM(amount_paid),0) FROM patient_studies) AS ps_paid,
          (SELECT COALESCE(SUM(commission_amount),0) FROM commissions) AS commissions,
          (SELECT COALESCE(SUM(income),0) FROM cashbox) AS cash_in,
          (SELECT COALESCE(SUM(expense),0) FROM cashbox) AS cash_out,
          (SELECT COALESCE(SUM(amount),0) FROM bank_deposits) AS deposits,
          (SELECT COALESCE(SUM(amount),0) FROM third_party_payments) AS third_party`);
      const checks: [string, number, number, number][] = [
        ["Precio de atenciones", sum(src.patient_studies, "price"), Number(m.ps_price), 0],
        ["Recargo por factura", sum(src.patient_studies, "invoice_surcharge"), Number(m.ps_surcharge), 0],
        ["Descuentos", sum(src.patient_studies, "discount"), Number(m.ps_discount), 0],
        ["Cobrado", sum(src.patient_studies, "amount_paid"), Number(m.ps_paid), fromCents(overpaidCents)],
        ["Comisiones", sum(src.commissions, "commission_amount"), Number(m.commissions), 0],
        ["Caja: ingresos", sum(src.cashbox, "income"), Number(m.cash_in), 0],
        ["Caja: gastos", sum(src.cashbox, "expense"), Number(m.cash_out), 0],
        ["Depósitos", sum(src.bank_deposits, "amount"), Number(m.deposits), 0],
        ["Pagos a terceros", sum(src.third_party_payments, "amount"), Number(m.third_party), 0],
      ];
      const counts = Object.entries(inserted).map(([t, n]) => [t, (src as Record<string, Row[]>)[t]?.length ?? 0, n] as const);
      const out = { checks, counts, lastBalance };
      if (dryRun) {
        dryRunResult = out;
        throw DRY_RUN; // withTransaction hace rollback
      }
      return out;
    }).catch((e) => {
      if (e === DRY_RUN) return dryRunResult!;
      throw e;
    });

    // Comprobantes: fuera de la transacción (son archivos); si falla uno, se informa y se sigue
    if (!dryRun) await migrateReceipts();
    return outcome;
  });

  // ---------- Informe ----------
  printReport(result.counts, result.checks);
  if (notes.length) {
    console.log(`\nObservaciones (${notes.length}):`);
    for (const n of notes) console.log(`  • ${n}`);
  }
}

const DRY_RUN = Symbol("dry-run");
let dryRunResult: { checks: [string, number, number, number][]; counts: (readonly [string, number, number])[]; lastBalance: number } | null = null;

/**
 * Copia los comprobantes del bucket privado "receipts" de Supabase al almacenamiento privado de
 * la sucursal y actualiza receipt_url con la llave nueva. Necesita SUPABASE_URL y
 * SUPABASE_SERVICE_ROLE_KEY; sin ellas, las rutas viejas quedan guardadas y se avisa.
 */
async function migrateReceipts() {
  const rows = await db().query<{ t: string; id: string; path: string }[]>(
    `SELECT 'bank_deposits' AS t, id, receipt_url AS path FROM bank_deposits WHERE receipt_url IS NOT NULL AND receipt_url NOT LIKE 'receipts/%'
     UNION ALL
     SELECT 'third_party_payments', id, receipt_url FROM third_party_payments WHERE receipt_url IS NOT NULL AND receipt_url NOT LIKE 'receipts/%'`,
  );
  if (rows.length === 0) return;
  const baseUrl = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !key) {
    note(`${rows.length} comprobante(s) siguen en Supabase Storage (faltan SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY). ` +
      `Vuelve a correr solo esta parte con: npm run tenant:import-supabase -- ${tenantId} --receipts-only`);
    return;
  }
  let copied = 0;
  for (const r of rows) {
    try {
      const res = await fetch(`${baseUrl}/storage/v1/object/receipts/${r.path.split("/").map(encodeURIComponent).join("/")}`, {
        headers: { Authorization: `Bearer ${key}`, apikey: key },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = Buffer.from(await res.arrayBuffer());
      const kind = detectFileKind(body, RECEIPT_TYPES);
      if (!kind) throw new Error("no es una imagen ni un PDF");
      const newKey = await putReceipt(tenantId, body, kind);
      await db().query(`UPDATE ${r.t} SET receipt_url = ? WHERE id = ?`, [newKey, r.id]);
      copied++;
    } catch (e) {
      note(`Comprobante "${r.path}" (${r.t} ${r.id}) no se pudo copiar: ${e instanceof Error ? e.message : e}`);
    }
  }
  console.log(`Comprobantes copiados: ${copied} de ${rows.length}`);
}

function printReport(counts: readonly (readonly [string, number, number])[], checks: [string, number, number, number][]) {
  console.log(`\n${dryRun ? "SIMULACIÓN (no se guardó nada)" : "Importación terminada"} en la sucursal "${tenantId}"\n`);
  console.log("Tabla                      Supabase   MySQL");
  for (const [t, s, n] of counts) console.log(`${t.padEnd(26)} ${String(s).padStart(8)} ${String(n).padStart(7)}${s !== n ? "  ← ver observaciones" : ""}`);
  console.log("\nMontos                     Supabase        MySQL   Diferencia explicada");
  let bad = 0;
  for (const [label, s, mysql, explained] of checks) {
    const diff = Number((s - mysql).toFixed(2));
    const ok = Math.abs(diff - explained) < 0.005;
    if (!ok) bad++;
    console.log(`${label.padEnd(24)} ${s.toFixed(2).padStart(10)} ${mysql.toFixed(2).padStart(12)}   ${diff.toFixed(2).padStart(8)} ${ok ? "OK" : "✗ NO CUADRA"}`);
  }
  if (bad) process.exitCode = 1;
}

(receiptsOnly ? tenancy.run(tenantId, migrateReceipts).then(() => notes.forEach((n) => console.log("  • " + n))) : main())
  .catch((e) => {
    console.error("✗ " + (e instanceof Error ? e.message : String(e)));
    process.exitCode = 1;
  })
  .finally(() => tenancy.close());
