// Cuánto tiempo un dato se considera "fresco" en React Query, según su tipo.
// Antes era 5 minutos para todo: dos cajeras podían ver saldos distintos.
export const STALE = {
  /** Estudios, tarifas, parámetros, permisos, marca */
  catalog: 10 * 60_000,
  /** Doctores, pacientes, usuarios */
  master: 2 * 60_000,
  /** Atenciones, entregas, citas */
  ops: 20_000,
  /** Caja, depósitos, pagos, comisiones, reportes: siempre se vuelve a pedir */
  money: 0,
} as const;
