import { Router } from "express";
import type { RowDataPacket } from "mysql2";
import { z } from "zod";
import { pool, withTransaction, type Conn } from "../db.js";
import { audit } from "../lib/audit.js";
import { HttpError } from "../lib/http-error.js";
import { requireAuth, requirePermission, requireRole } from "../middleware/auth.js";

export const doctorsRouter = Router();
doctorsRouter.use(requireAuth);

const optionalText = z
  .string()
  .trim()
  .max(500)
  .nullish()
  .transform((v) => (v ? v : null));

const doctorSchema = z.object({
  full_name: z.string().trim().min(1, "Nombre requerido").max(200),
  clinic_address: optionalText,
  phone: optionalText,
  email: z.union([z.email("Email inválido"), z.literal(""), z.null()]).optional().transform((v) => v || null),
  bank_account: optionalText,
  status: z.boolean().default(true),
  use_percentage: z.boolean().default(false),
  default_commission_pct: z.number().min(0).max(20, "La comisión no puede superar 20%").default(0),
  agreement_discount_pct: z.number().min(0).max(100).default(0),
});

const COLUMNS = Object.keys(doctorSchema.shape) as (keyof typeof doctorSchema.shape)[];

async function findDoctor(conn: Conn | typeof pool, id: string) {
  const [rows] = await conn.query<RowDataPacket[]>("SELECT * FROM doctors WHERE id = ?", [id]);
  return rows[0] ?? null;
}

// Lectura: mismos roles que la política RLS "Read doctors" (otros módulos necesitan la lista)
const canRead = requireRole("ADMIN", "SUBADMIN", "RECEPCION", "CAJA", "CONTABILIDAD", "AUDITOR");

doctorsRouter.get("/", canRead, async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const status = req.query.status;
  const where: string[] = [];
  const params: unknown[] = [];
  if (q) {
    where.push("(full_name LIKE ? OR phone LIKE ? OR email LIKE ?)");
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (status === "true" || status === "false") {
    where.push("status = ?");
    params.push(status === "true");
  }
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT * FROM doctors ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY full_name`,
    params,
  );
  res.json(rows);
});

doctorsRouter.get("/:id", canRead, async (req, res) => {
  const id = String(req.params.id);
  const doctor = await findDoctor(pool, id);
  if (!doctor) throw new HttpError(404, "Doctor no encontrado");
  res.json(doctor);
});

doctorsRouter.post("/", requirePermission("doctors.create"), async (req, res) => {
  const data = doctorSchema.parse(req.body);
  const doctor = await withTransaction(async (conn) => {
    const [idRow] = await conn.query<RowDataPacket[]>("SELECT UUID() AS id");
    const id = idRow[0].id as string;
    await conn.query(
      `INSERT INTO doctors (id, ${COLUMNS.join(", ")}, created_by) VALUES (?, ${COLUMNS.map(() => "?").join(", ")}, ?)`,
      [id, ...COLUMNS.map((c) => data[c]), req.user!.id],
    );
    const created = await findDoctor(conn, id);
    await audit(conn, req.user!.id, "INSERT", "doctors", id, created);
    return created;
  });
  res.status(201).json(doctor);
});

// PATCH parcial: permite cambiar solo "status" (activar/desactivar) o cualquier otro campo
doctorsRouter.patch("/:id", requirePermission("doctors.edit"), async (req, res) => {
  const id = String(req.params.id);
  const data = doctorSchema.partial().parse(req.body);
  const fields = COLUMNS.filter((c) => req.body?.[c] !== undefined);
  if (fields.length === 0) throw new HttpError(400, "No hay campos para actualizar");

  const doctor = await withTransaction(async (conn) => {
    if (!(await findDoctor(conn, id))) throw new HttpError(404, "Doctor no encontrado");
    await conn.query(`UPDATE doctors SET ${fields.map((c) => `${c} = ?`).join(", ")} WHERE id = ?`, [
      ...fields.map((c) => data[c]),
      id,
    ]);
    const updated = await findDoctor(conn, id);
    await audit(conn, req.user!.id, "UPDATE", "doctors", id, updated);
    return updated;
  });
  res.json(doctor);
});

doctorsRouter.delete("/:id", requirePermission("doctors.delete"), async (req, res) => {
  const id = String(req.params.id);
  await withTransaction(async (conn) => {
    const existing = await findDoctor(conn, id);
    if (!existing) throw new HttpError(404, "Doctor no encontrado");
    await conn.query("DELETE FROM doctors WHERE id = ?", [id]);
    await audit(conn, req.user!.id, "DELETE", "doctors", id, existing);
  });
  res.status(204).end();
});
