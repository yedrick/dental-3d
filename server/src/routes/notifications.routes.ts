import { Router } from "express";
import { z } from "zod";
import { db, withTransaction } from "../db.js";
import { audit } from "../lib/audit.js";
import { HttpError } from "../lib/http-error.js";
import { paged, paginate, paginationSchema } from "../lib/query.js";
import { uuid } from "../lib/schemas.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";

/**
 * Notificaciones internas de la sucursal. Supabase las empujaba en tiempo real; aquí el
 * frontend consulta GET /unread-count cada 30 s (responde 304 con ETag si no cambió).
 */
export const notificationsRouter = Router();
notificationsRouter.use(requireAuth);

const listSchema = paginationSchema.and(z.object({ unread: z.enum(["true", "false"]).optional() }));

/** Recibidas por el usuario actual. */
notificationsRouter.get("/", async (req, res) => {
  const f = listSchema.parse(req.query);
  const where = ["nr.user_id = ?"];
  const params: unknown[] = [req.user!.id];
  if (f.unread === "true") where.push("nr.read_at IS NULL");
  const whereSql = "WHERE " + where.join(" AND ");
  const { limit, offset } = paginate(f.page, f.limit);
  const [rows, [{ total }]] = await Promise.all([
    db().query(
      `SELECT nr.id, nr.read_at, nr.created_at, n.id AS notification_id, n.title, n.body,
              n.sender_id, u.full_name AS sender_name
         FROM notification_recipients nr
         JOIN notifications n ON n.id = nr.notification_id
         LEFT JOIN users u ON u.id = n.sender_id
         ${whereSql} ORDER BY nr.created_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    ),
    db().query<{ total: number }[]>(`SELECT COUNT(*) AS total FROM notification_recipients nr ${whereSql}`, params),
  ]);
  res.json(paged(rows, Number(total), f.page, f.limit));
});

notificationsRouter.get("/unread-count", async (req, res) => {
  const [{ count }] = await db().query<{ count: number }[]>(
    "SELECT COUNT(*) AS count FROM notification_recipients WHERE user_id = ? AND read_at IS NULL",
    [req.user!.id],
  );
  res.json({ count: Number(count) });
});

notificationsRouter.post("/read-all", async (req, res) => {
  const result = await db().query<{ affectedRows: number }>(
    "UPDATE notification_recipients SET read_at = UTC_TIMESTAMP() WHERE user_id = ? AND read_at IS NULL",
    [req.user!.id],
  );
  res.json({ updated: result.affectedRows });
});

/** Marca como leída una notificación recibida (solo las propias). */
notificationsRouter.post("/:id/read", async (req, res) => {
  const result = await db().query<{ affectedRows: number }>(
    "UPDATE notification_recipients SET read_at = COALESCE(read_at, UTC_TIMESTAMP()) WHERE id = ? AND user_id = ?",
    [String(req.params.id), req.user!.id],
  );
  if (result.affectedRows === 0) throw new HttpError(404, "Notificación no encontrada");
  res.json({ ok: true });
});

// ---------- Enviar (permiso notifications.send; ADMIN lo tiene) ----------

/** Usuarios activos de la sucursal, para elegir destinatarios. */
notificationsRouter.get("/recipients", requirePermission("notifications.send"), async (_req, res) => {
  res.json(await db().query(
    "SELECT id, full_name, username FROM users WHERE active = 1 AND approved = 1 ORDER BY full_name",
  ));
});

/** Enviadas por el usuario actual, con cuántos las leyeron. */
notificationsRouter.get("/sent", requirePermission("notifications.send"), async (req, res) => {
  const f = paginationSchema.parse(req.query);
  const { limit, offset } = paginate(f.page, f.limit);
  const [rows, [{ total }]] = await Promise.all([
    db().query(
      `SELECT n.id, n.title, n.body, n.created_at,
              COUNT(nr.id) AS recipients, SUM(nr.read_at IS NOT NULL) AS read_count
         FROM notifications n LEFT JOIN notification_recipients nr ON nr.notification_id = n.id
        WHERE n.sender_id = ?
        GROUP BY n.id ORDER BY n.created_at DESC LIMIT ? OFFSET ?`,
      [req.user!.id, limit, offset],
    ),
    db().query<{ total: number }[]>("SELECT COUNT(*) AS total FROM notifications WHERE sender_id = ?", [req.user!.id]),
  ]);
  res.json(paged(
    (rows as { recipients: number; read_count: number | null }[]).map((r) => ({ ...r, recipients: Number(r.recipients), read_count: Number(r.read_count ?? 0) })),
    Number(total), f.page, f.limit,
  ));
});

const sendSchema = z.object({
  title: z.string().trim().min(1, "Título requerido").max(200),
  body: z.string().trim().min(1, "Mensaje requerido").max(5000),
  // "all" = todos los usuarios activos de la sucursal (menos quien envía)
  target: z.union([z.literal("all"), z.array(uuid).min(1).max(500)]),
});

notificationsRouter.post("/", requirePermission("notifications.send"), async (req, res) => {
  const data = sendSchema.parse(req.body);
  const result = await withTransaction(async (tx) => {
    const users = data.target === "all"
      ? await tx.query<{ id: string }[]>("SELECT id FROM users WHERE active = 1 AND approved = 1 AND id <> ?", [req.user!.id])
      : await tx.query<{ id: string }[]>("SELECT id FROM users WHERE active = 1 AND id IN (?)", [data.target]);
    if (users.length === 0) throw new HttpError(400, "No hay destinatarios válidos");

    const [{ id }] = await tx.query<{ id: string }[]>("SELECT UUID() AS id");
    await tx.query("INSERT INTO notifications (id, sender_id, title, body) VALUES (?, ?, ?, ?)", [id, req.user!.id, data.title, data.body]);
    await tx.query("INSERT INTO notification_recipients (notification_id, user_id) VALUES ?", [users.map((u) => [id, u.id])]);
    await audit(tx, req.user!.id, "NOTIFICATION_SEND", "notifications", id, { title: data.title, recipients: users.length });
    return { id, recipients: users.length };
  });
  res.status(201).json(result);
});
