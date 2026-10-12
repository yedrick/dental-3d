import { Router } from "express";
import { z } from "zod";
import { db, withTransaction, type Db } from "../db.js";
import { audit } from "../lib/audit.js";
import { HttpError } from "../lib/http-error.js";
import { paged, paginate, paginationSchema } from "../lib/query.js";
import { optionalEmail, optionalText, uuid } from "../lib/schemas.js";
import { requireAuth, requirePermission, requireRole } from "../middleware/auth.js";
import { ATTENTION_TOTALS_SQL } from "../services/attentions.js";

export const patientsRouter = Router();
patientsRouter.use(requireAuth);

// Mismos roles que la política RLS "Read patients"
const canRead = requireRole("ADMIN", "SUBADMIN", "RECEPCION", "CAJA", "CONTABILIDAD", "DOCTOR", "AUDITOR");

const patientSchema = z.object({
  // Opcional: un paciente nuevo puede no tener doctor (sus atenciones van sin comisión)
  doctor_id: uuid.nullish().transform((v) => v ?? null),
  full_name: z.string().trim().min(1, "Nombre requerido").max(200),
  birth_date: z.iso
    .date("Fecha inválida (YYYY-MM-DD)")
    .refine((d) => d <= new Date().toISOString().slice(0, 10), "La fecha de nacimiento no puede ser futura")
    .nullish()
    .transform((v) => v ?? null),
  phone: optionalText(50),
  email: optionalEmail,
  notes: optionalText(2000),
  status: z.boolean().default(true),
});
const COLUMNS = Object.keys(patientSchema.shape) as (keyof typeof patientSchema.shape)[];

const listSchema = paginationSchema.extend({
  q: z.string().trim().max(100).optional(),
  doctor_id: z.union([uuid, z.literal("none")]).optional(), // "none" = pacientes sin doctor
  status: z.enum(["true", "false"]).optional(),
  sort: z.enum(["recent", "name"]).default("recent"),
});

async function findPatient(q: Db, id: string) {
  const rows = await q.query(
    `SELECT p.*, d.full_name AS doctor_name
       FROM patients p LEFT JOIN doctors d ON d.id = p.doctor_id
      WHERE p.id = ?`,
    [id],
  );
  return rows[0] ?? null;
}

async function assertDoctorExists(q: Db, doctorId: string) {
  const rows = await q.query("SELECT id FROM doctors WHERE id = ?", [doctorId]);
  if (!rows[0]) throw new HttpError(400, "El doctor indicado no existe");
}

patientsRouter.get("/", canRead, async (req, res) => {
  const f = listSchema.parse(req.query);
  const where: string[] = [];
  const params: unknown[] = [];
  if (f.q) {
    where.push("(p.full_name LIKE ? OR p.phone LIKE ? OR p.email LIKE ?)");
    params.push(`%${f.q}%`, `%${f.q}%`, `%${f.q}%`);
  }
  if (f.doctor_id === "none") where.push("p.doctor_id IS NULL");
  else if (f.doctor_id) { where.push("p.doctor_id = ?"); params.push(f.doctor_id); }
  if (f.status) { where.push("p.status = ?"); params.push(f.status === "true"); }
  const whereSql = where.length ? "WHERE " + where.join(" AND ") : "";
  const { limit, offset } = paginate(f.page, f.limit);

  const [rows, [{ total }]] = await Promise.all([
    db().query(
      `SELECT p.*, d.full_name AS doctor_name
         FROM patients p LEFT JOIN doctors d ON d.id = p.doctor_id
         ${whereSql}
        ORDER BY ${f.sort === "name" ? "p.full_name ASC" : "p.created_at DESC"}
        LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    ),
    db().query<{ total: number }[]>(`SELECT COUNT(*) AS total FROM patients p ${whereSql}`, params),
  ]);
  res.json(paged(rows, Number(total), f.page, f.limit));
});

patientsRouter.get("/:id", canRead, async (req, res) => {
  const patient = await findPatient(db(), String(req.params.id));
  if (!patient) throw new HttpError(404, "Paciente no encontrado");
  res.json(patient);
});

/** Historial de atenciones del paciente, con total y saldo de cada una. */
patientsRouter.get("/:id/attentions", canRead, async (req, res) => {
  const id = String(req.params.id);
  if (!(await findPatient(db(), id))) throw new HttpError(404, "Paciente no encontrado");
  const rows = await db().query(
    `SELECT ps.*, s.name AS study_name, ${ATTENTION_TOTALS_SQL}
       FROM patient_studies ps JOIN studies s ON s.id = ps.study_id
      WHERE ps.patient_id = ?
      ORDER BY ps.created_at DESC`,
    [id],
  );
  res.json(rows);
});

patientsRouter.post("/", requirePermission("patients.create"), async (req, res) => {
  const data = patientSchema.parse(req.body);
  const patient = await withTransaction(async (tx) => {
    if (data.doctor_id) await assertDoctorExists(tx, data.doctor_id);
    const [{ id }] = await tx.query<{ id: string }[]>("SELECT UUID() AS id");
    await tx.query(
      `INSERT INTO patients (id, ${COLUMNS.join(", ")}, created_by) VALUES (?, ${COLUMNS.map(() => "?").join(", ")}, ?)`,
      [id, ...COLUMNS.map((c) => data[c]), req.user!.id],
    );
    const created = await findPatient(tx, id);
    await audit(tx, req.user!.id, "INSERT", "patients", id, created);
    return created;
  });
  res.status(201).json(patient);
});

patientsRouter.patch("/:id", requirePermission("patients.edit"), async (req, res) => {
  const id = String(req.params.id);
  const data = patientSchema.partial().parse(req.body);
  const fields = COLUMNS.filter((c) => req.body?.[c] !== undefined);
  if (fields.length === 0) throw new HttpError(400, "No hay campos para actualizar");

  const patient = await withTransaction(async (tx) => {
    if (!(await findPatient(tx, id))) throw new HttpError(404, "Paciente no encontrado");
    if (data.doctor_id) await assertDoctorExists(tx, data.doctor_id);
    await tx.query(`UPDATE patients SET ${fields.map((c) => `${c} = ?`).join(", ")} WHERE id = ?`, [
      ...fields.map((c) => data[c]),
      id,
    ]);
    const updated = await findPatient(tx, id);
    await audit(tx, req.user!.id, "UPDATE", "patients", id, updated);
    return updated;
  });
  res.json(patient);
});

patientsRouter.delete("/:id", requirePermission("patients.delete"), async (req, res) => {
  const id = String(req.params.id);
  await withTransaction(async (tx) => {
    const existing = await findPatient(tx, id);
    if (!existing) throw new HttpError(404, "Paciente no encontrado");
    const [{ n }] = await tx.query<{ n: number }[]>("SELECT COUNT(*) AS n FROM patient_studies WHERE patient_id = ?", [id]);
    if (n > 0) {
      throw new HttpError(409, `No se puede eliminar: el paciente tiene ${n} atención(es) registradas. Desactívalo en su lugar.`);
    }
    await tx.query("DELETE FROM patients WHERE id = ?", [id]);
    await audit(tx, req.user!.id, "DELETE", "patients", id, existing);
  });
  res.status(204).end();
});
