# Dental Flow Pro

🦷 “Dental-3D”

Debe ser un sistema de gestión para un centro radiológico dental con control clínico, administrativo y financiero.

⚙️ TECNOLOGÍA ESPERADA

 Frontend: React o similar (UI moderna)

 Backend: Node.js o equivalente

 Base de datos: PostgreSQL o MySQL (relacional)

 Autenticación: JWT

 Sistema de roles (RBAC)

 Panel administrativo completo

🔐 1. SISTEMA DE LOGIN Y ROLES

Usuarios

 Login con usuario y contraseña

 Autenticación segura JWT

Tabla USERS

 id

 username

 password_hash

 full_name

 email

 active

ROLES DEL SISTEMA

 ADMIN

 RECEPCION

 CAJA

 CONTABILIDAD

 DOCTOR

 AUDITOR

PERMISOS (RBAC)

Cada rol debe tener permisos asignados:

 crear_pacientes

 ver_pacientes

 editar_pacientes

 ver_comisiones

 gestionar_caja

 ver_reportes

 exportar_reportes

 ver_auditoria

🧩 2. MÓDULO: DOCTORES

Funcionalidad

Gestión de doctores remitentes.

Base de datos

 id

 full_name

 clinic_address

 phone

 email

 bank_account

 status

Regla:

Todo paciente debe estar vinculado a un doctor obligatorio.

🧍 3. MÓDULO: PACIENTES

Funcionalidad

Registro de pacientes con asignación automática de doctor.

Campos:

 id

 doctor_id (FK obligatoria)

 full_name

 birth_date

 age (auto calculada)

 phone

 created_at

Flujo:

 Seleccionar doctor

 Autocompletar datos

 Registrar paciente

 Asignar estudio

🦷 4. MÓDULO: ESTUDIOS Y TARIFAS

Estudios:

 Radiografías

 Tomografías

 Teleradiografías

 Ortodoncia

 Otros

Tabla STUDIES

 id

 name

 description

 active

Tabla STUDY_PRICES (CRÍTICO)

 id

 study_id

 price_with_report

 price_without_report

 effective_date

 is_active

REGLA CRÍTICA:

 El precio SIEMPRE debe venir desde la tabla de tarifas activas

 NO depende de facturación ni lógica manual

 No debe existir error de precios desactualizados

🧾 5. MÓDULO: REGISTRO DE ATENCIÓN (PACIENTE + ESTUDIO)

Tabla PATIENT_STUDIES

 id

 patient_id

 study_id

 price (auto calculado)

 has_report (boolean)

 payment_method (cash / qr / card)

 invoice_number

 delivery_date

 created_by

 created_at

REGLA:

 Todo registro debe guardar usuario creador

 Precio se asigna automáticamente

💰 6. MÓDULO: COMISIONES DE DOCTORES

Función:

Calcular comisiones automáticamente por paciente referido.

Tabla COMMISSIONS

 id

 doctor_id

 patient_study_id

 commission_amount

 percentage

 created_at

Reglas:

 Comisión estándar según estudio

 50% primer paciente de doctor nuevo

 Vales sin monto → comisión fija 50 Bs

🧮 7. MÓDULO: CAJA CHICA

Función:

Control financiero interno.

Tabla CASHBOX

 id

 description

 income

 expense

 balance

 created_by

 created_at

REGLA CRÍTICA:

 Cada gasto debe descontar automáticamente el saldo

 balance = balance anterior + income - expense

🏦 8. MÓDULO: INGRESOS BANCARIOS

Tabla BANK_DEPOSITS

 id

 amount

 deposit_date

 reference

 created_by

💳 9. MÓDULO: PAGOS A TERCEROS

Tabla THIRD_PARTY_PAYMENTS

 id

 provider_name

 service_type

 amount

 service_date

 payment_date

 created_by

REGLAS:

 Fecha de servicio NO editable después de guardar

 Control de proveedores externos obligatorio

📊 10. MÓDULO: MOVIMIENTOS FINANCIEROS

Debe mostrar todo en un solo dashboard:

 Pacientes registrados

 Ingresos

 Gastos

 Caja chica

 Pagos a terceros

Con filtros por fecha.

📄 11. MÓDULO DE REPORTES INTELIGENTES

Debe incluir:

Operativos

 Pacientes por día

 Estudios realizados

Financieros

 Caja chica

 Ingresos

 Comisiones

 Pagos a terceros

Control

 Pacientes sin doctor

 Registros sin usuario

 Errores de fechas

 Tarifas incorrectas

EXPORTACIÓN:

 PDF (obligatorio)

 Excel (opcional)

 Visualización en sistema (obligatorio)

🧾 12. AUDITORÍA DEL SISTEMA

Tabla AUDIT_LOGS

 id

 user_id

 action

 table_name

 record_id

 timestamp

REGLA:

Todo cambio debe registrarse automáticamente.

⚠️ 13. REGLAS GLOBALES

 Todo registro debe tener usuario creador

 Todo paciente debe tener doctor

 Fechas en formato YYYY-MM-DD

 No conversión automática de fechas

 Tarifas centralizadas

 Comisiones automáticas

 Caja chica siempre actualizada

 Sistema completamente auditable

🎯 OBJETIVO DEL SISTEMA

Crear un sistema robusto que permita:

 Control clínico de pacientes

 Gestión de doctores

 Facturación automática

 Control financiero real

 Comisiones exactas

 Caja chica precisa

 Reportes completos

 Auditoría total del sistema

## Cómo está hecho

| Parte | Carpeta | Tecnología |
|---|---|---|
| Frontend | raíz (`src/`) | React 19, TanStack Start/Router/Query, Tailwind, shadcn/ui. Build de Node (`.output/`) |
| API | `server/` | Node, Express 5, TypeScript, MySQL, JWT. Multi-sucursal con [tenancy-node](https://github.com/yedrick/tenat-node): una base de datos por sucursal |
| Despliegue | `deploy/` | nginx, systemd, respaldos, sin Docker |

Gestor de paquetes: **npm** (`package-lock.json` en la raíz y en `server/`).

## Desarrollo

1. **API:** sigue `server/README.md`, sección "Puesta en marcha (local)": MySQL, `.env`, dueño del panel y `npm run dev` (puerto 4000).
2. **Frontend:**

```sh
npm ci          # instala exactamente lo del package-lock.json
npm run dev     # http://localhost:8080 (reenvía /api, /tenancy y /admin a la API)
```

3. Abre `http://localhost:8080/admin/` (panel de la plataforma) y cada sucursal en `http://<sucursal>.localhost:8080`.

## Producción

- **Laravel Forge:** `deploy/FORGE.md`, con el script de despliegue, los daemons, nginx y `.env` listos para pegar.
- **Servidor propio, sin Forge** (systemd): `deploy/DEPLOY.md`.

## Pruebas

- Unitarias: `cd server && npm test`.
- API, navegador y carga: ver `server/test/README.md`.
