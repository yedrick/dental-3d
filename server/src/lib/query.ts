import { z } from "zod";
import { config } from "../config.js";

// ---- Paginación: ?page=1&limit=50 ----
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(500).default(50),
});

export function paginate(page: number, limit: number) {
  return { limit, offset: (page - 1) * limit };
}

export function paged<T>(data: T[], total: number, page: number, limit: number) {
  return { data, page, limit, total, pages: Math.ceil(total / limit) };
}

// ---- Rangos de fechas ----
// Las fechas de los filtros son días del negocio (YYYY-MM-DD en la hora local de la clínica).
// created_at se guarda en UTC, así que el día local se convierte a su rango en UTC:
// con -04:00, "2026-10-08" = [2026-10-08 04:00:00, 2026-10-09 04:00:00) UTC.
function utcDateTime(localDay: string, addDays = 0) {
  const d = new Date(`${localDay}T00:00:00${config.businessUtcOffset}`);
  d.setUTCDate(d.getUTCDate() + addDays);
  return d.toISOString().slice(0, 19).replace("T", " ");
}

/** [inicio, fin) en UTC para filtrar columnas DATETIME por días locales. */
export function dayRange(from: string, to: string): [string, string] {
  return [utcDateTime(from), utcDateTime(to, 1)];
}

export const dateRangeSchema = z
  .object({ from: z.iso.date().optional(), to: z.iso.date().optional() })
  .refine((v) => !v.from || !v.to || v.from <= v.to, { message: "La fecha inicial debe ser anterior a la final", path: ["from"] });
