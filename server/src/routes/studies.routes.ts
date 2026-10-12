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

// ---------- Carga masiva desde Excel ----------
// El frontend lee el Excel y manda las filas en JSON. Aquí se valida TODO y se arma un plan;
// con `aplicar: false` solo se devuelve la vista previa. Con `aplicar: true` se ejecuta en una
// sola transacción, y solo si no hay ningún error (todo o nada).

const IMPORT_MAX_ROWS = 2000;
const importRowSchema = z
  .object({
    fila: z.number().int().min(1),
    nombre: z.string("Falta el nombre").trim().min(1, "Falta el nombre").max(200, "Nombre de más de 200 caracteres"),
    descripcion: z.string().trim().max(2000, "Descripción de más de 2000 caracteres").nullish(),
    precio_con_informe: money.nullish(),
    precio_sin_informe: money.nullish(),
    comision_fija: money.nullish(),
    activo: z.boolean("escribe SI o NO").nullish(),
  })
  .refine((r) => (r.precio_con_informe == null) === (r.precio_sin_informe == null), {
    message: "Pon los dos precios (con informe y sin informe) o ninguno",
  });
type ImportRow = z.infer<typeof importRowSchema>;
const importSchema = z.object({
  filas: z.array(z.unknown()).min(1, "El archivo no tiene filas").max(IMPORT_MAX_ROWS, `Máximo ${IMPORT_MAX_ROWS} filas por archivo`),
  fecha_vigencia: z.iso.date("Fecha inválida (YYYY-MM-DD)"),
  aplicar: z.boolean().default(false),
});
const FIELD_NAMES: Record<string, string> = {
  nombre: "Nombre", descripcion: "Descripción", precio_con_informe: "Precio con informe",
  precio_sin_informe: "Precio sin informe", comision_fija: "Comisión fija", activo: "Activo",
};
/** Mismo estudio aunque cambien mayúsculas, tildes o espacios. */
const normName = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();

type ExistingStudy = {
  id: string; name: string; description: string | null; fixed_commission: number; active: boolean;
  price_with_report: number | null; price_without_report: number | null;
};
type PlanRow = {
  fila: number; nombre: string; accion: "crear" | "actualizar" | "sin cambios";
  cambios: string[]; aviso?: string; row: ImportRow; existing?: ExistingStudy; nuevaTarifa: boolean;
};

async function planImport(q: Db, filas: unknown[], lock: boolean) {
  const existing = await q.query<ExistingStudy[]>(
    `SELECT s.id, s.name, s.description, s.fixed_commission, s.active, sp.price_with_report, sp.price_without_report
       FROM studies s LEFT JOIN study_prices sp ON sp.study_id = s.id AND sp.is_active = 1${lock ? " FOR UPDATE" : ""}`,
  );
  const byName = new Map<string, ExistingStudy[]>();
  for (const e of existing) byName.set(normName(e.name), [...(byName.get(normName(e.name)) ?? []), e]);

  const errores: { fila: number; mensaje: string }[] = [];
  const plan: PlanRow[] = [];
  const seen = new Map<string, number>();
  filas.forEach((raw, i) => {
    const fila = (raw as { fila?: unknown })?.fila;
    const parsed = importRowSchema.safeParse(raw);
    if (!parsed.success) {
      const filaN = typeof fila === "number" ? fila : i + 2;
      for (const issue of parsed.error.issues) {
        const campo = FIELD_NAMES[String(issue.path[0] ?? "")];
        errores.push({ fila: filaN, mensaje: campo ? `${campo}: ${issue.message}` : issue.message });
      }
      return;
    }
    const r = parsed.data;
    const key = normName(r.nombre);
    if (seen.has(key)) {
      errores.push({ fila: r.fila, mensaje: `"${r.nombre}" está repetido en el archivo (fila ${seen.get(key)})` });
      return;
    }
    seen.set(key, r.fila);
    const matches = byName.get(key) ?? [];
    if (matches.length > 1) {
      errores.push({ fila: r.fila, mensaje: `Hay ${matches.length} estudios llamados "${r.nombre}" en la sucursal: deja uno solo antes de cargar` });
      return;
    }
    const hasPrice = r.precio_con_informe != null && r.precio_sin_informe != null;
    const e = matches[0];
    if (!e) {
      plan.push({
        fila: r.fila, nombre: r.nombre, accion: "crear", row: r, nuevaTarifa: hasPrice,
        cambios: hasPrice ? [`Tarifa: ${r.precio_con_informe} con informe / ${r.precio_sin_informe} sin informe`] : [],
        ...(hasPrice ? {} : { aviso: "Sin tarifa: no se podrá usar en atenciones hasta cargarle precios" }),
      });
      return;
    }
    const cambios: string[] = [];
    if (r.comision_fija != null && Number(e.fixed_commission) !== r.comision_fija) cambios.push(`Comisión fija: ${Number(e.fixed_commission)} → ${r.comision_fija}`);
    if (r.activo != null && e.active !== r.activo) cambios.push(r.activo ? "Se activa" : "Se desactiva");
    if (r.descripcion && r.descripcion !== (e.description ?? "")) cambios.push("Descripción");
    const nuevaTarifa = hasPrice && (Number(e.price_with_report) !== r.precio_con_informe || Number(e.price_without_report) !== r.precio_sin_informe || e.price_with_report == null);
    if (nuevaTarifa) {
      cambios.push(e.price_with_report == null
        ? `Tarifa: ${r.precio_con_informe} con informe / ${r.precio_sin_informe} sin informe`
        : `Tarifa: ${Number(e.price_with_report)} → ${r.precio_con_informe} con informe, ${Number(e.price_without_report)} → ${r.precio_sin_informe} sin informe`);
    }
    plan.push({ fila: r.fila, nombre: e.name, accion: cambios.length ? "actualizar" : "sin cambios", cambios, row: r, existing: e, nuevaTarifa });
  });
  return { plan, errores };
}

