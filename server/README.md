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
  -p 3307:3306 mysql:8.4
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
│   ├── 001_schema.sql       tablas e índices
│   └── 002_seed.sql         permisos, permisos por rol y parámetros
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
    ├── lib/                 audit, cache, permissions, http-error
    ├── routes/              auth, doctors, branding
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
