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

## Fase 2 — Núcleo clínico y comisiones ✅ hecha

**Migración:** `db/tenant/003_clinico.sql` con `patients`, `studies`, `study_prices`, `patient_studies` y `commissions`, más sus índices. Aplicada a todas las sucursales con `npm run db:migrate`.

**Reglas que pasaron de trigger a código** (`src/services/attentions.ts`, todo en una transacción):

| Trigger de Supabase | En la API |
|---|---|
| `set_patient_study_price` | El precio sale de la tarifa activa (con o sin informe), leída dentro de la transacción. **El cliente no envía precios.** Se calculan también el recargo por factura (`invoice_surcharge_pct`) y el descuento por convenio del doctor (`agreement_discount_pct`), ambos sobre el precio base. |
| `deactivate_prev_prices` | Crear o activar una tarifa desactiva la anterior en la misma transacción. Además, un índice único sobre una columna generada impide que haya dos tarifas activas. |
| `calc_commission` | Igual que hoy: vale = 50 Bs fijos; doctor con porcentaje = su % del precio, o 50% en su primera atención; doctor sin porcentaje = comisión fija del estudio. En una atención con varios estudios, solo el primero cuenta como "primer paciente". |

**Endpoints:** `/api/patients`, `/api/studies`, `/api/studies/:id/prices`, `/api/study-prices/:id`, `/api/attentions` (registrar, cobrar, cobrar todo, entregar) y `/api/commissions` (con totales por doctor). Detalle en el README.

**Probado** con 33 verificaciones automáticas:
- Cálculo de precio, recargo, descuento, reparto del pago y comisiones.
- Una sola tarifa activa.
- Validaciones de cobro y entrega.
- Filtros por día local y paginación.
- Permisos por rol y aislamiento entre sucursales.
- Concurrencia.

En local, todas las listas responden en menos de 4 ms (p95).

**Mejoras y correcciones respecto a Supabase:**

1. **Cobro de más con doctores con convenio (bug del sistema actual).** El trigger aplica el descuento por convenio, pero el frontend calcula el total y el "pago completo" **sin** ese descuento, así que el paciente queda pagando de más. Ahora el servidor calcula el total y reparte el pago. Además, la base rechaza `amount_paid > total`.
2. **Doble 50% de "primer paciente" por concurrencia.** Dos atenciones simultáneas para un doctor nuevo podían cobrar ambas el 50%. Ahora se bloquea al doctor y la verificación usa una lectura con bloqueo (`FOR SHARE`), que ve los datos recién confirmados. Probado con peticiones simultáneas.
3. **Cobros simultáneos:** el saldo se lee con `FOR UPDATE`, así dos cobros a la vez no pueden pasarse del saldo.
4. **Días en hora de Bolivia:** los filtros `from`/`to` usan el día local (`BUSINESS_UTC_OFFSET=-04:00`). Supabase filtraba por día UTC: una atención a las 21:00 aparecía en el día siguiente. Probado en el límite de las 23:59:59 / 00:00:00.
5. **No se registran atenciones con estudios desactivados.**
6. **No se borran pacientes ni estudios con atenciones** (409, con mensaje para desactivarlos). El frontend decía "también elimina su historial", pero en Supabase igual fallaba por la clave foránea.
7. **Paginación y resúmenes en SQL:** pacientes, atenciones y comisiones ya no traen la tabla completa. Los totales (cobrado, saldo, comisiones por doctor) se suman en MySQL.

**Decisión pendiente (comisiones):** hoy el 50% del primer paciente **solo se aplica a doctores con porcentaje**, y no se puede combinar monto fijo con porcentaje. Se mantuvo igual que Supabase. Si cambia, se toca solo `commissionFor()` en `src/services/attentions.ts`.

**Notas:**
- El rol DOCTOR ve todas las comisiones (igual que hoy), porque los usuarios no están vinculados a un doctor. Si cada doctor solo debe ver las suyas, hay que vincular `users` ↔ `doctors` (Fase 4).
- MySQL debe correr en UTC (`--default-time-zone=+00:00`), porque `created_at` usa `CURRENT_TIMESTAMP`.

