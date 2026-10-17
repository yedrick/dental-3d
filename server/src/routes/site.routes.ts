import { createHash } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { db, withTransaction } from "../db.js";
import { audit } from "../lib/audit.js";
import { cache } from "../lib/cache.js";
import { detectFileKind, IMAGE_TYPES } from "../lib/files.js";
import { HttpError } from "../lib/http-error.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import { tenancy } from "../tenancy/index.js";

/**
 * Página web pública de cada sucursal (la portada de calacoto.dominio.com).
 * - El contenido vive en la base de la sucursal (tabla site_content, migración 007).
 * - Se cachea por sucursal con tenancy.cache() (Redis si hay REDIS_URL) y se borra al guardar.
 * - Las imágenes van al almacenamiento PÚBLICO de la sucursal (storage/<sucursal>/site/…).
 * Nada de esto es HTML: el frontend lo muestra como texto, así no se puede inyectar código.
 */
export const publicSiteRouter = Router();
export const siteRouter = Router();
siteRouter.use(requireAuth);

const CACHE_KEY = "site:content";
const CACHE_TTL = 3600;
export const SITE_IMAGE_MAX_BYTES = 2 * 1024 * 1024;

const text = (max: number) => z.string().trim().max(max);
// Solo https (o vacío): evita enlaces "javascript:" en la página pública
const httpsUrl = z.union([z.literal(""), z.url({ protocol: /^https$/, message: "Usa un enlace https://" }).max(500)]);
// Imagen subida a esta misma sucursal (o ninguna). Se guarda la LLAVE del almacenamiento
// (site/<hash>.png) y la URL se calcula al leer: así funciona con disco local, S3 y R2.
// Se aceptan también las rutas viejas /tenancy/assets/site/… y se convierten a llave.
const SITE_KEY = /^site\/[0-9a-f]{16}\.(png|jpg|webp)$/;
const toKey = (v: unknown) => (typeof v === "string" ? v.replace(/^\/tenancy\/assets\//, "") : v);
const siteImage = z.preprocess(toKey, z.union([z.literal(""), z.string().regex(SITE_KEY, "Imagen inválida")]));

export const siteSchema = z.object({
  seo: z.object({ title: text(120), description: text(300) }),
  hero: z.object({
    badge: text(80),
    title: text(120),
    highlight: text(120),
    subtitle: text(500),
    cta_label: text(60),
    image: siteImage,
    // Solo de lectura: la API la calcula a partir de "image" (no se guarda)
    image_url: z.string().optional(),
  }),
  stats: z.array(z.object({ value: text(12), label: text(40) })).max(4),
  studies: z.object({ title: text(120), subtitle: text(300), empty: text(200) }),
  contact: z.object({
    phone: text(30),
    whatsapp: z.union([z.literal(""), z.string().regex(/^\d{8,15}$/, "WhatsApp: solo dígitos con código de país (ej. 59177726685)")]),
    whatsapp_message: text(200),
    email: z.union([z.literal(""), z.email("Email inválido")]),
    address: text(200),
    address_note: text(200),
    map_url: httpsUrl,
  }),
  hours: z.array(z.object({ day: text(40), hours: text(40) })).max(7),
  cta: z.object({ title: text(120), subtitle: text(300) }),
  social: z.object({ facebook: httpsUrl, instagram: httpsUrl, tiktok: httpsUrl }),
  footer: z.object({ name: text(100) }),
});
export type SiteContent = z.infer<typeof siteSchema>;

/** Contenido por defecto: el que estaba escrito fijo en la portada, con el nombre de la sucursal. */
export function defaultSite(name: string): SiteContent {
  return {
    seo: {
      title: `${name} · Radiología Dental 2D y 3D en Bolivia`,
      description: "Centro de radiología dental en Bolivia. Estudios 2D y 3D (CBCT) con entrega ágil. Agenda por WhatsApp.",
    },
    hero: {
      badge: "Radiología dental de alta precisión",
      title: "Imagen dental",
      highlight: "clara, rápida y confiable.",
      subtitle: "Estudios radiológicos 2D y 3D para profesionales y pacientes. Diagnóstico preciso con la última tecnología en imagen dental.",
      cta_label: "Agendar por WhatsApp",
      image: "",
    },
    stats: [
      { value: "2D · 3D", label: "Imágenes dentales" },
      { value: "Digital", label: "Entrega de resultados" },
      { value: "WhatsApp", label: "Agenda tu cita" },
    ],
    studies: {
      title: "Estudios disponibles",
      subtitle: "Contáctanos por WhatsApp para consultar precios, disponibilidad y agendar tu estudio.",
      empty: "Estamos actualizando nuestro catálogo. Escríbenos por WhatsApp.",
    },
    contact: {
      // Vacíos: cada clínica pone los suyos en "Página web" (antes salían los de la primera clínica)
      phone: "",
      whatsapp: "",
      whatsapp_message: "Hola, quisiera agendar un estudio",
      email: "",
      address: "",
      address_note: "Consulta la dirección exacta al agendar.",
      map_url: "",
    },
    hours: [
      { day: "Lunes a Viernes", hours: "08:00 – 19:00" },
      { day: "Sábado", hours: "08:00 – 13:00" },
      { day: "Domingo", hours: "Cerrado" },
    ],
    cta: {
      title: "¿Listo para tu estudio?",
      subtitle: "Escríbenos por WhatsApp y agenda tu cita. Recibirás tus imágenes en formato digital y físico.",
    },
    social: { facebook: "", instagram: "", tiktok: "" },
    footer: { name },
  };
}

/** Mezcla lo guardado sobre los valores por defecto (sección por sección). */
function withDefaults(stored: Partial<SiteContent> | null, name: string): SiteContent {
  const d = defaultSite(name);
  if (!stored) return d;
  const merged = { ...d } as Record<string, unknown>;
  for (const [k, v] of Object.entries(stored)) {
    const base = (d as Record<string, unknown>)[k];
    merged[k] = Array.isArray(v) || typeof v !== "object" || v === null ? v : { ...(base as object), ...v };
  }
  return merged as SiteContent;
}

async function loadSite(): Promise<SiteContent> {
  const name = tenancy.currentOrFail().name;
  const site = await cache().remember(CACHE_KEY, CACHE_TTL, async () => {
    const [row] = await db().query<{ content: Partial<SiteContent> }[]>("SELECT content FROM site_content WHERE id = 1");
    return withDefaults(row?.content ?? null, name);
  });
  // La URL se calcula en cada lectura (no se cachea): con S3/R2 sin dominio público son URLs firmadas que vencen
  const key = toKey(site.hero.image) as string;
  const image_url = key && SITE_KEY.test(key) ? await tenancy.storage().url(key) : "";
  return { ...site, hero: { ...site.hero, image: key, image_url } };
}

// ---------- Público (portada) ----------
publicSiteRouter.get("/", async (_req, res) => {
  res.setHeader("Cache-Control", "public, max-age=60");
  res.json(await loadSite());
});

// ---------- Edición (permiso site.edit) ----------
siteRouter.get("/", requirePermission("site.edit"), async (_req, res) => {
  const [meta] = await db().query("SELECT updated_at, updated_by FROM site_content WHERE id = 1");
  res.json({ content: await loadSite(), updated_at: meta?.updated_at ?? null, updated_by: meta?.updated_by ?? null });
});

siteRouter.put("/", requirePermission("site.edit"), async (req, res) => {
  const parsed = siteSchema.parse(req.body);
  const content = { ...parsed, hero: { ...parsed.hero, image_url: undefined } }; // la URL no se guarda
  await withTransaction(async (tx) => {
    await tx.query(
      `INSERT INTO site_content (id, content, updated_by) VALUES (1, ?, ?)
       ON DUPLICATE KEY UPDATE content = VALUES(content), updated_by = VALUES(updated_by)`,
      [JSON.stringify(content), req.user!.id],
    );
    await audit(tx, req.user!.id, "SITE_UPDATE", "site_content", "1", content);
  });
  await cache().delete(CACHE_KEY);
  res.json(await loadSite());
});

/** Restablece el contenido por defecto. */
siteRouter.delete("/", requirePermission("site.edit"), async (req, res) => {
  await withTransaction(async (tx) => {
    await tx.query("DELETE FROM site_content WHERE id = 1");
    await audit(tx, req.user!.id, "SITE_RESET", "site_content", "1", null);
  });
  await cache().delete(CACHE_KEY);
  res.json(await loadSite());
});

/**
 * Sube una imagen para la página web (PNG, JPG o WEBP, máx. 2 MB; sin SVG). Se guarda en el
 * almacenamiento público de ESTA sucursal y devuelve la URL para usar en el contenido.
 */
siteRouter.post("/images", requirePermission("site.edit"), async (req, res) => {
  const body = req.body;
  if (!Buffer.isBuffer(body) || body.length === 0) {
    throw new HttpError(415, "Envía la imagen como cuerpo binario (image/png, image/jpeg o image/webp)");
  }
  const kind = detectFileKind(body, IMAGE_TYPES);
  if (!kind) throw new HttpError(415, "El archivo no es una imagen PNG, JPG o WEBP válida");
  const key = `site/${createHash("sha256").update(body).digest("hex").slice(0, 16)}.${kind.ext}`;
  await tenancy.storage().put(key, body, { contentType: kind.type });
  await withTransaction((tx) => audit(tx, req.user!.id, "SITE_IMAGE_UPLOAD", "site_content", key, { bytes: body.length }));
  res.status(201).json({ key, url: await tenancy.storage().url(key) });
});
