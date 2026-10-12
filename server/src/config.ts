import "dotenv/config";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Falta la variable de entorno ${name} (revisa server/.env)`);
  return v;
}

function list(value: string | undefined): string[] {
  return (value ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

export const config = {
  port: Number(process.env.PORT ?? 4000),
  // Procesos de la API (módulo cluster de Node). Un proceso usa UN núcleo para atender peticiones:
  // con más, se reparte la carga entre núcleos. Ver src/index.ts.
  processes: Math.max(1, Number(process.env.API_PROCESSES ?? 1)),
  // En producción, 127.0.0.1 (solo nginx llega a la API). Vacío = todas las interfaces.
  host: process.env.HOST || undefined,
  corsOrigin: list(process.env.CORS_ORIGIN),
  // Saltos de proxy de confianza para leer la IP real (rate limit). 0 = tráfico directo.
  trustProxy: Number(process.env.TRUST_PROXY ?? 0),
  // Zona horaria del negocio para los filtros por día (Bolivia = -04:00, sin horario de verano)
  businessUtcOffset: process.env.BUSINESS_UTC_OFFSET ?? "-04:00",
  tenancy: {
    // Base central de tenancy-node (tablas tenancy_*). El usuario necesita CREATE DATABASE,
    // CREATE USER y GRANT OPTION para crear la base y el usuario de cada sucursal.
    databaseUrl: required("DATABASE_URL"),
    // Conexiones del pool de la base central (tenancy-node usa 10 por defecto). Crear sucursales
    // retiene una conexión por sucursal mientras se aprovisiona (ver TENANCY-NODE-REPORTE.md #8):
    // crear tantas a la vez como este número bloquea la API. Mantenerlo holgado.
    centralPoolMax: Number(process.env.CENTRAL_POOL_MAX ?? 30),
    // Pools de las sucursales. Conexiones máximas a MySQL ≈ TENANT_POOL_MAX × TENANT_MAX_OPEN_POOLS
    // + CENTRAL_POOL_MAX: debe quedar por debajo de max_connections de MySQL.
    tenantPoolMax: Number(process.env.TENANT_POOL_MAX ?? 5),
    tenantMaxOpenPools: Number(process.env.TENANT_MAX_OPEN_POOLS ?? 100),
    tenantPoolIdleMs: Number(process.env.TENANT_POOL_IDLE_MS ?? 60_000),
    // Llave AES-256-GCM: cifra la contraseña del usuario MySQL de cada sucursal.
    encryptionKey: required("TENANCY_KEY"),
    // Dominios que nunca son una sucursal; las sucursales son subdominios de estos.
    centralDomains: list(process.env.CENTRAL_DOMAINS ?? "localhost"),
    storageDir: process.env.STORAGE_DIR ?? "./storage",
    // Caché compartida en Redis (recomendado en producción). Vacío = caché en memoria del proceso.
    redisUrl: process.env.REDIS_URL || undefined,
  },
  // Panel de la plataforma de tenancy-node (dominio central /admin): crear sucursales, tema,
  // suspender, auditoría y "Entrar como…". Vacío = panel apagado.
  admin: {
    sessionSecret: process.env.TENANCY_ADMIN_SECRET ?? "",
    // Cookies con Secure (HTTPS). Solo en desarrollo por http: false
    secureCookies: (process.env.ADMIN_SECURE_COOKIES ?? "true") !== "false",
    // URL pública de cada sucursal: {tenant} se reemplaza por el id (calacoto → https://calacoto.dominio.com)
    tenantUrl: process.env.TENANT_PUBLIC_URL ?? "https://{tenant}.localhost",
  },
  // Archivos privados (comprobantes): nunca se sirven sin un enlace firmado
  privateStorageDir: process.env.PRIVATE_STORAGE_DIR ?? "./storage-private",
  jwt: {
    secret: required("JWT_SECRET"),
    expiresIn: process.env.JWT_EXPIRES_IN ?? "8h",
  },
};

if (!/^[+-]\d{2}:\d{2}$/.test(config.businessUtcOffset)) {
  throw new Error("BUSINESS_UTC_OFFSET debe tener la forma -04:00");
}

if (config.admin.sessionSecret && config.admin.sessionSecret.length < 32) {
  throw new Error("TENANCY_ADMIN_SECRET debe tener al menos 32 caracteres");
}

if (config.jwt.secret.length < 32) {
  throw new Error("JWT_SECRET debe tener al menos 32 caracteres");
}
