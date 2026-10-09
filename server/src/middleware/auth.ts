import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config.js";
import { db } from "../db.js";
import { cache, CacheKeys, CacheTtl } from "../lib/cache.js";
import { HttpError } from "../lib/http-error.js";
import { loadPermissions, loadRoles, type Role } from "../lib/permissions.js";
import { tenancy } from "../tenancy/index.js";

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

interface TokenPayload {
  sub: string;
  /** Sucursal (tenant) que emitió el token. */
  tid: string;
}

interface CachedSession {
  active: boolean;
  approved: boolean;
  roles: Role[];
  permissions: string[];
}

/** Exige que la petición sea de una sucursal (subdominio), no del dominio central. */
export function requireTenant(req: Request, _res: Response, next: NextFunction) {
  if (!req.tenant) return next(new HttpError(404, "Sucursal no identificada: usa el subdominio de tu sucursal", "TENANT_REQUIRED"));
  next();
}

export function signToken(userId: string) {
  const tid = tenancy.currentId();
  if (!tid) throw new HttpError(404, "Sucursal no identificada", "TENANT_REQUIRED");
  return jwt.sign({ tid } satisfies Omit<TokenPayload, "sub">, config.jwt.secret, {
    subject: userId,
    algorithm: "HS256",
    expiresIn: config.jwt.expiresIn as jwt.SignOptions["expiresIn"],
  });
}

async function loadSession(userId: string): Promise<CachedSession | null> {
  return cache().remember(CacheKeys.auth(userId), CacheTtl.auth, async () => {
    const rows = await db().query<{ active: boolean; approved: boolean }[]>(
      "SELECT active, approved FROM users WHERE id = ?",
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

  req.user = { id: payload.sub, roles: session.roles, permissions: new Set(session.permissions) };
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
