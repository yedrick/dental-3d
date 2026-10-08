import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import type { RowDataPacket } from "mysql2";
import { config } from "../config.js";
import { pool } from "../db.js";
import { HttpError } from "../lib/http-error.js";
import { loadPermissions, loadRoles, type Role } from "../lib/permissions.js";

export interface AuthUser {
  id: string;
  roles: Role[];
  permissions: Set<string>;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function signToken(userId: string) {
  return jwt.sign({ sub: userId }, config.jwt.secret, {
    expiresIn: config.jwt.expiresIn as jwt.SignOptions["expiresIn"],
  });
}

/**
 * Valida el JWT (header Authorization: Bearer <token>) y carga roles y permisos.
 * Se vuelven a leer de la BD en cada petición para que desactivar un usuario
 * o quitarle un rol tenga efecto inmediato, sin esperar a que venza el token.
 */
export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return next(new HttpError(401, "No autenticado"));

  let userId: string;
  try {
    const payload = jwt.verify(token, config.jwt.secret) as jwt.JwtPayload;
    userId = String(payload.sub);
  } catch {
    return next(new HttpError(401, "Sesión inválida o expirada"));
  }

  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT active, approved FROM users WHERE id = ?",
    [userId],
  );
  const u = rows[0];
  if (!u || !u.active) return next(new HttpError(401, "Usuario inactivo o inexistente"));
  if (!u.approved) return next(new HttpError(403, "Tu cuenta aún no ha sido aprobada por un administrador."));

  const roles = await loadRoles(userId);
  req.user = { id: userId, roles, permissions: new Set(await loadPermissions(roles)) };
  next();
}

/** Exige al menos uno de los permisos indicados. */
export function requirePermission(...keys: string[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const user = req.user;
    if (!user) return next(new HttpError(401, "No autenticado"));
    if (keys.some((k) => user.permissions.has(k))) return next();
    next(new HttpError(403, "No tienes permiso para realizar esta acción"));
  };
}

/** Exige al menos uno de los roles indicados. */
export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const user = req.user;
    if (!user) return next(new HttpError(401, "No autenticado"));
    if (roles.some((r) => user.roles.includes(r))) return next();
    next(new HttpError(403, "No tienes permiso para realizar esta acción"));
  };
}
