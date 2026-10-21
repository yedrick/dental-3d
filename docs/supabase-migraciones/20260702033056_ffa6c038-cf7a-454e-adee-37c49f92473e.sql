
ALTER TABLE public.bank_deposits ADD COLUMN IF NOT EXISTS receipt_url TEXT;
ALTER TABLE public.third_party_payments ADD COLUMN IF NOT EXISTS receipt_url TEXT;

CREATE POLICY "Staff can view receipts" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'receipts' AND public.has_any_role(auth.uid(), ARRAY['ADMIN','CAJA','CONTABILIDAD','SUBADMIN']::app_role[]));
CREATE POLICY "Staff can upload receipts" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'receipts' AND public.has_any_role(auth.uid(), ARRAY['ADMIN','CAJA','CONTABILIDAD']::app_role[]));
CREATE POLICY "Staff can update receipts" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'receipts' AND public.has_any_role(auth.uid(), ARRAY['ADMIN','CAJA','CONTABILIDAD']::app_role[]));
CREATE POLICY "Staff can delete receipts" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'receipts' AND public.has_any_role(auth.uid(), ARRAY['ADMIN','CAJA','CONTABILIDAD']::app_role[]));
