import { tenancy } from "../tenancy/index.js";

/**
 * Caché de la sucursal actual. tenancy.cache() ya aísla las llaves por tenant
 * (tenant:<id>:...), así que una sucursal nunca lee la caché de otra.
 *
 * Regla: solo datos que se leen mucho y cambian poco. Nada de dinero (caja, precios
 * al registrar, comisiones): eso siempre se lee de la base dentro de la transacción.
 * Cada escritura borra sus llaves DESPUÉS del commit; el TTL es solo una red de seguridad.
 */
export const CacheKeys = {
  auth: (userId: string) => `auth:${userId}`,
  rolePerms: (roles: string[]) => `perms:${[...roles].sort().join(",")}`,
  doctorsList: "doctors:list",
} as const;

export const CacheTtl = {
  auth: 60,
  rolePerms: 600,
  doctorsList: 300,
} as const;

export function cache() {
  return tenancy.cache();
}

export async function invalidate(...keys: string[]) {
  const c = tenancy.cache();
  await Promise.all(keys.map((k) => c.delete(k)));
}

