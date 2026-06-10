-- M-119: Auto-generate sample IDs from cart codes.
--
-- WHY: Operations doesn't want to maintain a separate sample numbering scheme.
-- The cart code (sub_lot_code, e.g. "W12345-001") already uniquely identifies
-- the unit being tested, so the sample ID should mirror it directly. Retests
-- (subsequent samples on the same cart after a fail+disposition=retest cycle)
-- get an "R" / "R2" / "R3" ... suffix so the timeline can still distinguish
-- "the original test" from "the retest at this stage of the disposition flow".
--
-- BEHAVIOUR: qc_take_sample's `p_sample_id` becomes optional.
--   • Caller passes a value      → kept as-is (legacy callers / manual override).
--   • Caller passes NULL/empty   → server computes:
--       - n = count of existing qc_sample rows for this sub_lot
--       - n = 0 → sample_id = <sub_lot_code>                 (initial test)
--       - n = 1 → sample_id = <sub_lot_code>R                (first retest)
--       - n ≥ 2 → sample_id = <sub_lot_code>R<n>             (n-th retest)
--
-- Existing data is NOT touched — operators keep their hand-numbered IDs;
-- only NEW samples from the auto-gen path follow the convention.
--
-- Depends on: M-048 (qc_sample.test_group_id), M-053 (sub_lot_code format).
-- Affects: src/services/qcApi.ts, src/pages/qc/TestingPage.tsx.

CREATE OR REPLACE FUNCTION qc_take_sample(
    p_sub_lot_id uuid,
    p_sample_id text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
    s            qc_drying_sub_lot%ROWTYPE;
    new_id       uuid;
    row          qc_sample%ROWTYPE;
    auto_id      text;
    sample_count int;
BEGIN
    SELECT * INTO s FROM qc_drying_sub_lot WHERE id = p_sub_lot_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Sub-lot not found'; END IF;
    IF s.status NOT IN ('pending', 'inspecting') THEN
        RAISE EXCEPTION 'Cannot take a sample for sub-lot in status %', s.status;
    END IF;

    -- M-119: auto-generate when caller omits the ID.
    IF p_sample_id IS NULL OR length(trim(p_sample_id)) = 0 THEN
        SELECT COUNT(*) INTO sample_count
          FROM qc_sample
         WHERE drying_sub_lot_id = p_sub_lot_id;
        IF sample_count = 0 THEN
            auto_id := s.sub_lot_code;
        ELSIF sample_count = 1 THEN
            auto_id := s.sub_lot_code || 'R';
        ELSE
            auto_id := s.sub_lot_code || 'R' || sample_count::text;
        END IF;
    ELSE
        auto_id := trim(p_sample_id);
    END IF;

    INSERT INTO qc_sample (drying_sub_lot_id, test_group_id, sample_id, taken_by_auth_id)
    VALUES (p_sub_lot_id, s.test_group_id, auto_id, auth.uid())
    RETURNING id INTO new_id;

    SELECT * INTO row FROM qc_sample WHERE id = new_id;

    INSERT INTO qc_quality_event (drying_sub_lot_id, event_type, payload, actor_auth_id)
    VALUES (p_sub_lot_id, 'sample_taken',
            jsonb_build_object(
                'sample_id',     row.sample_id,
                'sample_pk',     row.id,
                'test_group_id', s.test_group_id,
                'auto_generated', (p_sample_id IS NULL OR length(trim(coalesce(p_sample_id, ''))) = 0)
            ),
            auth.uid());

    RETURN jsonb_build_object(
        'id',                row.id,
        'drying_sub_lot_id', row.drying_sub_lot_id,
        'test_group_id',     row.test_group_id,
        'sample_id',         row.sample_id,
        'taken_at',          row.taken_at,
        'status',            row.status
    );
END;
$$;
