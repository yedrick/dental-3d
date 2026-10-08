import bcrypt from "bcryptjs";
import { Router } from "express";
import type { RowDataPacket } from "mysql2";
import { z } from "zod";
import { pool, withTransaction } from "../db.js";
import { audit } from "../lib/audit.js";
import { HttpError } from "../lib/http-error.js";
import { loadPermissions, loadRoles } from "../lib/permissions.js";
import { requireAuth, signToken } from "../middleware/auth.js";

export const authRouter = Router();

// Mismas reglas que el formulario de registro (src/routes/auth.tsx)
export const passwordSchema = z
  .string()
  .min(10, "Mínimo 10 caracteres")
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
 * Registro público. El primer usuario queda como ADMIN aprobado;
 * los demás como RECEPCION pendientes de aprobación (igual que handle_new_user).
 */
authRouter.post("/register", async (req, res) => {
  const data = registerSchema.parse(req.body);
  const hash = await bcrypt.hash(data.password, 12);

  const result = await withTransaction(async (conn) => {
    const [first] = await conn.query<RowDataPacket[]>(
      "SELECT NOT EXISTS (SELECT 1 FROM user_roles FOR UPDATE) AS is_first",
    );
    const isFirst = Boolean(first[0].is_first);
    const [idRow] = await conn.query<RowDataPacket[]>("SELECT UUID() AS id");
    const id = idRow[0].id as string;

    await conn.execute(
      "INSERT INTO users (id, username, full_name, email, password_hash, approved) VALUES (?, ?, ?, ?, ?, ?)",
      [id, data.username, data.full_name, data.email, hash, isFirst],
    );
    await conn.execute("INSERT INTO user_roles (user_id, role) VALUES (?, ?)", [
      id,
      isFirst ? "ADMIN" : "RECEPCION",
    ]);
    await audit(conn, id, "USER_REGISTER", "users", id, {
      email: data.email,
      username: data.username,
      full_name: data.full_name,
    });
    return { id, approved: isFirst };
  });

  res.status(201).json({
    ...result,
    message: result.approved
      ? "Cuenta creada como ADMIN. Ya puedes iniciar sesión."
      : "Cuenta creada. Un administrador debe aprobarla antes de que puedas ingresar.",
  });
});

const loginSchema = z.object({
  // Acepta email o nombre de usuario
  login: z.string().trim().min(1),
  password: z.string().min(1),
});

// Hash ficticio para que el tiempo de respuesta no revele si el usuario existe
const DUMMY_HASH = bcrypt.hashSync("dummy-password-not-used", 12);

authRouter.post("/login", async (req, res) => {
  const { login, password } = loginSchema.parse(req.body);
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT id, password_hash, active, approved FROM users WHERE email = ? OR username = ? LIMIT 1",
    [login.toLowerCase(), login],
  );
  const u = rows[0];
  const ok = await bcrypt.compare(password, u?.password_hash ?? DUMMY_HASH);
  if (!u || !ok) throw new HttpError(401, "Usuario o contraseña incorrectos");
  if (!u.active) throw new HttpError(403, "Tu usuario está desactivado");
  if (!u.approved) throw new HttpError(403, "Tu cuenta aún no ha sido aprobada por un administrador.");

  res.json({ token: signToken(u.id) });
});

/** Datos de la sesión actual: perfil, roles y permisos (reemplaza AuthProvider + Supabase). */
authRouter.get("/me", requireAuth, async (req, res) => {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT id, username, full_name, email, active, approved, created_at FROM users WHERE id = ?",
    [req.user!.id],
  );
  const roles = await loadRoles(req.user!.id);
  res.json({ user: rows[0], roles, permissions: await loadPermissions(roles) });
});

const changePasswordSchema = z.object({
  current_password: z.string().min(1),
  new_password: passwordSchema,
});

authRouter.post("/change-password", requireAuth, async (req, res) => {
  const data = changePasswordSchema.parse(req.body);
  const [rows] = await pool.query<RowDataPacket[]>("SELECT password_hash FROM users WHERE id = ?", [
    req.user!.id,
  ]);
  if (!(await bcrypt.compare(data.current_password, rows[0].password_hash))) {
    throw new HttpError(400, "La contraseña actual no es correcta");
  }
  const hash = await bcrypt.hash(data.new_password, 12);
  await withTransaction(async (conn) => {
    await conn.execute("UPDATE users SET password_hash = ? WHERE id = ?", [hash, req.user!.id]);
    await audit(conn, req.user!.id, "PASSWORD_CHANGE", "users", req.user!.id, null);
  });
  res.json({ ok: true });
});
