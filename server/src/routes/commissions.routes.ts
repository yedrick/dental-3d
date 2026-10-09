import { Router } from "express";
import { z } from "zod";
import { db } from "../db.js";
import { dateRangeSchema, dayRange, paged, paginate, paginationSchema } from "../lib/query.js";
import { uuid } from "../lib/schemas.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";

// Las comisiones se generan solas al registrar una atención (services/attentions.ts).
// Aquí solo se consultan. Sin caché: es dinero.
export const commissionsRouter = Router();
commissionsRouter.use(requireAuth, requirePermission("view.commissions"));

const listSchema = paginationSchema.and(dateRangeSchema).and(z.object({ doctor_id: uuid.optional() }));

commissionsRouter.get("/", async (req, res) => {
  const f = listSchema.parse(req.query);
  const where: string[] = [];
  const params: unknown[] = [];
  if (f.from || f.to) {
    const [start, end] = dayRange(f.from ?? "2000-01-01", f.to ?? "2999-12-31");
    where.push("c.created_at >= ? AND c.created_at < ?");
    params.push(start, end);
  }
  if (f.doctor_id) { where.push("c.doctor_id = ?"); params.push(f.doctor_id); }
  const whereSql = where.length ? "WHERE " + where.join(" AND ") : "";
  const { limit, offset } = paginate(f.page, f.limit);

  const [rows, byDoctor] = await Promise.all([
    db().query(
      `SELECT c.*, d.full_name AS doctor_name,
              ps.patient_id, ps.study_id, ps.price, ps.has_report, ps.with_invoice, ps.is_voucher,
              p.full_name AS patient_name, s.name AS study_name
         FROM commissions c
         JOIN doctors d ON d.id = c.doctor_id
         JOIN patient_studies ps ON ps.id = c.patient_study_id
         JOIN patients p ON p.id = ps.patient_id
         JOIN studies s ON s.id = ps.study_id
         ${whereSql}
        ORDER BY c.created_at ASC LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    ),
    db().query<{ doctor_id: string; doctor_name: string; count: number; total: number }[]>(
      `SELECT c.doctor_id, d.full_name AS doctor_name, COUNT(*) AS count, SUM(c.commission_amount) AS total
         FROM commissions c JOIN doctors d ON d.id = c.doctor_id
         ${whereSql}
        GROUP BY c.doctor_id, d.full_name
        ORDER BY total DESC`,
      params,
    ),
  ]);
  const count = byDoctor.reduce((s, r) => s + Number(r.count), 0);
  res.json({
    ...paged(rows, count, f.page, f.limit),
    summary: {
      total: Number(byDoctor.reduce((s, r) => s + Number(r.total), 0).toFixed(2)),
      by_doctor: byDoctor.map((r) => ({ ...r, count: Number(r.count), total: Number(r.total) })),
    },
  });
});
