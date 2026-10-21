import { Router } from "express";
import { z } from "zod";
import { db } from "../db.js";
import { dateRangeSchema, dayRange, paged, paginate, paginationSchema } from "../lib/query.js";
import { uuid } from "../lib/schemas.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";

// Vista de auditoría (solo lectura; nadie puede editar ni borrar audit_logs desde la API).
export const auditRouter = Router();
auditRouter.use(requireAuth, requirePermission("view.audit"));

const listSchema = paginationSchema.and(dateRangeSchema).and(z.object({
  user_id: uuid.optional(),
  table_name: z.string().max(100).optional(),
  action: z.string().max(50).optional(),
  record_id: z.string().max(100).optional(),
}));

auditRouter.get("/", async (req, res) => {
  const f = listSchema.parse(req.query);
  const where: string[] = [];
  const params: unknown[] = [];
  if (f.from || f.to) {
    const [start, end] = dayRange(f.from ?? "2000-01-01", f.to ?? "2999-12-31");
    where.push("a.`timestamp` >= ? AND a.`timestamp` < ?");
    params.push(start, end);
  }
  for (const c of ["user_id", "table_name", "action", "record_id"] as const) {
    if (f[c]) { where.push(`a.${c} = ?`); params.push(f[c]); }
  }
  const whereSql = where.length ? "WHERE " + where.join(" AND ") : "";
  const { limit, offset } = paginate(f.page, f.limit);
  const [rows, [{ total }]] = await Promise.all([
    db().query(
      `SELECT a.id, a.user_id, u.full_name AS user_name, a.action, a.table_name, a.record_id, a.data, a.\`timestamp\`
         FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
         ${whereSql} ORDER BY a.id DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    ),
    db().query<{ total: number }[]>(`SELECT COUNT(*) AS total FROM audit_logs a ${whereSql}`, params),
  ]);
  res.json(paged(rows, Number(total), f.page, f.limit));
});

/** Valores para los filtros de la pantalla. */
auditRouter.get("/facets", async (_req, res) => {
  const [tables, actions] = await Promise.all([
    db().query<{ v: string }[]>("SELECT DISTINCT table_name AS v FROM audit_logs ORDER BY v"),
    db().query<{ v: string }[]>("SELECT DISTINCT action AS v FROM audit_logs ORDER BY v"),
  ]);
  res.json({ tables: tables.map((r) => r.v), actions: actions.map((r) => r.v) });
});