## Fase 3 — Finanzas, agenda y notificaciones ✅ hecha

**Migración:** `db/tenant/004_finanzas.sql` con:
- `cashbox` y `cashbox_state` (la fila del saldo);
- `bank_deposits`, `third_party_payments`;
- `appointments`;
- `notifications`, `notification_recipients`;
- el parámetro `cashbox_allow_negative`.

**Endpoints:** `/api/cashbox`, `/api/receipts`, `/api/deposits`, `/api/third-party-payments`, `/api/appointments` y `/api/notifications`. Detalle en el README.

**Probado** con 47 verificaciones automáticas, todas OK:
- caja chica (incluye 10 movimientos simultáneos);
- seguridad de comprobantes (firma, expiración, otra sucursal, SVG disfrazado, `../`, tamaño);
- fecha de servicio bloqueada;
- agenda (zona horaria, cruces, estados);
- notificaciones (contador, 304, leídas, permisos);
- permisos por rol y aislamiento entre sucursales.

La prueba de la Fase 2 se volvió a correr sin regresiones. En local, todo responde en menos de 3.1 ms (p95).

| Regla de Supabase | En la API |
|---|---|
| `set_cashbox_balance` (trigger) | Fila única `cashbox_state` bloqueada con `FOR UPDATE`: saldo = anterior + ingreso − gasto. |
| `prevent_service_date_change` (trigger) | `PATCH` de pagos a terceros rechaza cambiar `service_date` (`SERVICE_DATE_LOCKED`). |
| Bucket privado `receipts` | Almacenamiento privado por sucursal (`PRIVATE_STORAGE_DIR`) con enlaces firmados de 5 min, igual que `createSignedUrl`. |
| Supabase Realtime (campana) | `GET /api/notifications/unread-count` cada 30 s, con ETag/304. |
| `rpc("log_audit_event")` | Cada endpoint escribe su auditoría (`APPOINTMENT_*`, `NOTIFICATION_SEND`, etc.). |

**Mejoras y correcciones respecto a Supabase:**

1. **Saldo de caja con movimientos simultáneos.** El trigger leía "la última fila" sin bloqueo: dos movimientos a la vez podían calcular su saldo sobre el mismo anterior y la caja quedaba descuadrada. Ahora se bloquea una fila de saldo. Probado con 10 movimientos simultáneos: saldo exacto y sin saldos repetidos.
2. **Comprobantes más seguros:**
   - se valida el contenido real (imagen o PDF), sin SVG, máximo 5 MB;
   - el PDF se sirve con `CSP: sandbox`;
   - un comprobante de otra sucursal o inexistente no se puede asociar.
3. **Agenda:**
   - la hora se exige **con zona horaria**: el frontend actual usa la hora del navegador, que podría estar mal configurada;
   - se avisa (sin bloquear) si la cita se cruza con otra del mismo doctor.
4. **Montos en cero o negativos** rechazados en caja, depósitos y pagos.

**Decisiones para ti:**

- **Caja en negativo (cambio de comportamiento):** ahora **se rechaza** un gasto mayor al saldo. Supabase lo permitía. Se puede volver al comportamiento anterior con el parámetro `cashbox_allow_negative = 1`.
- **Movimientos de caja y depósitos sin edición ni borrado:** igual que el frontend actual. Las correcciones se hacen con un movimiento nuevo. Si hace falta anular, propongo un endpoint de "anulación" que registre el movimiento inverso, en vez de borrar.
- **AUDITOR no ve los comprobantes:** se mantuvo la regla del bucket de Supabase (ADMIN, SUBADMIN, CAJA, CONTABILIDAD). Si el auditor debe verlos, se agrega su rol.

**Pendiente de esta fase:**
- Limpiar los comprobantes subidos que nunca se asociaron a un depósito o pago (tarea programada con la cola de tenancy-node).
- **Respaldo** de `PRIVATE_STORAGE_DIR` junto con las bases de datos.
- Pasar a Server-Sent Events si 30 s de demora en la campana resulta mucho.

## Fase 4 — Administración, reportes y copia de datos ✅ hecha

