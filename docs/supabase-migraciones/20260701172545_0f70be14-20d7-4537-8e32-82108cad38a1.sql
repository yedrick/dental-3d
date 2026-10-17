
-- ============ PERMISSIONS CATALOG ============
CREATE TABLE public.permissions (
  key TEXT PRIMARY KEY,
  description TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.permissions TO authenticated;
GRANT ALL ON public.permissions TO service_role;
ALTER TABLE public.permissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read permissions" ON public.permissions FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin manage permissions" ON public.permissions FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'ADMIN')) WITH CHECK (public.has_role(auth.uid(), 'ADMIN'));

-- ============ ROLE PERMISSIONS ============
CREATE TABLE public.role_permissions (
  role public.app_role NOT NULL,
  permission_key TEXT NOT NULL REFERENCES public.permissions(key) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (role, permission_key)
);
GRANT SELECT ON public.role_permissions TO authenticated;
GRANT ALL ON public.role_permissions TO service_role;
ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read role_perms" ON public.role_permissions FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin manage role_perms" ON public.role_permissions FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'ADMIN')) WITH CHECK (public.has_role(auth.uid(), 'ADMIN'));

-- has_permission function
CREATE OR REPLACE FUNCTION public.has_permission(_user_id uuid, _key text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    JOIN public.role_permissions rp ON rp.role = ur.role
    WHERE ur.user_id = _user_id AND rp.permission_key = _key
  );
$$;

-- Seed permissions catalog
INSERT INTO public.permissions (key, description, category) VALUES
  ('view.dashboard','Ver dashboard','vistas'),
  ('view.doctors','Ver doctores','vistas'),
  ('view.patients','Ver pacientes','vistas'),
  ('view.studies','Ver estudios y tarifas','vistas'),
  ('view.attention','Ver atenciones','vistas'),
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
  ('cashbox.create','Registrar movimiento de caja','acciones'),
  ('deposits.create','Registrar depósito','acciones'),
  ('third_party.create','Registrar pago a terceros','acciones'),
  ('reports.export','Exportar reportes PDF','acciones'),
  ('users.manage_roles','Asignar roles a usuarios','admin'),
  ('roles.manage_permissions','Modificar permisos de roles','admin'),
  ('params.edit','Modificar parámetros del sistema','admin')
ON CONFLICT (key) DO NOTHING;

-- Seed default role_permissions
INSERT INTO public.role_permissions (role, permission_key)
SELECT r::public.app_role, p.key FROM public.permissions p CROSS JOIN (VALUES ('ADMIN')) AS x(r)
ON CONFLICT DO NOTHING;

INSERT INTO public.role_permissions (role, permission_key) VALUES
  ('RECEPCION','view.dashboard'),('RECEPCION','view.doctors'),('RECEPCION','view.patients'),
  ('RECEPCION','view.studies'),('RECEPCION','view.attention'),('RECEPCION','view.delivery'),
  ('RECEPCION','patients.create'),('RECEPCION','patients.edit'),
  ('RECEPCION','doctors.create'),('RECEPCION','doctors.edit'),
  ('RECEPCION','attention.create'),('RECEPCION','attention.charge'),('RECEPCION','attention.deliver'),
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
  ('AUDITOR','view.third_party'),('AUDITOR','view.reports'),('AUDITOR','view.audit')
ON CONFLICT DO NOTHING;

-- ============ APP PARAMS ============
CREATE TABLE public.app_params (
  key TEXT PRIMARY KEY,
  value_num NUMERIC(12,4),
  value_text TEXT,
  value_bool BOOLEAN,
  description TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID
);
GRANT SELECT ON public.app_params TO authenticated;
GRANT ALL ON public.app_params TO service_role;
ALTER TABLE public.app_params ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read params" ON public.app_params FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin manage params" ON public.app_params FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'ADMIN')) WITH CHECK (public.has_role(auth.uid(), 'ADMIN'));

