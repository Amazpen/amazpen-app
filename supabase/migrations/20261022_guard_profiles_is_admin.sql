-- Only an existing admin (or the server: service_role / postgres) may set
-- profiles.is_admin or change profiles.email. The profiles_update policy lets
-- every user update their own row, so without this guard any user could make
-- themselves admin, or take over an email that admin screens match members by.
-- SECURITY INVOKER on purpose: current_user must be the caller's role.
CREATE OR REPLACE FUNCTION public.guard_profiles_is_admin()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon')
     AND (
       (TG_OP = 'INSERT' AND NEW.is_admin IS TRUE)
       OR (TG_OP = 'UPDATE' AND (NEW.is_admin IS DISTINCT FROM OLD.is_admin
                                 OR NEW.email IS DISTINCT FROM OLD.email))
     )
     AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'only an admin can change is_admin or email' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_profiles_is_admin ON public.profiles;
CREATE TRIGGER trg_guard_profiles_is_admin
  BEFORE INSERT OR UPDATE OF is_admin, email ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_profiles_is_admin();
