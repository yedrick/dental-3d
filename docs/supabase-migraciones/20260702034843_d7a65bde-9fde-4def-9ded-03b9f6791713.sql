
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS approved BOOLEAN NOT NULL DEFAULT false;

-- Approve all existing users so nobody gets locked out
UPDATE public.profiles SET approved = true WHERE approved = false;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _username TEXT;
  _fullname TEXT;
  _is_first BOOLEAN;
BEGIN
  _username := COALESCE(NEW.raw_user_meta_data->>'username', split_part(NEW.email,'@',1));
  _fullname := COALESCE(NEW.raw_user_meta_data->>'full_name', _username);

  SELECT NOT EXISTS(SELECT 1 FROM public.user_roles) INTO _is_first;

  INSERT INTO public.profiles (id, username, full_name, email, approved)
  VALUES (NEW.id, _username, _fullname, NEW.email, _is_first);

  IF _is_first THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'ADMIN');
  ELSE
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'RECEPCION');
  END IF;
  RETURN NEW;
END; $function$;
