import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import { HttpError } from "../lib/http-error.js";
import { tenancy } from "../tenancy/index.js";

// Límites por sucursal + IP (con IPv6 agrupado por /56), para frenar fuerza bruta de contraseñas.
function limiter(windowMs: number, limit: number, message: string) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    keyGenerator: (req) => `${tenancy.currentId() ?? "central"}:${ipKeyGenerator(req.ip ?? "")}`,
    handler: (_req, _res, next) => next(new HttpError(429, message)),
  });
}

export const loginLimiter = limiter(15 * 60_000, 10, "Demasiados intentos de inicio de sesión. Espera 15 minutos.");
export const registerLimiter = limiter(60 * 60_000, 5, "Demasiados registros desde esta conexión. Intenta más tarde.");
export const sensitiveLimiter = limiter(15 * 60_000, 10, "Demasiados intentos. Espera 15 minutos.");
