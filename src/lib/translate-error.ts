import { ApiError } from "./api";

// Mensaje para mostrar al usuario. Los errores de la API ya vienen en español; si traen
// detalles de validación, se muestra el primero. El resto (red, librerías) se traduce aquí.
export function translateError(input: unknown): string {
  if (input instanceof ApiError) {
    // Planes de la sucursal (tenancy-node 0.11): mensajes propios en vez del texto en inglés
    if (input.code === "TENANCY_FEATURE_NOT_IN_PLAN") return "Este módulo no está incluido en el plan de tu sucursal.";
    if (input.code === "TENANCY_PLAN_LIMIT_REACHED") {
      const max = (input.details as { max?: number } | undefined)?.max;
      return `Tu plan permite ${max ?? "un número limitado de"} usuarios activos. Desactiva uno o mejora tu plan.`;
    }
    const first = Array.isArray(input.details) ? input.details[0] : undefined;
    return first ? `${input.message}: ${first.message}${first.field ? ` (${first.field})` : ""}` : input.message;
  }
  const raw =
    typeof input === "string"
      ? input
      : (input as any)?.message ?? (input as any)?.error_description ?? "";
  const msg = String(raw || "").trim();
  if (!msg) return "Ocurrió un error inesperado. Intenta de nuevo.";
  const m = msg.toLowerCase();

  // Auth
  if (m.includes("invalid login") || m.includes("invalid credentials"))
    return "Email o contraseña incorrectos.";
  if (m.includes("missing email")) return "Debes ingresar el email y la contraseña.";
  if (m.includes("email not confirmed")) return "Debes confirmar tu email antes de iniciar sesión.";
  if (m.includes("user not found")) return "Usuario no encontrado.";
  if (m.includes("weak_password") || m.includes("pwned") || m.includes("known to be weak"))
    return "Esta contraseña aparece en filtraciones públicas. Usa una NUEVA y ÚNICA.";
  if (m.includes("password should be at least"))
    return "La contraseña debe tener al menos 8 caracteres.";
  if (m.includes("already registered") || m.includes("user already"))
    return "Este email ya está registrado. Inicia sesión en su lugar.";
  if (m.includes("rate limit") || m.includes("too many requests"))
    return "Demasiados intentos. Espera unos minutos e inténtalo otra vez.";
  if (m.includes("jwt") && m.includes("expired"))
    return "Tu sesión expiró. Vuelve a iniciar sesión.";
  if (m.includes("unauthorized") || m === "no authorization header provided")
    return "No tienes autorización para realizar esta acción.";

  // Postgres / RLS
  if (m.includes("row-level security") || m.includes("violates row-level security"))
    return "No tienes permisos para realizar esta acción.";
  if (m.includes("permission denied"))
    return "Permiso denegado.";
  if (m.includes("duplicate key") || m.includes("already exists") || m.includes("unique constraint"))
    return "Ya existe un registro con esos datos.";
  if (m.includes("foreign key") || m.includes("violates") || m.includes("referenced"))
    return "No se puede completar: hay registros relacionados que dependen de este.";
  if (m.includes("not null") || m.includes("null value"))
    return "Faltan campos obligatorios.";
  if (m.includes("invalid input syntax") || m.includes("invalid uuid"))
    return "Formato de datos inválido.";
  if (m.includes("check constraint"))
    return "Los datos no cumplen las reglas de validación.";

  // Email / general
  if (m.includes("email")) return "Email inválido o no permitido.";
  if (m.includes("network") || m.includes("failed to fetch"))
    return "Error de conexión. Verifica tu internet e inténtalo de nuevo.";

  // Sin traducción: devolver el original
  return msg;
}
