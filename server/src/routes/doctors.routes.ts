import { Router } from "express";
import { z } from "zod";
import { db, withTransaction, type Db } from "../db.js";
import { audit } from "../lib/audit.js";
import { cache, CacheKeys, CacheTtl, invalidate } from "../lib/cache.js";
import { HttpError } from "../lib/http-error.js";
import { optionalEmail, optionalText } from "../lib/schemas.js";
import { requireAuth, requirePermission, requireRole } from "../middleware/auth.js";

export const doctorsRouter = Router();
doctorsRouter.use(requireAuth);

const doctorSchema = z.object({
  full_name: z.string().trim().min(1, "Nombre requerido").max(200),
  clinic_address: optionalText(),
  phone: optionalText(50),
  email: optionalEmail,
  bank_account: optionalText(100),
  status: z.boolean().default(true),
  use_percentage: z.boolean().default(false),
  default_commission_pct: z.number().min(0).max(20, "La comisión no puede superar 20%").default(0),
  agreement_discount_pct: z.number().min(0).max(100).default(0),
});

const COLUMNS = Object.keys(doctorSchema.shape) as (keyof typeof doctorSchema.shape)[];

async function findDoctor(q: Db, id: string) {
  const rows = await q.query("SELECT * FROM doctors WHERE id = ?", [id]);
  return rows[0] ?? null;
}

// Lectura: mismos roles que la política RLS "Read doctors" (otros módulos necesitan la lista)
const canRead = requireRole("ADMIN", "SUBADMIN", "RECEPCION", "CAJA", "CONTABILIDAD", "AUDITOR");

doctorsRouter.get("/", canRead, async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const status = req.query.status;

  // La lista completa se cachea (la usan varias pantallas); las búsquedas van directo a MySQL
  if (!q && status === undefined) {
    let hit = true;
    const rows = await cache().remember(CacheKeys.doctorsList, CacheTtl.doctorsList, () => {
      hit = false;
      return db().query("SELECT * FROM doctors ORDER BY full_name");
    });
    res.setHeader("X-Cache", hit ? "HIT" : "MISS");
    return res.json(rows);
  }

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
  const rows = await db().query(
    `SELECT * FROM doctors ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY full_name`,
    params,
  );
  res.json(rows);
});

doctorsRouter.get("/:id", canRead, async (req, res) => {
  const doctor = await findDoctor(db(), String(req.params.id));
  if (!doctor) throw new HttpError(404, "Doctor no encontrado");
  res.json(doctor);
});

doctorsRouter.post("/", requirePermission("doctors.create"), async (req, res) => {
  const data = doctorSchema.parse(req.body);
  const doctor = await withTransaction(async (tx) => {
    const [{ id }] = await tx.query<{ id: string }[]>("SELECT UUID() AS id");
    await tx.query(
      `INSERT INTO doctors (id, ${COLUMNS.join(", ")}, created_by) VALUES (?, ${COLUMNS.map(() => "?").join(", ")}, ?)`,
      [id, ...COLUMNS.map((c) => data[c]), req.user!.id],
    );
    const created = await findDoctor(tx, id);
    await audit(tx, req.user!.id, "INSERT", "doctors", id, created);
    return created;
  });
  await invalidate(CacheKeys.doctorsList);
  res.status(201).json(doctor);
});

// PATCH parcial: permite cambiar solo "status" (activar/desactivar) o cualquier otro campo
doctorsRouter.patch("/:id", requirePermission("doctors.edit"), async (req, res) => {
  const id = String(req.params.id);
  const data = doctorSchema.partial().parse(req.body);
  const fields = COLUMNS.filter((c) => req.body?.[c] !== undefined);
  if (fields.length === 0) throw new HttpError(400, "No hay campos para actualizar");

  const doctor = await withTransaction(async (tx) => {
    if (!(await findDoctor(tx, id))) throw new HttpError(404, "Doctor no encontrado");
    await tx.query(`UPDATE doctors SET ${fields.map((c) => `${c} = ?`).join(", ")} WHERE id = ?`, [
      ...fields.map((c) => data[c]),
      id,
    ]);
    const updated = await findDoctor(tx, id);
    await audit(tx, req.user!.id, "UPDATE", "doctors", id, updated);
    return updated;
  });
  await invalidate(CacheKeys.doctorsList);
  res.json(doctor);
});

doctorsRouter.delete("/:id", requirePermission("doctors.delete"), async (req, res) => {
  const id = String(req.params.id);
  await withTransaction(async (tx) => {
    const existing = await findDoctor(tx, id);
    if (!existing) throw new HttpError(404, "Doctor no encontrado");
    await tx.query("DELETE FROM doctors WHERE id = ?", [id]);
    await audit(tx, req.user!.id, "DELETE", "doctors", id, existing);
  });
  await invalidate(CacheKeys.doctorsList);
  res.status(204).end();
});
