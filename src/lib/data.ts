/**
 * Fecha para mostrar en formato YYYY-MM-DD.
 * - Columnas DATE ("2026-10-08"): tal cual, sin conversión de zona horaria.
 * - Fecha y hora de la API (ISO en UTC): se muestra el día en la hora local del navegador.
 */
export function formatDate(v?: string | null) {
  if (!v) return "-";
  if (v.length <= 10) return v;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v.slice(0, 10);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Fecha y hora local: "2026-10-08 14:30". */
export function formatDateTime(v?: string | null) {
  if (!v) return "-";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  return `${formatDate(v)} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** Hoy en la hora local, YYYY-MM-DD (para filtros from/to). */
export function todayLocal() {
  return formatDate(new Date().toISOString());
}

export function formatMoney(v?: number | string | null) {
  const n = Number(v ?? 0);
  return new Intl.NumberFormat("es-BO", { style: "currency", currency: "BOB", minimumFractionDigits: 2 }).format(n);
}

export function calcAge(birth?: string | null) {
  if (!birth) return "-";
  const b = new Date(birth);
  const d = new Date();
  let a = d.getFullYear() - b.getFullYear();
  const m = d.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && d.getDate() < b.getDate())) a--;
  return a;
}