**Migración:** `db/tenant/005_admin.sql` agrega `users.token_version` (versión de sesión) y un índice de auditoría por acción.

**Endpoints:** `/api/users`, `/api/roles`, `/api/params`, `/api/audit`, `/api/dashboard`, `/api/reports/summary` y `PATCH /api/auth/me`. Además, el script `npm run tenant:import-supabase`. Detalle en el README.

**Probado:**
- **46 verificaciones de la API: 45 OK.** Corrieron sobre una sucursal importada desde una base con la estructura de Supabase. La restante estaba mal planteada (el único ADMIN intentaba suplantarse a sí mismo y la API respondió "ya eres este usuario"). Se comprobó aparte, con un segundo ADMIN, que suplantar a un ADMIN se rechaza.
- **Importación** contra un PostgreSQL local con datos de ejemplo (`test/fixtures/supabase-fixture.sql`):
  - simulación y copia real;
  - comprobantes servidos por un servidor que imita Supabase Storage;
  - todas las sumas de dinero cuadran o su diferencia queda explicada;
  - segunda importación rechazada.
- Las pruebas de las Fases 2 y 3 se volvieron a correr sin regresiones.
- En local, todo responde en menos de 3 ms (p95).

### Usuarios y seguridad

| Antes (Supabase / Lovable) | Ahora |
|---|---|
| Todas las acciones exigían ser ADMIN (`assertAdmin`) | Permisos por acción (`users.create`, `users.edit`, `users.approve`, `users.manage_roles`, `users.delete`, `users.impersonate`). ADMIN los tiene todos. |
| Un rol por usuario en la pantalla | Varios roles por usuario (`PUT /api/users/:id/roles`). |
| Desactivar a alguien no cerraba su sesión | **Versión de sesión en el JWT:** contraseña nueva, desactivación, desaprobación o cambio de roles cierran **al instante** todas sus sesiones. |
| Cambiar la propia contraseña no cerraba otras sesiones | Cierra las demás y devuelve un token nuevo. |
| Suplantación con un "magic link" de Supabase | Token de 1 hora marcado como suplantación. Todo lo que se hace queda auditado con `_impersonated_by`. No se puede suplantar a un ADMIN ni encadenar suplantaciones. |

**Protecciones nuevas contra escalada de privilegios:**
- Solo un ADMIN puede dar o quitar el rol ADMIN, o tocar a otro ADMIN.
- Nadie puede eliminarse, desactivarse ni desaprobarse a sí mismo.
- Siempre queda al menos un ADMIN activo. Se verifica con bloqueo, así dos ADMIN no pueden quitarse el rol a la vez.

### Roles, parámetros y auditoría

- Al cambiar un permiso, vale desde la siguiente petición: se vacía la caché de la sucursal.
- El rol ADMIN no se edita (siempre tiene todos).
- Cada parámetro tiene su rango validado. Por ejemplo, un recargo de 200% se rechaza.
- La auditoría tiene filtros por fecha local, usuario, tabla, acción y registro, con paginación. Desde la API no se puede editar ni borrar.

### Dashboard y reportes

- Todo se suma en MySQL. El frontend actual traía **todas** las filas del período al navegador para sumarlas.
- **Agrupación por día local** (Bolivia), no por día UTC.
- **Corrección:** el dashboard actual suma solo el precio como "ingresos hoy". Ahora entrega lo facturado (precio + recargo − descuento) y lo cobrado por separado.
- **Controles nuevos**, además de los actuales (pacientes sin doctor, registros sin usuario, tarifas en cero):
  - entregas anteriores al registro;
  - pagos a terceros anteriores al servicio;
  - fechas futuras;
  - estudios activos sin tarifa;
  - atenciones cobradas de más.
- Caché de 1 h con una **versión de datos**: cualquier cambio exitoso la incrementa, así el reporte nunca sale desactualizado, ni siquiera el de un mes pasado al que se le cargó un depósito con fecha atrasada.

### Copia de datos desde Supabase (`npm run tenant:import-supabase`)

