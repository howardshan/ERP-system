-- ─────────────────────────────────────────────────────────────────────────────
-- M-154  Relax qc_drying_sub_lot.dryer_number CHECK (1..5 → ≥ 1)
--
-- M-126 (20260620000003) made dryers data-driven: rooms are seeded up to 16 in
-- qc_dry_room and check-in / move validate the target against qc_dry_room
-- existence instead of a hardcoded 1..5 range. But the original column CHECK on
-- qc_drying_sub_lot.dryer_number (added in 20260522000004 as
-- `dryer_number IS NULL OR dryer_number BETWEEN 1 AND 5`) was never dropped, so
-- checking a cart into Dryer 6..16 fails with:
--   new row for relation "qc_drying_sub_lot" violates check constraint
--   "qc_drying_sub_lot_dryer_number_check"
--
-- FIX: drop the stale 1..5 constraint and replace it with `≥ 1`, consistent with
-- qc_dry_room's own validation (qc_location_crud.sql: dryer_number must be ≥ 1).
-- The set of valid dryers is enforced by the RPC layer against qc_dry_room; the
-- CHECK just guards against zero/negative numbers. NULL still allowed (list-mode
-- carts carry dryer_number on the row; grid-mode carts via location_id).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE qc_drying_sub_lot
  DROP CONSTRAINT IF EXISTS qc_drying_sub_lot_dryer_number_check;

ALTER TABLE qc_drying_sub_lot
  ADD CONSTRAINT qc_drying_sub_lot_dryer_number_check
  CHECK (dryer_number IS NULL OR dryer_number >= 1);
