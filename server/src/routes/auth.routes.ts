import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import bcrypt from "bcryptjs";
import { Router } from "express";
import { z } from "zod";
import { db, withTransaction } from "../db.js";
import { audit } from "../lib/audit.js";
import { CacheKeys, invalidate } from "../lib/cache.js";
import { HttpError } from "../lib/http-error.js";
import { mailConfigured, passwordResetEmail, sendInBackground, sendMail } from "../lib/mailer.js";
import { username as usernameSchema } from "../lib/schemas.js";
import { hashPassword, verifyPassword } from "../lib/password.js";
import { loadPermissions, loadRoles } from "../lib/permissions.js";
import { consumeImpersonationToken, InvalidImpersonationTokenError } from "@tenancy-node/admin-api";
import { doctorScope, requireAuth, signToken } from "../middleware/auth.js";
import { tenancy } from "../tenancy/index.js";
import { config } from "../config.js";
import { forgotLimiter, loginLimiter, registerLimiter, sensitiveLimiter } from "../middleware/rate-limit.js";

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
  username: usernameSchema,
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
  // Con "@" se busca por email (y si coincide también un usuario viejo con "@", gana el email);
  // sin "@", solo por nombre de usuario. Así nadie puede "tapar" el email de otra persona.
  const byEmail = login.includes("@");
  const rows = await db().query<{ id: string; password_hash: string; active: boolean; approved: boolean; token_version: number }[]>(
    byEmail
      ? "SELECT id, password_hash, active, approved, token_version FROM users WHERE email = ? OR username = ? ORDER BY email = ? DESC LIMIT 1"
      : "SELECT id, password_hash, active, approved, token_version FROM users WHERE username = ? LIMIT 1",
    byEmail ? [login.toLowerCase(), login, login.toLowerCase()] : [login],
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
    "SELECT id, username, full_name, email, active, approved, must_change_password, doctor_id, created_at FROM users WHERE id = ?",
    [req.user!.id],
  );
  const roles = await loadRoles(req.user!.id);
  res.json({
    user: rows[0],
    // "doctor": solo ve lo de su ficha de doctor (sus pacientes, atenciones y comisiones)
    scope: doctorScope(req.user) !== undefined ? "doctor" : "full",
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
  username: usernameSchema.optional(),
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
  // El panel manda el id del usuario (o su email o usuario): se busca por el campo que corresponda
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ident);
  const [user] = await db().query<{ id: string; active: boolean; approved: boolean; token_version: number }[]>(
    `SELECT id, active, approved, token_version FROM users WHERE ${isUuid ? "id = ?" : ident.includes("@") ? "email = ?" : "username = ?"} LIMIT 1`,
    [ident.includes("@") && !isUuid ? ident.toLowerCase() : ident],
  );
  if (!user || !user.active) return res.redirect(302, "/auth?error=impersonation_user");

  const by = `platform:${imp.adminUserId}`;
  await withTransaction((tx) => audit(tx, user.id, "IMPERSONATE_PLATFORM", "users", user.id, { platform_admin_id: imp.adminUserId, by }));
  const appToken = signToken(user.id, user.token_version, { impersonatedBy: by, expiresIn: "1h" });
  // Solo rutas de esta misma app: "/x" sí; "//otro.com" o "/\\otro.com" (que el navegador toma como otro sitio) no
  const redirect = imp.redirectPath && /^\/(?![\/\\])/.test(imp.redirectPath) ? imp.redirectPath : "/app";
  res.setHeader("Cache-Control", "no-store");
  res.redirect(302, `/auth/impersonate#token=${encodeURIComponent(appToken)}&redirect=${encodeURIComponent(redirect)}`);
});

