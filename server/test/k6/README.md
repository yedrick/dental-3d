# Pruebas de carga y estrés con k6

Miden **cuánto aguanta** el sistema y **qué tan rápidas son las páginas**, por sucursal y por endpoint. k6 corre en Docker (`grafana/k6:2.3.0-with-browser`), no hace falta instalarlo.

| Archivo | Para qué |
|---|---|
| `preparar.mjs` | Crea N sucursales de prueba desde el panel, con un usuario y datos base (doctores, estudios, 30 pacientes). Deja `datos.json` |
| `api.js` | Carga y estrés de la API: personal trabajando, visitantes en la portada, logins y capacidad máxima |
| `paginas.js` | Velocidad de las páginas en un navegador real (Chromium): portada, login, panel, pacientes, caja |
| `vigilar.sh` | Mientras corre una prueba, anota cada 5 s la CPU y la memoria de la API, las conexiones de MySQL y la memoria de Redis |
| `correr.sh` | Corre cualquiera de las pruebas y guarda los resultados |
| `limpiar.sh` | Borra las sucursales de prueba |
| `nginx.conf` | nginx igual al de producción (sin HTTPS) en el puerto 8088, para `paginas.js` |

## Antes de empezar

Prueba la versión **compilada**, como en producción, con Redis y `TRUST_PROXY=1`. Así cada usuario virtual llega con su propia IP y el límite de intentos de login funciona como con usuarios reales.

```sh
# Redis aparte para la prueba
docker run -d --name dental3d-k6-redis -p 127.0.0.1:6380:6379 redis:7-alpine

# API (server/) y frontend (raíz), compilados
cd server && npm run build && NODE_ENV=production TRUST_PROXY=1 REDIS_URL=redis://127.0.0.1:6380 node dist/index.js
cd .. && npm run build && PORT=3000 node .output/server/index.mjs

# nginx de pruebas (solo para paginas.js)
server/test/k6/correr.sh nginx

# Sucursales de prueba: usa un prefijo NUEVO cada vez (el id de una sucursal borrada queda reservado)
cd server/test/k6 && OWNER_PASS='<contraseña del dueño del panel>' node preparar.mjs 20 k6a
```

## Correr

```sh
./correr.sh api humo          # 30 s, 5 usuarios: comprueba que todo responde
./correr.sh api carga         # 100 del personal + 200 visitantes + 2 logins/s, 4,5 min
./correr.sh api estres        # sube a 200, 400, 800 y 1200 del personal (×2 visitantes), 9 min
./correr.sh api pico          # de 50 a 1000 del personal en 10 s, 2 min
DURACION=60m ./correr.sh api resistencia   # 150 del personal durante una hora (fugas de memoria o conexiones)
./correr.sh api capacidad     # sube las peticiones por segundo por escalones: el máximo que aguanta
./correr.sh paginas           # velocidad de las páginas, una vuelta por sucursal

./vigilar.sh 600 &            # en otra terminal, mientras corre una prueba
```

Para ver **las páginas con el servidor cargado**, corre `./correr.sh paginas` mientras corre `./correr.sh api carga`.

**Ajustes** (variables de entorno):

| Variable | Qué hace |
|---|---|
| `ESCALA=2` | Duplica los usuarios del perfil (`0.5`, la mitad) |
| `PAUSA=0` | Sin pausas entre acciones (por defecto: 2 s, como una persona) |
| `LOGINS=10` | Logins por segundo (`0` los apaga) |
| `PASOS=100,500,1000` · `MESETA=60` | Escalones del perfil `capacidad` (peticiones por segundo) y cuánto dura cada uno (s) |
| `VUS=3` · `VUELTAS=40` | Navegadores a la vez y vueltas de `paginas.js` |
| `DOMINIO=dental3d.com` | Prueba el servidor real: `https://<sucursal>.dental3d.com`, pasando por nginx |

## Resultados

