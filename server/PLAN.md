# Plan de migración: Supabase → API Node + MySQL

Rama de trabajo: `dev`. **Nada se sube a `main` hasta la Fase 5**, porque `main` se sincroniza con Lovable y la app publicada se rompería. Al final (Fase 6) se elimina todo lo relacionado con Lovable.

## Decisiones tomadas

| Tema | Decisión |
|---|---|
| Base de datos | MySQL 8.4 (IDs UUID en `CHAR(36)`, para copiar los datos sin cambiar relaciones) |
| Backend | Node 20 + Express 5 + TypeScript, en la carpeta `server/` de este repo |
| Autenticación | JWT propio + contraseñas con bcrypt |
| Seguridad | Las reglas RLS de Supabase pasan a middlewares (`requirePermission` / `requireRole`) |
| Reglas de negocio | Los triggers de PostgreSQL pasan a código de la API, dentro de transacciones |
| Auditoría | La API escribe `audit_logs` en la misma transacción de cada cambio |
| Forma de trabajo | Por fases; cada fase se prueba antes de pasar a la siguiente |

## Fase 1 — Base, login y Doctores ✅ hecha

- Tablas `users`, `user_roles`, `permissions`, `role_permissions`, `app_params`, `doctors` y `audit_logs`, más los datos iniciales.
- `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me` y `POST /api/auth/change-password`.
- CRUD completo de `/api/doctors`, con permisos y auditoría.
- Errores en español, script `db:migrate` y script `db:create-admin`.
- Probado contra MySQL real: login, rechazos por permiso, usuario desactivado, validaciones y auditoría.

## Fase 2 — Núcleo clínico y comisiones

**Tablas:** `patients`, `studies`, `study_prices`, `patient_studies`, `commissions`.

**Reglas que se pasan de trigger a código:**

| Trigger actual | En la API |
|---|---|
| `set_patient_study_price` | Al registrar una atención, el precio se toma de la tarifa activa (con o sin informe). El cliente nunca envía el precio. |
| `deactivate_prev_prices` | Crear una tarifa activa desactiva la anterior en la misma transacción. |
| `calc_commission` | Calcula la comisión al registrar la atención: vale = monto fijo, porcentaje del doctor, 50% en el primer paciente, o monto fijo del estudio. |

**Endpoints:** `/api/patients`, `/api/studies`, `/api/studies/:id/prices`, `/api/attentions` (incluye cobrar y entregar) y `/api/commissions`.

**Decisión pendiente (comisiones):** hoy el 50% del primer paciente **solo se aplica a doctores con porcentaje**, y no se puede combinar un monto fijo con un porcentaje. Confirmar si se mantiene así o se cambia en esta fase.

**Listo cuando:** una atención registrada por la API genera el mismo precio y la misma comisión que hoy genera Supabase con los mismos datos.

## Fase 3 — Finanzas, agenda y notificaciones

**Tablas:** `cashbox`, `bank_deposits`, `third_party_payments`, `appointments`, `notifications`, `notification_recipients`.

- **Caja chica** (`set_cashbox_balance`): saldo = saldo anterior + ingreso − gasto. Se calcula bloqueando la última fila (`SELECT … FOR UPDATE`), para que dos movimientos al mismo tiempo no generen un saldo incorrecto.
- **Pagos a terceros** (`prevent_service_date_change`): la fecha de servicio no se puede editar después de guardarla.
- **Comprobantes:** hoy se guardan en el bucket `receipts` de Supabase Storage (`src/components/receipt-image.tsx`). Hay que guardarlos en el disco del servidor o en un almacenamiento tipo S3, con el mismo control de roles (ADMIN, CAJA y CONTABILIDAD suben; además SUBADMIN puede ver).
- **Notificaciones en tiempo real:** hoy usan Supabase Realtime (`src/components/notification-bell.tsx`). Opciones: consultar cada 30 segundos (lo más simple) o usar Server-Sent Events. Recomendado: empezar consultando cada 30 segundos.
- **Eventos de auditoría** que hoy usan `rpc("log_audit_event")` (cobrar, entregar, citas): se registran directamente en cada endpoint.

## Fase 4 — Administración, reportes y copia de datos

