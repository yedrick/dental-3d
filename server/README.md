# API Dental-3D (Node + Express + MySQL + tenancy-node)

Backend propio que reemplaza a Supabase, **multi-sucursal** con [tenancy-node](https://github.com/yedrick/tenat-node) v0.8.0:

- Cada **sucursal es un tenant** y tiene su **propia base MySQL** (`dental_<sucursal>`), con un **usuario MySQL propio** que solo puede entrar a esa base.
- La sucursal se identifica por **subdominio**: `sur.dental3d.com` → sucursal `sur`. En local: `sur.localhost:4000`.
- Caché, archivos (logo) y logs van **aislados por sucursal**.

Fases y pendientes: [PLAN.md](PLAN.md). Errores y mejoras para el equipo de tenancy-node: [TENANCY-NODE-REPORTE.md](TENANCY-NODE-REPORTE.md). Publicar en un servidor propio: [deploy/DEPLOY.md](../deploy/DEPLOY.md).

## Requisitos

- Node.js 20+
- MySQL 8.0.13+ (usa `DEFAULT (UUID())`)
- Docker (opcional, para el MySQL local)

## Puesta en marcha (local)

Probado desde cero el 12/10/2026 (copia limpia del repositorio y base vacía): panel, crear sucursales, "Entrar como", activar cuenta, doctor, atención, caja, página web y aislamiento entre sucursales, 15/15.

**1. MySQL.** Usa el de Docker o el tuyo.

```sh
cd server
docker compose up -d          # MySQL 8.4 en el puerto 3307, ya en UTC (usuario root / root_dev_password)
```

Con **tu propio MySQL** (8.0.13 o más nuevo; probado también con MySQL 26.7 de Homebrew/FlyEnv):
- No hace falta cambiar su zona horaria ni su `sql_mode`: la app fija **UTC y modo estricto en sus propias conexiones** (`src/tenancy/mysql-session.ts`), sin tocar las otras bases que tengas en ese MySQL.
- Las sucursales se crean como bases `dental_<id>` en ese mismo MySQL.
- Si `root` no tiene contraseña (FlyEnv), la URL queda `mysql://root@127.0.0.1:3306/<base central>`. Para algo más que pruebas, mejor un usuario dedicado:

```sql
CREATE DATABASE dental3d_central CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'tenancy_admin'@'localhost' IDENTIFIED BY 'una-contraseña-larga';
GRANT ALL PRIVILEGES ON `dental3d_central`.* TO 'tenancy_admin'@'localhost';
GRANT ALL PRIVILEGES ON `dental\_%`.* TO 'tenancy_admin'@'localhost' WITH GRANT OPTION;
GRANT CREATE USER ON *.* TO 'tenancy_admin'@'localhost';
```

**2. Backend.**

```sh
npm install                   # instala tenancy-node desde GitHub Releases
cp .env.example .env
npx tenancy key:generate      # copia el resultado (base64:...) en TENANCY_KEY
```

En `.env` cambia:

| Variable | Valor en local |
|---|---|
| `DATABASE_URL` | Docker: `mysql://root:root_dev_password@127.0.0.1:3307/dental3d_central`. Tu MySQL: `mysql://tenancy_admin:<contraseña>@127.0.0.1:3306/dental3d_central` |
| `TENANCY_KEY` | la que generaste. **Guárdala**: sin ella no se abren las bases de las sucursales |
| `JWT_SECRET` | `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `TENANCY_ADMIN_SECRET` | `openssl rand -base64 48` (enciende el panel `/admin`) |
| `CORS_ORIGIN` | `http://localhost:8080` |
| `ADMIN_SECURE_COOKIES` | `false` (en local no hay HTTPS) |
| `TENANT_PUBLIC_URL` | `http://{tenant}.localhost:8080` |
| `REDIS_URL` | vacío está bien en local (caché en memoria) |

```sh
npm run db:install                                       # tablas de la base central
OWNER_PASS='<12+ caracteres>' npx tenancy admin:user tu@email.com --role=owner --password-env=OWNER_PASS
npm run dev                                              # API en http://localhost:4000
```

**3. Frontend** (en otra terminal, desde la raíz del repo):

```sh
npm install                   # la primera vez tarda (~10 min con npm: no hay package-lock, ver Fase 6)
npm run dev                   # http://localhost:8080 (reenvía /api, /tenancy y /admin a la API)
```

**4. Usarlo:**
- **Panel de la plataforma:** http://localhost:8080/admin/. Ahí creas las sucursales (por ejemplo `calacoto` y `chasquipampa`), configuras el tema y el logo, creas usuarios y usas "Entrar como".
- **Cada sucursal:** http://calacoto.localhost:8080 (portada pública) y http://calacoto.localhost:8080/auth (login). La primera vez, entra con "Entrar como" desde el panel: la app pide activar la cuenta del ADMIN (email, usuario y contraseña).
- **No hace falta tocar `/etc/hosts`:** Chrome, Firefox, Edge y `curl` ya resuelven `*.localhost` a tu máquina. Solo si quieres otro dominio local (ej. `calacoto.dental.test`) agrega una línea por sucursal en `/etc/hosts` (`127.0.0.1 calacoto.dental.test`) y pon ese dominio en `CENTRAL_DOMAINS`.

**Por terminal** (en vez del panel): `npm run tenant:create -- calacoto --name="Calacoto"` y `ADMIN_PASSWORD='...' npm run tenant:create-admin -- calacoto admin@clinica.com admin "Nombre Apellido"`.

**Pruebas:** ver `test/README.md` (API, masivas, navegador y k6).

## Comandos

| Comando | Qué hace |
|---|---|
| `npm run dev` / `build` / `start` | Desarrollo con recarga / compilar a `dist/` / producción (`node dist/index.js`) |
| `npm run prod:create-admin` / `prod:import-supabase` | Versiones compiladas de los scripts, para el servidor (sin `tsx`) |
| `npm run db:install` | Tablas `tenancy_*` en la base central (idempotente) |
| `npm run db:migrate` | Aplica las migraciones pendientes de `db/tenant/` en **todas** las sucursales |
| `npm run tenant:create -- <id> --name="..."` | Crea una sucursal: base, usuario MySQL y migraciones |
| `npm run tenant:list` | Lista las sucursales |
| `npm run tenant:create-admin -- <id> <email> <usuario> "<nombre>"` | Crea o asciende el ADMIN de una sucursal (contraseña en `ADMIN_PASSWORD`) |
| `npm run tenant:import-supabase -- <id> [--dry-run]` | Copia los datos de Supabase a una sucursal nueva (ver [Copiar datos desde Supabase](#copiar-datos-desde-supabase)) |
| `npx tenancy --help` | Toda la CLI de tenancy-node: `migrate:status`, `rollback`, `delete`, `move`, etc. |

**Cambios de base de datos:** se agrega un archivo nuevo en `db/tenant/` (`003_algo.sql`, ...) y se corre `npm run db:migrate`. Nunca se edita una migración ya aplicada.

## Estructura

```
server/
├── tenancy.config.ts        config que lee la CLI (npx tenancy)
├── db/tenant/               migraciones de la base de CADA sucursal
│   ├── 001_schema.sql       usuarios, roles, permisos, doctores, auditoría
│   ├── 002_seed.sql         permisos, permisos por rol y parámetros
│   ├── 003_clinico.sql      pacientes, estudios, tarifas, atenciones, comisiones
│   ├── 004_finanzas.sql     caja chica, depósitos, pagos a terceros, citas, notificaciones
│   ├── 005_admin.sql        versión de sesión de usuarios, índice de auditoría
│   ├── 006_default_admin.sql  cuenta "por activar" (ADMIN por defecto de cada sucursal)
│   └── 007_site.sql         contenido de la página web pública
└── src/
    ├── index.ts             arranque y apagado ordenado
    ├── app.ts               Express: seguridad, compresión, tenancy, rutas
    ├── config.ts            variables de entorno
    ├── db.ts                consultas y transacciones en la base de la sucursal actual
    ├── tenancy/             configuración e instancia de tenancy-node
    ├── middleware/
    │   ├── auth.ts          requireTenant, requireAuth (JWT ligado a la sucursal), permisos
    │   ├── rate-limit.ts    límites de intentos (login, registro, contraseña)
    │   └── error.ts         errores { error: { code, message } } en español
    ├── lib/                 audit, cache, files, money, permissions, private-storage, query, schemas, http-error
    ├── services/
    │   └── attentions.ts    precio, recargo, descuento y comisión (antes triggers)
    ├── routes/              auth, doctors, patients, studies, attentions, commissions, cashbox,
    │                        finance (depósitos y pagos a terceros), receipts, appointments,
    │                        notifications, users, roles, params, audit, reports (dashboard), branding
    └── scripts/             create-admin.ts, import-supabase.ts
test/fixtures/               base de ejemplo con estructura de Supabase (para probar la importación)
test/api/                    pruebas de la API por fase (Python, contra un servidor corriendo)
test/massive/                prueba masiva (N sucursales a la vez) y prueba de carga
test/e2e/                    pruebas en navegador (Playwright + Chrome): panel y flujo completo
test/k6/                     carga, estrés, capacidad y velocidad de páginas con k6 (ver test/k6/README.md)
                             (ver test/README.md)
```

## Endpoints

Todas las rutas `/api/*` (salvo `/api/health`) se llaman **desde el subdominio de la sucursal**. Las que llevan 🔒 requieren `Authorization: Bearer <token>`.

Los errores siempre tienen la misma forma (igual que tenancy-node):

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Datos inválidos", "details": [ ... ] } }
```

### Públicas (tenancy-node)

| Método | Ruta | Qué devuelve |
|---|---|---|
| GET | `/tenancy/me` | Nombre, dirección y teléfono de la sucursal, y su tema (colores y URL del logo) |
| GET | `/tenancy/theme.css` | Variables CSS: `--color-primary`, `--color-secondary`, `--radius`, ... |
| GET | `/tenancy/assets/branding/...` | El logo de la sucursal |
| GET | `/api/health` | `{ ok }`, sin detalles internos (para el balanceador) |

### Autenticación

| Método | Ruta | Descripción |
|---|---|---|
| POST | `/api/auth/register` | `{ email, password, username, full_name }`. Queda como RECEPCION **pendiente de aprobación**. Máximo 5 por hora por IP |
| POST | `/api/auth/login` | `{ login, password }` (email o usuario) → `{ token }`. Máximo 10 intentos cada 15 min por IP y sucursal |
| GET 🔒 | `/api/auth/me` | Perfil, roles, permisos, sucursal e `impersonated_by` |
| PATCH 🔒 | `/api/auth/me` | `{ full_name?, username? }`: el usuario edita su propio perfil |
| POST 🔒 | `/api/auth/change-password` | `{ current_password, new_password }` → `{ token }` nuevo; **cierra las demás sesiones** |
| GET | `/api/auth/impersonate?token=` | Canjea el token de "Entrar como…" del panel y redirige a `/auth/impersonate#token=…` |
| POST 🔒 | `/api/auth/setup-account` | `{ full_name, username, email, new_password }`: activa la cuenta ADMIN por defecto (solo si está "por activar") |

| GET | `/api/auth/password-reset` | `{ enabled, minutes }`: si la recuperación por correo está activada |
| POST | `/api/auth/forgot-password` `{ email }` | Envía un código de 6 dígitos (15 min). Responde igual exista o no el email. Máx. 5 por 15 min por IP y 1 por minuto por usuario |
| POST | `/api/auth/reset-password` `{ email, code, new_password }` | Cambia la contraseña, cierra las demás sesiones y devuelve `{ token }`. 5 intentos por código |

El token **solo sirve en la sucursal que lo emitió**. Además lleva la versión de sesión del usuario: al cambiar su contraseña, desactivarlo, desaprobarlo o cambiar sus roles, **todas sus sesiones se cierran** (`SESSION_REVOKED`).

### Doctores 🔒

| Método | Ruta | Permiso |
|---|---|---|
| GET | `/api/doctors` (lista completa, en caché, header `X-Cache`) | roles ADMIN, SUBADMIN, RECEPCION, CAJA, CONTABILIDAD, AUDITOR |
| GET | `/api/doctors?q=texto&status=true` (búsqueda, sin caché) | ídem |
| GET | `/api/doctors/:id` | ídem |
| POST | `/api/doctors` | `doctors.create` |
| PATCH | `/api/doctors/:id` (parcial, p. ej. `{ "status": false }`) | `doctors.edit` |
| DELETE | `/api/doctors/:id` | `doctors.delete` |

### Listas paginadas

Pacientes, atenciones y comisiones usan `?page=1&limit=50` (máximo 500) y responden:

```json
{ "data": [ ... ], "page": 1, "limit": 50, "total": 120, "pages": 3, "summary": { ... } }
```

Los filtros `from` y `to` (`YYYY-MM-DD`) son **días en la hora de la clínica** (`BUSINESS_UTC_OFFSET`, Bolivia -04:00).

### Pacientes 🔒

| Método | Ruta | Permiso |
|---|---|---|
| GET | `/api/patients?q=&doctor_id=&status=&sort=recent\|name&page=&limit=` (`doctor_id=none`: los que no tienen doctor) | roles ADMIN, SUBADMIN, RECEPCION, CAJA, CONTABILIDAD, DOCTOR, AUDITOR |
| GET | `/api/patients/:id` (con `doctor_name`) | ídem |
| GET | `/api/patients/:id/attentions` (historial con `total` y `debt`) | ídem |
| POST | `/api/patients` (`doctor_id` **opcional**: sin doctor, sus atenciones van sin comisión ni descuento por convenio) | `patients.create` |
| PATCH | `/api/patients/:id` | `patients.edit` |
| DELETE | `/api/patients/:id` (409 si tiene atenciones: desactivarlo) | `patients.delete` |

### Estudios y tarifas 🔒

| Método | Ruta | Permiso |
|---|---|---|
| GET | `/api/studies?active=true` (con tarifa activa, en caché 10 min) | cualquier usuario |
| GET | `/api/studies/:id` · `/api/studies/:id/prices` (historial) | cualquier usuario |
| POST · PATCH · DELETE | `/api/studies` · `/api/studies/:id` (DELETE: 409 si tiene atenciones) | `studies.create` / `studies.edit` |
| POST | `/api/studies/:id/prices` `{ price_with_report, price_without_report, effective_date, is_active }` | `studies.edit` |
| PATCH · DELETE | `/api/study-prices/:id` | `studies.edit` |
| POST | `/api/studies/import` `{ filas, fecha_vigencia, aplicar }`: **carga masiva desde Excel** (ver abajo) | `studies.create` y `studies.edit` |

**Una sola tarifa activa por estudio:** al crear o activar una tarifa, la anterior se desactiva en la misma transacción (y un índice único lo garantiza en la base).

**Carga masiva (Excel), por sucursal.** En la app: Estudios y tarifas → "Carga masiva (Excel)".
- **Plantilla:** trae los estudios y las tarifas actuales de la sucursal, con las columnas *Nombre del estudio · Descripción · Precio con informe · Precio sin informe · Comisión fija · Activo (SI/NO)* y una hoja de instrucciones.
- **Lectura:** el navegador lee el Excel y manda las filas en JSON (máximo 2000). Acepta `150`, `150,50` y `1.250,00`.
- **Coincidencia:** por **nombre**, sin importar mayúsculas, tildes ni espacios. Si el nombre ya existe, se actualiza; si no, se crea.
- **Precios:** si cambian, se crea una **tarifa nueva** con la fecha de vigencia elegida y la anterior queda en el historial.
- **Celdas vacías:** en un estudio existente no cambian nada.
- **Vista previa:** con `aplicar: false` solo devuelve el plan (crear, actualizar, tarifas nuevas, sin cambios) y los **errores con su número de fila**.
- **Aplicar:** con `aplicar: true` se ejecuta en una transacción, **todo o nada**: si hay un solo error, no se guarda ninguna fila.

### Atenciones 🔒

| Método | Ruta | Permiso |
|---|---|---|
| GET | `/api/attentions?from=&to=&q=&patient_id=&doctor_id=&status=debt\|paid\|pending_delivery\|delivered` (con `summary`: total, pagado, saldo) | `view.attention`, `view.delivery` o `view.patients` |
| GET | `/api/attentions/payments?from=&to=&patient_id=&attention_id=` (pagos: fecha, monto, método, quién) | ídem |
| POST | `/api/attentions` (`external_doctor`: doctor no registrado, ver abajo) | `attention.create` |
| POST | `/api/attentions/:id/charge` `{ amount, payment_method }` (efectivo si no se indica) | `attention.charge` |
| POST | `/api/attentions/charge-all` `{ patient_id, payment_method }` | `attention.charge` |
| POST | `/api/attentions/deliver` `{ ids: [...] }` | `attention.deliver` |

**Pagos (migración 009).** Cada cobro queda en la tabla `payments`, con su fecha, monto, método (efectivo, QR o tarjeta), origen y quién lo registró. Hay tres orígenes: al registrar la atención, cobro de saldo y cobrar todo.
- `patient_studies.amount_paid` sigue siendo el total pagado de cada atención.
- **"Cobrado"** (dashboard y reportes) se cuenta por la **fecha de cada pago**: una deuda del mes pasado pagada hoy cuenta hoy. Además se indica cuánto de lo cobrado es de atenciones anteriores (`collected_today_previous` y `collected_previous`).
- La migración rehízo la historia desde la auditoría: el pago al registrar (con su método original), cada cobro y los "cobrar todo".

**Doctor no registrado.** En la atención se envía `"external_doctor": { "name": "Dr. Pérez", "commission_type": "pct" | "fixed", "commission_value": 12 }`.
- `pct` es el % del precio de cada estudio, hasta 100; `fixed` es un monto en Bs por cada estudio.
- La comisión se guarda con su nombre, sin descuento por convenio.
- Sale en Comisiones y en el reporte como "Nombre (no registrado)".
- No se puede enviar a la vez con `doctor_id`.

**Rol DOCTOR.** Un usuario que solo tiene el rol DOCTOR se enlaza con su ficha de doctor (`users.doctor_id`, desde Usuarios).
- Ve **solo lo suyo**: sus pacientes (asignados a él o con alguna atención suya), sus atenciones, sus comisiones, su ficha, sus citas y un dashboard con sus números.
- Caja, depósitos, pagos a terceros, comprobantes y reportes le dan 403, aunque se le marquen en Roles.
- Sin ficha enlazada no ve ningún paciente.

**Permisos de "ver".** Las lecturas siguen la matriz de **Roles y permisos**. Quitarle a un rol "Ver pacientes" o "Ver atenciones" deja de mostrárselos en la API. Las pantallas que necesitan buscar pacientes (Atención, Entregas, Agenda) también los muestran con sus propios permisos.

Registrar una atención:

```json
{
  "patient_id": "…", "doctor_id": null, "clinic_name": null,
  "with_invoice": true, "invoice_number": "F-123",
  "payment_method": "cash", "amount_paid": 515,
  "items": [ { "study_id": "…", "has_report": true, "is_voucher": false } ]
}
```

El cliente **no envía precios**. El servidor calcula, dentro de la transacción:
- precio de la tarifa activa (con o sin informe);
- recargo por factura (`invoice_surcharge_pct`);
- descuento por convenio del doctor (`agreement_discount_pct`);
- reparto del pago entre los estudios;
- comisión de cada estudio.

`total = precio + recargo − descuento`.

### Comisiones 🔒 (permiso `view.commissions`)

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/commissions?from=&to=&doctor_id=&page=&limit=` | Filas con paciente y estudio, y `summary` con total y totales por doctor |

Las comisiones se crean solas al registrar una atención:
- **Vale:** monto fijo de `voucher_amount` (50 Bs).
- **Doctor con porcentaje:** su % del precio, o `first_patient_commission_pct` (50%) en su primera atención.
- **Doctor sin porcentaje:** la comisión fija del estudio.

### Caja chica 🔒

| Método | Ruta | Permiso |
|---|---|---|
| GET | `/api/cashbox?from=&to=&page=&limit=` (con `summary`: ingresos, gastos y saldo actual) | `view.cashbox` |
| GET | `/api/cashbox/balance` | `view.cashbox` o `view.dashboard` |
| POST | `/api/cashbox` `{ description, income }` o `{ description, expense }` | `cashbox.create` |

`balance = saldo anterior + ingreso − gasto`. Lo calcula el servidor bloqueando una fila de saldo (`cashbox_state`), así los movimientos simultáneos nunca dan un saldo incorrecto.

Los movimientos **no se editan ni se borran**: una corrección es un movimiento nuevo. Un gasto que deja la caja en negativo se rechaza (`INSUFFICIENT_BALANCE`), salvo que el parámetro `cashbox_allow_negative` esté activo.

### Comprobantes 🔒 (almacenamiento privado)

| Método | Ruta | Permiso |
|---|---|---|
| POST | `/api/receipts` (binario PNG, JPG, WEBP o PDF, máximo 5 MB) → `{ key }` | `deposits.create` o `third_party.create` |
| GET | `/api/receipts/url?key=...` → `{ url, expires_at }` (válido 5 minutos) | roles ADMIN, SUBADMIN, CAJA, CONTABILIDAD |
| GET | `/api/receipts/file?key=&exp=&sig=` (el enlace firmado; no lleva token) | — |

Flujo:
1. Subir el archivo.
2. Enviar la `key` como `receipt_key` al crear el depósito o el pago.
3. Pedir un enlace firmado para verlo.

Los archivos se guardan en `PRIVATE_STORAGE_DIR/<sucursal>/receipts/...` y **nunca** se sirven sin firma. Un enlace solo sirve para esa sucursal y ese archivo, y vence en 5 minutos.

### Depósitos bancarios y pagos a terceros 🔒

| Método | Ruta | Permiso |
|---|---|---|
| GET | `/api/deposits?from=&to=&q=&page=&limit=` (con total) | `view.deposits` |
| POST | `/api/deposits` `{ amount, deposit_date, reference?, receipt_key? }` | `deposits.create` |
| GET | `/api/third-party-payments?from=&to=&q=` (con total) | `view.third_party` |
| POST | `/api/third-party-payments` `{ provider_name, service_type, amount, service_date, payment_date, receipt_key? }` | `third_party.create` |
| PATCH | `/api/third-party-payments/:id` (la **fecha de servicio no se puede cambiar**: `SERVICE_DATE_LOCKED`) | `third_party.create` |

Aquí `from`/`to` filtran por la fecha del depósito o del pago (columnas DATE, sin conversión de zona horaria).

### Agenda de citas 🔒

| Método | Ruta | Permiso |
|---|---|---|
| GET | `/api/appointments?from=&to=&status=&doctor_id=&patient_id=` | roles ADMIN, SUBADMIN, RECEPCION, DOCTOR, AUDITOR |
| GET | `/api/appointments/:id` | ídem |
| POST | `/api/appointments` | `appointments.create` |
| PATCH | `/api/appointments/:id` (también para cambiar solo el `status`) | `appointments.edit` |
| DELETE | `/api/appointments/:id` | `appointments.delete` |

- `starts_at` va **con zona horaria** (`2026-10-20T09:30:00-04:00`) y se guarda en UTC.
- Con `patient_id`, el nombre, el teléfono y el doctor se completan desde el paciente.
- Estados: `SCHEDULED`, `CONFIRMED`, `DONE`, `CANCELLED`, `NO_SHOW`.
- La respuesta trae `overlaps`: las citas del mismo doctor que se cruzan con el horario (es un aviso; no bloquea).

### Notificaciones 🔒

| Método | Ruta | Permiso |
|---|---|---|
| GET | `/api/notifications?unread=true&page=&limit=` (recibidas) | cualquier usuario |
| GET | `/api/notifications/unread-count` (para consultar cada 30 s; responde 304 si no cambió) | cualquier usuario |
| POST | `/api/notifications/:id/read` · `/api/notifications/read-all` | cualquier usuario (solo las propias) |
| GET | `/api/notifications/recipients` (usuarios activos) · `/api/notifications/sent` | `notifications.send` |
| GET | `/api/notifications/:id/recipients` (de una enviada: quién y cuándo la leyó) | `notifications.send` |
| POST | `/api/notifications` `{ title, body, target: "all" \| [userIds] }` | `notifications.send` |

### Usuarios 🔒

| Método | Ruta | Permiso |
|---|---|---|
| GET | `/api/users?q=&approved=&role=` · `/api/users/:id` | `view.users` |
| POST | `/api/users` `{ email, username, full_name, password, roles: [...] }` (queda aprobado) | `users.create` |
| PATCH | `/api/users/:id` `{ email?, username?, full_name?, password?, active? }` | `users.edit` |
| POST | `/api/users/:id/approve` `{ approved }` | `users.approve` |
| PUT | `/api/users/:id/roles` `{ roles: [...] }` | `users.manage_roles` |
| DELETE | `/api/users/:id` (lo que registró se conserva) | `users.delete` |
| POST | `/api/users/:id/impersonate` → `{ token }` de 1 hora | `users.impersonate` |

Protecciones:
- Solo un ADMIN puede dar o quitar el rol ADMIN, o modificar, eliminar o suplantar a otro ADMIN.
- Nadie puede eliminarse, desactivarse ni desaprobarse a sí mismo.
- Siempre queda al menos un ADMIN activo (`LAST_ADMIN`).
- No se puede suplantar a un ADMIN ni suplantar desde una sesión suplantada. Todo lo que se hace suplantando queda en la auditoría con `_impersonated_by`.

### Roles y permisos 🔒

| Método | Ruta | Permiso |
|---|---|---|
| GET | `/api/roles` → `{ roles, permissions, matrix }` | `view.roles` |
| PUT · DELETE | `/api/roles/:rol/permissions/:permiso` (dar o quitar; ADMIN no se edita) | `roles.manage_permissions` |

El cambio vale desde la siguiente petición: se vacía la caché de la sucursal.

### Parámetros 🔒

| Método | Ruta | Permiso |
|---|---|---|
| GET | `/api/params` (en caché 10 min) | cualquier usuario |
| PATCH | `/api/params/:key` `{ value_num }` o `{ value_bool }`, con rango validado por parámetro | `params.edit` |

### Auditoría 🔒 (permiso `view.audit`)

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/audit?from=&to=&user_id=&table_name=&action=&record_id=&page=&limit=` | Registros con el nombre del usuario |
| GET | `/api/audit/facets` | Tablas y acciones existentes, para los filtros |

### Dashboard y reportes 🔒

| Método | Ruta | Permiso |
|---|---|---|
| GET | `/api/dashboard` (hoy, hora local: pacientes, doctores, atenciones, facturado, cobrado, comisiones, depósitos, saldo de caja) | `view.dashboard` |
| GET | `/api/reports/summary?from=&to=` | `view.reports` |

El reporte se calcula en MySQL y tiene tres partes:
- **operativo:** atenciones, entregas, pacientes nuevos, por día y por estudio;
- **financiero:** facturado, cobrado, saldo, comisiones por doctor, caja, depósitos, pagos a terceros, neto y por método de pago;
- **control:** pacientes sin doctor, registros sin usuario, errores de fecha, tarifas en cero o faltantes, y atenciones cobradas de más.

Se cachea 1 hora, pero **cualquier cambio de datos lo invalida** (header `X-Cache`). La exportación a PDF o Excel la hace el frontend con estos datos.

### Marca de la sucursal 🔒 (permiso `branding.edit`)

| Método | Ruta | Descripción |
|---|---|---|
| PATCH | `/api/branding` | `{ name?, address?, phone?, theme?: { primary, secondary, accent, background, text, font, radius, mode } }` |
| PUT | `/api/branding/logo` | Cuerpo binario `image/png`, `image/jpeg` o `image/webp`, máximo 1 MB. **No acepta SVG** |
| DELETE | `/api/branding/logo` | Quita el logo |

Ejemplo:

```sh
curl -X PUT http://sur.localhost:4000/api/branding/logo \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: image/png" --data-binary @logo.png
```

## Panel de la plataforma (tenancy-node)

En el **dominio central** (`dominio.com/admin/`; en local `http://localhost:8080/admin/`) se monta el panel de tenancy-node (`@tenancy-node/admin-api` + `admin-ui`). En el subdominio de una sucursal responde 404. Se activa con `TENANCY_ADMIN_SECRET`.

| Desde el panel | Cómo lo resuelve |
|---|---|
| Crear una sucursal (`calacoto`) | tenancy-node crea `dental_calacoto`, su usuario MySQL y aplica `db/tenant/*.sql`, con el progreso en vivo |
| ADMIN por defecto | El `seed` del módulo (`src/tenancy/seed.ts`) crea `admin` con una contraseña aleatoria y la cuenta **por activar** |
| Tema (colores; logo por URL) | `theme.update` del módulo. La app lo lee de `/tenancy/me` |
| Entrar a la sucursal | "Entrar como…" genera un token de un solo uso (60 s). La app lo canjea en `GET /api/auth/impersonate` (`consumeImpersonationToken`) y entrega una sesión de 1 hora, auditada con `_impersonated_by: "platform:<id>"` |
| Activar la cuenta | La app obliga a definir nombre, usuario, email y contraseña (`POST /api/auth/setup-account`). Después, el ADMIN entra normal con su usuario y contraseña |
| Suspender, mantenimiento, migraciones, explorar datos, auditoría, usuarios del panel con 2FA | Funciones propias del panel |

Usuarios del panel (son distintos de los usuarios de cada sucursal): `npx tenancy admin:user tu@email.com --role=owner`.

## Página web pública de cada sucursal

La portada de `https://<sucursal>.dominio.com` se edita en la app, en **"Página web"** (permiso `site.edit`):
- títulos, textos, cifras destacadas;
- teléfono, WhatsApp y su mensaje, email, dirección y mapa;
- horarios, redes sociales, SEO e imagen principal.

| Qué | Dónde |
|---|---|
| Contenido | Tabla `site_content` en la **base de la sucursal** (migración 007): un documento JSON validado |
| Caché | `tenancy.cache()`, llave `tenant:<id>:site:content`, 1 hora. Se borra al guardar. Con `REDIS_URL`, en Redis |
| Imágenes | Almacenamiento público de la sucursal (`storage/<sucursal>/site/…`). Solo PNG, JPG o WEBP de hasta 2 MB (sin SVG) |
| Lectura pública | `GET /api/public/site` (contenido completo, con valores por defecto) |
| Edición | `GET` / `PUT` / `DELETE /api/site` y `POST /api/site/images` |

La lista de estudios de la portada sale sola del catálogo activo de la sucursal. Los enlaces solo aceptan `https://` y el contenido se muestra como texto, así que no se puede inyectar código.

## Redis (caché compartida)

Con `REDIS_URL=redis://127.0.0.1:6379`, tenancy-node usa `@tenancy-node/cache-redis` para toda la caché por sucursal (sesiones, permisos, catálogos, página web y reportes). Además usa `redisInvalidation`, así los cambios de sucursales llegan al instante a todas las réplicas. Sin `REDIS_URL` se usa la memoria del proceso.

## Recuperar la contraseña por correo

Se enciende o apaga **para todas las sucursales** en `.env`:
- Con `PASSWORD_RESET_ENABLED=true` y los datos SMTP (`MAIL_SMTP_HOST`, `MAIL_SMTP_PORT`, `MAIL_SMTP_SECURE`, `MAIL_SMTP_USER`, `MAIL_SMTP_PASS`, `MAIL_FROM`), en "¿Olvidaste tu contraseña?" el usuario recibe un **código de 6 dígitos**. El correo lleva el nombre y el logo de su sucursal.
- Con `PASSWORD_RESET_ENABLED=false`, o sin `MAIL_SMTP_HOST`, la pantalla dice que pida una contraseña nueva a un administrador.

Seguridad:
- Se guarda solo el HMAC del código, ligado a la sucursal y al usuario.
- El código vence a los 15 minutos, es de un solo uso y tiene 5 intentos; pedir uno nuevo anula los anteriores.
- La respuesta es igual aunque el email no exista y el correo sale en segundo plano, así ni el mensaje ni el tiempo de respuesta revelan si está registrado.
- Al cambiarla se cierran las demás sesiones.
- Todo queda en la auditoría (`PASSWORD_RESET_REQUEST`, `PASSWORD_RESET`).

**En local:** Mailpit atrapa los correos sin enviarlos. Se levanta con `docker run -d --name dental3d-mailpit -p 127.0.0.1:1025:1025 -p 127.0.0.1:8025:8025 axllent/mailpit:v1.27`, se configura `MAIL_SMTP_HOST=127.0.0.1` y `MAIL_SMTP_PORT=1025`, y los correos se ven en http://localhost:8025.

## Conexiones a MySQL

| Variable | Por defecto | Qué controla |
|---|---|---|
| `CENTRAL_POOL_MAX` | 30 | Conexiones a la base central. **No crear más sucursales a la vez que este número** (tenancy-node 0.10 se bloquea; ver `TENANCY-NODE-REPORTE.md`, punto 8) |
| `TENANT_POOL_MAX` | 5 | Conexiones por sucursal |
| `TENANT_MAX_OPEN_POOLS` | 100 | Sucursales con pool abierto a la vez |
| `TENANT_POOL_IDLE_MS` | 60000 | A los cuántos ms sin uso se cierra el pool de una sucursal |

| `API_PROCESSES` | 1 | Procesos de la API (módulo cluster: comparten el puerto y se reparten la carga entre núcleos). Con más de 1 hace falta `REDIS_URL` |
| `PASSWORD_WORKERS` | núcleos − 1 (repartidos entre procesos, máx. 4) | Hilos de bcrypt por proceso |

Regla: `(TENANT_POOL_MAX × sucursales activas + CENTRAL_POOL_MAX) × API_PROCESSES < max_connections` de MySQL.

**Capacidad medida con k6** (`test/k6/`; 20 sucursales, MySQL en Docker y k6 en la misma máquina de 12 núcleos):

| | 1 proceso | 4 procesos |
|---|---|---|
| Máximo sostenido (p95 < 500 ms, 0 errores) | ~750 peticiones/s | ~1500 peticiones/s |
| 100 del personal + 200 visitantes + 2 logins/s | p95 7 ms, 0 errores | — |

En la prueba, cada usuario del personal hace ~1,6 peticiones por segundo (con pausas de 2 s, más rápido que una persona real): 750 peticiones/s ≈ 450 usuarios del personal trabajando a la vez.

## Copiar datos desde Supabase

```sh
# 1. Sucursal NUEVA (no crear el ADMIN: los usuarios vienen de Supabase)
npm run tenant:create -- central --name="3D Dental Central"

# 2. Simulación: hace todo, muestra el informe y no guarda nada
SUPABASE_DB_URL='postgresql://postgres:<clave>@db.<proyecto>.supabase.co:5432/postgres?sslmode=require' \
  npm run tenant:import-supabase -- central --dry-run

# 3. Importación real, con los comprobantes del bucket "receipts"
SUPABASE_DB_URL=... SUPABASE_URL=https://<proyecto>.supabase.co SUPABASE_SERVICE_ROLE_KEY=... \
  npm run tenant:import-supabase -- central
```

Cómo funciona:
- Copia usuarios (con sus **contraseñas bcrypt**: nadie tiene que cambiarla), roles, la matriz de permisos, parámetros y todas las tablas, con los **mismos IDs**.
- Todo va en **una transacción**: si algo falla, no queda nada a medias. Una sucursal con datos se rechaza.
- Al final compara **conteos y sumas de dinero** entre las dos bases y lista las observaciones: sobrepagos ajustados, caja descuadrada, filas inválidas omitidas, usuarios renombrados, comprobantes que no se pudieron copiar.
- Los comprobantes que fallen se reintentan con `--receipts-only`.
- Para probarlo sin tocar Supabase, hay una base de ejemplo con la misma estructura en `test/fixtures/supabase-fixture.sql`.

## Seguridad (resumen)

- Una base y un usuario MySQL por sucursal (`credentials: 'per-tenant'`). Las credenciales se guardan cifradas con `TENANCY_KEY`.
- JWT HS256 con la sucursal (`tid`) y la versión de sesión (`ver`). Se verifican en cada petición.
- Contraseña nueva, desactivación, desaprobación o cambio de roles **cierran al instante** todas las sesiones del usuario.
- Protección contra escalada de privilegios en la administración de usuarios, y suplantación auditada.
- Contraseñas con bcrypt (12 rondas) y respuesta de login sin revelar si el usuario existe. bcrypt corre en hilos aparte (`src/lib/password.ts`, `PASSWORD_WORKERS`): un login (~250 ms de CPU) no frena a las demás peticiones.
- Límites de intentos por IP y sucursal, `helmet`, CORS restringido y límites de tamaño del cuerpo.
- Logo: se valida el contenido real del archivo, no solo el `Content-Type`. Sin SVG.
- Todo cambio queda en `audit_logs` de la sucursal.
- Respuestas con datos: `Cache-Control: private, no-cache`.

## Diferencias con Supabase

- Las políticas RLS ahora son middlewares (`requirePermission` / `requireRole`). ADMIN tiene todos los permisos.
- La auditoría la escribe la API dentro de la misma transacción de cada cambio, no un trigger.
- `auth.users` + `profiles` se unen en una sola tabla `users`, dentro de la base de cada sucursal.
- **Pendiente:** recuperar contraseña por email (necesita un servicio de correo).