- Copia usuarios con sus contraseñas bcrypt (probado: se inicia sesión con la contraseña original), roles, la matriz de permisos personalizada, parámetros y todas las tablas, con los mismos IDs, en **una sola transacción**.
- `--dry-run` hace todo y deshace. Una sucursal que ya tiene datos se rechaza.
- Copia los comprobantes del bucket `receipts` al almacenamiento privado. Los que fallen quedan listados y se reintentan con `--receipts-only`.
- **Informe final:** conteos por tabla, sumas de dinero Supabase vs MySQL y observaciones.

**Lo que el script corrige o avisa** (todo queda listado en el informe):

| Caso en los datos de Supabase | Qué hace |
|---|---|
| Atención cobrada de más (bug del descuento por convenio) | Registra lo cobrado hasta el total y **lista el saldo a favor** de cada paciente, para devolverlo o aplicarlo. |
| Saldo de caja descuadrado (bug de movimientos simultáneos) | Conserva el saldo guardado e informa el saldo recalculado, para que se registre un ajuste. |
| Movimientos de caja, depósitos o pagos en cero | No se importan (no afectan saldos). |
| Usuarios que solo difieren en mayúsculas | Renombra el segundo (`recep-3`): MySQL no distingue mayúsculas. |
| Usuario sin contraseña bcrypt | Se importa sin poder entrar hasta que un ADMIN le asigne una. |
| Cita con duración o estado inválido | Ajusta la duración y pone el estado `SCHEDULED`. |
| Referencias a usuarios borrados | Quedan en NULL. El historial se conserva y la auditoría guarda el id original. |

### Decisiones para ti

- **Saldo de caja al importar:** ¿se deja el saldo **guardado** (lo que hoy ve la clínica) o el **recalculado** (la suma real de los movimientos)? Por defecto se deja el guardado y se informa la diferencia.
- **Saldos a favor por sobrepago:** ¿se devuelven, o se registran como crédito del paciente? Hoy solo se listan.
- **DOCTOR ve las comisiones de todos:** para que cada doctor vea solo las suyas, hay que vincular `users` ↔ `doctors`. No se hizo, para no cambiar el comportamiento sin tu decisión.

### Pendiente

- **Administración de sucursales desde la interfaz**, en vez de la CLI: el panel de tenancy-node (`@tenancy-node/admin-api` / `admin-ui`), detrás de VPN.
- Recuperar contraseña por email (sigue esperando la elección del servicio de correo).
- Probar la importación contra la **base real de Supabase** con `--dry-run`. Necesita la cadena de conexión del proyecto (Lovable Cloud → Supabase → Database).

## Fase 5 — Cambiar el frontend y salir a producción

### 5.1 Frontend sobre la API ✅ hecho (rama `dev`)

**Ninguna pantalla usa ya Supabase.** Solo queda la carpeta `src/integrations/supabase/`, que no importa nadie y se borra en la Fase 6. Se eliminó `src/lib/users-admin.functions.ts` (las funciones de servidor de Lovable).

**Base:**
- `src/lib/api.ts`: cliente de la API.
  - Guarda el token y lo envía en cada petición.
  - Maneja los errores en español y la paginación.
  - Si la sesión se cierra (por ejemplo, `SESSION_REVOKED`), vuelve al login.
- `src/lib/auth.tsx`: sesión sobre `/api/auth/*`. Mantiene la misma interfaz (`can`, `hasRole`, `hasAny`, `user`, `roles`), así las pantallas casi no cambiaron. Ahora `can()` usa solo los permisos que entrega la API.
- `src/lib/branding.tsx`: nombre, contacto, logo y color de la sucursal desde `/tenancy/me`, aplicados a las variables de shadcn (solo en modo claro).
- `src/lib/query-config.ts`: tiempos de caché de React Query por tipo de dato:

  | Tipo de dato | Tiempo |
  |---|---|
  | Catálogos | 10 min |
  | Maestros | 2 min |
  | Operación diaria | 20 s |
  | Dinero | 0 |

  Antes eran 5 minutos para todo.
- `vite.config.ts`: en desarrollo, `/api` y `/tenancy` se reenvían a la API **conservando el host**. Se abre `http://central.localhost:8080`.
- **Logo original rescatado** del CDN de Lovable (`src/assets/logo-3d.png`). Es el logo por defecto de las sucursales sin logo propio.

