
-- Grant view permissions to SUBADMIN
INSERT INTO public.role_permissions (role, permission_key)
SELECT 'SUBADMIN'::app_role, key FROM public.permissions
WHERE key IN (
  'view.dashboard','view.doctors','view.patients','view.studies','view.attention',
  'view.appointments','view.delivery','view.commissions','view.cashbox',
  'view.deposits','view.third_party','view.reports'
)
ON CONFLICT DO NOTHING;

-- Add SUBADMIN to SELECT policies (read-only) on clinical + financial tables
DROP POLICY IF EXISTS "Read doctors" ON public.doctors;
CREATE POLICY "Read doctors" ON public.doctors FOR SELECT
  USING (has_any_role(auth.uid(), ARRAY['ADMIN','SUBADMIN','RECEPCION','CAJA','CONTABILIDAD','AUDITOR']::app_role[]));

DROP POLICY IF EXISTS "Read patients" ON public.patients;
CREATE POLICY "Read patients" ON public.patients FOR SELECT
  USING (has_any_role(auth.uid(), ARRAY['ADMIN','SUBADMIN','RECEPCION','CAJA','CONTABILIDAD','DOCTOR','AUDITOR']::app_role[]));

DROP POLICY IF EXISTS "Read patient_studies" ON public.patient_studies;
CREATE POLICY "Read patient_studies" ON public.patient_studies FOR SELECT
  USING (has_any_role(auth.uid(), ARRAY['ADMIN','SUBADMIN','RECEPCION','CAJA','CONTABILIDAD','AUDITOR','DOCTOR']::app_role[]));

DROP POLICY IF EXISTS appointments_read ON public.appointments;
CREATE POLICY appointments_read ON public.appointments FOR SELECT
  USING (has_any_role(auth.uid(), ARRAY['ADMIN','SUBADMIN','RECEPCION','DOCTOR','AUDITOR']::app_role[]));

DROP POLICY IF EXISTS "Read cashbox" ON public.cashbox;
CREATE POLICY "Read cashbox" ON public.cashbox FOR SELECT
  USING (has_any_role(auth.uid(), ARRAY['ADMIN','SUBADMIN','CAJA','CONTABILIDAD','AUDITOR']::app_role[]));

DROP POLICY IF EXISTS "Read deposits" ON public.bank_deposits;
CREATE POLICY "Read deposits" ON public.bank_deposits FOR SELECT
  USING (has_any_role(auth.uid(), ARRAY['ADMIN','SUBADMIN','CAJA','CONTABILIDAD','AUDITOR']::app_role[]));

DROP POLICY IF EXISTS "Read tpp" ON public.third_party_payments;
CREATE POLICY "Read tpp" ON public.third_party_payments FOR SELECT
  USING (has_any_role(auth.uid(), ARRAY['ADMIN','SUBADMIN','CONTABILIDAD','AUDITOR']::app_role[]));

DROP POLICY IF EXISTS "Read commissions" ON public.commissions;
CREATE POLICY "Read commissions" ON public.commissions FOR SELECT
  USING (has_any_role(auth.uid(), ARRAY['ADMIN','SUBADMIN','CONTABILIDAD','AUDITOR','DOCTOR']::app_role[]));
