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
  corsOrigin: list(process.env.CORS_ORIGIN),
  // Saltos de proxy de confianza para leer la IP real (rate limit). 0 = tráfico directo.
  trustProxy: Number(process.env.TRUST_PROXY ?? 0),
  // Zona horaria del negocio para los filtros por día (Bolivia = -04:00, sin horario de verano)
  businessUtcOffset: process.env.BUSINESS_UTC_OFFSET ?? "-04:00",
  tenancy: {
    // Base central de tenancy-node (tablas tenancy_*). El usuario necesita CREATE DATABASE,
    // CREATE USER y GRANT OPTION para crear la base y el usuario de cada sucursal.
    databaseUrl: required("DATABASE_URL"),
    // Llave AES-256-GCM: cifra la contraseña del usuario MySQL de cada sucursal.
    encryptionKey: required("TENANCY_KEY"),
    // Dominios que nunca son una sucursal; las sucursales son subdominios de estos.
    centralDomains: list(process.env.CENTRAL_DOMAINS ?? "localhost"),
    storageDir: process.env.STORAGE_DIR ?? "./storage",
  },
  jwt: {
    secret: required("JWT_SECRET"),
    expiresIn: process.env.JWT_EXPIRES_IN ?? "8h",
  },
};

if (!/^[+-]\d{2}:\d{2}$/.test(config.businessUtcOffset)) {
  throw new Error("BUSINESS_UTC_OFFSET debe tener la forma -04:00");
}

if (config.jwt.secret.length < 32) {
  throw new Error("JWT_SECRET debe tener al menos 32 caracteres");
}
