import { Router } from "express";
import { z } from "zod";
import { db, withTransaction, type Db } from "../db.js";
import { audit } from "../lib/audit.js";
import { cache, CacheKeys, CacheTtl, invalidate } from "../lib/cache.js";
import { HttpError } from "../lib/http-error.js";
import { money, optionalText } from "../lib/schemas.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";

// Estudios y tarifas. Lectura para cualquier usuario autenticado (como la RLS "Read studies").
export const studiesRouter = Router();
export const studyPricesRouter = Router();
/** Portada pública: solo nombre y descripción de los estudios activos (sin precios). */
export const publicStudiesRouter = Router();

publicStudiesRouter.get("/", async (_req, res) => {
  const rows = await cache().remember(CacheKeys.studiesList, CacheTtl.studiesList, () =>
    db().query(
      `SELECT s.*, sp.id AS active_price_id, sp.price_with_report, sp.price_without_report, sp.effective_date
         FROM studies s
         LEFT JOIN study_prices sp ON sp.study_id = s.id AND sp.is_active = 1
        ORDER BY s.name`,
    ),
  );
  res.setHeader("Cache-Control", "public, max-age=300");
  res.json((rows as { id: string; name: string; description: string | null; active: boolean }[])
    .filter((s) => s.active)
    .map(({ id, name, description }) => ({ id, name, description })));
});
studiesRouter.use(requireAuth);
studyPricesRouter.use(requireAuth);

const studySchema = z.object({
  name: z.string().trim().min(1, "Nombre requerido").max(200),
  description: optionalText(2000),
  fixed_commission: money.default(0),
  active: z.boolean().default(true),
});
const STUDY_COLUMNS = Object.keys(studySchema.shape) as (keyof typeof studySchema.shape)[];

const priceSchema = z.object({
  price_with_report: money,
  price_without_report: money,
  effective_date: z.iso.date("Fecha inválida (YYYY-MM-DD)"),
  is_active: z.boolean().default(true),
});
const PRICE_COLUMNS = Object.keys(priceSchema.shape) as (keyof typeof priceSchema.shape)[];

async function findStudy(q: Db, id: string) {
  const rows = await q.query("SELECT * FROM studies WHERE id = ?", [id]);
  return rows[0] ?? null;
}

async function findPrice(q: Db, id: string) {
  const rows = await q.query("SELECT id, study_id, price_with_report, price_without_report, effective_date, is_active, created_at FROM study_prices WHERE id = ?", [id]);
  return rows[0] ?? null;
}

/** Regla "una tarifa activa por estudio" (antes trigger deactivate_prev_prices). */
async function deactivateOtherPrices(tx: Db, studyId: string, exceptId: string | null) {
  await tx.query("UPDATE study_prices SET is_active = 0 WHERE study_id = ? AND is_active = 1 AND id <> ?", [
    studyId,
    exceptId ?? "",
  ]);
}

// ---------- Estudios ----------

/**
 * Lista de estudios con su tarifa activa. Se cachea 10 min por sucursal porque la usan
 * casi todas las pantallas. Es SOLO para mostrar: al registrar una atención, el precio se
 * vuelve a leer de la base dentro de la transacción.
 */
studiesRouter.get("/", async (req, res) => {
  let hit = true;
  const rows = await cache().remember(CacheKeys.studiesList, CacheTtl.studiesList, () => {
    hit = false;
    return db().query(
      `SELECT s.*, sp.id AS active_price_id, sp.price_with_report, sp.price_without_report, sp.effective_date
         FROM studies s
         LEFT JOIN study_prices sp ON sp.study_id = s.id AND sp.is_active = 1
        ORDER BY s.name`,
    );
  });
  res.setHeader("X-Cache", hit ? "HIT" : "MISS");
  const onlyActive = req.query.active === "true";
  res.json(onlyActive ? (rows as { active: boolean }[]).filter((s) => s.active) : rows);
});

studiesRouter.get("/:id", async (req, res) => {
  const study = await findStudy(db(), String(req.params.id));
  if (!study) throw new HttpError(404, "Estudio no encontrado");
  res.json(study);
});

studiesRouter.post("/", requirePermission("studies.create"), async (req, res) => {
  const data = studySchema.parse(req.body);
  const study = await withTransaction(async (tx) => {
    const [{ id }] = await tx.query<{ id: string }[]>("SELECT UUID() AS id");
    await tx.query(
      `INSERT INTO studies (id, ${STUDY_COLUMNS.join(", ")}) VALUES (?, ${STUDY_COLUMNS.map(() => "?").join(", ")})`,
      [id, ...STUDY_COLUMNS.map((c) => data[c])],
    );
    const created = await findStudy(tx, id);
    await audit(tx, req.user!.id, "INSERT", "studies", id, created);
    return created;
  });
  await invalidate(CacheKeys.studiesList);
  res.status(201).json(study);
});

