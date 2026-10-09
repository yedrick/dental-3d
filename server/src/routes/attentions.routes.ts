import { Router } from "express";
import { z } from "zod";
import { db, withTransaction } from "../db.js";
import { audit } from "../lib/audit.js";
import { HttpError } from "../lib/http-error.js";
import { fromCents, toCents } from "../lib/money.js";
import { dateRangeSchema, dayRange, paged, paginate, paginationSchema } from "../lib/query.js";
import { money, optionalText, uuid } from "../lib/schemas.js";
import { requireAuth, requirePermission, requireRole } from "../middleware/auth.js";
import { ATTENTION_TOTALS_SQL, createAttention } from "../services/attentions.js";

// Atenciones = patient_studies (paciente + estudio). Registrar, cobrar y entregar.
export const attentionsRouter = Router();
attentionsRouter.use(requireAuth);

const canRead = requireRole("ADMIN", "SUBADMIN", "RECEPCION", "CAJA", "CONTABILIDAD", "AUDITOR", "DOCTOR");
const paymentMethod = z.enum(["cash", "qr", "card"]);

const createSchema = z.object({
  patient_id: uuid,
  doctor_id: uuid.nullish().transform((v) => v ?? null), // por defecto, el doctor del paciente
  clinic_name: optionalText(200),
  with_invoice: z.boolean().default(false),
  invoice_number: optionalText(100),
  payment_method: paymentMethod.nullish().transform((v) => v ?? null),
  amount_paid: money.default(0),
  delivery_date: z.iso.date("Fecha inválida (YYYY-MM-DD)").nullish().transform((v) => v ?? null),
  items: z
    .array(z.object({ study_id: uuid, has_report: z.boolean().default(false), is_voucher: z.boolean().default(false) }))
    .min(1, "Agrega al menos un estudio")
    .max(30),
});

const listSchema = paginationSchema.and(dateRangeSchema).and(
  z.object({
    q: z.string().trim().max(100).optional(),
    patient_id: uuid.optional(),
    doctor_id: uuid.optional(),
    status: z.enum(["debt", "paid", "pending_delivery", "delivered"]).optional(),
  }),
);

