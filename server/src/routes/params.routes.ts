import { Router } from "express";
import { z } from "zod";
import { db, withTransaction } from "../db.js";
import { audit } from "../lib/audit.js";
import { cache, CacheKeys, CacheTtl, invalidate } from "../lib/cache.js";
import { HttpError } from "../lib/http-error.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";

// Parámetros del sistema. Lectura para cualquier usuario (las pantallas los usan para mostrar
// cálculos); los cálculos de dinero los vuelven a leer de la base dentro de su transacción.
export const paramsRouter = Router();
paramsRouter.use(requireAuth);

// Reglas de cada parámetro conocido; uno nuevo sin regla solo acepta números ≥ 0.
const RULES: Record<string, z.ZodType> = {
  default_commission_pct: z.object({ value_num: z.number().min(0).max(20) }),
  first_patient_commission_pct: z.object({ value_num: z.number().min(0).max(100) }),
  voucher_amount: z.object({ value_num: z.number().min(0).max(100_000) }),
  invoice_surcharge_pct: z.object({ value_num: z.number().min(0).max(100) }),
  default_discount_pct: z.object({ value_num: z.number().min(0).max(100) }),
  debt_alert_days: z.object({ value_num: z.number().int().min(0).max(3650) }),
  cashbox_allow_negative: z.object({ value_bool: z.boolean() }),
};
const fallbackRule = z.object({ value_num: z.number().min(0) });

paramsRouter.get("/", async (_req, res) => {
  res.json(await cache().remember(CacheKeys.params, CacheTtl.params, () =>
    db().query("SELECT `key`, value_num, value_text, value_bool, description, updated_at, updated_by FROM app_params ORDER BY `key`"),
  ));
});

paramsRouter.patch("/:key", requirePermission("params.edit"), async (req, res) => {
  const key = String(req.params.key);
  const data = (RULES[key] ?? fallbackRule).parse(req.body) as { value_num?: number; value_bool?: boolean };
  const param = await withTransaction(async (tx) => {
    const [before] = await tx.query("SELECT * FROM app_params WHERE `key` = ? FOR UPDATE", [key]);
    if (!before) throw new HttpError(404, "Parámetro no encontrado");
    const col = data.value_bool !== undefined ? "value_bool" : "value_num";
    await tx.query(`UPDATE app_params SET ${col} = ?, updated_by = ? WHERE \`key\` = ?`, [data[col], req.user!.id, key]);
    const [after] = await tx.query("SELECT * FROM app_params WHERE `key` = ?", [key]);
    await audit(tx, req.user!.id, "UPDATE", "app_params", key, { before, after });
    return after;
  });
  await invalidate(CacheKeys.params);
  res.json(param);
});
