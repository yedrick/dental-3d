import bcrypt from "bcryptjs";
import { Router } from "express";
import { z } from "zod";
import { db, withTransaction, type Db } from "../db.js";
import { audit } from "../lib/audit.js";
import { CacheKeys, invalidate } from "../lib/cache.js";
import { HttpError } from "../lib/http-error.js";
import { ROLES, type Role } from "../lib/permissions.js";
import { requireAuth, requirePermission, signToken } from "../middleware/auth.js";
import { sensitiveLimiter } from "../middleware/rate-limit.js";
import { passwordSchema } from "./auth.routes.js";

/**
 * Usuarios de la sucursal (reemplaza src/lib/users-admin.functions.ts + profiles/user_roles).
 * Protecciones contra escalada de privilegios:
 * - Solo un ADMIN puede asignar o quitar el rol ADMIN, o modificar/eliminar/suplantar a un ADMIN.
 * - Nadie puede eliminarse, desactivarse ni desaprobarse a sí mismo.
 * - Siempre queda al menos un ADMIN activo y aprobado.
 * - Contraseña nueva, desactivación, desaprobación o cambio de roles cierran sus sesiones.
 */
export const usersRouter = Router();
usersRouter.use(requireAuth);

const roleSchema = z.enum(ROLES);
const rolesSchema = z.array(roleSchema).min(1, "Asigna al menos un rol").max(ROLES.length).transform((r) => [...new Set(r)]);

const USER_FIELDS = "u.id, u.username, u.full_name, u.email, u.active, u.approved, u.created_at";

async function findUser(q: Db, id: string, lock = false) {
  const [u] = await q.query<{ id: string; username: string; full_name: string; email: string; active: boolean; approved: boolean }[]>(
    `SELECT ${USER_FIELDS} FROM users u WHERE u.id = ?${lock ? " FOR UPDATE" : ""}`,
    [id],
  );
  if (!u) return null;
  const roles = await q.query<{ role: Role }[]>("SELECT role FROM user_roles WHERE user_id = ? ORDER BY role", [id]);
  return { ...u, roles: roles.map((r) => r.role) };
}

const isAdmin = (roles: readonly string[]) => roles.includes("ADMIN");

/** Un no-ADMIN no puede tocar a un ADMIN. */
function assertCanManage(actorRoles: Role[], target: { roles: Role[] }) {
  if (isAdmin(target.roles) && !isAdmin(actorRoles)) {
    throw new HttpError(403, "Solo un ADMIN puede modificar a otro ADMIN");
  }
}

/** Después del cambio debe quedar al menos un ADMIN activo y aprobado (con bloqueo, contra carreras). */
async function assertAnotherAdminRemains(tx: Db, excludingUserId: string) {
  const rows = await tx.query(
    `SELECT u.id FROM users u JOIN user_roles ur ON ur.user_id = u.id
      WHERE ur.role = 'ADMIN' AND u.active = 1 AND u.approved = 1 AND u.id <> ?
      FOR UPDATE`,
    [excludingUserId],
  );
  if (rows.length === 0) throw new HttpError(409, "Debe quedar al menos un ADMIN activo en la sucursal", "LAST_ADMIN");
}

async function revokeSessions(tx: Db, userId: string) {
  await tx.query("UPDATE users SET token_version = token_version + 1 WHERE id = ?", [userId]);
}

// ---------- Lectura ----------

usersRouter.get("/", requirePermission("view.users"), async (req, res) => {
  const f = z.object({
    q: z.string().trim().max(100).optional(),
    approved: z.enum(["true", "false"]).optional(),
    role: roleSchema.optional(),
  }).parse(req.query);
  const where: string[] = [];
  const params: unknown[] = [];
  if (f.q) { where.push("(u.full_name LIKE ? OR u.username LIKE ? OR u.email LIKE ?)"); params.push(`%${f.q}%`, `%${f.q}%`, `%${f.q}%`); }
  if (f.approved) { where.push("u.approved = ?"); params.push(f.approved === "true"); }
  if (f.role) { where.push("EXISTS (SELECT 1 FROM user_roles r WHERE r.user_id = u.id AND r.role = ?)"); params.push(f.role); }
  const rows = await db().query<{ id: string; roles: string | null }[]>(
    `SELECT ${USER_FIELDS}, GROUP_CONCAT(ur.role ORDER BY ur.role) AS roles
       FROM users u LEFT JOIN user_roles ur ON ur.user_id = u.id
       ${where.length ? "WHERE " + where.join(" AND ") : ""}
      GROUP BY u.id ORDER BY u.created_at DESC`,
    params,
  );
  res.json(rows.map((r) => ({ ...r, roles: r.roles ? r.roles.split(",") : [] })));
});

