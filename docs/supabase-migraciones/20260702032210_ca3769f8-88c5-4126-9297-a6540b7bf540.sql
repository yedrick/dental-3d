
ALTER TABLE public.studies ADD COLUMN IF NOT EXISTS fixed_commission numeric(12,2) NOT NULL DEFAULT 0;
ALTER TABLE public.doctors ADD COLUMN IF NOT EXISTS use_percentage boolean NOT NULL DEFAULT false;

UPDATE public.doctors SET default_commission_pct = 20 WHERE default_commission_pct > 20;
UPDATE public.doctors SET default_commission_pct = 0 WHERE default_commission_pct < 0;

ALTER TABLE public.doctors DROP CONSTRAINT IF EXISTS doctors_pct_max_20;
ALTER TABLE public.doctors ADD CONSTRAINT doctors_pct_max_20 CHECK (default_commission_pct >= 0 AND default_commission_pct <= 20);

CREATE OR REPLACE FUNCTION public.calc_commission()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _doctor_id UUID;
  _use_pct BOOLEAN;
  _pct NUMERIC(12,4);
  _first_pct NUMERIC(12,4);
  _voucher_amt NUMERIC(12,4);
  _fixed NUMERIC(12,2);
  _amount NUMERIC(12,2);
  _is_first BOOLEAN;
BEGIN
  _doctor_id := COALESCE(NEW.doctor_id, (SELECT doctor_id FROM public.patients WHERE id = NEW.patient_id));
  SELECT default_commission_pct, use_percentage INTO _pct, _use_pct FROM public.doctors WHERE id = _doctor_id;
  SELECT COALESCE(fixed_commission,0) INTO _fixed FROM public.studies WHERE id = NEW.study_id;
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
  ELSIF COALESCE(_use_pct,false) THEN
    IF _is_first THEN
      _pct := _first_pct;
    END IF;
    _amount := NEW.price * (COALESCE(_pct,0) / 100.0);
  ELSE
    _amount := _fixed;
    _pct := 0;
  END IF;

  INSERT INTO public.commissions (doctor_id, patient_study_id, commission_amount, percentage)
  VALUES (_doctor_id, NEW.id, _amount, _pct);
  RETURN NEW;
END;
$function$;
