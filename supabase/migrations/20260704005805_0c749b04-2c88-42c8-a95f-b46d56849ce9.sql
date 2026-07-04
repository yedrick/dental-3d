ALTER TABLE public.bank_deposits
  DROP CONSTRAINT IF EXISTS bank_deposits_created_by_fkey;
ALTER TABLE public.bank_deposits
  ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE public.bank_deposits
  ADD CONSTRAINT bank_deposits_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.cashbox
  DROP CONSTRAINT IF EXISTS cashbox_created_by_fkey;
ALTER TABLE public.cashbox
  ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE public.cashbox
  ADD CONSTRAINT cashbox_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.doctors
  DROP CONSTRAINT IF EXISTS doctors_created_by_fkey;
ALTER TABLE public.doctors
  ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE public.doctors
  ADD CONSTRAINT doctors_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.patient_studies
  DROP CONSTRAINT IF EXISTS patient_studies_created_by_fkey;
ALTER TABLE public.patient_studies
  ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE public.patient_studies
  ADD CONSTRAINT patient_studies_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.patients
  DROP CONSTRAINT IF EXISTS patients_created_by_fkey;
ALTER TABLE public.patients
  ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE public.patients
  ADD CONSTRAINT patients_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.third_party_payments
  DROP CONSTRAINT IF EXISTS third_party_payments_created_by_fkey;
ALTER TABLE public.third_party_payments
  ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE public.third_party_payments
  ADD CONSTRAINT third_party_payments_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;