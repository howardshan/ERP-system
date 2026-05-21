-- Migration M-015: Add role (job title) column to erp_user; update list_erp_users RPC
-- Depends on: M-011

ALTER TABLE erp_user ADD COLUMN IF NOT EXISTS role text;

-- DROP first because adding a column to RETURNS TABLE requires recreating the function
DROP FUNCTION IF EXISTS list_erp_users();

CREATE OR REPLACE FUNCTION list_erp_users()
RETURNS TABLE (
  erp_user_id  uuid,
  auth_user_id uuid,
  email        text,
  full_name    text,
  role         text,
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
    ep.role,
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