Cada prueba muestra un resumen en español y deja en `resultados/`:
- `<prueba>-<fecha>.txt`: el resumen, con tablas general, **por endpoint** y **por sucursal**, la conclusión y las metas no cumplidas;
- `<prueba>-<fecha>.html`: gráficos de toda la prueba (ábrelo en el navegador);
- `<prueba>-<fecha>.json`: todos los datos;
- `vigilar-<fecha>.csv`: CPU, memoria y conexiones cada 5 s;
- `fallo-<página>-<sucursal>.png`: captura de una página que no cargó.

**Metas** (si no se cumplen, k6 sale con error y las lista):
- API: p95 < 500 ms y p99 < 1,5 s (sin contar el login), errores < 1 %, ningún dato de otra sucursal. Cada endpoint tiene su propia meta, por ejemplo 800 ms para crear una atención.
- Páginas: contenido visible en < 3 s (p95). Web Vitals de Google (p75): LCP < 2,5 s, FCP < 1,8 s, CLS < 0,1.
- Capacidad: un escalón "aguanta" si logra el 95 % del ritmo pedido con p95 < 500 ms y errores < 1 %.

## Qué revisa además

- **Aislamiento bajo carga:** `/tenancy/me` tiene que devolver la sucursal pedida, y `/api/doctors` solo los doctores de esa sucursal (`aislamiento_fallas` tiene que ser 0).
- **Datos que crecen:** cada vuelta del personal crea una atención y a veces un movimiento de caja, así las listas y los reportes crecen durante la prueba.

## Resultados de referencia (12/10/2026)

Máquina de 12 núcleos y 46 GB; MySQL 8.4 en Docker; API y frontend compilados; Redis; k6 en la misma máquina. 20 sucursales.

| Prueba | 1 proceso | 4 procesos (`API_PROCESSES=4`) |
|---|---|---|
| `humo` | p95 12 ms, 0 errores | — |
| `carga` (100 del personal + 200 visitantes + 2 logins/s) | **p95 7 ms**, 0 errores, 318 pet/s | — |
| `capacidad`: máximo sostenido | **~750 pet/s** (p95 332 ms) | **~1500 pet/s** (p95 141 ms) |
| `estres`: hasta dónde cumple p95 < 500 ms | — | hasta **400 del personal + 800 visitantes** (p95 57 ms); 0 errores incluso con 3.600 usuarios virtuales |
| `pico` (de 50 a 1000 del personal en 10 s) | 6 % de conexiones cortadas durante el salto, se recupera solo | — |
| `resistencia` (150 del personal, 11 min) | — | p95 23 ms, 0 errores; memoria y conexiones estables (sin fugas) |
| `paginas` (20 sucursales) | contenido visible en 110–230 ms; LCP 164 ms; con `carga` en paralelo, LCP 180 ms | — |

**Lo que encontraron estas pruebas:**
- **bcrypt frenaba toda la API:** `bcryptjs` corre en el hilo principal y cada login (~270 ms de CPU) demoraba a todas las demás peticiones (p95 de 300 ms en rutas de 5 ms). Ahora corre en hilos aparte (`src/lib/password.ts`); con logins, las demás rutas quedaron en p95 < 25 ms.
- **El límite es el proceso de Node, no MySQL:** con 1 proceso, la CPU de la API llega al 100 % de un núcleo, mientras MySQL tiene de sobra. Por eso existe `API_PROCESSES` (cluster): con 4 procesos, la capacidad se duplicó.
- **El aislamiento aguanta la carga:** 0 respuestas con datos de otra sucursal en todas las pruebas.
- Los cortes del `pico` vienen de la cola de conexiones nuevas de Node. En producción nginx reutiliza pocas conexiones hacia la API (`keepalive`), así que el efecto debería ser menor: conviene medirlo con `DOMINIO=` en el servidor real.

## Notas

- Si k6 corre en la misma máquina que la API, se reparten la CPU. Para medir el máximo real, corre k6 desde otra máquina con `DOMINIO=…`.
- Las conexiones a MySQL siguen la regla `TENANT_POOL_MAX × sucursales activas + CENTRAL_POOL_MAX < max_connections`.
- Al terminar: `./limpiar.sh` y `docker rm -f dental3d-k6-redis`.
