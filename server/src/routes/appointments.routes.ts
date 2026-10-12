import { Router } from "express";
import { z } from "zod";
import { db, withTransaction, type Db } from "../db.js";
import { audit } from "../lib/audit.js";
import { HttpError } from "../lib/http-error.js";
import { dateRangeSchema, dayRange } from "../lib/query.js";
import { optionalText, uuid } from "../lib/schemas.js";
import { doctorScope, requireAuth, requirePermission } from "../middleware/auth.js";

// Agenda de citas. starts_at se recibe con zona horaria (2026-10-10T09:30:00-04:00) y se guarda en UTC.
export const appointmentsRouter = Router();
appointmentsRouter.use(requireAuth);

// Mismos roles que la política RLS "appointments_read"
// Lectura: Agenda (view.appointments). Un usuario DOCTOR solo ve sus citas.
const canRead = requirePermission("view.appointments");
const STATUSES = ["SCHEDULED", "CONFIRMED", "DONE", "CANCELLED", "NO_SHOW"] as const;

const startsAt = z.iso
  .datetime({ offset: true, message: "Fecha y hora inválidas: usa ISO con zona (2026-10-10T09:30:00-04:00)" })
  .transform((v) => new Date(v).toISOString().slice(0, 19).replace("T", " "));

const appointmentSchema = z.object({
  patient_id: uuid.nullish().transform((v) => v ?? null),
  patient_name: z.string().trim().max(200).optional(),
  patient_phone: optionalText(50),
  doctor_id: uuid.nullish().transform((v) => v ?? null),
  study_id: uuid.nullish().transform((v) => v ?? null),
  starts_at: startsAt,
  duration_min: z.number().int().min(5).max(480).default(30),
  status: z.enum(STATUSES).default("SCHEDULED"),
  notes: optionalText(2000),
});
type AppointmentInput = z.infer<typeof appointmentSchema>;
const COLUMNS = ["patient_id", "patient_name", "patient_phone", "doctor_id", "study_id", "starts_at", "duration_min", "status", "notes"] as const;

const listSchema = dateRangeSchema.and(
  z.object({ status: z.enum(STATUSES).optional(), doctor_id: uuid.optional(), patient_id: uuid.optional() }),
);

const SELECT = `SELECT a.*, d.full_name AS doctor_name, s.name AS study_name
  FROM appointments a
  LEFT JOIN doctors d ON d.id = a.doctor_id
  LEFT JOIN studies s ON s.id = a.study_id`;

async function findAppointment(q: Db, id: string) {
  const rows = await q.query(`${SELECT} WHERE a.id = ?`, [id]);
  return rows[0] ?? null;
}

/** DATETIME leído de MySQL (Date en UTC) → 'YYYY-MM-DD HH:MM:SS'. */
const toSqlUtc = (v: Date | string) => (v instanceof Date ? v.toISOString().slice(0, 19).replace("T", " ") : v);

/** Completa nombre/teléfono/doctor desde el paciente y valida las referencias. */
async function resolveRefs(tx: Db, data: Partial<AppointmentInput>) {
  if (data.patient_id) {
    const [p] = await tx.query<{ full_name: string; phone: string | null; doctor_id: string }[]>(
      "SELECT full_name, phone, doctor_id FROM patients WHERE id = ?",
      [data.patient_id],
    );
    if (!p) throw new HttpError(400, "El paciente indicado no existe");
    data.patient_name ||= p.full_name;
    if (data.patient_phone === undefined || data.patient_phone === null) data.patient_phone = p.phone;
    if (data.doctor_id === undefined || data.doctor_id === null) data.doctor_id = p.doctor_id;
  }
  if (data.doctor_id && !(await tx.query("SELECT id FROM doctors WHERE id = ?", [data.doctor_id]))[0]) {
    throw new HttpError(400, "El doctor indicado no existe");
  }
  if (data.study_id && !(await tx.query("SELECT id FROM studies WHERE id = ?", [data.study_id]))[0]) {
    throw new HttpError(400, "El estudio indicado no existe");
  }
}

/** Citas activas (no canceladas ni ausentes) que se cruzan con el horario, para avisar. */
async function overlaps(q: Db, startsAtUtc: string, durationMin: number, doctorId: string | null, exceptId: string | null) {
  if (!doctorId) return [];
  return q.query(
    `SELECT id, patient_name, starts_at, duration_min FROM appointments
      WHERE doctor_id = ? AND id <> ? AND status IN ('SCHEDULED','CONFIRMED')
        AND starts_at < DATE_ADD(?, INTERVAL ? MINUTE)
        AND DATE_ADD(starts_at, INTERVAL duration_min MINUTE) > ?`,
    [doctorId, exceptId ?? "", startsAtUtc, durationMin, startsAtUtc],
  );
}

