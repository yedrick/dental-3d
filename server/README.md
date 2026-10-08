# API Dental-3D (Node + Express + MySQL)

Backend propio que reemplaza a Supabase. Se migra **por fases**.

| Fase | Contenido | Estado |
|---|---|---|
| 1 | Login JWT, usuarios, roles y permisos, parámetros, Doctores, auditoría | ✅ Hecho |
| 2 | Pacientes, Estudios y tarifas, Atenciones (precio automático), Comisiones | Pendiente |
| 3 | Caja chica, Depósitos, Pagos a terceros, Citas, Notificaciones | Pendiente |
| 4 | Reportes, Auditoría (vista), Usuarios/Roles (admin), migración de datos desde Supabase | Pendiente |
| 5 | Cambiar el frontend (`src/`) para consumir esta API en lugar de Supabase | Pendiente |
| 6 | Eliminar todo lo relacionado con Lovable y Supabase | Pendiente |

Detalle completo en [PLAN.md](PLAN.md).

Mientras el frontend no se cambie (fase 5), la app publicada en Lovable sigue usando Supabase.

## Requisitos

- Node.js 20+
- MySQL 8.0.13+ (usa `DEFAULT (UUID())`)

## Puesta en marcha

```sh
cd server
npm install
cp .env.example .env          # y cambia JWT_SECRET y las credenciales

# MySQL local con Docker (puerto 3307):
docker run -d --name dental3d-mysql \
  -e MYSQL_ROOT_PASSWORD=root_dev_password -e MYSQL_DATABASE=dental3d \
  -e MYSQL_USER=dental -e MYSQL_PASSWORD=dental_dev_password \
  -p 3307:3306 mysql:8.4
# (o: docker compose up -d)

npm run db:migrate            # crea tablas y datos iniciales (se puede repetir)
npm run dev                   # http://localhost:4000
```

El primer usuario que se registre queda como ADMIN aprobado. También se puede crear uno desde la terminal:

```sh
npm run db:create-admin -- admin@clinica.com admin "Nombre Apellido" 'Contraseña123!'
```

Producción: `npm run build && npm start`.

## Estructura

```
server/
├── db/
│   ├── schema.sql          tablas MySQL
│   └── seed.sql            permisos, permisos por rol y parámetros
└── src/
    ├── index.ts            arranca el servidor
    ├── app.ts              Express: middlewares y rutas
    ├── config.ts           variables de entorno
    ├── db.ts               pool MySQL + withTransaction()
    ├── middleware/
    │   ├── auth.ts         requireAuth (JWT), requirePermission, requireRole
    │   └── error.ts        errores en español (validación, MySQL, 404)
    ├── lib/
    │   ├── audit.ts        escribe en audit_logs
    │   └── permissions.ts  roles y permisos del usuario
    ├── routes/
    │   ├── auth.routes.ts
    │   └── doctors.routes.ts
    └── scripts/            migrate.ts, create-admin.ts
```

## Endpoints

Todas las rutas, salvo `register`, `login` y `health`, requieren el header `Authorization: Bearer <token>`.
Los errores siempre vuelven como `{ "error": "mensaje" }` (y `details` en errores de validación).

### Autenticación

| Método | Ruta | Descripción |
|---|---|---|
| POST | `/api/auth/register` | `{ email, password, username, full_name }`. Contraseña: 10+ caracteres, mayúscula, minúscula, número y símbolo |
| POST | `/api/auth/login` | `{ login, password }` (`login` = email o usuario) → `{ token }` |
| GET | `/api/auth/me` | Perfil, roles y permisos del usuario actual |
| POST | `/api/auth/change-password` | `{ current_password, new_password }` |

### Doctores

| Método | Ruta | Permiso |
|---|---|---|
| GET | `/api/doctors?q=texto&status=true` | roles ADMIN, SUBADMIN, RECEPCION, CAJA, CONTABILIDAD, AUDITOR |
| GET | `/api/doctors/:id` | ídem |
| POST | `/api/doctors` | `doctors.create` |
| PATCH | `/api/doctors/:id` | `doctors.edit` (acepta campos parciales, p. ej. `{ "status": false }`) |
| DELETE | `/api/doctors/:id` | `doctors.delete` |

Campos: `full_name` (obligatorio), `clinic_address`, `phone`, `email`, `bank_account`, `status`,
`use_percentage`, `default_commission_pct` (0–20), `agreement_discount_pct` (0–100).

## Diferencias con Supabase

- **Seguridad:** las reglas RLS de PostgreSQL ahora son middlewares de Express (`requirePermission` / `requireRole`). ADMIN tiene todos los permisos.
- **Auditoría:** MySQL no sabe qué usuario de la app hace cada cambio, así que la API escribe `audit_logs` dentro de la misma transacción del cambio, en vez de usar un trigger.
- **Usuarios:** `auth.users` + `profiles` se unen en una sola tabla `users` con `password_hash` (bcrypt).
- **Sesión:** el JWT dura `JWT_EXPIRES_IN` (8h por defecto). Roles, estado activo y aprobación se revisan en cada petición, así que desactivar a un usuario o quitarle un rol tiene efecto inmediato.
- **Pendiente:** recuperar contraseña por email (necesita un servicio SMTP).
