import type { RowDataPacket } from "mysql2";
import { pool } from "../db.js";

export const ROLES = ["ADMIN", "SUBADMIN", "RECEPCION", "CAJA", "CONTABILIDAD", "DOCTOR", "AUDITOR"] as const;
export type Role = (typeof ROLES)[number];

export async function loadRoles(userId: string): Promise<Role[]> {
  const [rows] = await pool.query<RowDataPacket[]>("SELECT role FROM user_roles WHERE user_id = ?", [userId]);
  return rows.map((r) => r.role as Role);
}

/** ADMIN tiene todos los permisos, igual que can() en src/lib/auth.tsx. */
export async function loadPermissions(roles: Role[]): Promise<string[]> {
  if (roles.length === 0) return [];
  const sql = roles.includes("ADMIN")
    ? "SELECT `key` AS permission_key FROM permissions"
    : "SELECT DISTINCT permission_key FROM role_permissions WHERE role IN (?)";
  const [rows] = await pool.query<RowDataPacket[]>(sql, [roles]);
  return rows.map((r) => r.permission_key as string);
}
