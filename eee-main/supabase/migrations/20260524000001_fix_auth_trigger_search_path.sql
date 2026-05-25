-- Migration M-078: Fix auth → erp_user trigger search_path
-- Purpose: Triggers on auth.users run as supabase_auth_admin, whose search_path
--          may not resolve unqualified "erp_user" to public.erp_user (SQLSTATE 42P01).
--          Dashboard "Create user" and sign-up then fail with "Database error creating new user".

CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS trigger
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.erp_user (auth_user_id, full_name, email)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    NEW.email
  )
  ON CONFLICT (auth_user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.assign_employee_id()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.employee_id IS NULL THEN
    SELECT 'EMP-' || LPAD((COUNT(*) + 1)::text, 4, '0')
    INTO NEW.employee_id
    FROM public.erp_user;
  END IF;
  RETURN NEW;
END;
$$;
