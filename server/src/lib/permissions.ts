import { db } from "../db.js";
import { cache, CacheKeys, CacheTtl } from "./cache.js";

export const ROLES = ["ADMIN", "SUBADMIN", "RECEPCION", "CAJA", "CONTABILIDAD", "DOCTOR", "AUDITOR"] as const;
export type Role = (typeof ROLES)[number];

export async function loadRoles(userId: string): Promise<Role[]> {
  const rows = await db().query<{ role: Role }[]>("SELECT role FROM user_roles WHERE user_id = ?", [userId]);
  return rows.map((r) => r.role);
}

/** ADMIN tiene todos los permisos, igual que can() en src/lib/auth.tsx. Cacheado por combinación de roles. */
export async function loadPermissions(roles: Role[]): Promise<string[]> {
  if (roles.length === 0) return [];
  return cache().remember(CacheKeys.rolePerms(roles), CacheTtl.rolePerms, async () => {
    const rows = roles.includes("ADMIN")
      ? await db().query<{ k: string }[]>("SELECT `key` AS k FROM permissions")
      : await db().query<{ k: string }[]>(
          "SELECT DISTINCT permission_key AS k FROM role_permissions WHERE role IN (?)",
          [roles],
        );
    return rows.map((r) => r.k);
  });
}
