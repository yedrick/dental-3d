# API Dental-3D (Node + Express + MySQL + tenancy-node)

Backend propio que reemplaza a Supabase, **multi-sucursal** con [tenancy-node](https://github.com/yedrick/tenat-node) v0.8.0:

- Cada **sucursal es un tenant** y tiene su **propia base MySQL** (`dental_<sucursal>`), con un **usuario MySQL propio** que solo puede entrar a esa base.
- La sucursal se identifica por **subdominio**: `sur.dental3d.com` → sucursal `sur`. En local: `sur.localhost:4000`.
- Caché, archivos (logo) y logs van **aislados por sucursal**.

Fases y pendientes: [PLAN.md](PLAN.md).

## Requisitos

- Node.js 20+
- MySQL 8.0.13+ (usa `DEFAULT (UUID())`)
- Docker (opcional, para el MySQL local)

## Puesta en marcha (local)

```sh
cd server
npm install                   # instala tenancy-node desde GitHub Releases
cp .env.example .env
npx tenancy key:generate      # pega el resultado en TENANCY_KEY
# y pon un JWT_SECRET de 32+ caracteres

# MySQL local (puerto 3307)
docker run -d --name dental3d-mysql \
  -e MYSQL_ROOT_PASSWORD=root_dev_password -e MYSQL_DATABASE=dental3d_central \
  -p 3307:3306 mysql:8.4 --default-time-zone=+00:00
# (o: docker compose up -d)

npm run db:install            # tablas tenancy_* en la base central
npm run tenant:create -- central --name="3D Dental Central"   # crea dental_central + migraciones
npm run tenant:create -- sur --name="3D Dental Sur"
ADMIN_PASSWORD='Admin123!xyz' npm run tenant:create-admin -- central admin@clinica.com admin "Nombre Apellido"

npm run dev                   # http://central.localhost:4000 , http://sur.localhost:4000
```

Los navegadores y `curl` resuelven `*.localhost` a `127.0.0.1` sin configurar nada.

## Comandos

| Comando | Qué hace |
|---|---|
| `npm run dev` / `build` / `start` | Desarrollo con recarga / compilar / producción |
| `npm run db:install` | Tablas `tenancy_*` en la base central (idempotente) |
| `npm run db:migrate` | Aplica las migraciones pendientes de `db/tenant/` en **todas** las sucursales |
| `npm run tenant:create -- <id> --name="..."` | Crea una sucursal: base, usuario MySQL y migraciones |
| `npm run tenant:list` | Lista las sucursales |
| `npm run tenant:create-admin -- <id> <email> <usuario> "<nombre>"` | Crea o asciende el ADMIN de una sucursal (contraseña en `ADMIN_PASSWORD`) |
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
│   └── 004_finanzas.sql     caja chica, depósitos, pagos a terceros, citas, notificaciones
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
    │                        notifications, branding
    └── scripts/             create-admin.ts
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
| GET 🔒 | `/api/auth/me` | Perfil, roles, permisos y sucursal |
| POST 🔒 | `/api/auth/change-password` | `{ current_password, new_password }` |

El token **solo sirve en la sucursal que lo emitió**.

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
| GET | `/api/patients?q=&doctor_id=&status=&sort=recent\|name&page=&limit=` | roles ADMIN, SUBADMIN, RECEPCION, CAJA, CONTABILIDAD, DOCTOR, AUDITOR |
| GET | `/api/patients/:id` (con `doctor_name`) | ídem |
| GET | `/api/patients/:id/attentions` (historial con `total` y `debt`) | ídem |
| POST | `/api/patients` (`doctor_id` obligatorio) | `patients.create` |
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

**Una sola tarifa activa por estudio:** al crear o activar una tarifa, la anterior se desactiva en la misma transacción (y un índice único lo garantiza en la base).

### Atenciones 🔒

| Método | Ruta | Permiso |
|---|---|---|
| GET | `/api/attentions?from=&to=&q=&patient_id=&doctor_id=&status=debt\|paid\|pending_delivery\|delivered` (con `summary`: total, pagado, saldo) | roles ADMIN, SUBADMIN, RECEPCION, CAJA, CONTABILIDAD, AUDITOR, DOCTOR |
| POST | `/api/attentions` | `attention.create` |
| POST | `/api/attentions/:id/charge` `{ amount, payment_method? }` | `attention.charge` |
| POST | `/api/attentions/charge-all` `{ patient_id }` | `attention.charge` |
| POST | `/api/attentions/deliver` `{ ids: [...] }` | `attention.deliver` |

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
| POST | `/api/notifications` `{ title, body, target: "all" \| [userIds] }` | `notifications.send` |

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

## Seguridad (resumen)

- Una base y un usuario MySQL por sucursal (`credentials: 'per-tenant'`). Las credenciales se guardan cifradas con `TENANCY_KEY`.
- JWT HS256 con la sucursal en el token (`tid`). Se verifica en cada petición.
- Usuario desactivado o cambio de roles: efecto en ≤ 60 s, y al instante cuando se haga desde los endpoints de usuarios (Fase 4).
- Contraseñas con bcrypt (12 rondas) y respuesta de login sin revelar si el usuario existe.
- Límites de intentos por IP y sucursal, `helmet`, CORS restringido y límites de tamaño del cuerpo.
- Logo: se valida el contenido real del archivo, no solo el `Content-Type`. Sin SVG.
- Todo cambio queda en `audit_logs` de la sucursal.
- Respuestas con datos: `Cache-Control: private, no-cache`.

## Diferencias con Supabase

- Las políticas RLS ahora son middlewares (`requirePermission` / `requireRole`). ADMIN tiene todos los permisos.
- La auditoría la escribe la API dentro de la misma transacción de cada cambio, no un trigger.
- `auth.users` + `profiles` se unen en una sola tabla `users`, dentro de la base de cada sucursal.
- **Pendiente:** recuperar contraseña por email (necesita un servicio de correo).
