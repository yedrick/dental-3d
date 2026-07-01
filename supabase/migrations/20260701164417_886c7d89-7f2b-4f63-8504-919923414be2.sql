
-- ============ ENUMS ============
CREATE TYPE public.app_role AS ENUM ('ADMIN','RECEPCION','CAJA','CONTABILIDAD','DOCTOR','AUDITOR');
CREATE TYPE public.payment_method AS ENUM ('cash','qr','card');

-- ============ PROFILES ============
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username TEXT UNIQUE NOT NULL,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- ============ USER_ROLES ============
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- has_role
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

CREATE OR REPLACE FUNCTION public.has_any_role(_user_id UUID, _roles public.app_role[])
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = ANY(_roles));
$$;

-- Profiles policies
CREATE POLICY "Users see own profile" ON public.profiles FOR SELECT TO authenticated
  USING (id = auth.uid() OR public.has_role(auth.uid(),'ADMIN') OR public.has_role(auth.uid(),'AUDITOR'));
CREATE POLICY "Users update own profile" ON public.profiles FOR UPDATE TO authenticated
  USING (id = auth.uid() OR public.has_role(auth.uid(),'ADMIN'));
CREATE POLICY "Insert own profile" ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (id = auth.uid() OR public.has_role(auth.uid(),'ADMIN'));

-- user_roles policies
CREATE POLICY "See own roles" ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(),'ADMIN') OR public.has_role(auth.uid(),'AUDITOR'));
CREATE POLICY "Admin manages roles" ON public.user_roles FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'ADMIN')) WITH CHECK (public.has_role(auth.uid(),'ADMIN'));

-- Trigger create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _username TEXT;
  _fullname TEXT;
  _is_first BOOLEAN;
BEGIN
  _username := COALESCE(NEW.raw_user_meta_data->>'username', split_part(NEW.email,'@',1));
  _fullname := COALESCE(NEW.raw_user_meta_data->>'full_name', _username);
  INSERT INTO public.profiles (id, username, full_name, email)
  VALUES (NEW.id, _username, _fullname, NEW.email);

  SELECT NOT EXISTS(SELECT 1 FROM public.user_roles) INTO _is_first;
  IF _is_first THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'ADMIN');
  ELSE
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'RECEPCION');
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============ DOCTORS ============
CREATE TABLE public.doctors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL,
  clinic_address TEXT,
  phone TEXT,
  email TEXT,
  bank_account TEXT,
  status BOOLEAN NOT NULL DEFAULT true,
  default_commission_pct NUMERIC(5,2) NOT NULL DEFAULT 20,
  created_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.doctors TO authenticated;
GRANT ALL ON public.doctors TO service_role;
ALTER TABLE public.doctors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Read doctors" ON public.doctors FOR SELECT TO authenticated USING (true);
CREATE POLICY "Manage doctors" ON public.doctors FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['ADMIN','RECEPCION']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['ADMIN','RECEPCION']::public.app_role[]));

-- ============ PATIENTS ============
CREATE TABLE public.patients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doctor_id UUID NOT NULL REFERENCES public.doctors(id),
  full_name TEXT NOT NULL,
  birth_date DATE,
  phone TEXT,
  created_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.patients TO authenticated;
GRANT ALL ON public.patients TO service_role;
ALTER TABLE public.patients ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Read patients" ON public.patients FOR SELECT TO authenticated USING (true);
CREATE POLICY "Manage patients" ON public.patients FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['ADMIN','RECEPCION']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['ADMIN','RECEPCION']::public.app_role[]));

-- ============ STUDIES ============
CREATE TABLE public.studies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.studies TO authenticated;
GRANT ALL ON public.studies TO service_role;
ALTER TABLE public.studies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Read studies" ON public.studies FOR SELECT TO authenticated USING (true);
CREATE POLICY "Manage studies" ON public.studies FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'ADMIN')) WITH CHECK (public.has_role(auth.uid(),'ADMIN'));

-- ============ STUDY_PRICES ============
CREATE TABLE public.study_prices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  study_id UUID NOT NULL REFERENCES public.studies(id) ON DELETE CASCADE,
  price_with_report NUMERIC(12,2) NOT NULL,
  price_without_report NUMERIC(12,2) NOT NULL,
  effective_date DATE NOT NULL DEFAULT CURRENT_DATE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX study_prices_one_active ON public.study_prices(study_id) WHERE is_active;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.study_prices TO authenticated;
GRANT ALL ON public.study_prices TO service_role;
ALTER TABLE public.study_prices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Read prices" ON public.study_prices FOR SELECT TO authenticated USING (true);
CREATE POLICY "Manage prices" ON public.study_prices FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'ADMIN')) WITH CHECK (public.has_role(auth.uid(),'ADMIN'));

