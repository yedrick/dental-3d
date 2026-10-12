import { createRequire } from "node:module";
import { availableParallelism } from "node:os";
import { Worker } from "node:worker_threads";

/**
 * bcrypt en hilos aparte (worker_threads).
 * bcryptjs es JavaScript puro: en el hilo principal, cada login (~250 ms de CPU con costo 12) frena
 * TODAS las demás peticiones de todas las sucursales mientras dura. Las pruebas k6 lo midieron:
 * p95 de 300 ms en rutas que responden en 5 ms. Aquí el cálculo va a un grupo de hilos y la API sigue
 * respondiendo; además los logins usan varios núcleos a la vez.
 * Hilos: PASSWORD_WORKERS por proceso (por defecto: núcleos − 1 repartidos entre los API_PROCESSES, entre 1 y 4).
 */
const BCRYPT_PATH = createRequire(import.meta.url).resolve("bcryptjs");
const PROCESSES = Math.max(1, Number(process.env.API_PROCESSES ?? 1));
const SIZE = Number(process.env.PASSWORD_WORKERS) || Math.min(4, Math.max(1, Math.floor((availableParallelism() - 1) / PROCESSES)));

const WORKER_CODE = `
const { parentPort, workerData } = require("node:worker_threads");
const bcrypt = require(workerData.bcrypt);
parentPort.on("message", ({ id, op, password, hash, rounds }) => {
  try {
    const result = op === "hash" ? bcrypt.hashSync(password, rounds) : bcrypt.compareSync(password, hash);
    parentPort.postMessage({ id, result });
  } catch (e) {
    parentPort.postMessage({ id, error: String(e && e.message || e) });
  }
});`;

type Job = { op: "hash" | "compare"; password: string; hash?: string; rounds?: number };
type Pending = { resolve: (v: never) => void; reject: (e: Error) => void };
type Slot = { worker: Worker; busy: number };

const pending = new Map<number, Pending>();
const owner = new Map<number, Slot>();
const slots: Slot[] = [];
let nextId = 0;

function spawn(): Slot {
  const slot: Slot = { worker: new Worker(WORKER_CODE, { eval: true, workerData: { bcrypt: BCRYPT_PATH } }), busy: 0 };
  slot.worker.unref(); // sin trabajos pendientes no impide que el proceso termine (ver run)
  slot.worker.on("message", ({ id, result, error }: { id: number; result?: unknown; error?: string }) => {
    const p = pending.get(id);
    pending.delete(id);
    owner.delete(id);
    if (--slot.busy === 0) slot.worker.unref();
    if (!p) return;
    if (error) p.reject(new Error(error));
    else p.resolve(result as never);
  });
  // Si un hilo se cae, se rechazan solo sus trabajos y se reemplaza
  slot.worker.on("error", (err) => {
    for (const [id, s] of owner) {
      if (s !== slot) continue;
      pending.get(id)?.reject(err);
      pending.delete(id);
      owner.delete(id);
    }
    slots[slots.indexOf(slot)] = spawn();
  });
  return slot;
}

function run<T>(job: Job): Promise<T> {
  if (slots.length === 0) for (let i = 0; i < SIZE; i++) slots.push(spawn());
  const slot = slots.reduce((a, b) => (b.busy < a.busy ? b : a));
  const id = nextId++;
  // Con trabajos pendientes el hilo mantiene vivo el proceso (p. ej. el seed en "npx tenancy create")
  if (slot.busy++ === 0) slot.worker.ref();
  owner.set(id, slot);
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: never) => void, reject });
    slot.worker.postMessage({ id, ...job });
  });
}

export function hashPassword(password: string, rounds = 12): Promise<string> {
  return run({ op: "hash", password, rounds });
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return run({ op: "compare", password, hash });
}
