// Peticiones en curso a la API, para el indicador global de carga (GlobalLoader en app.tsx).
// Lo alimenta api() en lib/api.ts: cuenta lecturas (GET) y escrituras (POST, PATCH, PUT, DELETE).
// Las consultas en segundo plano (p. ej. la campana de notificaciones cada 30 s) no cuentan.
import { useSyncExternalStore } from "react";

export type ActivityKind = "read" | "write";
export interface ActivitySnapshot {
  reads: number;
  writes: number;
  /** Desde cuándo hay alguna petición en curso (ms, Date.now()); null si no hay ninguna. */
  since: number | null;
}

let snapshot: ActivitySnapshot = { reads: 0, writes: 0, since: null };
const listeners = new Set<() => void>();

function update(kind: ActivityKind, delta: 1 | -1) {
  const reads = Math.max(0, snapshot.reads + (kind === "read" ? delta : 0));
  const writes = Math.max(0, snapshot.writes + (kind === "write" ? delta : 0));
  const busy = reads + writes > 0;
  snapshot = { reads, writes, since: busy ? (snapshot.since ?? Date.now()) : null };
  listeners.forEach((l) => l());
}

export const activity = {
  start: (kind: ActivityKind) => update(kind, 1),
  end: (kind: ActivityKind) => update(kind, -1),
};

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const IDLE: ActivitySnapshot = { reads: 0, writes: 0, since: null };

export function useActivity(): ActivitySnapshot {
  return useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => IDLE,
  );
}
