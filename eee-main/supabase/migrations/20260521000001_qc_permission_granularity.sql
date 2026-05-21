-- Migration M-040: Fine-grained QC permissions
--
-- Replaces the coarse QC permission keys with one-action-per-key granularity
-- so each of the 8 distinct workflow steps the customer cares about can be
-- toggled independently per user:
--   1. production:  create a Batch + sub-lots
--   2. dry_rooms:   place sub-lot in a cell ("create check-in")
--   3. batches:     create a new Batch row directly (legacy "Dry Room" list)
--   4. testing:     take sample (取样)
--   5. testing:     submit WA / input test data
--   6. dry_rooms:   view 5-dryer grid + occupancy
--   7. testing:     view testing queue
--   8. sub_lots:    view sub-lot full history
--
-- Also exposes move-between-cells, check-out, and per-disposition-type
-- gates so a manager / QC tech / floor operator can have non-overlapping
-- responsibilities.

-- Drop all existing QC permission grants for the dev user; we'll re-seed
-- the full new set below. This is safe because we're still in dev with
-- only ysha@smu.edu mapped to QC.
DELETE FROM user_permission_grant
WHERE module_id = 'qc'
  AND user_id IN (SELECT id FROM erp_user WHERE email = 'ysha@smu.edu');

-- Grant the full new key set
INSERT INTO user_permission_grant (user_id, module_id, resource, permission, approval_limit)
SELECT eu.id, 'qc', p.resource, p.permission, NULL
FROM erp_user eu
CROSS JOIN (VALUES
  ('module_permissions', 'manage'),

  -- (1) Production
  ('production',         'create_batch'),

  -- (3) Batches (legacy Production Lot list)
  ('batches',            'view'),
  ('batches',            'create'),
  ('batches',            'delete'),

  -- (2, 6) Dry Rooms
  ('dry_rooms',          'view_status'),
  ('dry_rooms',          'check_in'),
  ('dry_rooms',          'move'),
  ('dry_rooms',          'check_out'),

  -- (4, 5, 7) Testing
  ('testing',            'view_status'),
  ('testing',            'take_sample'),
  ('testing',            'submit_inspection'),
  ('testing',            'dispose_redry'),
  ('testing',            'dispose_room_temp'),
  ('testing',            'dispose_scrap_concession'),
  ('testing',            'stop_room_temp'),

  -- (8) Sub-lot history
  ('sub_lots',           'view_history'),

  -- Master data
  ('products',           'view'),
  ('products',           'create'),
  ('products',           'edit'),
  ('products',           'delete'),
  ('locations',          'view'),
  ('locations',          'manage'),

  -- Management
  ('dashboard',          'view'),
  ('trace',              'view'),
  ('audit_log',          'view')
) AS p(resource, permission)
WHERE eu.email = 'ysha@smu.edu'
ON CONFLICT (user_id, module_id, resource, permission) DO NOTHING;
