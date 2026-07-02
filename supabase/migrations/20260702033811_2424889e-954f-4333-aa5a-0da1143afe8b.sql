CREATE OR REPLACE FUNCTION public.log_audit_event(_action text, _table_name text, _record_id text, _data jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public.has_any_role(auth.uid(), ARRAY['ADMIN','SUBADMIN','RECEPCION','CAJA','CONTABILIDAD']::app_role[]) THEN
    RAISE EXCEPTION 'Insufficient privileges to record audit event';
  END IF;
  IF _action NOT IN (
    'CHARGE','DELIVER','CHARGE_ALL',
    'ATTENTION_CREATE',
    'APPOINTMENT_CREATE','APPOINTMENT_UPDATE','APPOINTMENT_DELETE','APPOINTMENT_STATUS'
  ) THEN
    RAISE EXCEPTION 'Invalid audit action: %', _action;
  END IF;
  INSERT INTO public.audit_logs(user_id, action, table_name, record_id, data)
  VALUES (auth.uid(), _action, _table_name, _record_id, _data);
END; $function$;