# Dental-3D — Plan de implementación

Sistema de gestión para centro radiológico dental con control clínico, administrativo y financiero.

## Stack

- **Frontend**: React 19 + TanStack Start (ya configurado) + Tailwind + shadcn/ui
- **Backend**: Lovable Cloud (Supabase gestionado) — PostgreSQL, Auth, RLS, Edge/Server Functions
- **Auth**: Lovable Cloud Auth (email + password). JWT gestionado automáticamente
- **Roles/RBAC**: tabla `user_roles` + enum + función `has_role()` (patrón seguro)
- **Reportes PDF**: `pdf-lib` en servidor; Excel con `xlsx` (opcional)

> Nota: en Lovable Cloud no se usa "usuario+contraseña" arbitrario, se usa email+contraseña (estándar seguro). Cada usuario tendrá además `username` y `full_name` en `profiles`.

## Alcance por fases

Dado el tamaño, propongo entregar en **3 fases**. Cada fase queda funcional y desplegable.

### Fase 1 — Núcleo clínico y seguridad
1. Habilitar Lovable Cloud
2. Auth (email/password) + página `/auth` + `/reset-password`
3. Esquema base:
   - `profiles` (id, username, full_name, email, active)
   - enum `app_role` (ADMIN, RECEPCION, CAJA, CONTABILIDAD, DOCTOR, AUDITOR)
   - `user_roles` + función `has_role()`
   - `doctors`, `patients`, `studies`, `study_prices`, `patient_studies`
   - `audit_logs` + trigger genérico de auditoría
4. RLS por rol en cada tabla
5. UI:
   - Layout `_authenticated` con sidebar
   - Dashboard vacío
   - Módulos: Doctores (CRUD), Pacientes (CRUD con doctor obligatorio + edad auto), Estudios y Tarifas (CRUD, precio con/sin informe, vigencia), Registro de atención (precio auto desde tarifa activa)
6. Auditoría automática vía trigger en tablas clave

### Fase 2 — Financiero
1. `commissions` con cálculo automático via trigger al crear `patient_studies`:
   - Comisión estándar por estudio
   - 50% primer paciente de doctor nuevo
   - Vales sin monto → 50 Bs fijo
2. `cashbox` (caja chica) con `balance` recalculado por trigger
3. `bank_deposits`
4. `third_party_payments` (fecha de servicio inmutable tras insert via trigger)
5. UI para cada módulo + validaciones

### Fase 3 — Dashboards, reportes y auditoría
1. Dashboard de movimientos financieros con filtros de fecha
2. Reportes:
   - Operativos: pacientes/día, estudios realizados
   - Financieros: caja chica, ingresos, comisiones, pagos a terceros
   - Control: pacientes sin doctor, registros sin usuario, errores de fecha, tarifas incorrectas
3. Exportación PDF (obligatorio) + Excel (opcional) vía server functions
4. Vista de `audit_logs` para rol AUDITOR

## Reglas globales implementadas técnicamente
- `created_by uuid REFERENCES auth.users NOT NULL` en toda tabla transaccional
- `patients.doctor_id NOT NULL`
- Fechas como `DATE` (YYYY-MM-DD) sin timezone
- Precio de `patient_studies` asignado por trigger desde `study_prices` activa
- Trigger de auditoría en INSERT/UPDATE/DELETE de tablas críticas
- Todo mutación protegida por RLS + `has_role()`

## Detalles técnicos clave

```text
study_prices
  study_id, price_with_report, price_without_report,
  effective_date, is_active
  → índice único parcial: (study_id) WHERE is_active
  → trigger: al insertar activa, desactiva anteriores

patient_studies BEFORE INSERT trigger:
  price := (SELECT CASE WHEN NEW.has_report
              THEN price_with_report ELSE price_without_report END
            FROM study_prices
            WHERE study_id = NEW.study_id AND is_active)

commissions AFTER INSERT ON patient_studies:
  aplica reglas (estándar / primer paciente 50% / vale 50 Bs)

cashbox BEFORE INSERT trigger:
  balance := COALESCE((SELECT balance FROM cashbox
             ORDER BY created_at DESC LIMIT 1), 0)
             + NEW.income - NEW.expense
```

## Preguntas antes de arrancar

1. ¿Confirmas email+password (estándar Lovable Cloud) en lugar de "username+password"? El username queda como campo visible pero el login es por email.
2. ¿Comisión estándar por estudio: qué porcentaje por defecto (ej. 20%)? ¿O lo dejo configurable por estudio en una columna `default_commission_pct`?
3. ¿Empiezo por **Fase 1** ahora?

Confirma y arranco con la Fase 1.