/** Lista con filtros, total y saldo de cada fila, y resumen de todo el filtro. */
attentionsRouter.get("/", canRead, async (req, res) => {
  const f = listSchema.parse(req.query);
  const where: string[] = [];
  const params: unknown[] = [];
  if (f.from || f.to) {
    const [start, end] = dayRange(f.from ?? "2000-01-01", f.to ?? "2999-12-31");
    where.push("ps.created_at >= ? AND ps.created_at < ?");
    params.push(start, end);
  }
  if (f.patient_id) { where.push("ps.patient_id = ?"); params.push(f.patient_id); }
  if (f.doctor_id) { where.push("ps.doctor_id = ?"); params.push(f.doctor_id); }
  if (f.q) { where.push("p.full_name LIKE ?"); params.push(`%${f.q}%`); }
  if (f.status === "debt") where.push("ps.price + ps.invoice_surcharge - ps.discount - ps.amount_paid > 0");
  if (f.status === "paid") where.push("ps.price + ps.invoice_surcharge - ps.discount - ps.amount_paid <= 0");
  if (f.status === "pending_delivery") where.push("ps.delivered_at IS NULL");
  if (f.status === "delivered") where.push("ps.delivered_at IS NOT NULL");
  const whereSql = where.length ? "WHERE " + where.join(" AND ") : "";
  const from = `FROM patient_studies ps
    JOIN patients p ON p.id = ps.patient_id
    JOIN studies s ON s.id = ps.study_id
    LEFT JOIN doctors d ON d.id = ps.doctor_id`;
  const { limit, offset } = paginate(f.page, f.limit);

  const [rows, [summary]] = await Promise.all([
    db().query(
      `SELECT ps.*, p.full_name AS patient_name, s.name AS study_name, d.full_name AS doctor_name, ${ATTENTION_TOTALS_SQL}
         ${from} ${whereSql}
        ORDER BY ps.created_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    ),
    db().query<{ count: number; total: number | null; paid: number | null; debt: number | null }[]>(
      `SELECT COUNT(*) AS count,
              SUM(ps.price + ps.invoice_surcharge - ps.discount) AS total,
              SUM(ps.amount_paid) AS paid,
              SUM(ps.price + ps.invoice_surcharge - ps.discount - ps.amount_paid) AS debt
         ${from} ${whereSql}`,
      params,
    ),
  ]);
  res.json({
    ...paged(rows, Number(summary.count), f.page, f.limit),
    summary: { total: Number(summary.total ?? 0), paid: Number(summary.paid ?? 0), debt: Number(summary.debt ?? 0) },
  });
});

/**
 * Registra una atención con uno o varios estudios. El precio, el recargo por factura, el
 * descuento por convenio y la comisión los calcula el servidor; el cliente solo dice qué
 * estudios y cuánto pagó.
 */
attentionsRouter.post("/", requirePermission("attention.create"), async (req, res) => {
  const data = createSchema.parse(req.body);
  const result = await withTransaction((tx) => createAttention(tx, data, req.user!.id));
  res.status(201).json(result);
});

const chargeSchema = z.object({
  amount: money.refine((v) => v > 0, "El monto debe ser mayor a 0"),
  payment_method: paymentMethod.optional(),
});

/** Cobra parte o todo el saldo de una atención. */
attentionsRouter.post("/:id/charge", requirePermission("attention.charge"), async (req, res) => {
  const id = String(req.params.id);
  const data = chargeSchema.parse(req.body);
  const result = await withTransaction(async (tx) => {
    // FOR UPDATE: dos cobros simultáneos no pueden pasarse del saldo
    const [row] = await tx.query<{ patient_id: string; total: number; amount_paid: number; patient_name: string }[]>(
      `SELECT ps.patient_id, ps.amount_paid, p.full_name AS patient_name,
              (ps.price + ps.invoice_surcharge - ps.discount) AS total
         FROM patient_studies ps JOIN patients p ON p.id = ps.patient_id
        WHERE ps.id = ? FOR UPDATE`,
      [id],
    );
    if (!row) throw new HttpError(404, "Atención no encontrada");
    const debtCents = toCents(row.total) - toCents(row.amount_paid);
    const amountCents = toCents(data.amount);
    if (debtCents <= 0) throw new HttpError(400, "Esta atención no tiene saldo pendiente");
    if (amountCents > debtCents) throw new HttpError(400, `El monto supera el saldo pendiente (${fromCents(debtCents)})`);

    const newPaid = fromCents(toCents(row.amount_paid) + amountCents);
    await tx.query(
      `UPDATE patient_studies SET amount_paid = ?${data.payment_method ? ", payment_method = ?" : ""} WHERE id = ?`,
      data.payment_method ? [newPaid, data.payment_method, id] : [newPaid, id],
    );
    const out = {
      patient_id: row.patient_id, patient_name: row.patient_name, amount: data.amount,
      payment_method: data.payment_method ?? null,
      balance_before: fromCents(debtCents), balance_after: fromCents(debtCents - amountCents), amount_paid: newPaid,
    };
    await audit(tx, req.user!.id, "CHARGE", "patient_studies", id, out);
    return out;
  });
  res.json(result);
});

/** Cobra todo el saldo pendiente de un paciente. */
attentionsRouter.post("/charge-all", requirePermission("attention.charge"), async (req, res) => {
  const { patient_id, payment_method } = z.object({ patient_id: uuid, payment_method: paymentMethod.optional() }).parse(req.body);
  const result = await withTransaction(async (tx) => {
    const rows = await tx.query<{ id: string; total: number; amount_paid: number }[]>(
      `SELECT id, amount_paid, (price + invoice_surcharge - discount) AS total
         FROM patient_studies
        WHERE patient_id = ? AND price + invoice_surcharge - discount - amount_paid > 0
        FOR UPDATE`,
      [patient_id],
    );
    if (rows.length === 0) throw new HttpError(400, "El paciente no tiene saldo pendiente");
    const debtCents = rows.reduce((s, r) => s + toCents(r.total) - toCents(r.amount_paid), 0);
    for (const r of rows) {
      await tx.query(
        `UPDATE patient_studies SET amount_paid = ?${payment_method ? ", payment_method = ?" : ""} WHERE id = ?`,
        payment_method ? [r.total, payment_method, r.id] : [r.total, r.id],
      );
    }
    const out = { patient_id, items: rows.length, amount: fromCents(debtCents), balance_before: fromCents(debtCents), balance_after: 0 };
    await audit(tx, req.user!.id, "CHARGE_ALL", "patient_studies", patient_id, { ...out, ids: rows.map((r) => r.id) });
    return out;
  });
  res.json(result);
});

/** Marca como entregados uno o varios estudios (los ya entregados se ignoran). */
attentionsRouter.post("/deliver", requirePermission("attention.deliver"), async (req, res) => {
  const { ids } = z.object({ ids: z.array(uuid).min(1).max(100) }).parse(req.body);
  const result = await withTransaction(async (tx) => {
    const pending = await tx.query<{ id: string; patient_id: string }[]>(
      "SELECT id, patient_id FROM patient_studies WHERE id IN (?) AND delivered_at IS NULL FOR UPDATE",
      [ids],
    );
    if (pending.length > 0) {
      await tx.query(
        "UPDATE patient_studies SET delivered_at = UTC_TIMESTAMP(), delivered_by = ? WHERE id IN (?)",
        [req.user!.id, pending.map((r) => r.id)],
      );
      await audit(tx, req.user!.id, "DELIVER", "patient_studies", pending[0].patient_id, {
        ids: pending.map((r) => r.id),
        patient_ids: [...new Set(pending.map((r) => r.patient_id))],
      });
    }
    return { delivered: pending.length, already_delivered_or_missing: ids.length - pending.length };
  });
  res.json(result);
});