- **Usuarios** (reemplaza `src/lib/users-admin.functions.ts`): crear, editar, eliminar, aprobar y asignar roles. Para **impersonar** se emite un JWT del usuario elegido, solo si se tiene el permiso `users.impersonate`, y queda auditado.
- **Roles y permisos:** editar `role_permissions`.
- **Parámetros:** editar `app_params`.
- **Auditoría:** vista con filtros por fecha, usuario y tabla.
- **Reportes:** pacientes por día, estudios, caja, ingresos, comisiones, pagos a terceros y los controles de calidad (pacientes sin doctor, registros sin usuario, errores de fecha, tarifas incorrectas). La exportación a PDF y Excel puede seguir haciéndose en el frontend.
- **Copia de datos desde Supabase:**
  - Script que lee PostgreSQL (con la cadena de conexión de la base de Supabase) y escribe en MySQL conservando los mismos IDs.
  - **Contraseñas:** Supabase las guarda con bcrypt en `auth.users.encrypted_password`. Si se copian a `users.password_hash`, nadie tiene que cambiar su contraseña.
  - Verificar que el conteo de filas y la suma de montos sean iguales en ambas bases.

## Fase 5 — Cambiar el frontend y salir a producción

- Crear un cliente de API (`src/lib/api.ts`) que guarde el token y lo envíe en cada petición.
- Reescribir `src/lib/auth.tsx` sobre `/api/auth/*`, conservando `can()` y `hasRole()` para no tocar las páginas.
- Reemplazar en las páginas unas 100 llamadas directas a Supabase: 77 `from()`, 11 `rpc()`, ~15 de login y sesión, 2 de archivos y 1 de tiempo real.
- Publicar la API (Railway, Render o un VPS) con MySQL administrado, HTTPS y respaldos automáticos diarios.
- Definir `VITE_API_URL` en el frontend y `CORS_ORIGIN` en la API con el dominio real.
- Recién entonces unir la rama a `main`, en un horario de poco uso. El día del corte: congelar cambios en Supabase → copiar los datos → publicar.

**Consecuencia:** a partir de aquí, el editor de Lovable sigue sirviendo para la interfaz, pero ya no administra la base de datos ni el login.

## Fase 6 — Eliminar todo lo de Lovable

**¿Por qué al final y no ahora?** Hoy el frontend necesita Lovable para funcionar: el login y los datos están en Lovable Cloud (Supabase), Vite se configura con un paquete de Lovable y el logo está guardado en los servidores de Lovable. Si se borra antes de la Fase 5, la app deja de funcionar. Lo que sí se puede adelantar en `dev` está marcado como **(se puede adelantar)**.

### 6.1 En el código

| Qué | Dónde | Acción |
|---|---|---|
| Configuración de Vite | `vite.config.ts` | Reemplazar `@lovable.dev/vite-tanstack-config` por los plugins directos: `tanstackStart`, `viteReact`, `tailwindcss`, `tsConfigPaths` y `nitro`. Publicar en Node en vez de Cloudflare. Quitar el `componentTagger` y los plugins de Lovable. Comprobar que `npm run build` y `npm run dev` funcionan. **(se puede adelantar)** |
| Dependencias | `package.json` | Quitar `@lovable.dev/vite-tanstack-config` y, después de la Fase 5, `@supabase/supabase-js`. Cambiar el nombre `tanstack_start_ts` por `dental-3d`. **(se puede adelantar, salvo Supabase)** |
| Gestor de paquetes | `bunfig.toml`, `bun.lock`, `package-lock.json` | Elegir **uno solo** (npm o bun), borrar el lockfile del otro y quitar de `bunfig.toml` las excepciones de `@lovable.dev/*`. **(se puede adelantar)** |
| Reporte de errores | `src/lib/lovable-error-reporting.ts`, `src/routes/__root.tsx` | Borrar el archivo y reemplazar `reportLovableError` por `console.error`, o por Sentry si se quiere monitoreo. **(se puede adelantar)** |
| **Logo** | `src/assets/logo-3d.png.asset.json` | Hoy es un enlace al CDN de Lovable (`/__l5e/assets-v1/...`). **Descargar el PNG real**, guardarlo como `src/assets/logo-3d.png` y cambiar los imports (sidebar, layout `/app`, inicio, etc.). Si no se hace, el logo desaparece al cerrar Lovable. **(se puede adelantar, prioridad alta)** |
| Supabase | `src/integrations/supabase/`, `supabase/`, `src/lib/users-admin.functions.ts` | Borrarlos después de la Fase 5, cuando ninguna página los use. Conservar `supabase/migrations` en una copia aparte (o en el historial de git) como referencia del esquema anterior. |
| Variables de entorno | `.env` (raíz) | Hoy tiene las claves de Supabase y está subido a git. Borrarlo del repositorio (`git rm --cached .env`), agregarlo a `.gitignore` y crear `.env.example` solo con `VITE_API_URL`. |
| Carpeta `.lovable/` | `plan.md`, `project.json` | Mover `plan.md` (los requisitos originales) a `docs/plan-original.md` y borrar la carpeta. |
| Documentación | `README.md`, `AGENTS.md` | Quitar las secciones de Lovable. Escribir un README propio (instalación, frontend y API, publicación). En `AGENTS.md`, quitar el aviso de Lovable pero mantener la regla de no reescribir el historial de `main`. |
| Mensajes de error | `src/integrations/supabase/*.ts` | Dicen "Connect Supabase in Lovable Cloud". Desaparecen al borrar la carpeta. |
| Verificación final | todo el repo | `grep -ri lovable` y `grep -ri supabase` (fuera de `docs/`) no deben encontrar nada. Además, `build` y `lint` deben pasar. |

