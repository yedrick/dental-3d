import bcrypt from "bcryptjs";
import { Router } from "express";
import { z } from "zod";
import { db, withTransaction } from "../db.js";
import { audit } from "../lib/audit.js";
import { CacheKeys, invalidate } from "../lib/cache.js";
import { HttpError } from "../lib/http-error.js";
import { hashPassword, verifyPassword } from "../lib/password.js";
import { loadPermissions, loadRoles } from "../lib/permissions.js";
import { consumeImpersonationToken, InvalidImpersonationTokenError } from "@tenancy-node/admin-api";
import { requireAuth, signToken } from "../middleware/auth.js";
import { tenancy } from "../tenancy/index.js";
import { loginLimiter, registerLimiter, sensitiveLimiter } from "../middleware/rate-limit.js";

export const authRouter = Router();

// Mismas reglas que el formulario de registro (src/routes/auth.tsx)
export const passwordSchema = z
  .string()
  .min(10, "Mínimo 10 caracteres")
  .max(200)
  .regex(/[A-Z]/, "Debe tener una mayúscula")
  .regex(/[a-z]/, "Debe tener una minúscula")
  .regex(/[0-9]/, "Debe tener un número")
  .regex(/[^A-Za-z0-9]/, "Debe tener un símbolo");

const registerSchema = z.object({
  email: z.email("Email inválido").trim().toLowerCase(),
  password: passwordSchema,
  username: z.string().trim().min(1).max(100),
  full_name: z.string().trim().min(1).max(200),
});

/**
 * Registro público en la sucursal del subdominio. Siempre queda como RECEPCION
 * pendiente de aprobación. El primer ADMIN de cada sucursal se crea con
 * `npm run tenant:create-admin` (antes, "el primer registrado es ADMIN" permitía que
 * un desconocido se adueñara de una sucursal recién creada).
 */
authRouter.post("/register", registerLimiter, async (req, res) => {
  const data = registerSchema.parse(req.body);
  const hash = await hashPassword(data.password);

  const id = await withTransaction(async (tx) => {
    const [{ id }] = await tx.query<{ id: string }[]>("SELECT UUID() AS id");
    await tx.query(
      "INSERT INTO users (id, username, full_name, email, password_hash, approved) VALUES (?, ?, ?, ?, ?, 0)",
      [id, data.username, data.full_name, data.email, hash],
    );
    await tx.query("INSERT INTO user_roles (user_id, role) VALUES (?, 'RECEPCION')", [id]);
    await audit(tx, id, "USER_REGISTER", "users", id, {
      email: data.email,
      username: data.username,
      full_name: data.full_name,
    });
    return id;
  });

  res.status(201).json({
    id,
    approved: false,
    message: "Cuenta creada. Un administrador debe aprobarla antes de que puedas ingresar.",
  });
});

const loginSchema = z.object({
  // Acepta email o nombre de usuario
  login: z.string().trim().min(1).max(255),
  password: z.string().min(1).max(200),
});

// Hash ficticio para que el tiempo de respuesta no revele si el usuario existe
const DUMMY_HASH = bcrypt.hashSync("dummy-password-not-used", 12);

authRouter.post("/login", loginLimiter, async (req, res) => {
  const { login, password } = loginSchema.parse(req.body);
  const rows = await db().query<{ id: string; password_hash: string; active: boolean; approved: boolean; token_version: number }[]>(
    "SELECT id, password_hash, active, approved, token_version FROM users WHERE email = ? OR username = ? LIMIT 1",
    [login.toLowerCase(), login],
  );
  const u = rows[0];
  const ok = await verifyPassword(password, u?.password_hash ?? DUMMY_HASH);
  if (!u || !ok) throw new HttpError(401, "Usuario o contraseña incorrectos", "INVALID_CREDENTIALS");
  if (!u.active) throw new HttpError(403, "Tu usuario está desactivado", "USER_INACTIVE");
  if (!u.approved) throw new HttpError(403, "Tu cuenta aún no ha sido aprobada por un administrador.", "USER_NOT_APPROVED");

  res.json({ token: signToken(u.id, u.token_version) });
});

/** Datos de la sesión actual: perfil, roles, permisos y sucursal. */
authRouter.get("/me", requireAuth, async (req, res) => {
  const rows = await db().query(
    "SELECT id, username, full_name, email, active, approved, must_change_password, created_at FROM users WHERE id = ?",
    [req.user!.id],
  );
  const roles = await loadRoles(req.user!.id);
  res.json({
    user: rows[0],
    roles,
    permissions: await loadPermissions(roles),
    tenant: { id: req.tenant!.id.value, name: req.tenant!.name },
    impersonated_by: req.user!.impersonatedBy ?? null,
  });
});

const changePasswordSchema = z.object({
  current_password: z.string().min(1).max(200),
  new_password: passwordSchema,
});

authRouter.post("/change-password", sensitiveLimiter, requireAuth, async (req, res) => {
  const data = changePasswordSchema.parse(req.body);
  const rows = await db().query<{ password_hash: string }[]>("SELECT password_hash FROM users WHERE id = ?", [
    req.user!.id,
  ]);
  if (!(await verifyPassword(data.current_password, rows[0].password_hash))) {
    throw new HttpError(400, "La contraseña actual no es correcta", "INVALID_CREDENTIALS");
  }
  const hash = await hashPassword(data.new_password);
  // Cierra todas las sesiones anteriores (token_version + 1) y entrega un token nuevo para esta
  const version = await withTransaction(async (tx) => {
    await tx.query("UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?", [hash, req.user!.id]);
    await audit(tx, req.user!.id, "PASSWORD_CHANGE", "users", req.user!.id, null);
    const [u] = await tx.query<{ token_version: number }[]>("SELECT token_version FROM users WHERE id = ?", [req.user!.id]);
    return u.token_version;
  });
  await invalidate(CacheKeys.auth(req.user!.id));
  res.json({ ok: true, token: signToken(req.user!.id, version) });
});

