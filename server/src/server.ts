import { app } from "./app.js";
import { config } from "./config.js";
import { errorTracker, tenancy } from "./tenancy/index.js";

// Registro de errores compartido (base central): lo ve el panel /admin aunque haya varios procesos
errorTracker.start();

const server = app.listen(config.port, config.host ?? "::", () => {
  const proc = config.processes > 1 ? ` [proceso ${process.pid}]` : "";
  console.log(`API Dental-3D escuchando en http://localhost:${config.port} (sucursal: http://<id>.localhost:${config.port})${proc}`);
});

// Apagado ordenado: dejar de aceptar conexiones, terminar las peticiones en curso y cerrar pools
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    server.close(async () => {
      await tenancy.close();
      await errorTracker.close();
      process.exit(0);
    });
  });
}
