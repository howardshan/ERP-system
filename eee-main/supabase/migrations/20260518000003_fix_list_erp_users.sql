-- Migration M-011: Fix list_erp_users to be erp_user-centric
-- Depends on: M-010
-- Without Supabase Auth users, the previous version returned empty.
-- This version queries FROM erp_user and optionally overlays auth data.

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
    ep.id                                                                          AS erp_user_id,
    ep.auth_user_id,
    COALESCE(au.email, ep.email)                                                   AS email,
    COALESCE(au.raw_user_meta_data->>'full_name', ep.full_name,
             split_part(COALESCE(au.email, ep.email), '@', 1))                     AS full_name,
    ep.department,
    ep.manager_id,
    mgr.full_name                                                                  AS manager_name,
    ep.is_active,
    ep.created_at
  FROM erp_user ep
  LEFT JOIN auth.users au  ON au.id = ep.auth_user_id
  LEFT JOIN erp_user mgr   ON mgr.id = ep.manager_id
  ORDER BY COALESCE(au.raw_user_meta_data->>'full_name', ep.full_name, au.email);
$$;
