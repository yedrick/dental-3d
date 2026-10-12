-- Datos de referencia de cada tenant: catálogo de permisos, permisos por rol y parámetros.
-- Va como migración (no como seed) para que los permisos nuevos lleguen a todas las
-- sucursales con `npx tenancy migrate`. Reproduce el estado final de supabase/migrations.
-- ADMIN no necesita filas aquí: la API le concede todos los permisos.

INSERT IGNORE INTO permissions (`key`, description, category) VALUES
  ('view.dashboard','Ver dashboard','vistas'),
  ('view.doctors','Ver doctores','vistas'),
  ('view.patients','Ver pacientes','vistas'),
  ('view.studies','Ver estudios y tarifas','vistas'),
  ('view.attention','Ver atenciones','vistas'),
  ('view.appointments','Ver agenda','vistas'),
  ('view.delivery','Ver entregas y cobros','vistas'),
  ('view.commissions','Ver comisiones','vistas'),
  ('view.cashbox','Ver caja chica','vistas'),
  ('view.deposits','Ver depósitos bancarios','vistas'),
  ('view.third_party','Ver pagos a terceros','vistas'),
  ('view.reports','Ver reportes','vistas'),
  ('view.audit','Ver auditoría','vistas'),
  ('view.users','Ver usuarios','vistas'),
  ('view.roles','Ver roles y permisos','vistas'),
  ('view.params','Ver parámetros','vistas'),
  ('view.notifications','Ver notificaciones','vistas'),
  ('view.profile','Ver perfil personal','vistas'),
  ('doctors.create','Crear doctor','acciones'),
  ('doctors.edit','Editar doctor','acciones'),
  ('doctors.delete','Eliminar doctor','acciones'),
  ('patients.create','Crear paciente','acciones'),
  ('patients.edit','Editar paciente','acciones'),
  ('patients.delete','Eliminar paciente','acciones'),
  ('studies.create','Crear estudio','acciones'),
  ('studies.edit','Editar estudio/tarifa','acciones'),
  ('attention.create','Registrar atención','acciones'),
  ('attention.charge','Cobrar saldo pendiente','acciones'),
  ('attention.deliver','Marcar entrega de estudio','acciones'),
  ('appointments.create','Crear cita','acciones'),
  ('appointments.edit','Editar cita','acciones'),
  ('appointments.delete','Eliminar cita','acciones'),
  ('cashbox.create','Registrar movimiento de caja','acciones'),
  ('deposits.create','Registrar depósito','acciones'),
  ('third_party.create','Registrar pago a terceros','acciones'),
  ('reports.export','Exportar reportes PDF','acciones'),
  ('notifications.send','Enviar notificaciones','acciones'),
  ('users.create','Crear usuarios','admin'),
  ('users.edit','Editar usuarios','admin'),
  ('users.delete','Eliminar usuarios','admin'),
  ('users.approve','Aprobar/desaprobar usuarios','admin'),
  ('users.impersonate','Iniciar sesión como otro usuario','admin'),
  ('users.manage_roles','Asignar roles a usuarios','admin'),
  ('roles.manage_permissions','Modificar permisos de roles','admin'),
  ('params.edit','Modificar parámetros del sistema','admin'),
  ('branding.edit','Cambiar nombre, logo y colores de la sucursal','admin');

INSERT IGNORE INTO role_permissions (role, permission_key) VALUES
  ('RECEPCION','view.dashboard'),('RECEPCION','view.doctors'),('RECEPCION','view.patients'),
  ('RECEPCION','view.studies'),('RECEPCION','view.attention'),('RECEPCION','view.delivery'),
  ('RECEPCION','view.appointments'),
  ('RECEPCION','patients.create'),('RECEPCION','patients.edit'),
  ('RECEPCION','doctors.create'),('RECEPCION','doctors.edit'),
  ('RECEPCION','attention.create'),('RECEPCION','attention.charge'),('RECEPCION','attention.deliver'),
  ('RECEPCION','appointments.create'),('RECEPCION','appointments.edit'),('RECEPCION','appointments.delete'),

  ('CAJA','view.dashboard'),('CAJA','view.attention'),('CAJA','view.delivery'),
  ('CAJA','view.cashbox'),('CAJA','view.deposits'),('CAJA','view.studies'),
  ('CAJA','attention.create'),('CAJA','attention.charge'),('CAJA','attention.deliver'),
  ('CAJA','cashbox.create'),('CAJA','deposits.create'),

  ('CONTABILIDAD','view.dashboard'),('CONTABILIDAD','view.commissions'),('CONTABILIDAD','view.cashbox'),
  ('CONTABILIDAD','view.deposits'),('CONTABILIDAD','view.third_party'),('CONTABILIDAD','view.reports'),
  ('CONTABILIDAD','third_party.create'),('CONTABILIDAD','reports.export'),

  ('DOCTOR','view.dashboard'),('DOCTOR','view.patients'),('DOCTOR','view.commissions'),

  ('AUDITOR','view.dashboard'),('AUDITOR','view.doctors'),('AUDITOR','view.patients'),
  ('AUDITOR','view.studies'),('AUDITOR','view.attention'),('AUDITOR','view.delivery'),
  ('AUDITOR','view.commissions'),('AUDITOR','view.cashbox'),('AUDITOR','view.deposits'),
  ('AUDITOR','view.third_party'),('AUDITOR','view.reports'),('AUDITOR','view.audit'),

  ('SUBADMIN','view.dashboard'),('SUBADMIN','view.doctors'),('SUBADMIN','view.patients'),
  ('SUBADMIN','view.studies'),('SUBADMIN','view.attention'),('SUBADMIN','view.appointments'),
  ('SUBADMIN','view.delivery'),('SUBADMIN','view.commissions'),('SUBADMIN','view.cashbox'),
  ('SUBADMIN','view.deposits'),('SUBADMIN','view.third_party'),('SUBADMIN','view.reports');

-- Perfil y notificaciones para todos los roles
INSERT IGNORE INTO role_permissions (role, permission_key)
SELECT r.role, p.k FROM
  (SELECT 'SUBADMIN' AS role UNION ALL SELECT 'RECEPCION' UNION ALL SELECT 'CAJA'
   UNION ALL SELECT 'CONTABILIDAD' UNION ALL SELECT 'DOCTOR' UNION ALL SELECT 'AUDITOR') r
CROSS JOIN (SELECT 'view.profile' AS k UNION ALL SELECT 'view.notifications') p;

INSERT IGNORE INTO app_params (`key`, value_num, description) VALUES
  ('default_commission_pct', 20, 'Porcentaje de comisión por defecto para nuevos doctores'),
  ('first_patient_commission_pct', 50, 'Porcentaje de comisión por el primer paciente de un doctor'),
  ('voucher_amount', 50, 'Monto en Bs del vale (para comisiones)'),
  ('invoice_surcharge_pct', 13, 'Recargo % cuando se emite factura'),
  ('default_discount_pct', 0, 'Descuento % por defecto (0 = sin descuento)'),
  ('debt_alert_days', 15, 'Días máximos de deuda antes de alertar');