usersRouter.get("/:id", requirePermission("view.users"), async (req, res) => {
  const user = await findUser(db(), String(req.params.id));
  if (!user) throw new HttpError(404, "Usuario no encontrado");
  res.json(user);
});

// ---------- Crear ----------

const createSchema = z.object({
  email: z.email("Email inválido").trim().toLowerCase(),
  username: z.string().trim().min(1).max(100),
  full_name: z.string().trim().min(1).max(200),
  password: passwordSchema,
  roles: rolesSchema,
});

/** Crea un usuario ya aprobado (como adminCreateUser). */
usersRouter.post("/", requirePermission("users.create"), async (req, res) => {
  const data = createSchema.parse(req.body);
  if (isAdmin(data.roles) && !isAdmin(req.user!.roles)) throw new HttpError(403, "Solo un ADMIN puede crear otro ADMIN");
  const hash = await bcrypt.hash(data.password, 12);
  const user = await withTransaction(async (tx) => {
    const [{ id }] = await tx.query<{ id: string }[]>("SELECT UUID() AS id");
    await tx.query(
      "INSERT INTO users (id, username, full_name, email, password_hash, approved, active) VALUES (?, ?, ?, ?, ?, 1, 1)",
      [id, data.username, data.full_name, data.email, hash],
    );
    await tx.query("INSERT INTO user_roles (user_id, role) VALUES ?", [data.roles.map((r) => [id, r])]);
    await audit(tx, req.user!.id, "USER_CREATE", "users", id, { email: data.email, username: data.username, full_name: data.full_name, roles: data.roles });
    return findUser(tx, id);
  });
  res.status(201).json(user);
});

// ---------- Editar ----------

const updateSchema = z.object({
  email: z.email("Email inválido").trim().toLowerCase().optional(),
  username: z.string().trim().min(1).max(100).optional(),
  full_name: z.string().trim().min(1).max(200).optional(),
  password: passwordSchema.optional(),
  active: z.boolean().optional(),
});

usersRouter.patch("/:id", requirePermission("users.edit"), sensitiveLimiter, async (req, res) => {
  const id = String(req.params.id);
  const data = updateSchema.parse(req.body);
  if (Object.keys(data).length === 0) throw new HttpError(400, "No hay campos para actualizar");
  if (id === req.user!.id && data.active === false) throw new HttpError(400, "No puedes desactivar tu propio usuario");
  const hash = data.password ? await bcrypt.hash(data.password, 12) : null;

  const user = await withTransaction(async (tx) => {
    const target = await findUser(tx, id, true);
    if (!target) throw new HttpError(404, "Usuario no encontrado");
    assertCanManage(req.user!.roles, target);
    if (data.active === false && isAdmin(target.roles)) await assertAnotherAdminRemains(tx, id);

    const changes: Record<string, unknown> = {};
    for (const c of ["email", "username", "full_name", "active"] as const) if (data[c] !== undefined) changes[c] = data[c];
    if (hash) changes.password_hash = hash;
    const cols = Object.keys(changes);
    await tx.query(`UPDATE users SET ${cols.map((c) => `${c} = ?`).join(", ")} WHERE id = ?`, [...cols.map((c) => changes[c]), id]);
    if (hash || data.active === false) await revokeSessions(tx, id);

    await audit(tx, req.user!.id, "USER_UPDATE", "users", id, {
      changed: { ...data, password: undefined, password_changed: Boolean(hash) },
    });
    return findUser(tx, id);
  });
  await invalidate(CacheKeys.auth(id));
  res.json(user);
});

