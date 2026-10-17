
-- Fix search_path on trigger function that was missing it
ALTER FUNCTION public.prevent_service_date_change() SET search_path = public;

-- Revoke direct EXECUTE on SECURITY DEFINER trigger functions (called only by triggers)
REVOKE EXECUTE ON FUNCTION public.set_cashbox_balance() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.prevent_service_date_change() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.deactivate_prev_prices() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.audit_trigger() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.calc_commission() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_patient_study_price() FROM PUBLIC, anon, authenticated;

-- Revoke anon EXECUTE from RLS helper functions (only authenticated needs to invoke via RLS)
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.has_any_role(uuid, app_role[]) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.has_permission(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_any_role(uuid, app_role[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_permission(uuid, text) TO authenticated;

-- Restrict overly permissive SELECT policies to authorised roles
DROP POLICY IF EXISTS "appointments_read" ON public.appointments;
CREATE POLICY "appointments_read" ON public.appointments
  FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['ADMIN','RECEPCION','DOCTOR','AUDITOR']::app_role[]));

DROP POLICY IF EXISTS "Read patients" ON public.patients;
CREATE POLICY "Read patients" ON public.patients
  FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['ADMIN','RECEPCION','CAJA','CONTABILIDAD','DOCTOR','AUDITOR']::app_role[]));

DROP POLICY IF EXISTS "Read doctors" ON public.doctors;
CREATE POLICY "Read doctors" ON public.doctors
  FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['ADMIN','RECEPCION','CAJA','CONTABILIDAD','AUDITOR']::app_role[]));

DROP POLICY IF EXISTS "Read patient_studies" ON public.patient_studies;
CREATE POLICY "Read patient_studies" ON public.patient_studies
  FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['ADMIN','RECEPCION','CAJA','CONTABILIDAD','AUDITOR','DOCTOR']::app_role[]));

-- Replace open audit_logs INSERT policy with SECURITY DEFINER RPC
DROP POLICY IF EXISTS "Authenticated can insert audit logs" ON public.audit_logs;

CREATE OR REPLACE FUNCTION public.log_audit_event(_action text, _table_name text, _record_id text, _data jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public.has_any_role(auth.uid(), ARRAY['ADMIN','RECEPCION','CAJA','CONTABILIDAD']::app_role[]) THEN
    RAISE EXCEPTION 'Insufficient privileges to record audit event';
  END IF;
  IF _action NOT IN ('CHARGE','DELIVER') THEN
    RAISE EXCEPTION 'Invalid audit action: %', _action;
  END IF;
  INSERT INTO public.audit_logs(user_id, action, table_name, record_id, data)
  VALUES (auth.uid(), _action, _table_name, _record_id, _data);
END; $$;

REVOKE EXECUTE ON FUNCTION public.log_audit_event(text, text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_audit_event(text, text, text, jsonb) TO authenticated;
