import { app } from "./app.js";
import { config } from "./config.js";
import { tenancy } from "./tenancy/index.js";

const server = app.listen(config.port, config.host ?? "::", () => {
  console.log(`API Dental-3D escuchando en http://localhost:${config.port} (sucursal: http://<id>.localhost:${config.port})`);
});

// Apagado ordenado: dejar de aceptar conexiones, terminar las peticiones en curso y cerrar pools
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    server.close(async () => {
      await tenancy.close();
      process.exit(0);
    });
  });
}
