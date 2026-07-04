
-- Revoke EXECUTE on trigger-only SECURITY DEFINER functions from client-callable roles
REVOKE EXECUTE ON FUNCTION public.set_cashbox_balance() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.deactivate_prev_prices() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.audit_trigger() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_patient_study_price() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.protect_profile_approved() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.calc_commission() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.prevent_service_date_change() FROM PUBLIC, anon, authenticated;
