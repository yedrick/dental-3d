
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS status boolean NOT NULL DEFAULT true;
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS notes text;

CREATE TABLE IF NOT EXISTS public.appointments (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id uuid REFERENCES public.patients(id) ON DELETE CASCADE,
  patient_name text NOT NULL,
  patient_phone text,
  doctor_id uuid REFERENCES public.doctors(id) ON DELETE SET NULL,
  study_id uuid REFERENCES public.studies(id) ON DELETE SET NULL,
  starts_at timestamptz NOT NULL,
  duration_min integer NOT NULL DEFAULT 30,
  status text NOT NULL DEFAULT 'SCHEDULED',
  notes text,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.appointments TO authenticated;
GRANT ALL ON public.appointments TO service_role;
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "appointments_read" ON public.appointments FOR SELECT TO authenticated USING (true);
CREATE POLICY "appointments_write" ON public.appointments FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['ADMIN','RECEPCION']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['ADMIN','RECEPCION']::app_role[]));

CREATE INDEX IF NOT EXISTS appointments_starts_at_idx ON public.appointments(starts_at);
CREATE INDEX IF NOT EXISTS appointments_patient_idx ON public.appointments(patient_id);

INSERT INTO public.permissions (key, category, description) VALUES
  ('view.appointments','APPOINTMENTS','Ver agenda'),
  ('appointments.create','APPOINTMENTS','Crear cita'),
  ('appointments.edit','APPOINTMENTS','Editar cita'),
  ('appointments.delete','APPOINTMENTS','Eliminar cita'),
  ('patients.edit','PATIENTS','Editar paciente'),
  ('patients.delete','PATIENTS','Eliminar paciente'),
  ('doctors.edit','DOCTORS','Editar doctor'),
  ('doctors.delete','DOCTORS','Eliminar doctor')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.role_permissions (role, permission_key)
SELECT 'ADMIN'::app_role, key FROM public.permissions
WHERE key IN ('view.appointments','appointments.create','appointments.edit','appointments.delete','patients.edit','patients.delete','doctors.edit','doctors.delete')
ON CONFLICT DO NOTHING;

INSERT INTO public.role_permissions (role, permission_key)
SELECT 'RECEPCION'::app_role, key FROM public.permissions
WHERE key IN ('view.appointments','appointments.create','appointments.edit','appointments.delete','patients.edit')
ON CONFLICT DO NOTHING;
