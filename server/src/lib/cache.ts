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
  studiesList: "studies:list",
  params: "params",
  reportsVersion: "reports:v",
  report: (version: number, name: string, from: string, to: string) => `report:${version}:${name}:${from}:${to}`,
} as const;

export const CacheTtl = {
  auth: 60,
  rolePerms: 600,
  doctorsList: 300,
  studiesList: 600,
  params: 600,
  report: 3600,
} as const;

export function cache() {
  return tenancy.cache();
}

export async function invalidate(...keys: string[]) {
  const c = tenancy.cache();
  await Promise.all(keys.map((k) => c.delete(k)));
}


/**
 * Versión de los reportes: cualquier cambio de datos (POST/PATCH/PUT/DELETE exitoso) la
 * incrementa, y como la versión va en la llave, un reporte nunca se sirve desactualizado
 * (ni siquiera de meses pasados con un depósito cargado con fecha atrasada).
 */
export async function reportsVersion(): Promise<number> {
  return (await tenancy.cache().get<number>(CacheKeys.reportsVersion)) ?? 0;
}

export async function bumpReportsVersion() {
  await tenancy.cache().set(CacheKeys.reportsVersion, Date.now());
}
