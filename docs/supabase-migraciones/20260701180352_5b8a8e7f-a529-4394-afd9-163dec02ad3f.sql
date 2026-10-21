
ALTER TABLE public.doctors ADD COLUMN IF NOT EXISTS agreement_discount_pct NUMERIC(5,2) NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.set_patient_study_price()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _p NUMERIC(12,2);
  _pct NUMERIC(12,4);
  _disc_pct NUMERIC(5,2);
BEGIN
  IF NEW.doctor_id IS NULL THEN
    SELECT doctor_id INTO NEW.doctor_id FROM public.patients WHERE id = NEW.patient_id;
  END IF;

  IF NEW.is_voucher THEN
    NEW.price := 0;
    NEW.invoice_surcharge := 0;
    NEW.discount := 0;
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
    -- Apply doctor/clinic agreement discount if none provided
    IF COALESCE(NEW.discount,0) = 0 AND NEW.doctor_id IS NOT NULL THEN
      SELECT COALESCE(agreement_discount_pct,0) INTO _disc_pct FROM public.doctors WHERE id = NEW.doctor_id;
      IF COALESCE(_disc_pct,0) > 0 THEN
        NEW.discount := ROUND((_p * _disc_pct / 100.0)::numeric, 2);
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
