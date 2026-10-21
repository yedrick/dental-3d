// Dinero en centavos (enteros) para no arrastrar errores de punto flotante.
// Redondeo "half away from zero" a 2 decimales, igual que ROUND(numeric, 2) de PostgreSQL.

export const toCents = (amount: number) => Math.round(Number(amount) * 100);
export const fromCents = (cents: number) => cents / 100;

/** Porcentaje de un monto en centavos, redondeado al centavo. */
export function percentOf(cents: number, pct: number) {
  const raw = (cents * pct) / 100;
  return Math.sign(raw) * Math.round(Math.abs(raw) + 1e-9);
}