studiesRouter.patch("/:id", requirePermission("studies.edit"), async (req, res) => {
  const id = String(req.params.id);
  const data = studySchema.partial().parse(req.body);
  const fields = STUDY_COLUMNS.filter((c) => req.body?.[c] !== undefined);
  if (fields.length === 0) throw new HttpError(400, "No hay campos para actualizar");
  const study = await withTransaction(async (tx) => {
    if (!(await findStudy(tx, id))) throw new HttpError(404, "Estudio no encontrado");
    await tx.query(`UPDATE studies SET ${fields.map((c) => `${c} = ?`).join(", ")} WHERE id = ?`, [
      ...fields.map((c) => data[c]),
      id,
    ]);
    const updated = await findStudy(tx, id);
    await audit(tx, req.user!.id, "UPDATE", "studies", id, updated);
    return updated;
  });
  await invalidate(CacheKeys.studiesList);
  res.json(study);
});

studiesRouter.delete("/:id", requirePermission("studies.edit"), async (req, res) => {
  const id = String(req.params.id);
  await withTransaction(async (tx) => {
    const existing = await findStudy(tx, id);
    if (!existing) throw new HttpError(404, "Estudio no encontrado");
    const [{ n }] = await tx.query<{ n: number }[]>("SELECT COUNT(*) AS n FROM patient_studies WHERE study_id = ?", [id]);
    if (n > 0) throw new HttpError(409, `No se puede eliminar: el estudio tiene ${n} atención(es). Desactívalo en su lugar.`);
    await tx.query("DELETE FROM study_prices WHERE study_id = ?", [id]);
    await tx.query("DELETE FROM studies WHERE id = ?", [id]);
    await audit(tx, req.user!.id, "DELETE", "studies", id, existing);
  });
  await invalidate(CacheKeys.studiesList);
  res.status(204).end();
});

// ---------- Tarifas ----------

studiesRouter.get("/:id/prices", async (req, res) => {
  const id = String(req.params.id);
  if (!(await findStudy(db(), id))) throw new HttpError(404, "Estudio no encontrado");
  const rows = await db().query(
    `SELECT id, study_id, price_with_report, price_without_report, effective_date, is_active, created_at
       FROM study_prices WHERE study_id = ? ORDER BY effective_date DESC, created_at DESC`,
    [id],
  );
  res.json(rows);
});

/** Nueva tarifa. Si queda activa, desactiva la anterior en la misma transacción. */
studiesRouter.post("/:id/prices", requirePermission("studies.edit"), async (req, res) => {
  const studyId = String(req.params.id);
  const data = priceSchema.parse(req.body);
  const price = await withTransaction(async (tx) => {
    if (!(await findStudy(tx, studyId))) throw new HttpError(404, "Estudio no encontrado");
    const [{ id }] = await tx.query<{ id: string }[]>("SELECT UUID() AS id");
    if (data.is_active) await deactivateOtherPrices(tx, studyId, id);
    await tx.query(
      `INSERT INTO study_prices (id, study_id, ${PRICE_COLUMNS.join(", ")}) VALUES (?, ?, ${PRICE_COLUMNS.map(() => "?").join(", ")})`,
      [id, studyId, ...PRICE_COLUMNS.map((c) => data[c])],
    );
    const created = await findPrice(tx, id);
    await audit(tx, req.user!.id, "INSERT", "study_prices", id, created);
    return created;
  });
  await invalidate(CacheKeys.studiesList);
  res.status(201).json(price);
});

studyPricesRouter.patch("/:id", requirePermission("studies.edit"), async (req, res) => {
  const id = String(req.params.id);
  const data = priceSchema.partial().parse(req.body);
  const fields = PRICE_COLUMNS.filter((c) => req.body?.[c] !== undefined);
  if (fields.length === 0) throw new HttpError(400, "No hay campos para actualizar");
  const price = await withTransaction(async (tx) => {
    const existing = await findPrice(tx, id);
    if (!existing) throw new HttpError(404, "Tarifa no encontrada");
    if (data.is_active === true) await deactivateOtherPrices(tx, existing.study_id, id);
    await tx.query(`UPDATE study_prices SET ${fields.map((c) => `${c} = ?`).join(", ")} WHERE id = ?`, [
      ...fields.map((c) => data[c]),
      id,
    ]);
    const updated = await findPrice(tx, id);
    await audit(tx, req.user!.id, "UPDATE", "study_prices", id, updated);
    return updated;
  });
  await invalidate(CacheKeys.studiesList);
  res.json(price);
});

studyPricesRouter.delete("/:id", requirePermission("studies.edit"), async (req, res) => {
  const id = String(req.params.id);
  await withTransaction(async (tx) => {
    const existing = await findPrice(tx, id);
    if (!existing) throw new HttpError(404, "Tarifa no encontrada");
    await tx.query("DELETE FROM study_prices WHERE id = ?", [id]);
    await audit(tx, req.user!.id, "DELETE", "study_prices", id, existing);
  });
  await invalidate(CacheKeys.studiesList);
  res.status(204).end();
});
