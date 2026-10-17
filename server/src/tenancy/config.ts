import { fileURLToPath } from "node:url";
import { defineConfig } from "@tenancy-node/core";
import { database } from "@tenancy-node/db";
import { storageFromEnv } from "@tenancy-node/storage-s3";
import { redis, redisInvalidation } from "@tenancy-node/cache-redis";
import { config } from "../config.js";
import { mysqlWithSession } from "./mysql-session.js";
import { seedTenant } from "./seed.js";
import { defaultPlan, features, plans } from "./plans.js";

/**
 * Configuración de tenancy-node. La usan la API (src/tenancy/index.ts) y la CLI
 * (tenancy.config.ts → npx tenancy ...). Cada tenant es una sucursal con su propia base.
 */
export const tenancyConfig = defineConfig({
  centralDomains: config.tenancy.centralDomains,
  // imagendent.ionix.kollatech.site → tenant "imagendent" (en local: sur.localhost)
  resolver: "subdomain",
  // Solo archivos PÚBLICOS (logo, favicon): http.assets los sirve sin autenticación.
  // Los archivos privados (comprobantes) NO deben guardarse con tenancy.storage().
  // Disco local por defecto (STORAGE_DIR); STORAGE_DRIVER=s3 o r2 lo pasa a S3 / Cloudflare R2.
  storage: storageFromEnv({ STORAGE_LOCAL_ROOT: config.tenancy.storageDir, ...process.env }),
  http: {
    me: true, // GET /tenancy/me → nombre, datos públicos y tema (con logo)
    theme: true, // GET /tenancy/theme.css → variables CSS de la sucursal
    assets: true, // GET /tenancy/assets/branding/logo-....png
    plans: true, // GET /tenancy/plans → planes y precios para la web comercial
    platform: true, // GET /tenancy/platform → marca y contacto de IONIX (panel → Plataforma)
    // no-cache + ETag: un cambio de plan o de tema se ve al recargar, sin bajar todo otra vez
    cacheControl: "no-cache",
  },
  // plan, features y limits: el frontend muestra solo los módulos del plan (ver plans.ts)
  publicFields: ["name", "address", "phone", "plan", "planLabel", "features", "limits"],
  // Módulos y planes de IONIX: menú, API (requireFeature), límites, panel y precios públicos
  features,
  // Planes base: en el panel (/admin → Planes) se editan precios, módulos y límites sin desplegar;
  // "Restablecer" vuelve a estos valores
  plans,
  defaultPlan,
  // Marca de la plataforma mientras nadie la edite en el panel (/admin → Plataforma)
  platform: { defaults: { name: "IONIX", ...(config.mail.salesTo ? { salesNotifyTo: [config.mail.salesTo] } : {}) } },
  // Caché por sucursal (tenant:<id>:…) en Redis si hay REDIS_URL; si no, en memoria. Con Redis,
  // los cambios de sucursales y dominios también llegan al instante a todas las réplicas.
  ...(config.tenancy.redisUrl
    ? {
        cache: redis({ url: config.tenancy.redisUrl, keyPrefix: "ionix:" }),
        invalidation: redisInvalidation({ url: config.tenancy.redisUrl }),
      }
    : {}),
  theme: {
    defaults: { primary: "#0F172A", secondary: "#64748B", radius: "md" }, // #0F172A = color actual de la app
    // Fuentes que se pueden elegir en el panel (/admin): lista con vista previa, y
    // /tenancy/theme.css ya trae la carga de la fuente. Las mismas que src/lib/branding.tsx.
    fonts: [
      ...[
        "Inter", "Roboto", "Open Sans", "Lato", "Montserrat", "Poppins", "Nunito", "Raleway", "Source Sans 3",
        "Work Sans", "DM Sans", "Manrope", "Rubik", "Quicksand", "Mulish", "Ubuntu",
      ].map((family) => ({ family, weights: [400, 500, 600, 700] })),
      ...["Merriweather", "Playfair Display", "Lora"].map((family) => ({
        family,
        weights: [400, 500, 600, 700],
        fallback: "Georgia, serif",
      })),
      { family: "Arial", source: "system" as const, fallback: "Helvetica, sans-serif" },
      { family: "Helvetica", source: "system" as const, fallback: "Arial, sans-serif" },
      { family: "Verdana", source: "system" as const, fallback: "Geneva, sans-serif" },
      { family: "Tahoma", source: "system" as const, fallback: "Geneva, sans-serif" },
      { family: "Trebuchet MS", source: "system" as const, fallback: "sans-serif" },
      { family: "Georgia", source: "system" as const, fallback: "serif" },
      { family: "Times New Roman", source: "system" as const, fallback: "Times, serif" },
      { family: "Courier New", source: "system" as const, fallback: "monospace" },
    ],
  },
  plugins: [
    database({
      driver: mysqlWithSession(), // UTC y modo estricto en cada conexión (ver mysql-session.ts)
      central: { url: config.tenancy.databaseUrl, pool: { max: config.tenancy.centralPoolMax } },
      encryptionKey: config.tenancy.encryptionKey,
      // Cada sucursal tiene su propio usuario MySQL con acceso SOLO a su base
      credentials: "per-tenant",
      prefix: "dental_",
      migrations: { tenant: fileURLToPath(new URL("../../db/tenant", import.meta.url)) },
      // ADMIN por defecto de cada sucursal nueva (cuenta por activar)
      seed: seedTenant,
      pool: {
        max: config.tenancy.tenantPoolMax,
        maxOpenPools: config.tenancy.tenantMaxOpenPools,
        idleTimeoutMs: config.tenancy.tenantPoolIdleMs,
      },
    }),
  ],
});