**Pantallas convertidas (todas):** login y registro, perfil, portada, dashboard, doctores, pacientes y su ficha, estudios y tarifas, atenciones, entregas, agenda, comisiones, caja, depósitos, pagos a terceros, reportes, usuarios, roles, parámetros, auditoría, notificaciones y la campana.

**Nueva pantalla:** "Marca de la sucursal" (`/app/branding`, permiso `branding.edit`): nombre, dirección, teléfono, color principal y logo.

**Correcciones visibles para el usuario:**

| Pantalla | Antes | Ahora |
|---|---|---|
| Atenciones | El total y el "pago completo" **no restaban el descuento por convenio**: se cobraba de más | La vista previa muestra "Desc. convenio (x%)" y cobra el total correcto. El servidor lo vuelve a calcular. |
| Dashboard | "Ingresos hoy" sumaba solo el precio | "Facturado hoy" (precio + recargo − descuento) y "Cobrado hoy" |
| Agenda, comisiones, auditoría, reportes | Días y horas en UTC | Días y horas en la hora local |
| Pacientes, auditoría, caja, depósitos, pagos | Traían la tabla completa | Búsqueda y páginas en el servidor |
| Usuarios | Un solo rol por usuario | Varios roles, estado activo/inactivo, reglas de contraseña visibles |
| Notificaciones | Tiempo real de Supabase | La campana consulta cada 30 s (responde 304 si no hay cambios). Se agregaron "marcar todas como leídas" y el remitente. |
| Comprobantes | Solo imágenes | Imágenes y PDF (≤ 5 MB), con enlace firmado de 5 minutos |
| Reportes | — | Controles nuevos: fechas incoherentes, estudios sin tarifa, cobros de más |
| Login | Solo email | Email o usuario. En una dirección sin sucursal, pide entrar por el subdominio. |
| Recuperar contraseña | Email de Supabase | Pantalla que indica pedirla a un ADMIN (falta elegir el servicio de correo) |

**Cambios en la API para el frontend:**
- `GET /api/public/studies`: estudios de la portada, sin precios.
- `GET /api/notifications/:id/recipients`: quién leyó cada notificación enviada.
- Teléfono del paciente en la lista de atenciones.
- Color por defecto `#0F172A`, para que la app se vea igual que antes mientras una sucursal no elija sus colores.

**Probado en el navegador** (Chrome, sucursal `central` en `central.localhost`):
- Login, dashboard, pacientes, estudios, agenda (hora local), comisiones, caja, entregas, reportes (día local), usuarios y auditoría.
- **Registro de una atención con convenio:** la vista previa mostró 300 + 39 − 30 = 309 y el servidor registró 309.
- Marca: el cambio de color se aplica al instante, y un color inválido se rechaza.
- La sucursal `sur` muestra su propio nombre y color.
- Sin errores en la consola. Solo aparece un aviso de "hydration" de desarrollo, por haber cambiado `__root.tsx` con el servidor encendido.
- **No probado en pantalla:** "Ingresar como" otro usuario, porque usa una confirmación nativa del navegador. Está probado en la API.
- TypeScript compila sin errores nuevos. El único error, en `src/routes/__root.tsx`, ya existía.

**Pendientes del frontend:**
- "Ingresar como" y otras confirmaciones usan `confirm()` del navegador: conviene pasarlas a `AlertDialog`.
- La ficha del paciente oculta doctores y citas para roles sin acceso a esos datos (DOCTOR, CAJA, CONTABILIDAD). Decidir si esos roles deben verlos.
- El reporte ya entrega pacientes nuevos, ingresos por estudio y comisiones por doctor, pero la pantalla todavía no los muestra.
- Lista de proveedores para el autocompletado de pagos a terceros (hoy usa los últimos 500 pagos).
- Corregir el error de tipos que ya existía en `src/routes/__root.tsx` (`errorComponent`).

### 5.2 Salir a producción — preparado ✅ (falta publicar)

Decisión: **servidor propio** (nginx + systemd). Por ahora solo se dejó listo compilar y publicar; no se publicó nada. Guía paso a paso: [`deploy/DEPLOY.md`](../deploy/DEPLOY.md).