### 6.2 Fuera del código (lo hace el dueño de la cuenta)

En este orden, **sin saltarse pasos**:

1. **Copiar los datos** de Lovable Cloud a MySQL (Fase 4) y verificar los conteos y totales.
2. **Publicar el frontend** en otro servicio (Vercel, Netlify, Cloudflare Pages o el mismo VPS de la API) con un **dominio propio**, porque `dental-3d.lovable.app` deja de funcionar al cerrar Lovable.
3. Usar el sistema en producción **al menos 1–2 semanas** sin problemas.
4. En Lovable: **desconectar el repositorio de GitHub**. Si no se desconecta, cualquier cambio hecho en Lovable seguiría llegando a `main`.
5. Guardar un **respaldo final** de la base de Supabase (`pg_dump`) y de los archivos del bucket `receipts`.
6. Recién entonces, **borrar el proyecto en Lovable** y cancelar la suscripción, si existe.

### Listo cuando

- La app funciona publicada en el nuevo servicio, con dominio propio, usando solo la API Node + MySQL.
- En el repositorio no queda ninguna referencia a Lovable ni a Supabase (salvo el respaldo de `supabase/migrations`).
- El proyecto en Lovable está desconectado y borrado, y existe un respaldo guardado.

## Caché para respuestas rápidas

**Regla de oro:** se cachea lo que se **lee mucho y cambia poco**. El dinero (saldo de caja, precios al registrar, comisiones) **siempre se calcula leyendo la base de datos dentro de la transacción**, nunca desde el caché. Un dato viejo en una pantalla de consulta es aceptable; un saldo o un precio incorrecto guardado en la base no.

### Situación actual

- **Frontend:** React Query ya tiene caché (`src/router.tsx`): `staleTime` de 5 minutos para **todas** las consultas, sin volver a pedir datos al cambiar de pestaña.
  - Esto es rápido, pero **arriesgado para datos que cambian seguido**. Ejemplo: si la cajera A registra un gasto, la cajera B puede seguir viendo el saldo anterior hasta 5 minutos.
- **API (Fase 1):** en cada petición `requireAuth` hace 3 consultas a MySQL: usuario, roles y permisos. Es el primer lugar donde conviene cachear.

### Capa 1 — Caché en la API (memoria del servidor)

Se crea `src/lib/cache.ts` con una interfaz simple: `get`, `set`, `del` y `delPrefix`. Al principio se implementa con `lru-cache`, en memoria y con un límite de elementos. Luego se puede cambiar a Redis sin tocar las rutas.

