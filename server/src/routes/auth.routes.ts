import bcrypt from "bcryptjs";
import { Router } from "express";
import { z } from "zod";
import { db, withTransaction } from "../db.js";
import { audit } from "../lib/audit.js";
import { HttpError } from "../lib/http-error.js";
import { loadPermissions, loadRoles } from "../lib/permissions.js";
import { requireAuth, signToken } from "../middleware/auth.js";
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
  const hash = await bcrypt.hash(data.password, 12);

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
  const rows = await db().query<{ id: string; password_hash: string; active: boolean; approved: boolean }[]>(
    "SELECT id, password_hash, active, approved FROM users WHERE email = ? OR username = ? LIMIT 1",
    [login.toLowerCase(), login],
  );
  const u = rows[0];
  const ok = await bcrypt.compare(password, u?.password_hash ?? DUMMY_HASH);
  if (!u || !ok) throw new HttpError(401, "Usuario o contraseña incorrectos", "INVALID_CREDENTIALS");
  if (!u.active) throw new HttpError(403, "Tu usuario está desactivado", "USER_INACTIVE");
  if (!u.approved) throw new HttpError(403, "Tu cuenta aún no ha sido aprobada por un administrador.", "USER_NOT_APPROVED");

  res.json({ token: signToken(u.id) });
});

/** Datos de la sesión actual: perfil, roles, permisos y sucursal. */
authRouter.get("/me", requireAuth, async (req, res) => {
  const rows = await db().query(
    "SELECT id, username, full_name, email, active, approved, created_at FROM users WHERE id = ?",
    [req.user!.id],
  );
  const roles = await loadRoles(req.user!.id);
  res.json({
    user: rows[0],
    roles,
    permissions: await loadPermissions(roles),
    tenant: { id: req.tenant!.id.value, name: req.tenant!.name },
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
  if (!(await bcrypt.compare(data.current_password, rows[0].password_hash))) {
    throw new HttpError(400, "La contraseña actual no es correcta", "INVALID_CREDENTIALS");
  }
  const hash = await bcrypt.hash(data.new_password, 12);
  await withTransaction(async (tx) => {
    await tx.query("UPDATE users SET password_hash = ? WHERE id = ?", [hash, req.user!.id]);
    await audit(tx, req.user!.id, "PASSWORD_CHANGE", "users", req.user!.id, null);
  });
  res.json({ ok: true });
});