**Hecho y probado en local** con el mismo esquema que producción (API compilada + frontend compilado + nginx real en Docker con `deploy/nginx/dental3d.conf`):
- **Frontend:** `npm run build` genera un **servidor Node** (`.output/server/index.mjs`, preset `node-server`) en lugar de Cloudflare. Dentro de Lovable se sigue forzando Cloudflare.
- **Backend:** `npm run build` compila a `dist/`.
  - La CLI de tenancy-node y `pg` pasaron a dependencias de producción.
  - Scripts compilados `prod:create-admin` y `prod:import-supabase`.
  - Instalación de producción simulada con `npm ci --omit=dev`: la CLI y los scripts funcionan sin `tsx`.
  - Nueva variable `HOST` para escuchar solo en `127.0.0.1`.
- **nginx** (`deploy/nginx/dental3d.conf`):
  - Subdominio comodín, `/api` y `/tenancy` a la API conservando el `Host`, y el resto al frontend.
  - Límite de 6 MB, HSTS, `/api/health` solo local.
  - Pasa `nginx -t` también con TLS.
  - Probado: login y dashboard en el navegador, sucursales distintas, sucursal inexistente (404) y cuerpo de 7 MB (413).
- **systemd:** `deploy/systemd/dental3d-api.service` y `dental3d-web.service`, con apagado ordenado y endurecimiento.
- **Respaldos:** `deploy/backup.sh` respalda la base central, cada sucursal y los archivos, conservando 30 días.

**Encontrado al probar:** un `add_header` dentro de un bloque `location` de nginx anula los encabezados de seguridad del servidor (HSTS, nosniff). Se quitó ese bloque; el frontend ya entrega `/assets/*` con caché de 1 año.

**Falta (lo haces tú en el servidor):**
- DNS comodín.
- MySQL en UTC con el usuario `tenancy_admin`.
- `.env` de producción.
- Certificado comodín.
- Activar los servicios y el cron de respaldos.
- El día del corte: importar desde Supabase.

Todo está en `deploy/DEPLOY.md`.

Pasos originales de esta fase:

- **Un subdominio por sucursal**, y el frontend y la API **en el mismo host**: nginx manda `/api` y `/tenancy` a Node y el resto al frontend. Así `/tenancy/me` y el login reconocen la sucursal por el host.
- Publicar la API con:
  - MySQL administrado en UTC;
  - HTTPS con un certificado comodín (`*.dental3d.com`);
  - `TRUST_PROXY=1`;
  - respaldos automáticos diarios **de cada base** (`tenancy run "mysqldump ..."` recorre todas las sucursales) y de `PRIVATE_STORAGE_DIR`.
- Publicar el frontend: build de Node, sin el destino Cloudflare de Lovable (Fase 6).
- **El día del corte:**
  1. Congelar cambios en Supabase.
  2. `npm run tenant:import-supabase -- <sucursal> --dry-run`, revisar el informe.
  3. Importación real.
  4. Publicar.
  5. Recién entonces unir `dev` a `main`.

## Fase 6 — Eliminar todo lo de Lovable

**¿Por qué al final y no ahora?** Hoy el frontend necesita Lovable para funcionar: el login y los datos están en Lovable Cloud (Supabase), Vite se configura con un paquete de Lovable y el logo está guardado en los servidores de Lovable. Si se borra antes de la Fase 5, la app deja de funcionar. Lo que sí se puede adelantar en `dev` está marcado como **(se puede adelantar)**.

### 6.1 En el código

