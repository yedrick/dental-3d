import { fileURLToPath } from "node:url";
import { defineConfig, LocalStorage } from "@tenancy-node/core";
import { database } from "@tenancy-node/db";
import { mysql } from "@tenancy-node/db-mysql";
import { config } from "../config.js";

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
  storage: new LocalStorage({ root: config.tenancy.storageDir }),
  http: {
    me: true, // GET /tenancy/me → nombre, datos públicos y tema (con logo)
    theme: true, // GET /tenancy/theme.css → variables CSS de la sucursal
    assets: true, // GET /tenancy/assets/branding/logo-....png
    cacheControl: "public, max-age=60",
  },
  publicFields: ["name", "address", "phone"],
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
      pool: { max: 5, maxOpenPools: 100, idleTimeoutMs: 60_000 },
    }),
  ],
});
