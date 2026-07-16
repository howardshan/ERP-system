-- ─────────────────────────────────────────────────────────────────────────────
-- M-169  Auto-release on inspection PASS (no more manual release step)
--
-- Operators no longer want a separate manual "Release" click after a cart passes
-- testing. Now any cart that transitions to `passed` is auto-released
-- (passed → closed, released_at stamped) so it flows straight into the packaging
-- queue. A trigger on qc_drying_sub_lot fires the existing
-- qc_release_passed_sub_lot(id) with NO yield → no ERP/warehouse posting and no
-- packaging-linkage requirement (M-139 made yield optional). It also covers
-- sampling-group siblings, which reach `passed` via champion propagation (each
-- such row UPDATE fires the trigger).
--
-- Re-entrancy: qc_release_passed_sub_lot sets status='closed', which re-fires the
-- trigger with NEW.status='closed' → WHEN clause is false → no recursion. The
-- release RPC re-checks status='passed' FOR UPDATE, so it's idempotent/safe.
-- ─────────────────────────────────────────────────────────────────────────────

-- Drop the stale 1-arg overload (pre-M-139) so the call below is unambiguous;
-- the live version is qc_release_passed_sub_lot(uuid, numeric) (yield optional).
DROP FUNCTION IF EXISTS qc_release_passed_sub_lot(uuid);

CREATE OR REPLACE FUNCTION qc__autorelease_on_pass()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- yield NULL → release without touching inventory/packaging linkage (M-139).
  PERFORM qc_release_passed_sub_lot(NEW.id, NULL::numeric);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS qc_autorelease_on_pass ON qc_drying_sub_lot;
CREATE TRIGGER qc_autorelease_on_pass
  AFTER UPDATE OF status ON qc_drying_sub_lot
  FOR EACH ROW
  WHEN (NEW.status = 'passed' AND OLD.status IS DISTINCT FROM 'passed')
  EXECUTE FUNCTION qc__autorelease_on_pass();