| Qué | Dónde | Acción |
|---|---|---|
| Configuración de Vite | `vite.config.ts` | Reemplazar `@lovable.dev/vite-tanstack-config` por los plugins directos: `tanstackStart`, `viteReact`, `tailwindcss`, `tsConfigPaths` y `nitro`. Publicar en Node en vez de Cloudflare. Quitar el `componentTagger` y los plugins de Lovable. **(se puede adelantar)** |
| Dependencias | `package.json` | Quitar `@lovable.dev/vite-tanstack-config` y, después de la Fase 5, `@supabase/supabase-js`. Cambiar el nombre `tanstack_start_ts` por `dental-3d`. **(se puede adelantar, salvo Supabase)** |
| Gestor de paquetes | `bunfig.toml`, `bun.lock`, `package-lock.json` | Elegir **uno solo**, borrar el lockfile del otro y quitar de `bunfig.toml` las excepciones de `@lovable.dev/*`. **(se puede adelantar)** |
| Reporte de errores | `src/lib/lovable-error-reporting.ts`, `src/routes/__root.tsx` | Borrar el archivo y reemplazar `reportLovableError` por `console.error`, o por Sentry. **(se puede adelantar)** |
| **Logo** | `src/assets/logo-3d.png.asset.json` | ✅ El PNG real ya está en `src/assets/logo-3d.png` y es el logo por defecto; el `.asset.json` se eliminó. |
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
- **Refresh tokens** o un JWT más corto (1–2 h). ✅ Ya se revocan las sesiones al cambiar la contraseña, desactivar o cambiar roles (Fase 4).
- **2FA** para ADMIN (TOTP).
- ✅ **Archivos privados** fuera de `tenancy.storage()`, con enlaces firmados (Fase 3). En producción con varias réplicas: S3 privado con URLs prefirmadas.
- **Dependencias:** `npm audit` en CI y fijar tenancy-node a una versión exacta.
- **Respaldos** automáticos de cada base y prueba de restauración mensual.

## Caché y velocidad

**Regla de oro:** se cachea lo que **se lee mucho y cambia poco**. El dinero (saldo de caja, precios al registrar, comisiones) **siempre se calcula leyendo la base dentro de la transacción**, nunca desde la caché.

### Capa 1 — Caché de la API (`tenancy.cache()`, aislada por sucursal)

Implementada en `src/lib/cache.ts`. Las llaves llevan el prefijo de la sucursal automáticamente (`tenant:sur:...`), así que una sucursal nunca lee la caché de otra.

| Dato | Llave | TTL | Se borra cuando… | Estado |
|---|---|---|---|---|
| Sesión: activo, aprobado, versión, roles, permisos | `auth:<userId>` | 60 s | se edita, aprueba, desactiva o elimina el usuario, o cambian sus roles | ✅ |
| Permisos por combinación de roles | `perms:<roles>` | 10 min | se edita `role_permissions` (se vacía la caché de la sucursal) | ✅ |
| Lista de doctores | `doctors:list` | 5 min | se crea, edita o elimina un doctor | ✅ |
| Parámetros (`app_params`) | `params` | 10 min | se edita un parámetro | ✅ |
| Estudios + tarifa activa (para mostrar) | `studies:list` | 10 min | se crea, edita o borra un estudio o una tarifa | ✅ |
| Reportes (cualquier período) | `report:<versión>:<tipo>:<desde>:<hasta>` | 1 h | cualquier cambio de datos incrementa la versión | ✅ |

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
  | `/api/studies` (caché) | 1.7 ms | 2.1 ms |
  | `/api/patients` (50 por página) | 2.3 ms | 2.8 ms |
  | `/api/attentions` (50 por página + resumen) | 2.6 ms | 3.4 ms |
  | `/api/commissions` (+ totales por doctor) | 2.5 ms | 2.9 ms |
  | `/api/cashbox` (50 por página + saldo) | 2.4 ms | 3.1 ms |
  | `/api/deposits` | 2.1 ms | 2.3 ms |
  | `/api/appointments` (un mes) | 2.2 ms | 2.6 ms |
  | `/api/notifications/unread-count` | 2.0 ms | 2.4 ms |

- **Objetivo en producción:** p95 < 100 ms en lecturas y < 20 ms en catálogos cacheados. Repetir la medición con datos reales (`autocannon`) en cada fase.

## Rendimiento y base de datos

### Ya implementado ✅