function importReport(plan: PlanRow[], errores: { fila: number; mensaje: string }[], aplicado: boolean) {
  return {
    aplicado,
    resumen: {
      filas: plan.length + new Set(errores.map((e) => e.fila)).size,
      crear: plan.filter((p) => p.accion === "crear").length,
      actualizar: plan.filter((p) => p.accion === "actualizar").length,
      nuevas_tarifas: plan.filter((p) => p.nuevaTarifa).length,
      sin_cambios: plan.filter((p) => p.accion === "sin cambios").length,
      errores: errores.length,
    },
    filas: plan.map(({ fila, nombre, accion, cambios, aviso }) => ({ fila, nombre, accion, cambios, ...(aviso ? { aviso } : {}) })),
    errores: errores.sort((a, b) => a.fila - b.fila),
  };
}

studiesRouter.post("/import", requirePermission("studies.create"), requirePermission("studies.edit"), async (req, res) => {
  const { filas, fecha_vigencia, aplicar } = importSchema.parse(req.body);
  if (!aplicar) {
    const { plan, errores } = await planImport(db(), filas, false);
    res.json(importReport(plan, errores, false));
    return;
  }
  const result = await withTransaction(async (tx) => {
    const { plan, errores } = await planImport(tx, filas, true);
    if (errores.length) return importReport(plan, errores, false); // todo o nada
    const userId = req.user!.id;
    for (const p of plan) {
      let studyId = p.existing?.id;
      if (p.accion === "crear") {
        const [{ id }] = await tx.query<{ id: string }[]>("SELECT UUID() AS id");
        studyId = id;
        await tx.query("INSERT INTO studies (id, name, description, fixed_commission, active) VALUES (?, ?, ?, ?, ?)", [
          id, p.row.nombre, p.row.descripcion || null, p.row.comision_fija ?? 0, p.row.activo ?? true,
        ]);
        await audit(tx, userId, "INSERT", "studies", id, { name: p.row.nombre, fixed_commission: p.row.comision_fija ?? 0, active: p.row.activo ?? true, via: "excel" });
      } else if (p.accion === "actualizar") {
        const set: Record<string, unknown> = {};
        if (p.row.comision_fija != null) set.fixed_commission = p.row.comision_fija;
        if (p.row.activo != null) set.active = p.row.activo;
        if (p.row.descripcion) set.description = p.row.descripcion;
        const cols = Object.keys(set);
        if (cols.length) {
          await tx.query(`UPDATE studies SET ${cols.map((c) => `${c} = ?`).join(", ")} WHERE id = ?`, [...cols.map((c) => set[c]), studyId]);
          await audit(tx, userId, "UPDATE", "studies", studyId!, { ...set, via: "excel" });
        }
      }
      if (p.nuevaTarifa) {
        const [{ id: priceId }] = await tx.query<{ id: string }[]>("SELECT UUID() AS id");
        await deactivateOtherPrices(tx, studyId!, priceId);
        await tx.query(
          "INSERT INTO study_prices (id, study_id, price_with_report, price_without_report, effective_date, is_active) VALUES (?, ?, ?, ?, ?, 1)",
          [priceId, studyId, p.row.precio_con_informe, p.row.precio_sin_informe, fecha_vigencia],
        );
        await audit(tx, userId, "INSERT", "study_prices", priceId, {
          study_id: studyId, price_with_report: p.row.precio_con_informe, price_without_report: p.row.precio_sin_informe,
          effective_date: fecha_vigencia, via: "excel",
        });
      }
    }
    const report = importReport(plan, errores, true);
    await audit(tx, userId, "STUDIES_IMPORT", "studies", "excel", { fecha_vigencia, ...report.resumen });
    return report;
  });
  if (result.aplicado) await invalidate(CacheKeys.studiesList);
  res.json(result);
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

/** Todas las tarifas (historial completo) en una sola petición, para la pestaña Tarifas. */
studyPricesRouter.get("/", async (_req, res) => {
  const rows = await db().query(
    `SELECT id, study_id, price_with_report, price_without_report, effective_date, is_active, created_at
       FROM study_prices ORDER BY effective_date DESC, created_at DESC`,
  );
  res.json(rows);
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