/** Citas de un rango de días locales (por defecto, el mes que pida el calendario). */
appointmentsRouter.get("/", canRead, async (req, res) => {
  const f = listSchema.parse(req.query);
  const where: string[] = [];
  const params: unknown[] = [];
  if (f.from || f.to) {
    const [start, end] = dayRange(f.from ?? "2000-01-01", f.to ?? "2999-12-31");
    where.push("a.starts_at >= ? AND a.starts_at < ?");
    params.push(start, end);
  }
  if (f.status) { where.push("a.status = ?"); params.push(f.status); }
  if (f.doctor_id) { where.push("a.doctor_id = ?"); params.push(f.doctor_id); }
  if (f.patient_id) { where.push("a.patient_id = ?"); params.push(f.patient_id); }
  const own = doctorScope(req.user);
  if (own !== undefined) { where.push("a.doctor_id = ?"); params.push(own); }
  const rows = await db().query(
    `${SELECT} ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY a.starts_at ASC LIMIT 2000`,
    params,
  );
  res.json(rows);
});

appointmentsRouter.get("/:id", canRead, async (req, res) => {
  const a = await findAppointment(db(), String(req.params.id));
  const own = doctorScope(req.user);
  if (!a || (own !== undefined && a.doctor_id !== own)) throw new HttpError(404, "Cita no encontrada");
  res.json(a);
});

appointmentsRouter.post("/", requirePermission("appointments.create"), async (req, res) => {
  const data = appointmentSchema.parse(req.body);
  const result = await withTransaction(async (tx) => {
    await resolveRefs(tx, data);
    if (!data.patient_name) throw new HttpError(400, "Nombre del paciente requerido");
    const [{ id }] = await tx.query<{ id: string }[]>("SELECT UUID() AS id");
    await tx.query(
      `INSERT INTO appointments (id, ${COLUMNS.join(", ")}, created_by) VALUES (?, ${COLUMNS.map(() => "?").join(", ")}, ?)`,
      [id, ...COLUMNS.map((c) => data[c] ?? null), req.user!.id],
    );
    const created = await findAppointment(tx, id);
    await audit(tx, req.user!.id, "APPOINTMENT_CREATE", "appointments", id, created);
    return { ...created, overlaps: await overlaps(tx, data.starts_at, data.duration_min, data.doctor_id, id) };
  });
  res.status(201).json(result);
});

appointmentsRouter.patch("/:id", requirePermission("appointments.edit"), async (req, res) => {
  const id = String(req.params.id);
  const parsed = appointmentSchema.partial().parse(req.body);
  // Solo los campos enviados (Zod 4 aplica los valores por defecto aun en esquemas parciales)
  const patch: Partial<AppointmentInput> = {};
  for (const c of COLUMNS) if (req.body?.[c] !== undefined) (patch as Record<string, unknown>)[c] = parsed[c];
  if (Object.keys(patch).length === 0) throw new HttpError(400, "No hay campos para actualizar");
  if (patch.patient_name === "") throw new HttpError(400, "Nombre del paciente requerido");

  const result = await withTransaction(async (tx) => {
    const existing = await findAppointment(tx, id);
    if (!existing) throw new HttpError(404, "Cita no encontrada");
    await resolveRefs(tx, patch); // si cambia el paciente, completa nombre, teléfono y doctor
    const fields = COLUMNS.filter((c) => patch[c] !== undefined);
    await tx.query(`UPDATE appointments SET ${fields.map((c) => `${c} = ?`).join(", ")} WHERE id = ?`, [
      ...fields.map((c) => patch[c] ?? null),
      id,
    ]);
    const updated = await findAppointment(tx, id);
    const onlyStatus = fields.length === 1 && fields[0] === "status";
    await audit(tx, req.user!.id, onlyStatus ? "APPOINTMENT_STATUS" : "APPOINTMENT_UPDATE", "appointments", id,
      onlyStatus ? { from: existing.status, to: updated.status, patient_name: updated.patient_name } : { before: existing, after: updated });
    return { ...updated, overlaps: await overlaps(tx, toSqlUtc(updated.starts_at), updated.duration_min, updated.doctor_id, id) };
  });
  res.json(result);
});

appointmentsRouter.delete("/:id", requirePermission("appointments.delete"), async (req, res) => {
  const id = String(req.params.id);
  await withTransaction(async (tx) => {
    const existing = await findAppointment(tx, id);
    if (!existing) throw new HttpError(404, "Cita no encontrada");
    await tx.query("DELETE FROM appointments WHERE id = ?", [id]);
    await audit(tx, req.user!.id, "APPOINTMENT_DELETE", "appointments", id,
      { patient_name: existing.patient_name, starts_at: existing.starts_at, status: existing.status });
  });
  res.status(204).end();
});
