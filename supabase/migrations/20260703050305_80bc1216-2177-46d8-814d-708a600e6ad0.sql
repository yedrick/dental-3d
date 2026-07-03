GRANT SELECT ON public.studies TO anon;
CREATE POLICY "Public read active studies" ON public.studies FOR SELECT TO anon USING (active = true);