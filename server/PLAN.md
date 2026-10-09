# Plan de migración: Supabase → API Node + MySQL multi-sucursal

Rama de trabajo: `dev`. **Nada se sube a `main` hasta la Fase 5**, porque `main` se sincroniza con Lovable y la app publicada se rompería. Al final (Fase 6) se elimina todo lo relacionado con Lovable.

## Decisiones tomadas

| Tema | Decisión |
|---|---|
| Base de datos | MySQL 8.4 (IDs UUID en `CHAR(36)`, para copiar los datos sin cambiar relaciones) |
| Backend | Node 20 + Express 5 + TypeScript, en la carpeta `server/` de este repo |
| **Multi-sucursal** | **tenancy-node v0.8.0** ([repo](https://github.com/yedrick/tenat-node)), instalado desde GitHub Releases. **Solo se usa este módulo** para todo lo que sea multi-tenant: bases, caché, archivos, tema/logo, logs |
| Modelo | **Cada sucursal es un tenant con su propia base** (`dental_<sucursal>`) y su propio usuario MySQL. Cómo compartir datos entre sucursales se decide más adelante ([temas abiertos](#temas-abiertos-de-multi-sucursal)) |
| Identificación | Por **subdominio**: `sur.dental3d.com` → `sur` |
| Autenticación | JWT propio (HS256) ligado a la sucursal + bcrypt |
| Seguridad | Las reglas RLS de Supabase pasan a middlewares (`requirePermission` / `requireRole`) |
| Reglas de negocio | Los triggers de PostgreSQL pasan a código de la API, dentro de transacciones |
| Cambios de base | Migraciones en `server/db/tenant/NNN_*.sql`, aplicadas a todas las sucursales con `npm run db:migrate` |
| Forma de trabajo | Por fases; cada fase se prueba antes de pasar a la siguiente |

## Arquitectura

```
navegador ── sur.dental3d.com ──► proxy (nginx) ──┬─ /api, /tenancy ─► API Node (Express + tenancy-node)
                                                  └─ resto ──────────► frontend (React)

API Node ─┬─► MySQL central: dental3d_central   (tablas tenancy_*: sucursales, dominios, servidores)
          ├─► MySQL dental_central               (usuario MySQL propio de "central")
          ├─► MySQL dental_sur                   (usuario MySQL propio de "sur")
          ├─► caché por sucursal                 (memoria; Redis en producción con varias réplicas)
          └─► archivos públicos por sucursal     (storage/<sucursal>/branding/logo-*.png)
```

En cada petición, `tenancyMiddleware` lee el subdominio, abre el contexto de esa sucursal y todo lo demás (`db()`, `cache()`, `storage()`, logs) usa automáticamente esa sucursal.

## Fase 1 — Base, login y Doctores ✅ hecha

- Tablas de usuarios, roles, permisos, parámetros, doctores y auditoría, con sus datos iniciales.
- Login, registro, sesión y cambio de contraseña con JWT.
- CRUD de Doctores con permisos y auditoría.
- Errores en español.

## Fase 1.5 — Multi-sucursal, seguridad, velocidad y marca ✅ hecha

**Multi-sucursal (tenancy-node):**
- Instalados `@tenancy-node/core`, `db`, `db-mysql`, `adapter-express` y `cli` (v0.8.0). Se revisó que no traen scripts de instalación.
- `src/tenancy/config.ts` es la configuración única de la API y de la CLI (`tenancy.config.ts`).
- El esquema pasó a migraciones por sucursal (`db/tenant/001_schema.sql`, `002_seed.sql`).
- Probado con dos sucursales (`central` y `sur`):
  - Datos totalmente aislados.
  - Un token de una sucursal es rechazado en la otra.
  - Caché y límites de intentos separados por sucursal.
  - Una sucursal inexistente responde 404.

**Seguridad:** ver [Seguridad](#seguridad).

**Velocidad:** caché por sucursal, compresión, ETag/304 y un log con la duración de cada petición. Ver [Caché y velocidad](#caché-y-velocidad).

**Marca:** cada sucursal tiene nombre, dirección, teléfono, colores y logo propios. Ver [Logos y marca](#logos-y-marca-por-sucursal).

**Bug encontrado en tenancy-node 0.8.0** (con parche aplicado): ver [Reporte para tenancy-node](#reporte-para-tenancy-node).

## Fase 2 — Núcleo clínico y comisiones

**Migración nueva:** `db/tenant/003_clinico.sql` con `patients`, `studies`, `study_prices`, `patient_studies` y `commissions`, más sus índices (ver [Base de datos](#rendimiento-y-base-de-datos)).

**Reglas que se pasan de trigger a código:**

| Trigger actual | En la API |
|---|---|
| `set_patient_study_price` | Al registrar una atención, el precio se toma de la tarifa activa (con o sin informe), leída dentro de la transacción. El cliente nunca envía el precio. |
| `deactivate_prev_prices` | Crear una tarifa activa desactiva la anterior en la misma transacción. |
| `calc_commission` | Calcula la comisión al registrar la atención: vale = monto fijo, porcentaje del doctor, 50% en el primer paciente, o monto fijo del estudio. |

**Endpoints:** `/api/patients`, `/api/studies`, `/api/studies/:id/prices`, `/api/attentions` (incluye cobrar y entregar) y `/api/commissions`.

**Caché:** estudios con su tarifa activa (solo para mostrar, 10 min). La lista de pacientes se pagina y no se cachea.

**Decisión pendiente (comisiones):** hoy el 50% del primer paciente **solo se aplica a doctores con porcentaje**, y no se puede combinar un monto fijo con un porcentaje. Confirmar si se mantiene así.

**Listo cuando:** una atención registrada por la API genera el mismo precio y la misma comisión que hoy genera Supabase con los mismos datos.

## Fase 3 — Finanzas, agenda y notificaciones

**Migración nueva:** `004_finanzas.sql` con `cashbox`, `bank_deposits`, `third_party_payments`, `appointments`, `notifications` y `notification_recipients`.

- **Caja chica** (`set_cashbox_balance`): saldo = saldo anterior + ingreso − gasto. Se calcula bloqueando la última fila (`SELECT … FOR UPDATE`) para que dos movimientos al mismo tiempo no generen un saldo incorrecto. **Sin caché.**
- **Pagos a terceros** (`prevent_service_date_change`): la fecha de servicio no se puede editar después de guardarla.
- **Comprobantes (archivos privados):** **no** se guardan con `tenancy.storage()`, porque esa ruta es pública (`/tenancy/assets`). Hay que usar una carpeta privada por sucursal (`private/<sucursal>/receipts/...`), servida por un endpoint con login y permisos, o S3 privado con URLs firmadas. Mismo control de roles: ADMIN, CAJA y CONTABILIDAD suben; además SUBADMIN puede ver.
- **Notificaciones:** hoy usan Supabase Realtime. Al principio se consultan cada 30 segundos; después se puede pasar a Server-Sent Events.
- **Eventos de auditoría** que hoy usan `rpc("log_audit_event")` (cobrar, entregar, citas): se registran directamente en cada endpoint.

## Fase 4 — Administración, reportes y copia de datos

- **Usuarios de la sucursal:** crear, editar, eliminar, aprobar y asignar roles. Cada cambio **borra la caché de sesión** del usuario (`invalidate(CacheKeys.auth(id))`), así desactivar a alguien tiene efecto inmediato. Para **impersonar** se emite un JWT del usuario elegido, solo con el permiso `users.impersonate`, y queda auditado.
- **Roles y permisos** (`role_permissions`) y **parámetros** (`app_params`), con caché de 10 min que se borra al editar.
- **Auditoría:** vista con filtros.
- **Reportes:** se cachean solo los de meses ya cerrados.
- **Administración de sucursales** (crear, suspender, mantenimiento): con la CLI (`npx tenancy ...`) o con el panel de administración de tenancy-node (`@tenancy-node/admin-api` / `admin-ui`), accesible solo por VPN o túnel SSH.
- **Copia de datos desde Supabase:**
  - Todos los datos actuales van a **una sucursal** (por ejemplo, `central`).
  - Script que lee PostgreSQL y escribe en `dental_central` conservando los mismos IDs.
  - **Contraseñas:** Supabase las guarda con bcrypt en `auth.users.encrypted_password`. Si se copian a `users.password_hash`, nadie tiene que cambiarla.
  - Verificar que el conteo de filas y la suma de montos sean iguales en ambas bases.

## Fase 5 — Cambiar el frontend y salir a producción

- **Un subdominio por sucursal**, y el frontend y la API **en el mismo host**: nginx manda `/api` y `/tenancy` a Node y el resto al frontend. Así `/tenancy/me` y el login reconocen la sucursal por el host.
- Cliente de API (`src/lib/api.ts`) que guarda el token y lo envía en cada petición.
- Reescribir `src/lib/auth.tsx` sobre `/api/auth/*`, conservando `can()` y `hasRole()` para no tocar las páginas.
- **Marca:**
  - Cargar `/tenancy/theme.css` y pasar `--color-primary` y los demás colores a las variables de Tailwind/shadcn.
  - Mostrar el logo y el nombre desde `/tenancy/me` (sidebar, login, PDFs).
  - Agregar una pantalla "Marca de la sucursal" para quien tenga `branding.edit`.
- Reemplazar en las páginas unas 100 llamadas directas a Supabase: 77 `from()`, 11 `rpc()`, ~15 de login y sesión, 2 de archivos y 1 de tiempo real.
- `staleTime` de React Query según el tipo de dato (ver [Caché](#caché-y-velocidad)).
- Publicar la API con MySQL administrado, HTTPS, un certificado comodín (`*.dental3d.com`) y respaldos automáticos diarios **de cada base** (`tenancy run "mysqldump ..."` recorre todas las sucursales).
- Recién entonces unir la rama a `main`. El día del corte: congelar cambios en Supabase → copiar los datos → publicar.

## Fase 6 — Eliminar todo lo de Lovable

**¿Por qué al final y no ahora?** Hoy el frontend necesita Lovable para funcionar: el login y los datos están en Lovable Cloud (Supabase), Vite se configura con un paquete de Lovable y el logo está guardado en los servidores de Lovable. Si se borra antes de la Fase 5, la app deja de funcionar. Lo que sí se puede adelantar en `dev` está marcado como **(se puede adelantar)**.

### 6.1 En el código

| Qué | Dónde | Acción |
|---|---|---|
| Configuración de Vite | `vite.config.ts` | Reemplazar `@lovable.dev/vite-tanstack-config` por los plugins directos: `tanstackStart`, `viteReact`, `tailwindcss`, `tsConfigPaths` y `nitro`. Publicar en Node en vez de Cloudflare. Quitar el `componentTagger` y los plugins de Lovable. **(se puede adelantar)** |
| Dependencias | `package.json` | Quitar `@lovable.dev/vite-tanstack-config` y, después de la Fase 5, `@supabase/supabase-js`. Cambiar el nombre `tanstack_start_ts` por `dental-3d`. **(se puede adelantar, salvo Supabase)** |
| Gestor de paquetes | `bunfig.toml`, `bun.lock`, `package-lock.json` | Elegir **uno solo**, borrar el lockfile del otro y quitar de `bunfig.toml` las excepciones de `@lovable.dev/*`. **(se puede adelantar)** |
| Reporte de errores | `src/lib/lovable-error-reporting.ts`, `src/routes/__root.tsx` | Borrar el archivo y reemplazar `reportLovableError` por `console.error`, o por Sentry. **(se puede adelantar)** |
| **Logo** | `src/assets/logo-3d.png.asset.json` | Hoy es un enlace al CDN de Lovable. **Descargar el PNG real** y subirlo como logo de cada sucursal con `PUT /api/branding/logo`. Mientras tanto, guardarlo en `src/assets/` como respaldo. **(se puede adelantar, prioridad alta)** |
| Supabase | `src/integrations/supabase/`, `supabase/`, `src/lib/users-admin.functions.ts` | Borrarlos después de la Fase 5. Conservar `supabase/migrations` en `docs/` o en el historial de git, como referencia. |
| Variables de entorno | `.env` (raíz) | Hoy tiene las claves de Supabase y está subido a git. Borrarlo del repositorio (`git rm --cached .env`), agregarlo a `.gitignore` y crear `.env.example`. |
| Carpeta `.lovable/` | `plan.md`, `project.json` | Mover `plan.md` (los requisitos originales) a `docs/plan-original.md` y borrar la carpeta. |
| Documentación | `README.md`, `AGENTS.md` | Quitar las secciones de Lovable. Escribir un README propio. En `AGENTS.md`, mantener la regla de no reescribir el historial de `main`. |
| Verificación final | todo el repo | `grep -ri lovable` y `grep -ri supabase` (fuera de `docs/`) no deben encontrar nada. `build` y `lint` deben pasar. |

### 6.2 Fuera del código (lo hace el dueño de la cuenta)

En este orden, **sin saltarse pasos**:

1. **Copiar los datos** de Lovable Cloud a MySQL (Fase 4) y verificar los conteos y totales.
2. **Publicar el frontend** con **dominio propio** y subdominios por sucursal, porque `dental-3d.lovable.app` deja de funcionar al cerrar Lovable.
3. Usar el sistema en producción **al menos 1–2 semanas** sin problemas.
4. En Lovable: **desconectar el repositorio de GitHub**.
5. Guardar un **respaldo final** de Supabase (`pg_dump`) y de los archivos del bucket `receipts`.
6. Recién entonces, **borrar el proyecto en Lovable** y cancelar la suscripción.

## Seguridad

### Ya implementado ✅

| Medida | Detalle |
|---|---|
| Aislamiento por sucursal | Base propia y **usuario MySQL propio** por sucursal (`credentials: 'per-tenant'`). Aunque el código tuviera un error, MySQL no deja leer la base de otra sucursal. |
| Credenciales cifradas | Las contraseñas MySQL de cada sucursal se guardan cifradas con AES-256-GCM (`TENANCY_KEY`). |
| Token ligado a la sucursal | El JWT lleva la sucursal (`tid`). Un token de `central` es rechazado en `sur`. |
| JWT | Solo HS256 (el algoritmo es fijo). Se exige un secreto de 32+ caracteres o la API no arranca. Duración de 8 h. |
| Sesión | Activo, aprobado, roles y permisos se revisan en cada petición (caché de 60 s por sucursal). |
| Registro público | Ya **no** existe "el primer registrado es ADMIN": eso permitía que un desconocido se adueñara de una sucursal nueva. El ADMIN se crea por terminal (`tenant:create-admin`), con la contraseña en una variable de entorno. |
| Fuerza bruta | Límites por IP y sucursal: login 10 cada 15 min, registro 5 por hora, cambio de contraseña 10 cada 15 min. |
| Contraseñas | bcrypt de 12 rondas. Reglas: 10+ caracteres, mayúscula, minúscula, número y símbolo. El login no revela si el usuario existe. |
| Archivos | Logo: solo PNG, JPG o WEBP, validando el **contenido** real y no solo el `Content-Type`. **SVG bloqueado** (puede llevar scripts). Máximo 1 MB. |
| Tema | Colores y fuente validados (también los valida tenancy-node), para que nadie pueda inyectar CSS. |
| Encabezados | `helmet`, CORS solo para los orígenes configurados, JSON de 1 MB como máximo, `Cache-Control: private, no-cache` en los datos. |
| Errores | Los 500 no muestran detalles; el error completo va al log con la sucursal. |
| Auditoría | Todo cambio (doctores, marca, logo, registro, contraseña, ADMIN por terminal) queda en `audit_logs` de la sucursal. |
| Secretos | `server/.env` y `server/storage` están en `.gitignore`. |

### Pendiente

- **Producción:** usar un usuario MySQL dedicado para tenancy-node, no `root`:

  ```sql
  CREATE USER 'tenancy_admin'@'%' IDENTIFIED BY '...';
  GRANT ALL PRIVILEGES ON `dental3d_central`.* TO 'tenancy_admin'@'%';
  GRANT ALL PRIVILEGES ON `dental\_%`.* TO 'tenancy_admin'@'%' WITH GRANT OPTION;
  GRANT CREATE USER ON *.* TO 'tenancy_admin'@'%';
  ```

- **`TENANCY_KEY`** en un gestor de secretos, con copia de respaldo. Si se pierde, no se pueden abrir las bases de las sucursales. Se rota con `npx tenancy key:rotate`.
- **HTTPS** obligatorio y `TRUST_PROXY=1` detrás de nginx. `trustProxy` de tenancy-node queda **apagado** salvo que nginx reescriba el `Host`; si estuviera encendido sin proxy, cualquiera podría elegir la sucursal con `X-Forwarded-Host`.
- **Recuperar contraseña por email** (ver [Pendientes](#pendientes-y-temas-abiertos)).
- **Bloqueo por usuario** después de N intentos fallidos, además del límite por IP.
- **Refresh tokens** o un JWT más corto (1–2 h), y revocar sesiones al cambiar la contraseña.
- **2FA** para ADMIN (TOTP).
- **Archivos privados** fuera de `tenancy.storage()` (ver Fase 3).
- **Dependencias:** `npm audit` en CI y fijar tenancy-node a una versión exacta.
- **Respaldos** automáticos de cada base y prueba de restauración mensual.

## Caché y velocidad

**Regla de oro:** se cachea lo que **se lee mucho y cambia poco**. El dinero (saldo de caja, precios al registrar, comisiones) **siempre se calcula leyendo la base dentro de la transacción**, nunca desde la caché.

### Capa 1 — Caché de la API (`tenancy.cache()`, aislada por sucursal)

Implementada en `src/lib/cache.ts`. Las llaves llevan el prefijo de la sucursal automáticamente (`tenant:sur:...`), así que una sucursal nunca lee la caché de otra.

| Dato | Llave | TTL | Se borra cuando… | Estado |
|---|---|---|---|---|
| Sesión: activo, aprobado, roles, permisos | `auth:<userId>` | 60 s | se edita, aprueba, desactiva o elimina el usuario, o cambian sus roles | ✅ (borrado inmediato en Fase 4) |
| Permisos por combinación de roles | `perms:<roles>` | 10 min | se edita `role_permissions` | ✅ (borrado en Fase 4) |
| Lista de doctores | `doctors:list` | 5 min | se crea, edita o elimina un doctor | ✅ |
| Parámetros (`app_params`) | `params` | 10 min | se edita un parámetro | Fase 4 |
| Estudios + tarifa activa (para mostrar) | `studies:active` | 10 min | se crea o edita un estudio o una tarifa | Fase 2 |
| Reportes de **meses cerrados** | `report:<tipo>:<desde>:<hasta>` | 1 h | se registra un cambio con fecha en ese período | Fase 4 |

Reglas:
- Las llaves se borran **después del commit**. El TTL es solo una red de seguridad.
- Las búsquedas (`?q=`) van directo a MySQL.
- **No se cachea:** caja, depósitos, pagos a terceros, atenciones del día, comisiones pendientes ni auditoría.
- El header `X-Cache: HIT/MISS` muestra si una respuesta vino de la caché.

### Capa 2 — Redis (cuando haya más de una réplica)

Hoy se usa la caché en memoria de tenancy-node (un solo proceso). Con 2 o más réplicas:
- `cache: redis({ url })` de `@tenancy-node/cache-redis`. Sirve también para los límites de intentos.
- `invalidation: redisInvalidation({ url })`, para que un cambio de sucursal llegue a todas las réplicas al instante.
- No hace falta cambiar ninguna ruta.

### Capa 3 — HTTP ✅

- Compresión gzip (`compression`).
- ETag + `304 Not Modified`: probado.
- Datos con `Cache-Control: private, no-cache`.
- `/tenancy/me`, `theme.css` y el logo con `public, max-age=60`.
- El nombre del logo lleva un hash de su contenido, así un logo nuevo nunca se ve viejo.

### Capa 4 — Frontend (Fase 5)

| Tipo de dato | `staleTime` |
|---|---|
| Catálogos (estudios, tarifas, parámetros, permisos, marca) | 10 min |
| Maestros (doctores, pacientes) | 2 min |
| Operación diaria (atenciones, entregas, citas) | 15–30 s, y volver a pedir al regresar a la pestaña |
| Dinero (caja, depósitos, pagos, comisiones) | 0 |

Hoy el frontend tiene 5 minutos **para todo** (`src/router.tsx`). Es arriesgado para el dinero: dos cajeras pueden ver saldos distintos.

### Medición

- tenancy-node registra en el log, por cada petición: sucursal, ruta, código y `durationMs`.
- **Medido en local** (200 peticiones):

  | Ruta | p50 | p95 |
  |---|---|---|
  | `/api/doctors` (caché) | 1.6 ms | 2.2 ms |
  | búsqueda sin caché | 2.1 ms | 2.4 ms |
  | `/api/auth/me` | 2.1 ms | 2.4 ms |
  | `/tenancy/me` | 0.7 ms | 0.8 ms |

- **Objetivo en producción:** p95 < 100 ms en lecturas y < 20 ms en catálogos cacheados. Repetir la medición con datos reales (`autocannon`) en cada fase.

## Rendimiento y base de datos

### Ya implementado ✅

- Índices: `doctors(status, full_name)`, `doctors(full_name)`, `audit_logs(user_id, timestamp)`, `audit_logs(table_name, record_id)`, `audit_logs(timestamp)`.
- Pools por sucursal de tenancy-node: 5 conexiones por sucursal, hasta 100 pools abiertos y cierre tras 60 s sin uso.
- Tipos iguales a PostgreSQL: TINYINT(1) → boolean, DATE → `'YYYY-MM-DD'` sin conversión de zona horaria, DECIMAL → número.
- Apagado ordenado: se terminan las peticiones en curso y se cierran los pools.

### En cada fase

- **Índices de la Fase 2:**
  - `patients(full_name)`
  - `patients(doctor_id)`
  - `patient_studies(patient_id)`
  - `patient_studies(created_at)`
  - `patient_studies(doctor_id, created_at)`
  - `study_prices(study_id, is_active)`
  - `commissions(doctor_id, created_at)`
- **Índices de la Fase 3:**
  - `cashbox(created_at)`
  - `appointments(starts_at)`
  - `appointments(patient_id)`
  - `third_party_payments(payment_date)`
  - `bank_deposits(deposit_date)`
- **Paginación** (`?page=&limit=`, máximo 100) en pacientes, atenciones, auditoría y caja. Hoy `useList` trae la tabla completa.
- Revisar las consultas nuevas con `EXPLAIN` y activar `slow_query_log` (umbral de 200 ms) en producción.
- **Conexiones:** `sucursales × 5 + pool central ≤ max_connections` de MySQL. Con más de 30 sucursales activas a la vez, subir `max_connections` o agregar un servidor (`npx tenancy servers:add`). tenancy-node reparte las sucursales nuevas al servidor con menos sucursales (`placement: 'least-tenants'`) y mueve una existente con `npx tenancy move`.
- **Cambios de base:** siempre con una migración nueva en `db/tenant/` y `npm run db:migrate` (se aplica a todas las sucursales, de 5 en 5). Nunca editar una migración ya aplicada.

## Logos y marca por sucursal

### Ya implementado ✅ (con tenancy-node: `tenants.update`, `theme.update`, `storage`)

| Qué | Cómo |
|---|---|
| Nombre, dirección, teléfono | `PATCH /api/branding` → se guardan en la sucursal (`name`, `data.address`, `data.phone`) |
| Colores, fuente, bordes, modo claro/oscuro | `PATCH /api/branding` con `theme: { primary, secondary, accent, background, text, font, radius, mode }` |
| Logo | `PUT /api/branding/logo` (PNG/JPG/WEBP, ≤ 1 MB) y `DELETE /api/branding/logo`. Se guarda en `storage/<sucursal>/branding/` |
| Lectura pública para el frontend | `GET /tenancy/me` (nombre, dirección, teléfono, tema y URL del logo) y `GET /tenancy/theme.css` (variables CSS) |
| Permiso | `branding.edit` (ADMIN lo tiene). Cada cambio se audita |
| Colores por defecto | `#0E7490` / `#64748B`, en `src/tenancy/config.ts` |

### Pendiente

- **Favicon** por sucursal (mismo flujo que el logo).
- **Logo en PDFs** de reportes y comprobantes.
- Pantalla de marca y aplicación del tema en el frontend (Fase 5).
- **S3/R2** para los logos cuando haya varias réplicas (`@tenancy-node/storage-s3`): hoy se guardan en el disco del servidor.

## Temas abiertos de multi-sucursal

Se deciden cuando lleguemos ahí, con el módulo de tenancy-node:

- **Usuarios en varias sucursales:** hoy cada sucursal tiene sus propios usuarios. Alguien que trabaja en dos sucursales necesita dos cuentas.
- **Doctores, pacientes y tarifas compartidos:** hoy cada sucursal tiene los suyos. Un paciente que va a dos sucursales existe dos veces.
- **Reportes consolidados** de todas las sucursales: tenancy-node no cruza bases. Se recorren con `tenancy.runForEach` y se suman en código.
- **Crear sucursales desde la interfaz** en vez de la terminal (panel de administración de tenancy-node o endpoints centrales).
- **Dominio propio por sucursal** (`clinicasur.com`) además del subdominio: tenancy-node lo soporta con el resolver `domain`.

## Reporte para tenancy-node

**Bug (v0.8.0, `@tenancy-node/db-mysql`): fuga de conexiones al usar `tenancy.pool()`.**

- **Qué pasa:** `connect()` devuelve `destroy: () => db.destroy()`. Kysely solo cierra el pool si alguna vez lo usó (`RuntimeDriver.destroy` sale si no hubo `init`). Si la app usa solo el pool nativo (`tenancy.pool()`), al cerrar el pool de una sucursal (por inactividad o en `tenancy.close()`) **sus conexiones MySQL quedan abiertas**. En un servidor que corre mucho tiempo, se acumulan conexiones hasta llegar a `max_connections`.
- **Cómo se reproduce:** `tenancy.run(id, () => tenancy.pool().query("SELECT 1"))` → `tenancy.close()` → queda un socket abierto al puerto de MySQL y el proceso no termina.
- **Arreglo sugerido en `db-mysql`:** que `destroy` cierre el pool nativo directamente (`native.end()`) en vez de hacerlo a través de Kysely, o forzar la inicialización de Kysely.
- **Parche aplicado aquí:** `src/db.ts` hace una consulta mínima por Kysely la primera vez que usa cada pool. Verificado: después de `tenancy.close()` no queda ninguna conexión abierta. Quitarlo cuando salga la corrección.

**Detalle de uso (no es un bug):** dentro de una petición, `tenancy.theme()` devuelve el tema con que empezó la petición. Después de `theme.update()` hay que usar el valor que devuelve `update`.

## Pendientes y temas abiertos

### 1. Recuperar contraseña por email (no implementado)
Necesita un servicio de correo: **Resend**, **Brevo** o **SMTP del dominio**.

Diseño propuesto:
- `POST /api/auth/forgot-password` envía un enlace con un token aleatorio de un solo uso, válido 30 minutos. En la base se guarda solo el hash del token.
- `POST /api/auth/reset-password` cambia la contraseña.
- Respuesta idéntica exista o no el email, y con límite de intentos.

Se puede usar la cola de tenancy-node (`tenancy.jobs`) para enviar el correo sin hacer esperar la petición. **Decisión pendiente:** qué servicio de correo usar.

### 2. Contenedor de MySQL local
`dental3d-mysql`, en el puerto **3307**, tiene la base central `dental3d_central` y las sucursales de prueba `dental_central` y `dental_sur`, con un ADMIN (`admin` / `Admin123!xyz`) en cada una.
- Detenerlo: `docker stop dental3d-mysql`
- Iniciarlo: `docker start dental3d-mysql`
- Empezar de cero: `docker rm -f dental3d-mysql`, volver a crearlo, `npm run db:install` y crear las sucursales.

### 3. Carpeta `server` excluida del ESLint del frontend
Se agregó `"server"` a `ignores` en `eslint.config.js`. Pendiente: darle a `server/` su propio ESLint y Prettier.

### 4. Archivos que aparecieron en la raíz
`package-lock.json` en la raíz y un reordenamiento de `src/routeTree.gen.ts`. Parecen salir de correr `npm install` o `npm run dev` en la raíz. **No se incluyen en los commits.** Se pueden descartar:
- `rm package-lock.json`
- `git checkout src/routeTree.gen.ts`

### 5. Otros
- Tests automáticos (Vitest + Supertest), con `@tenancy-node/testing` para crear sucursales de prueba, empezando en la Fase 2, donde están las reglas de dinero.
- Usar `pino` como logger de tenancy-node en producción y enviar los logs a un sistema donde se pueda filtrar por sucursal.

## Orden siguiente

1. ✅ Commit de la Fase 1, el plan, la Fase 1.5 (multi-sucursal, seguridad, velocidad y marca) en `dev`.
2. Avisar del bug de tenancy-node (sección [Reporte](#reporte-para-tenancy-node)).
3. Confirmar la regla de comisiones (Fase 2) y el servicio de correo.
4. Adelantar en `dev` lo urgente de la Fase 6: **descargar el logo** dentro del proyecto.
5. Empezar la Fase 2.
