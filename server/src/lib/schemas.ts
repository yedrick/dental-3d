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
  .number("Debe ser un número")
  .min(0, "No puede ser negativo")
  .max(9_999_999_999.99)
  // Se mira el número escrito (150 · 150.5 · 150.55): v * 100 tiene error de coma flotante en montos
  // grandes y rechazaba cifras válidas
  .refine((v) => /^\d+(\.\d{1,2})?$/.test(String(v)), "Máximo 2 decimales");

/** Nombre de usuario: sin "@", así nunca se confunde con el email de otra persona al iniciar sesión. */
export const username = z
  .string()
  .trim()
  .min(1, "Usuario requerido")
  .max(100)
  .refine((v) => !v.includes("@"), "El nombre de usuario no puede tener @ (para eso está el email)");