-- Al insertar activa, desactiva anteriores
CREATE OR REPLACE FUNCTION public.deactivate_prev_prices()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.is_active THEN
    UPDATE public.study_prices SET is_active = false
      WHERE study_id = NEW.study_id AND id <> NEW.id AND is_active;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER trg_study_prices_active BEFORE INSERT OR UPDATE ON public.study_prices
  FOR EACH ROW EXECUTE FUNCTION public.deactivate_prev_prices();

-- ============ PATIENT_STUDIES ============
CREATE TABLE public.patient_studies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES public.patients(id),
  study_id UUID NOT NULL REFERENCES public.studies(id),
  price NUMERIC(12,2) NOT NULL DEFAULT 0,
  has_report BOOLEAN NOT NULL DEFAULT false,
  payment_method public.payment_method,
  invoice_number TEXT,
  delivery_date DATE,
  is_voucher BOOLEAN NOT NULL DEFAULT false,
  created_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.patient_studies TO authenticated;
GRANT ALL ON public.patient_studies TO service_role;
ALTER TABLE public.patient_studies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Read patient_studies" ON public.patient_studies FOR SELECT TO authenticated USING (true);
CREATE POLICY "Manage patient_studies" ON public.patient_studies FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['ADMIN','RECEPCION','CAJA']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['ADMIN','RECEPCION','CAJA']::public.app_role[]));

-- Precio automático desde tarifa activa
CREATE OR REPLACE FUNCTION public.set_patient_study_price()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _p NUMERIC(12,2);
BEGIN
  IF NEW.is_voucher THEN
    NEW.price := 0;
  ELSE
    SELECT CASE WHEN NEW.has_report THEN price_with_report ELSE price_without_report END
      INTO _p FROM public.study_prices WHERE study_id = NEW.study_id AND is_active;
    IF _p IS NULL THEN
      RAISE EXCEPTION 'No hay tarifa activa para el estudio %', NEW.study_id;
    END IF;
    NEW.price := _p;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER trg_set_price BEFORE INSERT ON public.patient_studies
  FOR EACH ROW EXECUTE FUNCTION public.set_patient_study_price();

-- ============ COMMISSIONS ============
CREATE TABLE public.commissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doctor_id UUID NOT NULL REFERENCES public.doctors(id),
  patient_study_id UUID NOT NULL REFERENCES public.patient_studies(id) ON DELETE CASCADE,
  commission_amount NUMERIC(12,2) NOT NULL,
  percentage NUMERIC(5,2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.commissions TO authenticated;
GRANT ALL ON public.commissions TO service_role;
ALTER TABLE public.commissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Read commissions" ON public.commissions FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['ADMIN','CONTABILIDAD','AUDITOR','DOCTOR']::public.app_role[]));
CREATE POLICY "Manage commissions" ON public.commissions FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['ADMIN','CONTABILIDAD']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['ADMIN','CONTABILIDAD']::public.app_role[]));

-- Cálculo automático de comisión
CREATE OR REPLACE FUNCTION public.calc_commission()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _doctor_id UUID;
  _pct NUMERIC(5,2);
  _amount NUMERIC(12,2);
  _is_first BOOLEAN;
BEGIN
  SELECT doctor_id INTO _doctor_id FROM public.patients WHERE id = NEW.patient_id;
  SELECT default_commission_pct INTO _pct FROM public.doctors WHERE id = _doctor_id;

  -- ¿Primer paciente del doctor?
  SELECT NOT EXISTS (
    SELECT 1 FROM public.patient_studies ps
    JOIN public.patients p ON p.id = ps.patient_id
    WHERE p.doctor_id = _doctor_id AND ps.id <> NEW.id
  ) INTO _is_first;

  IF NEW.is_voucher THEN
    _amount := 50;
    _pct := 0;
  ELSIF _is_first THEN
    _pct := 50;
    _amount := NEW.price * 0.5;
  ELSE
    _amount := NEW.price * (_pct / 100.0);
  END IF;

  INSERT INTO public.commissions (doctor_id, patient_study_id, commission_amount, percentage)
  VALUES (_doctor_id, NEW.id, _amount, _pct);
  RETURN NEW;
END; $$;
CREATE TRIGGER trg_calc_commission AFTER INSERT ON public.patient_studies
  FOR EACH ROW EXECUTE FUNCTION public.calc_commission();

-- ============ CASHBOX ============
CREATE TABLE public.cashbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  description TEXT NOT NULL,
  income NUMERIC(12,2) NOT NULL DEFAULT 0,
  expense NUMERIC(12,2) NOT NULL DEFAULT 0,
  balance NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cashbox TO authenticated;
