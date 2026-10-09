import { z } from "zod";

/** Texto opcional: "" y null se guardan como NULL. */
export const optionalText = (max = 500) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

export const optionalEmail = z
  .union([z.email("Email inválido"), z.literal(""), z.null()])
  .optional()
  .transform((v) => v || null);

export const uuid = z.uuid("Identificador inválido");

/** Monto en Bs con máximo 2 decimales. */
export const money = z
  .number()
  .min(0)
  .max(9_999_999_999.99)
  .refine((v) => Math.abs(Math.round(v * 100) - v * 100) < 1e-6, "Máximo 2 decimales");
