CREATE POLICY "Authenticated can insert audit logs" ON public.audit_logs
FOR INSERT TO authenticated
WITH CHECK (user_id = auth.uid());