/** Aprueba o desaprueba (antes protect_profile_approved: solo ADMIN). */
usersRouter.post("/:id/approve", requirePermission("users.approve"), async (req, res) => {
  const id = String(req.params.id);
  const { approved } = z.object({ approved: z.boolean() }).parse(req.body);
  if (id === req.user!.id && !approved) throw new HttpError(400, "No puedes desaprobar tu propio usuario");
  const user = await withTransaction(async (tx) => {
    const target = await findUser(tx, id, true);
    if (!target) throw new HttpError(404, "Usuario no encontrado");
    assertCanManage(req.user!.roles, target);
    if (!approved && isAdmin(target.roles)) await assertAnotherAdminRemains(tx, id);
    await tx.query("UPDATE users SET approved = ? WHERE id = ?", [approved, id]);
    if (!approved) await revokeSessions(tx, id);
    await audit(tx, req.user!.id, approved ? "USER_APPROVE" : "USER_UNAPPROVE", "users", id, { email: target.email });
    return findUser(tx, id);
  });
  await invalidate(CacheKeys.auth(id));
  res.json(user);
});

/** Reemplaza los roles del usuario. */
usersRouter.put("/:id/roles", requirePermission("users.manage_roles"), async (req, res) => {
  const id = String(req.params.id);
  const { roles } = z.object({ roles: rolesSchema }).parse(req.body);
  const user = await withTransaction(async (tx) => {
    const target = await findUser(tx, id, true);
    if (!target) throw new HttpError(404, "Usuario no encontrado");
    assertCanManage(req.user!.roles, target);
    if (isAdmin(roles) && !isAdmin(req.user!.roles)) throw new HttpError(403, "Solo un ADMIN puede asignar el rol ADMIN");
    if (isAdmin(target.roles) && !isAdmin(roles)) await assertAnotherAdminRemains(tx, id);

    await tx.query("DELETE FROM user_roles WHERE user_id = ?", [id]);
    await tx.query("INSERT INTO user_roles (user_id, role) VALUES ?", [roles.map((r) => [id, r])]);
    await revokeSessions(tx, id);
    await audit(tx, req.user!.id, "USER_ROLES", "users", id, { from: target.roles, to: roles });
    return findUser(tx, id);
  });
  await invalidate(CacheKeys.auth(id));
  res.json(user);
});

// ---------- Eliminar ----------

/** Lo que el usuario registró se conserva: created_by queda en NULL y la auditoría guarda su id. */
usersRouter.delete("/:id", requirePermission("users.delete"), async (req, res) => {
  const id = String(req.params.id);
  if (id === req.user!.id) throw new HttpError(400, "No puedes eliminar tu propio usuario");
  await withTransaction(async (tx) => {
    const target = await findUser(tx, id, true);
    if (!target) throw new HttpError(404, "Usuario no encontrado");
    assertCanManage(req.user!.roles, target);
    if (isAdmin(target.roles)) await assertAnotherAdminRemains(tx, id);
    await tx.query("DELETE FROM users WHERE id = ?", [id]);
    await audit(tx, req.user!.id, "USER_DELETE", "users", id, { profile: target });
  });
  await invalidate(CacheKeys.auth(id));
  res.status(204).end();
});

// ---------- Iniciar sesión como otro usuario ----------

/**
 * Entrega un token del usuario elegido, válido 1 hora y marcado como suplantación: todo lo que
 * se haga queda en la auditoría con _impersonated_by. No se puede suplantar a un ADMIN.
 */
usersRouter.post("/:id/impersonate", requirePermission("users.impersonate"), sensitiveLimiter, async (req, res) => {
  const id = String(req.params.id);
  if (id === req.user!.id) throw new HttpError(400, "Ya eres este usuario");
  if (req.user!.impersonatedBy) throw new HttpError(400, "No se puede suplantar desde una sesión suplantada");
  const target = await withTransaction(async (tx) => {
    const t = await findUser(tx, id);
    if (!t) throw new HttpError(404, "Usuario no encontrado");
    if (isAdmin(t.roles)) throw new HttpError(403, "No se puede iniciar sesión como otro ADMIN");
    if (!t.active || !t.approved) throw new HttpError(400, "El usuario está inactivo o sin aprobar");
    await audit(tx, req.user!.id, "IMPERSONATE_START", "users", id, { target: t.email });
    const [{ token_version }] = await tx.query<{ token_version: number }[]>("SELECT token_version FROM users WHERE id = ?", [id]);
    return { ...t, token_version };
  });
  res.json({
    token: signToken(id, target.token_version, { impersonatedBy: req.user!.id, expiresIn: "1h" }),
    user: { id, email: target.email, full_name: target.full_name, roles: target.roles },
    expires_in: 3600,
  });
});
