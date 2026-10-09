import { createHash } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { withTransaction } from "../db.js";
import { audit } from "../lib/audit.js";
import { HttpError } from "../lib/http-error.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import { tenancy } from "../tenancy/index.js";

/**
 * Marca de la sucursal: nombre, datos de contacto, colores y logo. Todo se guarda con
 * tenancy-node (tenants.update, theme.update, storage) y el frontend lo lee sin sesión en
 * GET /tenancy/me (nombre, dirección, teléfono, tema y URL del logo) y GET /tenancy/theme.css.
 */
export const brandingRouter = Router();
brandingRouter.use(requireAuth, requirePermission("branding.edit"));

const color = z.string().regex(/^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/, "Color hexadecimal inválido");

const brandingSchema = z.object({
  name: z.string().trim().min(1).max(150).optional(),
  address: z.string().trim().max(300).nullable().optional(),
  phone: z.string().trim().max(50).nullable().optional(),
  theme: z
    .object({
      primary: color.optional(),
      secondary: color.optional(),
      accent: color.nullable().optional(),
      background: color.nullable().optional(),
      text: color.nullable().optional(),
      font: z.string().regex(/^[A-Za-z0-9 _-]{1,64}$/, "Fuente inválida").nullable().optional(),
      radius: z.enum(["none", "sm", "md", "lg"]).nullable().optional(),
      mode: z.enum(["light", "dark", "auto"]).nullable().optional(),
    })
    .strict()
    .optional(),
}).strict();

function currentTenantId() {
  const id = tenancy.currentId();
  if (!id) throw new HttpError(404, "Sucursal no identificada", "TENANT_REQUIRED");
  return id;
}

brandingRouter.patch("/", async (req, res) => {
  const data = brandingSchema.parse(req.body);
  const id = currentTenantId();

  const changes: { name?: string; data?: Record<string, unknown> } = {};
  if (data.name !== undefined) changes.name = data.name;
  const extra: Record<string, unknown> = {};
  // undefined en data borra la llave en tenancy-node; null → borrar
  if (data.address !== undefined) extra.address = data.address ?? undefined;
  if (data.phone !== undefined) extra.phone = data.phone ?? undefined;
  if (Object.keys(extra).length) changes.data = extra;

  if (changes.name !== undefined || changes.data) await tenancy.tenants.update(id, changes);
  // tenancy.theme() devuelve el tema con que empezó la petición; se responde el ya guardado
  const theme = data.theme && Object.keys(data.theme).length
    ? await tenancy.theme.update(id, data.theme)
    : null;

  await withTransaction((tx) => audit(tx, req.user!.id, "BRANDING_UPDATE", "tenancy_tenants", id, data));
  const tenant = await tenancy.tenants.findOrFail(id);
  res.json({
    id,
    name: tenant.name,
    address: tenant.data.address ?? null,
    phone: tenant.data.phone ?? null,
    theme: (theme ?? tenant.theme ?? tenancy.theme.defaults).toJSON(),
  });
});

// Solo formatos de imagen rasterizada: SVG puede llevar scripts (XSS) y no se acepta.
const IMAGE_TYPES: { ext: string; type: string; magic: (b: Buffer) => boolean }[] = [
  { ext: "png", type: "image/png", magic: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { ext: "jpg", type: "image/jpeg", magic: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: "webp", type: "image/webp", magic: (b) => b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP" },
];

export const LOGO_MAX_BYTES = 1024 * 1024;

/**
 * Sube el logo: cuerpo binario (Content-Type image/png, image/jpeg o image/webp, máx. 1 MB).
 * El nombre lleva un hash del contenido, así la URL cambia con cada logo nuevo y los
 * navegadores no muestran el anterior desde su caché.
 */
brandingRouter.put("/logo", async (req, res) => {
  const body = req.body;
  if (!Buffer.isBuffer(body) || body.length === 0) {
    throw new HttpError(415, "Envía la imagen como cuerpo binario (image/png, image/jpeg o image/webp)");
  }
  const kind = IMAGE_TYPES.find((t) => t.magic(body));
  if (!kind) throw new HttpError(415, "El archivo no es una imagen PNG, JPG o WEBP válida");

  const id = currentTenantId();
  const previous = tenancy.theme().theme.logo;
  const key = `branding/logo-${createHash("sha256").update(body).digest("hex").slice(0, 16)}.${kind.ext}`;

  await tenancy.storage().put(key, body, { contentType: kind.type });
  await tenancy.theme.update(id, { logo: key });
  if (previous && previous !== key && previous.startsWith("branding/")) await tenancy.storage().delete(previous);

  await withTransaction((tx) => audit(tx, req.user!.id, "LOGO_UPDATE", "tenancy_tenants", id, { key, bytes: body.length }));
  res.json({ logo: key, url: await tenancy.storage().url(key) });
});

brandingRouter.delete("/logo", async (req, res) => {
  const id = currentTenantId();
  const previous = tenancy.theme().theme.logo;
  await tenancy.theme.update(id, { logo: null });
  if (previous?.startsWith("branding/")) await tenancy.storage().delete(previous);
  await withTransaction((tx) => audit(tx, req.user!.id, "LOGO_DELETE", "tenancy_tenants", id, { key: previous ?? null }));
  res.status(204).end();
});