| Dato | Clave | Duración (TTL) | Se borra cuando… |
|---|---|---|---|
| Sesión: activo, aprobado, roles, permisos | `auth:<userId>` | 60 s | se edita, aprueba, desactiva o elimina el usuario, o cambian sus roles |
| Permisos por rol | `perms:<rol>` | 10 min | se edita `role_permissions` |
| Parámetros (`app_params`) | `params` | 10 min | se edita un parámetro |
| Estudios + tarifa activa (para mostrar) | `studies:active` | 10 min | se crea o edita un estudio o una tarifa |
| Lista de doctores | `doctors:list` | 5 min | se crea, edita o elimina un doctor |
| Dashboard y reportes de **meses ya cerrados** | `report:<tipo>:<desde>:<hasta>` | 1 h | se registra un cambio con fecha en ese período |

**Cómo se mantiene correcto (invalidación):**
1. Cada endpoint que modifica algo borra sus claves **después del commit**. Si se borraran antes, otra petición podría volver a cachear el dato viejo.
2. El TTL es solo una red de seguridad: si algún borrado falla, el dato se renueva solo.
3. Se cachea solo la versión "sin filtros". Las búsquedas (`?q=`) van directo a MySQL, porque con índices son rápidas.
4. **No se cachea:** caja chica, depósitos, pagos a terceros, atenciones del día, comisiones pendientes ni auditoría. Cambian todo el tiempo y necesitan exactitud.

**Seguridad:** la clave `auth:<userId>` dura como máximo 60 segundos y además se borra en el mismo momento en que un ADMIN desactiva al usuario o le quita un rol. Así se mantiene la regla de la Fase 1 de que desactivar a alguien tenga efecto inmediato.

### Capa 2 — Redis (cuando haya más de un servidor)

El caché en memoria funciona mientras la API corra en **un solo proceso**. Si se publican 2 o más instancias, cada una tendría su propio caché y un borrado en una no llegaría a la otra. En ese caso:
- Cambiar la implementación de `cache.ts` a Redis (`ioredis`). Las claves y los TTL son los mismos.
- Railway y Render ofrecen Redis administrado. En un VPS se instala con Docker.
- **No hace falta al principio.** Una sola instancia aguanta de sobra el volumen de un centro radiológico.

### Capa 3 — HTTP (entre la API y el navegador)

- **Compresión gzip/brotli** (`compression`): las listas grandes en JSON (pacientes, atenciones) pesan entre 5 y 10 veces menos.
- **ETag:** Express ya lo genera. Si los datos no cambiaron, responde `304 Not Modified` sin volver a enviar el contenido.
- `Cache-Control: private, no-cache` en todas las respuestas con datos. Así el navegador revalida con el ETag y **ningún proxy o CDN guarda datos de pacientes**. Las rutas con datos sensibles nunca usan `public`.

### Capa 4 — Frontend (React Query), por tipo de dato

Reemplazar los 5 minutos globales de `staleTime` por valores según el tipo de dato:

| Tipo de dato | `staleTime` | Ejemplos |
|---|---|---|
| Catálogos | 10 min | estudios, tarifas, parámetros, permisos, roles |
| Maestros | 2 min | doctores, pacientes |
| Operación diaria | 15–30 s, y volver a pedir al regresar a la pestaña | atenciones, entregas, citas |
| Dinero | 0 (siempre fresco) | caja chica, depósitos, pagos a terceros, comisiones |

Además:
- Después de cada guardado, invalidar las consultas relacionadas (ya se hace en varias páginas con `invalidateQueries`).
- Usar **actualización optimista** solo en cambios simples, como activar o desactivar un doctor. Nunca en montos.

### Capa 5 — Base de datos (lo que más acelera sin riesgo)

Antes de cachear una consulta lenta, primero revisar que tenga índice:
- `patients(doctor_id)`, `patients(full_name)`
- `patient_studies(patient_id)`, `patient_studies(created_at)`, `patient_studies(doctor_id)`
- `commissions(doctor_id, created_at)`, `cashbox(created_at)`, `appointments(starts_at)`
- `study_prices(study_id, is_active)`

Otras medidas:
- Revisar las consultas lentas con `EXPLAIN` y activar el `slow_query_log` de MySQL (umbral de 200 ms).
- Paginar las listas grandes (`?page=&limit=`) en vez de traer toda la tabla, como hace hoy `useList`.