- Índices de la Fase 1: `doctors(status, full_name)`, `doctors(full_name)`, `audit_logs(user_id, timestamp)`, `audit_logs(table_name, record_id)`, `audit_logs(timestamp)`.
- Índices de la Fase 2:
  - `patients(full_name)`, `patients(doctor_id)`, `patients(phone)`, `patients(created_at)`
  - `patient_studies(patient_id, created_at)`, `patient_studies(created_at)`, `patient_studies(doctor_id, created_at)`, `patient_studies(study_id)`, `patient_studies(delivered_at)`
  - `study_prices(study_id, is_active)` + único de tarifa activa
  - `commissions(doctor_id, created_at)`, `commissions(created_at)` + único por atención
- Paginación (máximo 500 por página) en pacientes, atenciones y comisiones.
- Dinero calculado en centavos enteros (`src/lib/money.ts`), con el mismo redondeo que `ROUND(numeric, 2)` de PostgreSQL.
- Restricciones `CHECK` en la base: montos no negativos, no pagar más que el total, comisión de doctor ≤ 20%.
- Índices de la Fase 3:
  - `cashbox(seq)` único, `cashbox(created_at)`
  - `bank_deposits(deposit_date)`
  - `third_party_payments(payment_date)`, `third_party_payments(provider_name)`
  - `appointments(starts_at)`, `appointments(patient_id)`, `appointments(doctor_id, starts_at)`
  - `notification_recipients(user_id, read_at)`, `notification_recipients(user_id, created_at)`
- Saldo de caja en O(1): una fila (`cashbox_state`) en vez de buscar el último movimiento.
- Pools por sucursal de tenancy-node: 5 conexiones por sucursal, hasta 100 pools abiertos y cierre tras 60 s sin uso.
- Tipos iguales a PostgreSQL: TINYINT(1) → boolean, DATE → `'YYYY-MM-DD'` sin conversión de zona horaria, DECIMAL → número.
- Apagado ordenado: se terminan las peticiones en curso y se cierran los pools.

### En cada fase

- **Paginación** en auditoría (Fase 4), igual que en pacientes, atenciones, caja, depósitos y pagos.
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
`dental3d-mysql`, en el puerto **3307**, tiene la base central `dental3d_central` y las sucursales de prueba `dental_central` y `dental_sur`, con un ADMIN (`admin` / `Admin123!xyz`) en cada una. `dental_central` tiene datos de prueba de la Fase 2. El contenedor actual se creó sin `--default-time-zone=+00:00`, pero la imagen ya usa UTC por defecto; al recrearlo, usar el comando del README.
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
- Tests automáticos en el repo (Vitest + Supertest), con `@tenancy-node/testing` para crear sucursales de prueba. Las verificaciones de las Fases 2 (33), 3 (47) y 4 (46, más la importación) se corrieron con scripts locales. Conviene pasarlas al repo antes de la Fase 5. La base de ejemplo de Supabase ya está en `test/fixtures/`.
- Usar `pino` como logger de tenancy-node en producción y enviar los logs a un sistema donde se pueda filtrar por sucursal.

## Orden siguiente

1. ✅ Commit de la Fase 1, el plan y la Fase 1.5 en `dev`.
2. ✅ Fase 2 (núcleo clínico y comisiones) en `dev`.
3. ✅ Fase 3 (finanzas, agenda y notificaciones) en `dev`.
4. ✅ Fase 4 (usuarios, roles, parámetros, auditoría, reportes y copia de datos) en `dev`.
5. Avisar del bug de tenancy-node (sección [Reporte](#reporte-para-tenancy-node)).
6. Decidir:
   - regla de comisiones;
   - servicio de correo;
   - caja en negativo y anulaciones;
   - comprobantes para AUDITOR;
   - saldo de caja y saldos a favor al importar;
   - comisiones por doctor.
7. Correr la importación contra la base real de Supabase con `--dry-run` y revisar el informe.
8. Pasar las pruebas de las Fases 2 a 4 a tests automáticos en el repo.
9. ✅ Logo descargado dentro del proyecto (`src/assets/logo-3d.png`).
10. ✅ Fase 5.1: el frontend usa la API (rama `dev`).
11. ✅ Fase 5.2 preparada para servidor propio (`deploy/`). Falta publicar: seguir `deploy/DEPLOY.md`.
12. Fase 6: quitar Lovable. Incluye elegir **un** gestor de paquetes y subir su lockfile, para builds reproducibles.
