import type { NextFunction, Request, Response } from "express";
import { errorResponseBody, httpStatusFor, isTenancyError } from "@tenancy-node/core";
import { ZodError } from "zod";
import { HttpError } from "../lib/http-error.js";
import { tenancy } from "../tenancy/index.js";

// Todas las respuestas de error usan la forma de tenancy-node: { error: { code, message, details? } }

// Errores de MySQL más comunes, traducidos al español
const MYSQL_ERRORS: Record<string, [number, string, string]> = {
  ER_DUP_ENTRY: [409, "CONFLICT", "Ya existe un registro con esos datos"],
  ER_ROW_IS_REFERENCED_2: [409, "CONFLICT", "No se puede eliminar: tiene registros relacionados"],
  ER_NO_REFERENCED_ROW_2: [400, "BAD_REQUEST", "El registro relacionado no existe"],
  ER_CHECK_CONSTRAINT_VIOLATED: [400, "BAD_REQUEST", "Algún valor está fuera del rango permitido"],
};

export function notFound(_req: Request, _res: Response, next: NextFunction) {
  next(new HttpError(404, "Ruta no encontrada"));
}

const send = (res: Response, status: number, code: string, message: string, details?: unknown) =>
  res.status(status).json({ error: { code, message, ...(details ? { details } : {}) } });

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) return send(res, err.status, err.code, err.message);
  if (err instanceof ZodError) {
    return send(res, 400, "VALIDATION_ERROR", "Datos inválidos",
      err.issues.map((i) => ({ field: i.path.join("."), message: i.message })));
  }
  if (isTenancyError(err)) return res.status(httpStatusFor(err)).json(errorResponseBody(err));

  const e = err as { code?: string; type?: string; status?: number };
  if (e?.code && MYSQL_ERRORS[e.code]) {
    const [status, code, message] = MYSQL_ERRORS[e.code];
    return send(res, status, code, message);
  }
  if (e?.type === "entity.parse.failed") return send(res, 400, "BAD_REQUEST", "JSON inválido");
  if (e?.type === "entity.too.large") return send(res, 413, "PAYLOAD_TOO_LARGE", "El archivo o los datos son demasiado grandes");

  // Error inesperado: al log de tenancy (con tenantId) y respuesta sin detalles
  tenancy.observability.logger.error({ err, method: req.method, path: req.originalUrl }, "error no controlado");
  send(res, 500, "INTERNAL_ERROR", "Error interno del servidor");
}
