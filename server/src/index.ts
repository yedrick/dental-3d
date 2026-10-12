import cluster from "node:cluster";
import { config } from "./config.js";

/**
 * Arranque de la API.
 * Con API_PROCESSES > 1, este proceso solo reparte: crea N procesos de la API que comparten el puerto
 * (módulo cluster de Node), y reinicia el que se caiga. Así se usan varios núcleos: las pruebas k6
 * mostraron que un solo proceso llega al 100 % de su núcleo mucho antes que MySQL o Redis.
 * Cada proceso tiene sus propios pools: las conexiones a MySQL se multiplican por API_PROCESSES.
 */
if (config.processes > 1 && cluster.isPrimary) {
  if (!config.tenancy.redisUrl) {
    console.warn("API_PROCESSES > 1 sin REDIS_URL: cada proceso tendrá su propia caché y los cambios tardarán en verse en los demás");
  }
  let stopping = false;
  for (let i = 0; i < config.processes; i++) cluster.fork();
  cluster.on("exit", (worker, code, signal) => {
    if (stopping) {
      if (Object.keys(cluster.workers ?? {}).length === 0) process.exit(0);
      return;
    }
    console.error(`El proceso ${worker.process.pid} terminó (${signal ?? code}); se inicia otro`);
    setTimeout(() => cluster.fork(), 1000);
  });
  // Apagado ordenado: cada proceso termina sus peticiones en curso y cierra sus pools
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.once(signal, () => {
      stopping = true;
      for (const w of Object.values(cluster.workers ?? {})) w?.process.kill("SIGTERM");
    });
  }
} else {
  await import("./server.js");
}
