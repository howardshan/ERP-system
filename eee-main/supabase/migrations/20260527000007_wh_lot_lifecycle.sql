-- M-106: Lot lifecycle — release / reject / expire / expiring list (Warehouse S3)
--
-- Implements BR-6a (lot status flow) + BR-11 (COA-gated release):
--   release : quarantine → available, writes a coa(result='pass')
--   reject  : quarantine|available → rejected, writes a coa(result='fail', notes=reason)
--   expire  : sweeps past-date lots to status='expired' so BR-W4 auto-blocks outbound
--
-- Status transitions are guarded; outbound enforcement stays in M-102's
-- _wh_apply_transaction BR-W4 check (no kernel change here).
-- Idempotent (CREATE OR REPLACE).

-- ── COA number generator (max+1 regex, mirrors wh_next_grn_number) ───────────
CREATE OR REPLACE FUNCTION wh_next_coa_number()
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE n int;
BEGIN
    SELECT COALESCE(MAX(NULLIF(regexp_replace(coa_number, '^COA-(\d+)$', '\1'), '')::int), 0) + 1
    INTO n FROM coa WHERE coa_number ~ '^COA-\d+$';
    RETURN 'COA-' || LPAD(n::text, 6, '0');
END;
$$;

-- ── Release: quarantine → available (BR-11) ─────────────────────────────────
CREATE OR REPLACE FUNCTION wh_release_lot(
    p_lot_id        bigint,
    p_test_date     date DEFAULT current_date,
    p_tested_by     text DEFAULT NULL,
    p_document_ref  text DEFAULT NULL,
    p_notes         text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_status     text;
    v_lot_number text;
    v_coa_id     bigint;
    v_coa_number text;
BEGIN
    SELECT status, lot_number INTO v_status, v_lot_number
    FROM lot WHERE id = p_lot_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'lot % not found', p_lot_id; END IF;
    IF v_status <> 'quarantine' THEN
        RAISE EXCEPTION 'lot % is % (release allowed only from quarantine)', p_lot_id, v_status;
    END IF;

    v_coa_number := wh_next_coa_number();
    INSERT INTO coa (coa_number, lot_id, test_date, result, tested_by, document_ref, notes, created_by)
    VALUES (v_coa_number, p_lot_id, p_test_date, 'pass', p_tested_by, p_document_ref, p_notes, auth.uid()::text)
    RETURNING id INTO v_coa_id;

    UPDATE lot SET status = 'available' WHERE id = p_lot_id;

    RETURN jsonb_build_object(
        'lot_id', p_lot_id, 'lot_number', v_lot_number, 'new_status', 'available',
        'coa_id', v_coa_id, 'coa_number', v_coa_number
    );
END;
$$;

-- ── Reject: quarantine|available → rejected (BR-11) ─────────────────────────
-- Allows "late reject" of an already-available lot. Physical stock stays put;
-- subsequent issue/ship/production_consume are auto-blocked by BR-W4 since
-- lot.status='rejected' is in the kernel's blocked set.
CREATE OR REPLACE FUNCTION wh_reject_lot(
    p_lot_id        bigint,
    p_reason        text,
    p_test_date     date DEFAULT current_date,
    p_tested_by     text DEFAULT NULL,
    p_document_ref  text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_status     text;
    v_lot_number text;
    v_coa_id     bigint;
    v_coa_number text;
BEGIN
    IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
        RAISE EXCEPTION 'reject reason is required';
    END IF;

    SELECT status, lot_number INTO v_status, v_lot_number
    FROM lot WHERE id = p_lot_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'lot % not found', p_lot_id; END IF;
    IF v_status NOT IN ('quarantine', 'available') THEN
        RAISE EXCEPTION 'lot % is % (reject allowed only from quarantine or available)', p_lot_id, v_status;
    END IF;

    v_coa_number := wh_next_coa_number();
    INSERT INTO coa (coa_number, lot_id, test_date, result, tested_by, document_ref, notes, created_by)
    VALUES (v_coa_number, p_lot_id, p_test_date, 'fail', p_tested_by, p_document_ref, trim(p_reason), auth.uid()::text)
    RETURNING id INTO v_coa_id;

    UPDATE lot SET status = 'rejected' WHERE id = p_lot_id;

    RETURN jsonb_build_object(
        'lot_id', p_lot_id, 'lot_number', v_lot_number, 'new_status', 'rejected',
        'coa_id', v_coa_id, 'coa_number', v_coa_number
    );
END;
$$;

-- ── Expire sweep: past-date lots → status='expired' (admin / one-click) ─────
-- After this runs, BR-W4 (M-102) auto-blocks any subsequent outbound for
-- those lots since 'expired' is in the kernel's blocked status set.
CREATE OR REPLACE FUNCTION wh_expire_lots()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_ids bigint[];
BEGIN
    WITH updated AS (
        UPDATE lot
           SET status = 'expired'
         WHERE expiry_date IS NOT NULL
           AND expiry_date < current_date
           AND status NOT IN ('consumed', 'rejected', 'expired')
         RETURNING id
    )
    SELECT COALESCE(array_agg(id), ARRAY[]::bigint[]) INTO v_ids FROM updated;

    RETURN jsonb_build_object(
        'expired_count', COALESCE(array_length(v_ids, 1), 0),
        'lot_ids', to_jsonb(v_ids)
    );
END;
$$;

-- ── Expiring list (already-past OR future N days) ───────────────────────────
-- Includes:
--   (a) already-expired lots whose status is NOT yet 'expired'/'consumed'/
--       'rejected' — so user sees them and can hit "expire-all"
--   (b) future-expiring within p_days_ahead days (any non-terminal status)
-- Already-expired lots return negative days_until_expiry.
CREATE OR REPLACE FUNCTION wh_list_expiring(p_days_ahead int DEFAULT 30)
RETURNS jsonb
LANGUAGE sql STABLE
AS $$
    WITH lot_qty AS (
        SELECT lot_id, SUM(quantity_on_hand) AS on_hand
        FROM inventory_balance
        WHERE lot_id IS NOT NULL
        GROUP BY lot_id
    )
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'lot_id',             l.id,
            'lot_number',         l.lot_number,
            'item_id',            i.id,
            'item_sku',           i.sku,
            'item_name',          i.name,
            'base_uom',           u.code,
            'lot_status',         l.status,
            'expiry_date',        l.expiry_date,
            'days_until_expiry',  (l.expiry_date - current_date),
            'total_on_hand',      COALESCE(q.on_hand, 0)
        ) ORDER BY l.expiry_date ASC NULLS LAST
    ), '[]'::jsonb)
    FROM lot l
    JOIN item i ON i.id = l.item_id
    JOIN uom u  ON u.id = i.base_uom_id
    LEFT JOIN lot_qty q ON q.lot_id = l.id
    WHERE l.expiry_date IS NOT NULL
      AND l.status NOT IN ('consumed', 'rejected')
      AND (
        -- already past expiry but not yet flagged
        (l.expiry_date < current_date AND l.status <> 'expired')
        -- or upcoming within window
        OR l.expiry_date BETWEEN current_date AND current_date + p_days_ahead
      );
$$;
