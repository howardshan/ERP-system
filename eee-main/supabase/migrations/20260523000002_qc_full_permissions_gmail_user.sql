-- M-063: Grant the full QC permission set to shayiqing16@gmail.com.
--
-- All previous QC permission seeds (M-040, M-050, etc.) only targeted
-- ysha@smu.edu. The gmail account only had qc.analysis.view from one
-- explicit seed (20260519000014) which means every other QC page was
-- gated out and analysis.view is the only one that could appear — but
-- even that is unreliable if the row was missing.
--
-- This migration mirrors the full set from M-040 + adds analysis.view,
-- retest permission, and the module-level access grant for the gmail user.

-- Module access (show QC in the sidebar)
INSERT INTO user_module_access (user_id, module_id)
SELECT eu.id, 'qc'
FROM erp_user eu
WHERE eu.email = 'shayiqing16@gmail.com'
ON CONFLICT DO NOTHING;

-- Full permission set (same as M-040 for ysha, plus analysis.view)
INSERT INTO user_permission_grant (user_id, module_id, resource, permission, approval_limit)
SELECT eu.id, 'qc', p.resource, p.permission, NULL
FROM erp_user eu
CROSS JOIN (VALUES
  ('module_permissions', 'manage'),

  -- Production
  ('production',         'create_batch'),

  -- Batches
  ('batches',            'view'),
  ('batches',            'create'),
  ('batches',            'delete'),

  -- Dry Rooms
  ('dry_rooms',          'view_status'),
  ('dry_rooms',          'check_in'),
  ('dry_rooms',          'move'),
  ('dry_rooms',          'check_out'),

  -- Testing
  ('testing',            'view_status'),
  ('testing',            'take_sample'),
  ('testing',            'submit_inspection'),
  ('testing',            'dispose_redry'),
  ('testing',            'dispose_room_temp'),
  ('testing',            'dispose_scrap_concession'),
  ('testing',            'retest'),
  ('testing',            'stop_room_temp'),
  ('testing',            'release_pass'),

  -- Sub-lot history
  ('sub_lots',           'view_history'),

  -- Master data
  ('products',           'view'),
  ('products',           'create'),
  ('products',           'edit'),
  ('products',           'delete'),
  ('locations',          'view'),
  ('locations',          'manage'),

  -- Management / analytics
  ('dashboard',          'view'),
  ('analysis',           'view'),
  ('trace',              'view'),
  ('audit_log',          'view')
) AS p(resource, permission)
WHERE eu.email = 'shayiqing16@gmail.com'
ON CONFLICT (user_id, module_id, resource, permission) DO NOTHING;
