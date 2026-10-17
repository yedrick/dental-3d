
INSERT INTO public.permissions (key, description) VALUES
  ('view.notifications', 'Ver notificaciones'),
  ('notifications.send', 'Enviar notificaciones'),
  ('view.profile', 'Ver perfil personal'),
  ('users.create', 'Crear usuarios'),
  ('users.edit', 'Editar usuarios'),
  ('users.delete', 'Eliminar usuarios'),
  ('users.approve', 'Aprobar/desaprobar usuarios'),
  ('users.impersonate', 'Iniciar sesión como otro usuario')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.role_permissions (role, permission_key)
SELECT r::app_role, k FROM
  (VALUES ('SUBADMIN'),('RECEPCION'),('CAJA'),('CONTABILIDAD'),('DOCTOR'),('AUDITOR')) AS roles(r),
  (VALUES ('view.profile'),('view.notifications')) AS perms(k)
ON CONFLICT DO NOTHING;