const setupSchema = z.object({
  email: z.email("Email inválido").trim().toLowerCase(),
  username: usernameSchema,
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

// ---------- Recuperar la contraseña con un código por correo ----------
// Se enciende y apaga para TODAS las sucursales en .env (PASSWORD_RESET_ENABLED y MAIL_SMTP_*).

const RESET_MINUTES = 15;
const RESET_MAX_ATTEMPTS = 5;
const resetEnabled = () => config.mail.passwordResetEnabled && mailConfigured();
/** Solo se guarda el HMAC del código (ligado a la sucursal y al usuario), nunca el código. */
const codeHash = (userId: string, code: string) =>
  createHmac("sha256", `${config.jwt.secret}:password-reset`).update(`${tenancy.currentId()}\n${userId}\n${code}`).digest("hex");

/** ¿Está disponible la recuperación por correo? (la pantalla decide qué mostrar) */
authRouter.get("/password-reset", (_req, res) => {
  res.json({ enabled: resetEnabled(), minutes: RESET_MINUTES });
});

const forgotSchema = z.object({ email: z.email("Email inválido").trim().toLowerCase() });

/**
 * Pide un código. Responde lo mismo exista o no el email (nadie puede averiguar qué correos hay)
 * y el correo sale en segundo plano (el tiempo de respuesta tampoco lo delata).
 */
authRouter.post("/forgot-password", forgotLimiter, async (req, res) => {
  if (!resetEnabled()) {
    throw new HttpError(503, "La recuperación por correo no está activada. Pide a un administrador de tu sucursal una contraseña nueva.", "PASSWORD_RESET_DISABLED");
  }
  const { email } = forgotSchema.parse(req.body);
  const [user] = await db().query<{ id: string; full_name: string; email: string }[]>(
    "SELECT id, full_name, email FROM users WHERE email = ? AND active = 1 AND approved = 1 LIMIT 1",
    [email],
  );
  if (user) {
    // Máx. 1 código por minuto y 5 por hora por usuario
    const [{ lastMinute, lastHour }] = await db().query<{ lastMinute: number; lastHour: number }[]>(
      `SELECT SUM(created_at > UTC_TIMESTAMP() - INTERVAL 1 MINUTE) AS lastMinute, COUNT(*) AS lastHour
         FROM password_resets WHERE user_id = ? AND created_at > UTC_TIMESTAMP() - INTERVAL 1 HOUR`,
      [user.id],
    );
    if (Number(lastMinute ?? 0) === 0 && Number(lastHour) < 5) {
      const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
      await withTransaction(async (tx) => {
        // Un código nuevo anula los anteriores
        await tx.query("UPDATE password_resets SET used_at = UTC_TIMESTAMP() WHERE user_id = ? AND used_at IS NULL", [user.id]);
        await tx.query(
          `INSERT INTO password_resets (user_id, code_hash, expires_at, ip)
           VALUES (?, ?, UTC_TIMESTAMP() + INTERVAL ${RESET_MINUTES} MINUTE, ?)`,
          [user.id, codeHash(user.id, code), req.ip ?? null],
        );
        await audit(tx, user.id, "PASSWORD_RESET_REQUEST", "users", user.id, { ip: req.ip ?? null });
      });
      const tenant = tenancy.currentOrFail();
      const base = config.admin.tenantUrl.replace("{tenant}", tenant.id.value).replace(/\/$/, "");
      const logo = await tenancy.theme().logoUrl().catch(() => undefined);
      const mail = passwordResetEmail({
        branchName: tenant.name,
        userName: user.full_name,
        code,
        minutes: RESET_MINUTES,
        resetUrl: `${base}/reset-password?email=${encodeURIComponent(user.email)}`,
        logoUrl: logo ? (logo.startsWith("http") ? logo : `${base}${logo}`) : undefined,
      });
      sendInBackground(() => sendMail({ to: user.email, fromName: tenant.name, ...mail }), {
        tenantId: tenant.id.value, userId: user.id, operation: "password_reset.send",
      });
    }
  }
  res.json({ ok: true, minutes: RESET_MINUTES });
});

const resetSchema = z.object({
  email: z.email("Email inválido").trim().toLowerCase(),
  code: z.string().trim().regex(/^\d{6}$/, "El código tiene 6 dígitos"),
  new_password: passwordSchema,
});
const INVALID_CODE = "Código inválido o vencido. Pide uno nuevo si hace falta.";

/** Cambia la contraseña con el código. Cierra las demás sesiones y deja al usuario dentro. */
authRouter.post("/reset-password", sensitiveLimiter, async (req, res) => {
  if (!resetEnabled()) throw new HttpError(503, "La recuperación por correo no está activada.", "PASSWORD_RESET_DISABLED");
  const data = resetSchema.parse(req.body);
  const [user] = await db().query<{ id: string }[]>(
    "SELECT id FROM users WHERE email = ? AND active = 1 AND approved = 1 LIMIT 1",
    [data.email],
  );
  if (!user) throw new HttpError(400, INVALID_CODE, "INVALID_CODE");
  const hash = await hashPassword(data.new_password);

  const version = await withTransaction(async (tx) => {
    const [reset] = await tx.query<{ id: number; code_hash: string; attempts: number }[]>(
      `SELECT id, code_hash, attempts FROM password_resets
        WHERE user_id = ? AND used_at IS NULL AND expires_at > UTC_TIMESTAMP()
        ORDER BY id DESC LIMIT 1 FOR UPDATE`,
      [user.id],
    );
    if (!reset || reset.attempts >= RESET_MAX_ATTEMPTS) return null;
    const expected = Buffer.from(reset.code_hash, "hex");
    const given = Buffer.from(codeHash(user.id, data.code), "hex");
    if (!timingSafeEqual(expected, given)) {
      // Cada intento fallido cuenta; al 5.º el código queda anulado
      await tx.query(
        `UPDATE password_resets SET attempts = attempts + 1,
                used_at = IF(attempts + 1 >= ${RESET_MAX_ATTEMPTS}, UTC_TIMESTAMP(), used_at)
          WHERE id = ?`,
        [reset.id],
      );
      return null;
    }
    await tx.query("UPDATE password_resets SET used_at = UTC_TIMESTAMP() WHERE id = ?", [reset.id]);
    await tx.query("UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?", [hash, user.id]);
    const [{ token_version }] = await tx.query<{ token_version: number }[]>("SELECT token_version FROM users WHERE id = ?", [user.id]);
    await audit(tx, user.id, "PASSWORD_RESET", "users", user.id, { via: "codigo_por_correo" });
    return token_version;
  });
  if (version === null) throw new HttpError(400, INVALID_CODE, "INVALID_CODE");
  await invalidate(CacheKeys.auth(user.id));
  res.json({ token: signToken(user.id, version) });
});