### Cómo se mide

- Registrar en un log la duración de cada petición (método, ruta, ms) y si vino del caché (header `X-Cache: HIT/MISS`).
- **Objetivo:** que el 95% de las peticiones de lectura respondan en menos de 100 ms y los catálogos cacheados en menos de 20 ms.
- Comparar antes y después con `autocannon` sobre `/api/doctors` y `/api/auth/me`.

### Cuándo se hace

| Fase | Trabajo de caché |
|---|---|
| Inicio de la Fase 2 | `cache.ts` (memoria), caché de `auth:<userId>` con invalidación, compresión, `Cache-Control`, log de tiempos |
| Fase 2 | Caché de estudios, tarifas y doctores; índices de pacientes y atenciones; paginación |
| Fase 3 | **Sin caché** en caja, depósitos y pagos a terceros (es intencional); solo índices |
| Fase 4 | Caché de permisos y parámetros, y de reportes de meses cerrados |
| Fase 5 | `staleTime` por tipo de dato en el frontend; Redis solo si se publica más de una instancia |

## Pendientes y temas abiertos

### 1. Recuperar contraseña por email (no implementado)
Necesita un servicio de correo. Opciones: **Resend**, **Brevo** o **SMTP del dominio** (Gmail o Microsoft 365 de la clínica).

Diseño propuesto:
- `POST /api/auth/forgot-password` envía un enlace con un token aleatorio de un solo uso, válido 30 minutos. En la base se guarda solo el hash del token.
- `POST /api/auth/reset-password` cambia la contraseña.
- La respuesta es siempre la misma, exista o no el email, para no revelar qué cuentas existen.

**Decisión pendiente:** qué servicio de correo usar. Se puede hacer en cualquier fase. Hasta entonces, un ADMIN puede cambiar contraseñas (Fase 4) o usar `npm run db:create-admin`.

### 2. Contenedor de MySQL local
El contenedor `dental3d-mysql` sigue corriendo en el puerto **3307** y tiene datos de prueba.
- Detenerlo: `docker stop dental3d-mysql`
- Volver a iniciarlo: `docker start dental3d-mysql`
- Borrarlo con sus datos: `docker rm -f dental3d-mysql`, y luego `npm run db:migrate` para empezar de cero.

### 3. Carpeta `server` excluida del ESLint del frontend
Se agregó `"server"` a `ignores` en `eslint.config.js`, porque el backend usa otra configuración (Node, sin React). Pendiente: darle a `server/` su propio ESLint y Prettier.

### 4. Archivos que aparecieron en la raíz durante la sesión
`package-lock.json` en la raíz y un reordenamiento de `src/routeTree.gen.ts`. No los creó este trabajo; parecen salir de correr `npm install` o `npm run dev` en la raíz.
- El proyecto ya usa `bun.lock`. Si no se usa npm en la raíz, **no hay que subir** `package-lock.json`: se puede borrar o agregar a `.gitignore`.
- `src/routeTree.gen.ts` se genera solo y el cambio es únicamente de orden. Se puede descartar con `git checkout src/routeTree.gen.ts`.
- **Ninguno de los dos debe incluirse en los commits del backend.**

### 5. Otros
- El `.env` de la raíz está subido al repositorio. Hoy solo tiene claves públicas de Supabase, pero `server/.env` (secreto JWT y contraseña de la base) **nunca** debe subirse. Ya está en `server/.gitignore`.
- Agregar tests automáticos de la API, con Vitest y Supertest contra un MySQL de prueba, empezando en la Fase 2, donde están las reglas de dinero.
- Limitar los intentos de login para frenar ataques de fuerza bruta (por ejemplo con `express-rate-limit`).

## Orden siguiente

1. ✅ Commit de la Fase 1 y del plan en la rama `dev`, sin `package-lock.json` ni `src/routeTree.gen.ts`.
2. Confirmar la regla de comisiones (Fase 2) y el servicio de correo.
3. Adelantar en `dev` lo urgente de la Fase 6: **descargar el logo** dentro del proyecto.
4. Empezar la Fase 2 con la base del caché: `cache.ts`, caché de sesión, compresión y log de tiempos.
