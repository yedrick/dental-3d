import { Router } from "express";
import { z } from "zod";
import { db, withTransaction, type Db } from "../db.js";
import { audit } from "../lib/audit.js";
import { HttpError } from "../lib/http-error.js";
import { receiptExists } from "../lib/private-storage.js";
import { paged, paginate, paginationSchema } from "../lib/query.js";
import { money, optionalText } from "../lib/schemas.js";
import { denyDoctorScope, requireAuth, requirePermission } from "../middleware/auth.js";
import { tenancy } from "../tenancy/index.js";

// Depósitos bancarios y pagos a terceros. Sin caché: es dinero.
export const depositsRouter = Router();
export const thirdPartyRouter = Router();
depositsRouter.use(requireAuth, denyDoctorScope);
thirdPartyRouter.use(requireAuth, denyDoctorScope);

const positive = money.refine((v) => v > 0, "El monto debe ser mayor a 0");
const date = z.iso.date("Fecha inválida (YYYY-MM-DD)");
const receiptKey = z.string().max(300).nullish().transform((v) => v || null);

/** El comprobante debe existir en el almacenamiento privado de ESTA sucursal. */
async function assertReceipt(key: string | null) {
  if (key && !(await receiptExists(tenancy.currentId()!, key))) {
    throw new HttpError(400, "El comprobante no existe: súbelo primero en POST /api/receipts");
  }
}

// Filtro por fecha de negocio (columna DATE, sin conversión de zona horaria)
const listSchema = paginationSchema.and(
  z.object({ from: date.optional(), to: date.optional(), q: z.string().trim().max(100).optional() }),
);

async function list(
  q: Db,
  table: "bank_deposits" | "third_party_payments",
  dateColumn: "deposit_date" | "payment_date",
  f: z.infer<typeof listSchema>,
  searchColumns: string[],
) {
  const where: string[] = [];
  const params: unknown[] = [];
  if (f.from) { where.push(`t.${dateColumn} >= ?`); params.push(f.from); }
  if (f.to) { where.push(`t.${dateColumn} <= ?`); params.push(f.to); }
  if (f.q) {
    where.push("(" + searchColumns.map((c) => `t.${c} LIKE ?`).join(" OR ") + ")");
    params.push(...searchColumns.map(() => `%${f.q}%`));
  }
  const whereSql = where.length ? "WHERE " + where.join(" AND ") : "";
  const { limit, offset } = paginate(f.page, f.limit);
  const [rows, [sum]] = await Promise.all([
    q.query(
      `SELECT t.*, u.full_name AS created_by_name FROM ${table} t LEFT JOIN users u ON u.id = t.created_by
        ${whereSql} ORDER BY t.${dateColumn} DESC, t.created_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    ),
    q.query<{ count: number; total: number | null }[]>(
      `SELECT COUNT(*) AS count, SUM(t.amount) AS total FROM ${table} t ${whereSql}`,
      params,
    ),
  ]);
  return { ...paged(rows, Number(sum.count), f.page, f.limit), summary: { total: Number(sum.total ?? 0) } };
}

// ---------- Depósitos bancarios ----------

const depositSchema = z.object({
  amount: positive,
  deposit_date: date,
  reference: optionalText(200),
  receipt_key: receiptKey,
});

depositsRouter.get("/", requirePermission("view.deposits"), async (req, res) => {
  res.json(await list(db(), "bank_deposits", "deposit_date", listSchema.parse(req.query), ["reference"]));
});

depositsRouter.post("/", requirePermission("deposits.create"), async (req, res) => {
  const data = depositSchema.parse(req.body);
  await assertReceipt(data.receipt_key);
  const deposit = await withTransaction(async (tx) => {
    const [{ id }] = await tx.query<{ id: string }[]>("SELECT UUID() AS id");
    await tx.query(
      "INSERT INTO bank_deposits (id, amount, deposit_date, reference, receipt_url, created_by) VALUES (?, ?, ?, ?, ?, ?)",
      [id, data.amount, data.deposit_date, data.reference, data.receipt_key, req.user!.id],
    );
    const [row] = await tx.query("SELECT * FROM bank_deposits WHERE id = ?", [id]);
    await audit(tx, req.user!.id, "INSERT", "bank_deposits", id, row);
    return row;
  });
  res.status(201).json(deposit);
});

// ---------- Pagos a terceros ----------

const paymentSchema = z
  .object({
    provider_name: z.string().trim().min(1, "Proveedor requerido").max(200),
    service_type: z.string().trim().min(1, "Tipo de servicio requerido").max(200),
    amount: positive,
    service_date: date,
    payment_date: date,
    receipt_key: receiptKey,
  });

thirdPartyRouter.get("/", requirePermission("view.third_party"), async (req, res) => {
  res.json(await list(db(), "third_party_payments", "payment_date", listSchema.parse(req.query), ["provider_name", "service_type"]));
});

thirdPartyRouter.post("/", requirePermission("third_party.create"), async (req, res) => {
  const data = paymentSchema.parse(req.body);
  await assertReceipt(data.receipt_key);
  const payment = await withTransaction(async (tx) => {
    const [{ id }] = await tx.query<{ id: string }[]>("SELECT UUID() AS id");
    await tx.query(
      `INSERT INTO third_party_payments (id, provider_name, service_type, amount, service_date, payment_date, receipt_url, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, data.provider_name, data.service_type, data.amount, data.service_date, data.payment_date, data.receipt_key, req.user!.id],
    );
    const [row] = await tx.query("SELECT * FROM third_party_payments WHERE id = ?", [id]);
    await audit(tx, req.user!.id, "INSERT", "third_party_payments", id, row);
    return row;
  });
  res.status(201).json(payment);
});

/**
 * Corrige un pago. Regla: la fecha de servicio NO se puede cambiar después de guardar
 * (antes trigger prevent_service_date_change).
 */
thirdPartyRouter.patch("/:id", requirePermission("third_party.create"), async (req, res) => {
  const id = String(req.params.id);
  const data = paymentSchema.partial().parse(req.body);
  await assertReceipt(data.receipt_key ?? null);
  const payment = await withTransaction(async (tx) => {
    const [existing] = await tx.query<{ service_date: string }[]>("SELECT * FROM third_party_payments WHERE id = ? FOR UPDATE", [id]);
    if (!existing) throw new HttpError(404, "Pago no encontrado");
    if (data.service_date !== undefined && data.service_date !== existing.service_date) {
      throw new HttpError(400, "La fecha de servicio no puede modificarse después de guardar", "SERVICE_DATE_LOCKED");
    }
    const changes: Record<string, unknown> = {};
    for (const c of ["provider_name", "service_type", "amount", "payment_date"] as const) {
      if (data[c] !== undefined) changes[c] = data[c];
    }
    if (req.body?.receipt_key !== undefined) changes.receipt_url = data.receipt_key;
    const cols = Object.keys(changes);
    if (cols.length === 0) throw new HttpError(400, "No hay campos para actualizar");
    await tx.query(`UPDATE third_party_payments SET ${cols.map((c) => `${c} = ?`).join(", ")} WHERE id = ?`, [
      ...cols.map((c) => changes[c]),
      id,
    ]);
    const [row] = await tx.query("SELECT * FROM third_party_payments WHERE id = ?", [id]);
    await audit(tx, req.user!.id, "UPDATE", "third_party_payments", id, { before: existing, after: row });
    return row;
  });
  res.json(payment);
});