const profileSchema = z.object({
  full_name: z.string().trim().min(1).max(200).optional(),
  username: z.string().trim().min(1).max(100).optional(),
});

/** El usuario edita su propio nombre y usuario (el email y los roles los cambia un ADMIN). */
authRouter.patch("/me", requireAuth, async (req, res) => {
  const data = profileSchema.parse(req.body);
  const fields = (["full_name", "username"] as const).filter((c) => data[c] !== undefined);
  if (fields.length === 0) throw new HttpError(400, "No hay campos para actualizar");
  const user = await withTransaction(async (tx) => {
    await tx.query(`UPDATE users SET ${fields.map((c) => `${c} = ?`).join(", ")} WHERE id = ?`, [...fields.map((c) => data[c]), req.user!.id]);
    const [u] = await tx.query("SELECT id, username, full_name, email, active, approved, created_at FROM users WHERE id = ?", [req.user!.id]);
    await audit(tx, req.user!.id, "PROFILE_UPDATE", "users", req.user!.id, data);
    return u;
  });
  res.json(user);
});

/**
 * "Entrar como…" desde el panel de la plataforma (tenancy-node, dominio central /admin).
 * El panel abre https://<sucursal>.dominio.com/api/auth/impersonate?token=… (token de un solo uso,
 * 60 s, solo vale en esta sucursal). Se canjea, se busca al usuario por id, usuario o email y se
 * entrega una sesión de 1 hora marcada como suplantación: todo queda auditado con _impersonated_by.
 * El token de la app viaja en el fragmento (#), que el navegador no envía a ningún servidor.
 */
authRouter.get("/impersonate", sensitiveLimiter, async (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  let imp: Awaited<ReturnType<typeof consumeImpersonationToken>>;
  try {
    imp = await consumeImpersonationToken(tenancy, token);
  } catch (e) {
    if (e instanceof InvalidImpersonationTokenError) {
      return res.redirect(302, "/auth?error=impersonation");
    }
    throw e;
  }
  const ident = imp.userIdentifier.trim();
  const [user] = await db().query<{ id: string; active: boolean; approved: boolean; token_version: number }[]>(
    "SELECT id, active, approved, token_version FROM users WHERE id = ? OR username = ? OR email = ? LIMIT 1",
    [ident, ident, ident.toLowerCase()],
  );
  if (!user || !user.active) return res.redirect(302, "/auth?error=impersonation_user");

  const by = `platform:${imp.adminUserId}`;
  await withTransaction((tx) => audit(tx, user.id, "IMPERSONATE_PLATFORM", "users", user.id, { platform_admin_id: imp.adminUserId, by }));
  const appToken = signToken(user.id, user.token_version, { impersonatedBy: by, expiresIn: "1h" });
  const redirect = imp.redirectPath && imp.redirectPath.startsWith("/") && !imp.redirectPath.startsWith("//") ? imp.redirectPath : "/app";
  res.setHeader("Cache-Control", "no-store");
  res.redirect(302, `/auth/impersonate#token=${encodeURIComponent(appToken)}&redirect=${encodeURIComponent(redirect)}`);
});

const setupSchema = z.object({
  email: z.email("Email inválido").trim().toLowerCase(),
  username: z.string().trim().min(1).max(100),
  full_name: z.string().trim().min(1).max(200),
  new_password: passwordSchema,
});

/**
 * Activa la cuenta por defecto de una sucursal nueva: define email, usuario, nombre y contraseña
 * sin pedir la contraseña actual (nadie la conoce). Solo sirve mientras la cuenta está "por activar".
 */
authRouter.post("/setup-account", sensitiveLimiter, requireAuth, async (req, res) => {
  const data = setupSchema.parse(req.body);
  const hash = await hashPassword(data.new_password);
  const version = await withTransaction(async (tx) => {
    const [u] = await tx.query<{ must_change_password: boolean }[]>(
      "SELECT must_change_password FROM users WHERE id = ? FOR UPDATE",
      [req.user!.id],
    );
    if (!u?.must_change_password) throw new HttpError(400, "Esta cuenta ya está activada. Cambia tu contraseña desde Mi perfil.", "ALREADY_ACTIVATED");
    await tx.query(
      `UPDATE users SET email = ?, username = ?, full_name = ?, password_hash = ?, must_change_password = 0,
              token_version = token_version + 1 WHERE id = ?`,
      [data.email, data.username, data.full_name, hash, req.user!.id],
    );
    await audit(tx, req.user!.id, "ACCOUNT_SETUP", "users", req.user!.id, { email: data.email, username: data.username });
    const [v] = await tx.query<{ token_version: number }[]>("SELECT token_version FROM users WHERE id = ?", [req.user!.id]);
    return v.token_version;
  });
  await invalidate(CacheKeys.auth(req.user!.id));
  // Sesión normal (ya no suplantada): la cuenta queda en manos de quien la activó
  res.json({ ok: true, token: signToken(req.user!.id, version) });
});