INSERT INTO public.app_params (key, value_num, description) VALUES
  ('default_commission_pct', 20, 'Porcentaje de comisión por defecto para nuevos doctores'),
  ('first_patient_commission_pct', 50, 'Porcentaje de comisión por el primer paciente de un doctor'),
  ('voucher_amount', 50, 'Monto en Bs del vale (para comisiones)'),
  ('invoice_surcharge_pct', 13, 'Recargo % cuando se emite factura'),
  ('default_discount_pct', 0, 'Descuento % por defecto (0 = sin descuento)'),
  ('debt_alert_days', 15, 'Días máximos de deuda antes de alertar')
ON CONFLICT (key) DO NOTHING;

-- ============ PATIENT_STUDIES additions ============
ALTER TABLE public.patient_studies
  ADD COLUMN IF NOT EXISTS doctor_id UUID REFERENCES public.doctors(id),
  ADD COLUMN IF NOT EXISTS clinic_name TEXT,
  ADD COLUMN IF NOT EXISTS with_invoice BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS invoice_surcharge NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS amount_paid NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivered_by UUID;

-- Update price trigger to also compute invoice surcharge & default doctor
CREATE OR REPLACE FUNCTION public.set_patient_study_price()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _p NUMERIC(12,2);
  _pct NUMERIC(12,4);
BEGIN
  -- default doctor from patient if not provided
  IF NEW.doctor_id IS NULL THEN
    SELECT doctor_id INTO NEW.doctor_id FROM public.patients WHERE id = NEW.patient_id;
  END IF;

  IF NEW.is_voucher THEN
    NEW.price := 0;
    NEW.invoice_surcharge := 0;
  ELSE
    SELECT CASE WHEN NEW.has_report THEN price_with_report ELSE price_without_report END
      INTO _p FROM public.study_prices WHERE study_id = NEW.study_id AND is_active;
    IF _p IS NULL THEN
      RAISE EXCEPTION 'No hay tarifa activa para el estudio %', NEW.study_id;
    END IF;
    NEW.price := _p;
    IF NEW.with_invoice THEN
      SELECT COALESCE(value_num,0) INTO _pct FROM public.app_params WHERE key='invoice_surcharge_pct';
      NEW.invoice_surcharge := ROUND((_p * COALESCE(_pct,0) / 100.0)::numeric, 2);
    ELSE
      NEW.invoice_surcharge := 0;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- Update commission trigger to read from app_params
CREATE OR REPLACE FUNCTION public.calc_commission()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _doctor_id UUID;
  _pct NUMERIC(12,4);
  _first_pct NUMERIC(12,4);
  _voucher_amt NUMERIC(12,4);
  _amount NUMERIC(12,2);
  _is_first BOOLEAN;
BEGIN
  _doctor_id := COALESCE(NEW.doctor_id, (SELECT doctor_id FROM public.patients WHERE id = NEW.patient_id));
  SELECT default_commission_pct INTO _pct FROM public.doctors WHERE id = _doctor_id;
  SELECT COALESCE(value_num,50) INTO _first_pct FROM public.app_params WHERE key='first_patient_commission_pct';
  SELECT COALESCE(value_num,50) INTO _voucher_amt FROM public.app_params WHERE key='voucher_amount';

  SELECT NOT EXISTS (
    SELECT 1 FROM public.patient_studies ps
    JOIN public.patients p ON p.id = ps.patient_id
    WHERE p.doctor_id = _doctor_id AND ps.id <> NEW.id
  ) INTO _is_first;

  IF NEW.is_voucher THEN
    _amount := _voucher_amt;
    _pct := 0;
  ELSIF _is_first THEN
    _pct := _first_pct;
    _amount := NEW.price * (_first_pct / 100.0);
  ELSE
    _amount := NEW.price * (COALESCE(_pct,0) / 100.0);
  END IF;

  INSERT INTO public.commissions (doctor_id, patient_study_id, commission_amount, percentage)
  VALUES (_doctor_id, NEW.id, _amount, _pct);
  RETURN NEW;
END;
$function$;