GRANT ALL ON public.cashbox TO service_role;
ALTER TABLE public.cashbox ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Read cashbox" ON public.cashbox FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['ADMIN','CAJA','CONTABILIDAD','AUDITOR']::public.app_role[]));
CREATE POLICY "Manage cashbox" ON public.cashbox FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['ADMIN','CAJA']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['ADMIN','CAJA']::public.app_role[]));

CREATE OR REPLACE FUNCTION public.set_cashbox_balance()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _prev NUMERIC(12,2);
BEGIN
  SELECT COALESCE(balance,0) INTO _prev FROM public.cashbox
    ORDER BY created_at DESC, id DESC LIMIT 1;
  NEW.balance := COALESCE(_prev,0) + COALESCE(NEW.income,0) - COALESCE(NEW.expense,0);
  RETURN NEW;
END; $$;
CREATE TRIGGER trg_cashbox_balance BEFORE INSERT ON public.cashbox
  FOR EACH ROW EXECUTE FUNCTION public.set_cashbox_balance();

-- ============ BANK_DEPOSITS ============
CREATE TABLE public.bank_deposits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  amount NUMERIC(12,2) NOT NULL,
  deposit_date DATE NOT NULL,
  reference TEXT,
  created_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bank_deposits TO authenticated;
GRANT ALL ON public.bank_deposits TO service_role;
ALTER TABLE public.bank_deposits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Read deposits" ON public.bank_deposits FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['ADMIN','CAJA','CONTABILIDAD','AUDITOR']::public.app_role[]));
CREATE POLICY "Manage deposits" ON public.bank_deposits FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['ADMIN','CAJA','CONTABILIDAD']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['ADMIN','CAJA','CONTABILIDAD']::public.app_role[]));

-- ============ THIRD_PARTY_PAYMENTS ============
CREATE TABLE public.third_party_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_name TEXT NOT NULL,
  service_type TEXT NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  service_date DATE NOT NULL,
  payment_date DATE NOT NULL,
  created_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.third_party_payments TO authenticated;
GRANT ALL ON public.third_party_payments TO service_role;
ALTER TABLE public.third_party_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Read tpp" ON public.third_party_payments FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['ADMIN','CONTABILIDAD','AUDITOR']::public.app_role[]));
CREATE POLICY "Manage tpp" ON public.third_party_payments FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['ADMIN','CONTABILIDAD']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['ADMIN','CONTABILIDAD']::public.app_role[]));

-- Bloquear cambio de service_date
CREATE OR REPLACE FUNCTION public.prevent_service_date_change()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.service_date IS DISTINCT FROM OLD.service_date THEN
    RAISE EXCEPTION 'La fecha de servicio no puede modificarse después de guardar';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER trg_lock_service_date BEFORE UPDATE ON public.third_party_payments
  FOR EACH ROW EXECUTE FUNCTION public.prevent_service_date_change();

-- ============ AUDIT_LOGS ============
CREATE TABLE public.audit_logs (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID,
  action TEXT NOT NULL,
  table_name TEXT NOT NULL,
  record_id TEXT,
  data JSONB,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.audit_logs TO authenticated;
GRANT ALL ON public.audit_logs TO service_role;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Read audit" ON public.audit_logs FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['ADMIN','AUDITOR']::public.app_role[]));

CREATE OR REPLACE FUNCTION public.audit_trigger()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _rid TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN _rid := OLD.id::text; ELSE _rid := NEW.id::text; END IF;
  INSERT INTO public.audit_logs(user_id, action, table_name, record_id, data)
  VALUES (auth.uid(), TG_OP, TG_TABLE_NAME, _rid,
          CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END);
  RETURN COALESCE(NEW, OLD);
END; $$;

CREATE TRIGGER audit_doctors AFTER INSERT OR UPDATE OR DELETE ON public.doctors
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();
CREATE TRIGGER audit_patients AFTER INSERT OR UPDATE OR DELETE ON public.patients
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();
CREATE TRIGGER audit_studies AFTER INSERT OR UPDATE OR DELETE ON public.studies
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();
CREATE TRIGGER audit_prices AFTER INSERT OR UPDATE OR DELETE ON public.study_prices
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();
CREATE TRIGGER audit_ps AFTER INSERT OR UPDATE OR DELETE ON public.patient_studies
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();
CREATE TRIGGER audit_cashbox AFTER INSERT OR UPDATE OR DELETE ON public.cashbox
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();
CREATE TRIGGER audit_deposits AFTER INSERT OR UPDATE OR DELETE ON public.bank_deposits
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();
CREATE TRIGGER audit_tpp AFTER INSERT OR UPDATE OR DELETE ON public.third_party_payments
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();
CREATE TRIGGER audit_user_roles AFTER INSERT OR UPDATE OR DELETE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();
