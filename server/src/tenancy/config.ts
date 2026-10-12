import { fileURLToPath } from "node:url";
import { defineConfig } from "@tenancy-node/core";
import { database } from "@tenancy-node/db";
import { mysql } from "@tenancy-node/db-mysql";
import { storageFromEnv } from "@tenancy-node/storage-s3";
import { redis, redisInvalidation } from "@tenancy-node/cache-redis";
import { config } from "../config.js";
import { seedTenant } from "./seed.js";

/**
 * Configuración de tenancy-node. La usan la API (src/tenancy/index.ts) y la CLI
 * (tenancy.config.ts → npx tenancy ...). Cada tenant es una sucursal con su propia base.
 */
export const tenancyConfig = defineConfig({
  centralDomains: config.tenancy.centralDomains,
  // sur.dental3d.com → tenant "sur" (en local: sur.localhost)
  resolver: "subdomain",
  // Solo archivos PÚBLICOS (logo, favicon): http.assets los sirve sin autenticación.
  // Los archivos privados (comprobantes) NO deben guardarse con tenancy.storage().
  // Disco local por defecto (STORAGE_DIR); STORAGE_DRIVER=s3 o r2 lo pasa a S3 / Cloudflare R2.
  storage: storageFromEnv({ STORAGE_LOCAL_ROOT: config.tenancy.storageDir, ...process.env }),
  http: {
    me: true, // GET /tenancy/me → nombre, datos públicos y tema (con logo)
    theme: true, // GET /tenancy/theme.css → variables CSS de la sucursal
    assets: true, // GET /tenancy/assets/branding/logo-....png
    cacheControl: "public, max-age=60",
  },
  publicFields: ["name", "address", "phone"],
  // Caché por sucursal (tenant:<id>:…) en Redis si hay REDIS_URL; si no, en memoria. Con Redis,
  // los cambios de sucursales y dominios también llegan al instante a todas las réplicas.
  ...(config.tenancy.redisUrl
    ? {
        cache: redis({ url: config.tenancy.redisUrl, keyPrefix: "dental3d:" }),
        invalidation: redisInvalidation({ url: config.tenancy.redisUrl }),
      }
    : {}),
  theme: { defaults: { primary: "#0F172A", secondary: "#64748B", radius: "md" } }, // #0F172A = color actual de la app
  plugins: [
    database({
      driver: mysql(),
      central: { url: config.tenancy.databaseUrl },
      encryptionKey: config.tenancy.encryptionKey,
      // Cada sucursal tiene su propio usuario MySQL con acceso SOLO a su base
      credentials: "per-tenant",
      prefix: "dental_",
      migrations: { tenant: fileURLToPath(new URL("../../db/tenant", import.meta.url)) },
      // ADMIN por defecto de cada sucursal nueva (cuenta por activar)
      seed: seedTenant,
      pool: { max: 5, maxOpenPools: 100, idleTimeoutMs: 60_000 },
    }),
  ],
});
