# Pruebas

Necesitan la API corriendo (`npm run dev`, puerto 4000) y MySQL con datos de prueba. La prueba web
necesita además el frontend (`npx vite dev --port 8081`, o el puerto que indiques en `WEB`) y Google Chrome instalado.

| Carpeta | Qué prueba | Cómo correrla |
|---|---|---|
| `unit/` | Pruebas unitarias con **vitest**, sin API ni base: dinero en centavos, comisiones, rangos de fecha, paginación, validaciones, tipo real de archivos y enlaces firmados de comprobantes | `npm test` (o `npm run test:watch`) |
| `api/` | Fases 2, 3 y 4: cálculos de dinero, concurrencia, permisos, aislamiento (sucursales `central`, `sur`, `importada`) | `python3 test/api/fase2.py` |
| `massive/masiva.py` | Crea N sucursales a la vez desde el panel, usuarios por el panel, 40 escrituras concurrentes por sucursal y verifica totales y aislamiento | `python3 test/massive/masiva.py 25 /tmp/estado.json <prefijo>` |
| `massive/carga.mjs` | Carga mezclada entre todas las sucursales (usa el estado de la anterior); revisa que ninguna respuesta sea de otra sucursal | `node test/massive/carga.mjs /tmp/estado.json 30000 100` |
| `api/pacientes_estudios.py` + `e2e/estudios-excel.mjs` | Paciente sin doctor y carga masiva de estudios con Excel: vista previa, aplicar, todo o nada, errores por fila (23 + 13 comprobaciones) | `OWNER_PASS=... python3 test/api/pacientes_estudios.py excel1` y luego `cd test/e2e && TENANT=excel1 WEB=localhost:8080 node estudios-excel.mjs` |
| `e2e/doble-clic.mjs` | Doble clic y tres clics en el mismo instante (servidor lento a propósito): paciente, doctor, cobro parcial y cita se envían UNA vez; el botón se bloquea y se libera si falla (8 comprobaciones) | `TENANT=<id> node test/e2e/doble-clic.mjs` (sucursal preparada con `pacientes_estudios.py`) |
| `api/pagos_permisos.py` + `e2e/pagos-doctor.mjs` | Pagos con fecha y método ("cobrado hoy" con saldos de días anteriores), doctor no registrado, rol DOCTOR solo lo suyo, permisos de "ver" según Roles, usuario sin "@" (33 + 15). La sucursal se prepara con el script de API; la de navegador necesita una sucursal recién preparada | `OWNER_PASS=... python3 test/api/pagos_permisos.py pag1` y luego `cd test/e2e && TENANT=pag1 node pagos-doctor.mjs` |
| `k6/` | **k6**: carga, estrés, picos, resistencia y capacidad máxima de la API, por sucursal y por endpoint, y velocidad de las páginas en navegador. Ver [k6/README.md](k6/README.md) | `cd test/k6 && node preparar.mjs 20 k6a && ./correr.sh api carga` |
| `e2e/` | Navegador real: panel → crear sucursal → "Entrar como" → activar cuenta → doctor, atención, caja, página web → portada pública | `cd test/e2e && npm install && TENANT=web1 node panel.mjs && TENANT=web1 OTRA=calacoto node flujo.mjs` (`WEB=localhost:8080` si el frontend está en otro puerto; `OTRA` = otra sucursal existente, para el aislamiento) |

Notas:
- `masiva.py` y `e2e/` entran al panel con `OWNER_EMAIL` (por defecto `owner@dental3d.local`) y `OWNER_PASS`: exporta la contraseña del dueño antes de correrlas.
- `masiva.py`: usa un **prefijo nuevo** en cada corrida (en tenancy-node el id de una sucursal borrada queda reservado).
- No crees más sucursales a la vez que `CENTRAL_POOL_MAX` (ver `TENANCY-NODE-REPORTE.md` #8).
- Con muchas sucursales, sube `max_connections` de MySQL: `TENANT_POOL_MAX × sucursales + CENTRAL_POOL_MAX`.
- Las pruebas de `api/` dependen de datos acumulados: alguna verificación de conteo puede fallar al repetirlas.
