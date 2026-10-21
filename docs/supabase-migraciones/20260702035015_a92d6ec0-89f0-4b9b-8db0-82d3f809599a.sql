
CREATE OR REPLACE FUNCTION public.protect_profile_approved()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.approved IS DISTINCT FROM OLD.approved THEN
    IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'ADMIN'::app_role) THEN
      RAISE EXCEPTION 'Solo un administrador puede modificar el estado de aprobación';
    END IF;
  END IF;
  RETURN NEW;
END; $$;

REVOKE EXECUTE ON FUNCTION public.protect_profile_approved() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_protect_profile_approved ON public.profiles;
CREATE TRIGGER trg_protect_profile_approved
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.protect_profile_approved();
