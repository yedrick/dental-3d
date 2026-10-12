import { randomBytes, randomUUID } from "node:crypto";
import { sql, type Kysely } from "kysely";
import type { Tenant } from "@tenancy-node/core";
import { hashPassword } from "../lib/password.js";

/**
 * Seed de tenancy-node: corre al crear cada sucursal (después de las migraciones), también cuando
 * se crea desde el panel de la plataforma. Deja un ADMIN por defecto ("admin") con una contraseña
 * aleatoria que nadie conoce y la cuenta marcada "por activar": se entra con "Entrar como…" desde
 * el panel y la app obliga a definir email, usuario y contraseña.
 * Idempotente: si la sucursal ya tiene un ADMIN, no hace nada (`npx tenancy seed` se puede repetir).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function seedTenant(db: Kysely<any>, tenant: Tenant) {
  const { rows } = await sql<{ n: number }>`SELECT COUNT(*) AS n FROM user_roles WHERE role = 'ADMIN'`.execute(db);
  if (Number(rows[0]?.n ?? 0) > 0) return;

  const id = randomUUID();
  const hash = await hashPassword(randomBytes(32).toString("base64url"));
  await sql`
    INSERT INTO users (id, username, full_name, email, password_hash, approved, active, must_change_password)
    VALUES (${id}, 'admin', ${`Administrador ${tenant.name}`.slice(0, 200)}, ${`admin@${tenant.id.value}.local`}, ${hash}, 1, 1, 1)
  `.execute(db);
  await sql`INSERT INTO user_roles (user_id, role) VALUES (${id}, 'ADMIN')`.execute(db);
  await sql`
    INSERT INTO audit_logs (user_id, action, table_name, record_id, data)
    VALUES (NULL, 'DEFAULT_ADMIN_CREATE', 'users', ${id}, ${JSON.stringify({ username: "admin", tenant: tenant.id.value })})
  `.execute(db);
}
