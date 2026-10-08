import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { HttpError } from "../lib/http-error.js";

// Errores de MySQL más comunes, traducidos al español
const MYSQL_ERRORS: Record<string, [number, string]> = {
  ER_DUP_ENTRY: [409, "Ya existe un registro con esos datos"],
  ER_ROW_IS_REFERENCED_2: [409, "No se puede eliminar: tiene registros relacionados"],
  ER_NO_REFERENCED_ROW_2: [400, "El registro relacionado no existe"],
  ER_CHECK_CONSTRAINT_VIOLATED: [400, "Algún valor está fuera del rango permitido"],
};

export function notFound(_req: Request, _res: Response, next: NextFunction) {
  next(new HttpError(404, "Ruta no encontrada"));
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: "Datos inválidos",
      details: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
  }
  const code = (err as { code?: string })?.code;
  if (code && MYSQL_ERRORS[code]) {
    const [status, message] = MYSQL_ERRORS[code];
    return res.status(status).json({ error: message });
  }
  if ((err as { type?: string })?.type === "entity.parse.failed") {
    return res.status(400).json({ error: "JSON inválido" });
  }
  console.error(err);
  res.status(500).json({ error: "Error interno del servidor" });
}
