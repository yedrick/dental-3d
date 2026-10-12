import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { AdminHttpError, type TenantUsersAdapter } from "@tenancy-node/admin-api";
import { db, withTransaction } from "../db.js";
import { audit } from "../lib/audit.js";
import { ROLES, type Role } from "../lib/permissions.js";
import { passwordSchema } from "../routes/auth.routes.js";

const ROLE_LABELS: Record<Role, string> = {
  ADMIN: "Administrador",
  SUBADMIN: "Subadministrador",
  RECEPCION: "Recepción",
  CAJA: "Caja",
  CONTABILIDAD: "Contabilidad",
  DOCTOR: "Doctor",
  AUDITOR: "Auditor",
};

/** `%` y `_` del texto buscado se toman literales en el LIKE. */
const like = (text: string) => `%${text.replace(/[\\%_]/g, "\\$&")}%`;

/** Username libre a partir del email (ana.perez@x.com → ana.perez, ana.perez2...). */
async function freeUsername(email: string): Promise<string> {
  const base = (email.split("@")[0] ?? "usuario").replace(/[^a-z0-9._-]/gi, "").slice(0, 90) || "usuario";
  const taken = new Set(
    (await db().query<{ username: string }[]>("SELECT username FROM users WHERE username LIKE ?", [`${base}%`])).map(
      (r) => r.username,
    ),
  );
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base}${i}`)) return `${base}${i}`;
}

/**
 * Usuarios de cada sucursal para el panel de la plataforma (tenancy-node `tenantUsers`): los lista,
 * los crea con las mismas reglas que POST /api/users y permite "Entrar como". Corre en el contexto
 * de la sucursal, así que db() ya apunta a su base.
 */
export const tenantUsers: TenantUsersAdapter = {
  roles: ROLES.map((value) => ({ value, label: ROLE_LABELS[value] })),

  async list({ search, page, perPage }) {
    const where = search ? "WHERE u.full_name LIKE ? OR u.email LIKE ? OR u.username LIKE ?" : "";
    const params = search ? [like(search), like(search), like(search)] : [];
    const [rows, [count]] = await Promise.all([
      db().query<{ id: string; full_name: string; email: string; active: boolean; roles: string | null }[]>(
        `SELECT u.id, u.full_name, u.email, u.active,
                GROUP_CONCAT(r.role ORDER BY FIELD(r.role, ${ROLES.map(() => "?").join(", ")})) AS roles
           FROM users u LEFT JOIN user_roles r ON r.user_id = u.id
           ${where}
          GROUP BY u.id, u.full_name, u.email, u.active
          ORDER BY u.full_name
          LIMIT ? OFFSET ?`,
        [...ROLES, ...params, perPage, (page - 1) * perPage],
      ),
      db().query<{ n: number }[]>(`SELECT COUNT(*) AS n FROM users u ${where}`, params),
    ]);
    return {
      items: rows.map((u) => ({
        id: u.id,
        name: u.full_name,
        email: u.email,
        // El rol de más jerarquía (un usuario puede tener varios).
        role: u.roles?.split(",")[0] ?? null,
        active: Boolean(u.active),
      })),
      total: Number(count?.n ?? 0),
    };
  },

  async create({ name, email, role, password }) {
    const roleValue = (role ?? "RECEPCION") as Role;
    if (password !== undefined) {
      const check = passwordSchema.safeParse(password);
      if (!check.success)
        throw new AdminHttpError(422, "WEAK_PASSWORD", check.error.issues.map((i) => i.message).join(". "));
    }
    const [exists] = await db().query<{ id: string }[]>("SELECT id FROM users WHERE email = ? LIMIT 1", [email]);
    if (exists) throw new AdminHttpError(409, "EMAIL_TAKEN", "Ya existe un usuario con ese email en esta sucursal");

    const username = await freeUsername(email);
    // Sin contraseña, la cuenta queda "por activar" (como el ADMIN del seed): se entra con
    // "Entrar como…" y la app obliga a definir una.
    const hash = await bcrypt.hash(password ?? randomBytes(32).toString("base64url"), 12);
    try {
      const id = await withTransaction(async (tx) => {
        const [{ id }] = await tx.query<{ id: string }[]>("SELECT UUID() AS id");
        await tx.query(
          `INSERT INTO users (id, username, full_name, email, password_hash, approved, active, must_change_password)
           VALUES (?, ?, ?, ?, ?, 1, 1, ?)`,
          [id, username, name.slice(0, 200), email, hash, password === undefined ? 1 : 0],
        );
        await tx.query("INSERT INTO user_roles (user_id, role) VALUES (?, ?)", [id, roleValue]);
        await audit(tx, null, "USER_CREATE_PLATFORM", "users", id, {
          email,
          username,
          full_name: name,
          roles: [roleValue],
          by: "platform",
        });
        return id;
      });
      return { id, name, email, role: roleValue, active: true };
    } catch (error) {
      if ((error as { code?: string }).code === "ER_DUP_ENTRY")
        throw new AdminHttpError(409, "EMAIL_TAKEN", "Ya existe un usuario con ese email en esta sucursal");
      throw error;
    }
  },
};
