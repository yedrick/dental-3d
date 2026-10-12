# Pruebas

Necesitan la API corriendo (`npm run dev`, puerto 4000) y MySQL con datos de prueba. La prueba web
necesita además el frontend (`npx vite dev --port 8081`) y Google Chrome instalado.

| Carpeta | Qué prueba | Cómo correrla |
|---|---|---|
| `api/` | Fases 2, 3 y 4: cálculos de dinero, concurrencia, permisos, aislamiento (sucursales `central`, `sur`, `importada`) | `python3 test/api/fase2.py` |
| `massive/masiva.py` | Crea N sucursales a la vez desde el panel, usuarios por el panel, 40 escrituras concurrentes por sucursal y verifica totales y aislamiento | `python3 test/massive/masiva.py 25 /tmp/estado.json <prefijo>` |
| `massive/carga.mjs` | Carga mezclada entre todas las sucursales (usa el estado de la anterior); revisa que ninguna respuesta sea de otra sucursal | `node test/massive/carga.mjs /tmp/estado.json 30000 100` |
| `k6/` | **k6**: carga, estrés, picos, resistencia y capacidad máxima de la API, por sucursal y por endpoint, y velocidad de las páginas en navegador. Ver [k6/README.md](k6/README.md) | `cd test/k6 && node preparar.mjs 20 k6a && ./correr.sh api carga` |
| `e2e/` | Navegador real: panel → crear sucursal → "Entrar como" → activar cuenta → doctor, atención, caja, página web → portada pública | `cd test/e2e && npm install && TENANT=web1 node panel.mjs && TENANT=web1 node flujo.mjs` |

Notas:
- `masiva.py` y `e2e/` entran al panel con `OWNER_EMAIL` (por defecto `owner@dental3d.local`) y `OWNER_PASS`: exporta la contraseña del dueño antes de correrlas.
- `masiva.py`: usa un **prefijo nuevo** en cada corrida (en tenancy-node el id de una sucursal borrada queda reservado).
- No crees más sucursales a la vez que `CENTRAL_POOL_MAX` (ver `TENANCY-NODE-REPORTE.md` #8).
- Con muchas sucursales, sube `max_connections` de MySQL: `TENANT_POOL_MAX × sucursales + CENTRAL_POOL_MAX`.
- Las pruebas de `api/` dependen de datos acumulados: alguna verificación de conteo puede fallar al repetirlas.
