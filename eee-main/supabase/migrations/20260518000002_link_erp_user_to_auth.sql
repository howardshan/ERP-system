-- Migration M-010: Link erp_user to Supabase Auth users
-- Depends on: M-009

-- Add foreign key to auth.users
ALTER TABLE erp_user ADD COLUMN IF NOT EXISTS auth_user_id uuid REFERENCES auth.users(id) UNIQUE;

-- RPC: list all auth users with erp profile overlay (SECURITY DEFINER to read auth.users)
CREATE OR REPLACE FUNCTION list_erp_users()
RETURNS TABLE (
  erp_user_id  uuid,
  auth_user_id uuid,
  email        text,
  full_name    text,
  department   text,
  manager_id   uuid,
  manager_name text,
  is_active    boolean,
  created_at   timestamptz
)
SECURITY DEFINER
LANGUAGE sql AS $$
  SELECT
    COALESCE(ep.id, au.id)                                                        AS erp_user_id,
    au.id                                                                          AS auth_user_id,
    au.email,
    COALESCE(ep.full_name,
             au.raw_user_meta_data->>'full_name',
             split_part(au.email, '@', 1))                                         AS full_name,
    ep.department,
    ep.manager_id,
    mgr.full_name                                                                  AS manager_name,
    COALESCE(ep.is_active, true)                                                   AS is_active,
    COALESCE(ep.created_at, au.created_at)                                         AS created_at
  FROM auth.users au
  LEFT JOIN erp_user ep  ON ep.auth_user_id = au.id
  LEFT JOIN erp_user mgr ON mgr.id = ep.manager_id
  ORDER BY COALESCE(ep.full_name, au.email);
$$;

-- Trigger: auto-create erp_user profile when a new auth user registers
CREATE OR REPLACE FUNCTION handle_new_auth_user()
RETURNS trigger
SECURITY DEFINER
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO erp_user (auth_user_id, full_name, email)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    NEW.email
  )
  ON CONFLICT (auth_user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_auth_user();

-- Sync existing auth users who don't yet have an erp_user row
INSERT INTO erp_user (auth_user_id, full_name, email)
SELECT
  au.id,
  COALESCE(au.raw_user_meta_data->>'full_name', split_part(au.email, '@', 1)),
  au.email
FROM auth.users au
WHERE NOT EXISTS (
  SELECT 1 FROM erp_user ep WHERE ep.auth_user_id = au.id
);
