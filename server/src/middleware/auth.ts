import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config.js";
import { db } from "../db.js";
import { cache, CacheKeys, CacheTtl } from "../lib/cache.js";
import { HttpError } from "../lib/http-error.js";
import { loadPermissions, loadRoles, type Role } from "../lib/permissions.js";
import { requestContext } from "../lib/request-context.js";
import { tenancy } from "../tenancy/index.js";

export interface AuthUser {
  id: string;
  roles: Role[];
  permissions: Set<string>;
  /** ADMIN que está "iniciando sesión como" este usuario. */
  impersonatedBy?: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

interface TokenPayload {
  sub: string;
  /** Sucursal (tenant) que emitió el token. */
  tid: string;
  /** Versión de sesión del usuario: si cambió, el token ya no sirve. */
  ver: number;
  /** Suplantación: id del ADMIN que la inició. */
  imp?: string;
}

interface CachedSession {
  active: boolean;
  approved: boolean;
  token_version: number;
  roles: Role[];
  permissions: string[];
}

/** Exige que la petición sea de una sucursal (subdominio), no del dominio central. */
export function requireTenant(req: Request, _res: Response, next: NextFunction) {
  if (!req.tenant) return next(new HttpError(404, "Sucursal no identificada: usa el subdominio de tu sucursal", "TENANT_REQUIRED"));
  next();
}

export function signToken(
  userId: string,
  tokenVersion: number,
  options: { impersonatedBy?: string; expiresIn?: jwt.SignOptions["expiresIn"] } = {},
) {
  const tid = tenancy.currentId();
  if (!tid) throw new HttpError(404, "Sucursal no identificada", "TENANT_REQUIRED");
  const payload: Omit<TokenPayload, "sub"> = { tid, ver: tokenVersion };
  if (options.impersonatedBy) payload.imp = options.impersonatedBy;
  return jwt.sign(payload, config.jwt.secret, {
    subject: userId,
    algorithm: "HS256",
    expiresIn: options.expiresIn ?? (config.jwt.expiresIn as jwt.SignOptions["expiresIn"]),
  });
}

async function loadSession(userId: string): Promise<CachedSession | null> {
  return cache().remember(CacheKeys.auth(userId), CacheTtl.auth, async () => {
    const rows = await db().query<{ active: boolean; approved: boolean; token_version: number }[]>(
      "SELECT active, approved, token_version FROM users WHERE id = ?",
      [userId],
    );
    if (!rows[0]) return null; // null se cachea: un id inexistente no golpea la base en cada petición
    const roles = await loadRoles(userId);
    return { ...rows[0], roles, permissions: await loadPermissions(roles) };
  });
}

/**
 * Valida el JWT (Authorization: Bearer <token>) y carga roles y permisos.
 * - El token solo sirve en la sucursal que lo emitió (claim tid).
 * - Deja de servir si cambió la versión de sesión del usuario (claim ver): contraseña nueva,
 *   desactivación o cambio de roles cierran todas sus sesiones.
 * - La sesión se cachea 60 s por sucursal y se borra al instante cuando un ADMIN
 *   desactiva al usuario o cambia sus roles (invalidate(CacheKeys.auth(id))).
 */
export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return next(new HttpError(401, "No autenticado"));

  let payload: TokenPayload;
  try {
    payload = jwt.verify(token, config.jwt.secret, { algorithms: ["HS256"] }) as TokenPayload;
  } catch {
    return next(new HttpError(401, "Sesión inválida o expirada"));
  }
  if (!payload.sub || payload.tid !== tenancy.currentId()) {
    return next(new HttpError(401, "La sesión no pertenece a esta sucursal"));
  }

  const session = await loadSession(payload.sub);
  if (!session || !session.active) return next(new HttpError(401, "Usuario inactivo o inexistente"));
  if (!session.approved) return next(new HttpError(403, "Tu cuenta aún no ha sido aprobada por un administrador."));
  if (payload.ver !== session.token_version) return next(new HttpError(401, "Tu sesión fue cerrada. Vuelve a iniciar sesión.", "SESSION_REVOKED"));

  req.user = { id: payload.sub, roles: session.roles, permissions: new Set(session.permissions), impersonatedBy: payload.imp };
  requestContext.enterWith({ userId: payload.sub, impersonatedBy: payload.imp });
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
