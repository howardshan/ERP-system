-- Migration M-118: operator-chosen sampling method on bulk check-out.
--
-- Replaces the M-075 (20260523000019) behaviour where carts were chunked in
-- ASCENDING sub_lot_code order and the champion within each chunk was picked
-- randomly. The new behaviour is deterministic and operator-driven:
--
--   • cart_ids are sorted DESCENDING by sub_lot_code (highest cart first),
--     so chunking proceeds from the most recently produced carts down.
--   • A new parameter `p_sampling_method` ∈ {'method_1','method_2'} selects:
--       method_1 — chunk by N; remainder forms its own group; champion =
--                  highest sub_lot_code in each chunk.
--       method_2 — when R := T mod N > 0 AND T > N, do (floor(T/N) - 1)
--                  regular chunks of N (champion = highest), then a single
--                  trailing chunk of (N + R) carts whose champion is the
--                  "middle-large" element: ascending position floor(K/2)+1
--                  (1-indexed) = descending position (K - floor(K/2)) in
--                  our descending member_ids array.
--       Both methods reduce to the same algorithm when R = 0 or T ≤ N.
--
--   • Step 2a (fresh) and Step 2b (redry) use the same logic.
--   • `group_assigned` event payload and the returned `groups` jsonb element
--     gain a `sampling_method` field for audit / analysis.
--   • Default 'method_1' preserves backward compatibility for any caller that
--     omits the new parameter (e.g. the legacy LotDetail.tsx path).
--
-- Mirrored in TypeScript by src/lib/qcSampling.ts (used by the dialog's group
-- preview). Keep both in sync if the algorithm changes.
--
-- Depends on: M-048 (sampling groups), M-075 (bulk fresh/redry classification).
-- Affects: src/services/qcApi.ts, src/pages/qc/components/BulkCheckOutDialog.tsx,
--   src/lib/qcSampling.ts, docs/database/03..., docs/modules/09_qc.md.

CREATE OR REPLACE FUNCTION qc_check_out_sub_lots_bulk(
    p_sub_lot_ids uuid[],
    p_out_time timestamptz DEFAULT NULL,
    p_sampling_method text DEFAULT 'method_1'
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
    out_t timestamptz := COALESCE(p_out_time, now());
    requested int := COALESCE(array_length(p_sub_lot_ids, 1), 0);
    succeeded jsonb := '[]'::jsonb;
    failed jsonb := '[]'::jsonb;
    groups jsonb := '[]'::jsonb;
    sub_id uuid;
    s qc_drying_sub_lot%ROWTYPE;
    grp_rec record;
    sample_n int;
    cart_ids uuid[];
    T_count int;
    R_count int;
    full_chunks int;
    chunk_idx int;
    chunk_size int;
    grp_id uuid;
    grp_seq int;
    champion_id uuid;
    champ_pos int;
    member_ids uuid[];
    fresh_ids uuid[];
    redry_ids uuid[];
    i int;
BEGIN
    IF requested = 0 THEN
      RETURN jsonb_build_object('requested', 0, 'succeeded', succeeded, 'failed', failed, 'groups', groups);
    END IF;

    IF p_sampling_method NOT IN ('method_1', 'method_2') THEN
        RAISE EXCEPTION 'Invalid p_sampling_method: % (expected method_1 or method_2)', p_sampling_method;
    END IF;

    -- ── Step 1: check out each cart ──────────────────────────────────────────
    FOREACH sub_id IN ARRAY p_sub_lot_ids LOOP
        SELECT * INTO s FROM qc_drying_sub_lot WHERE id = sub_id FOR UPDATE;
        IF NOT FOUND THEN
            failed := failed || jsonb_build_array(jsonb_build_object(
                'sub_lot_id', sub_id, 'reason', 'not_found'));
            CONTINUE;
        END IF;
        IF s.status <> 'drying' THEN
            failed := failed || jsonb_build_array(jsonb_build_object(
                'sub_lot_id', sub_id, 'sub_lot_code', s.sub_lot_code,
                'reason', 'wrong_status', 'status', s.status));
            CONTINUE;
        END IF;

        UPDATE qc_drying_sub_lot
        SET out_time = out_t,
            status   = 'pending',
            is_test_champion = false,
            location_id  = NULL,
            dryer_number = NULL,
            updated_at   = now()
        WHERE id = sub_id;

        UPDATE qc_sub_lot_spot_history
        SET ended_at = out_t,
            end_reason = 'check_out',
            duration_minutes = EXTRACT(EPOCH FROM (out_t - started_at)) / 60.0
        WHERE drying_sub_lot_id = sub_id AND ended_at IS NULL;

        INSERT INTO qc_quality_event (drying_sub_lot_id, event_type, payload, actor_auth_id)
        VALUES (sub_id, 'check_out',
                jsonb_build_object('out_time', out_t, 'status', 'pending', 'mode', 'bulk'),
                auth.uid());

        succeeded := succeeded || jsonb_build_array(jsonb_build_object(
            'sub_lot_id', sub_id, 'sub_lot_code', s.sub_lot_code));
    END LOOP;

    -- ── Snapshot fresh vs redry BEFORE Step 2a writes anything (M-075 fix) ──
    SELECT array_agg(sl.id ORDER BY sl.sub_lot_code) INTO fresh_ids
      FROM qc_drying_sub_lot sl
      WHERE sl.id = ANY(p_sub_lot_ids)
        AND sl.status   = 'pending'
        AND sl.out_time = out_t
        AND sl.test_group_id IS NULL;

    SELECT array_agg(sl.id ORDER BY sl.sub_lot_code) INTO redry_ids
      FROM qc_drying_sub_lot sl
      WHERE sl.id = ANY(p_sub_lot_ids)
        AND sl.status   = 'pending'
        AND sl.out_time = out_t
        AND sl.test_group_id IS NOT NULL;

    -- ── Step 2a: form sampling groups for FRESH carts ───────────────────────
    -- cart_ids are aggregated DESCENDING (highest sub_lot_code first) so
    -- chunking starts from the most recently produced cart.
    IF fresh_ids IS NOT NULL THEN
        FOR grp_rec IN
            SELECT sl.production_lot_id,
                   COALESCE(sku.sample_every_n_carts, 1) AS sample_n,
                   array_agg(sl.id ORDER BY sl.sub_lot_code DESC) AS cart_ids
            FROM qc_drying_sub_lot sl
            JOIN qc_production_lot lot ON lot.id = sl.production_lot_id
            LEFT JOIN qc_product_sku sku ON sku.id = lot.sku_id
            WHERE sl.id = ANY(fresh_ids)
            GROUP BY sl.production_lot_id, sku.sample_every_n_carts
        LOOP
            sample_n := GREATEST(1, grp_rec.sample_n);
            cart_ids := grp_rec.cart_ids;
            T_count := array_length(cart_ids, 1);
            R_count := T_count % sample_n;

            SELECT COALESCE(MAX(group_sequence), 0) INTO grp_seq
              FROM qc_test_group WHERE production_lot_id = grp_rec.production_lot_id;

            IF p_sampling_method = 'method_2' AND T_count > sample_n AND R_count > 0 THEN
                -- Method 2: (full_chunks) regular chunks of N + 1 tail chunk of N+R
                full_chunks := (T_count / sample_n) - 1;

                FOR i IN 0..full_chunks-1 LOOP
                    member_ids := cart_ids[i*sample_n+1 : (i+1)*sample_n];
                    chunk_size := array_length(member_ids, 1);
                    grp_seq := grp_seq + 1;

                    INSERT INTO qc_test_group (production_lot_id, group_sequence, member_count)
                    VALUES (grp_rec.production_lot_id, grp_seq, chunk_size)
                    RETURNING id INTO grp_id;

                    champion_id := member_ids[1];  -- descending first = highest

                    UPDATE qc_drying_sub_lot
                    SET test_group_id    = grp_id,
                        is_test_champion = (id = champion_id),
                        status = CASE WHEN id = champion_id THEN 'pending' ELSE 'awaiting_group_result' END,
                        updated_at = now()
                    WHERE id = ANY(member_ids);

                    INSERT INTO qc_quality_event (drying_sub_lot_id, event_type, payload, actor_auth_id)
                    SELECT m_id, 'group_assigned',
                           jsonb_build_object(
                               'test_group_id',    grp_id,
                               'group_sequence',   grp_seq,
                               'is_champion',      m_id = champion_id,
                               'member_count',     chunk_size,
                               'redry',            false,
                               'sampling_method',  p_sampling_method
                           ),
                           auth.uid()
                    FROM unnest(member_ids) AS m_id;

                    groups := groups || jsonb_build_array(jsonb_build_object(
                        'test_group_id',    grp_id,
                        'group_sequence',   grp_seq,
                        'production_lot_id', grp_rec.production_lot_id,
                        'member_count',     chunk_size,
                        'champion_id',      champion_id,
                        'member_ids',       to_jsonb(member_ids),
                        'redry',            false,
                        'sampling_method',  p_sampling_method
                    ));
                END LOOP;

                -- Tail chunk: N + R carts, champion = "middle-large".
                member_ids := cart_ids[full_chunks*sample_n+1 : T_count];
                chunk_size := array_length(member_ids, 1);
                grp_seq := grp_seq + 1;

                INSERT INTO qc_test_group (production_lot_id, group_sequence, member_count)
                VALUES (grp_rec.production_lot_id, grp_seq, chunk_size)
                RETURNING id INTO grp_id;

                -- ascending pos floor(K/2)+1 = descending pos (K - floor(K/2))
                champ_pos := chunk_size - (chunk_size / 2);
                champion_id := member_ids[champ_pos];

                UPDATE qc_drying_sub_lot
                SET test_group_id    = grp_id,
                    is_test_champion = (id = champion_id),
                    status = CASE WHEN id = champion_id THEN 'pending' ELSE 'awaiting_group_result' END,
                    updated_at = now()
                WHERE id = ANY(member_ids);

                INSERT INTO qc_quality_event (drying_sub_lot_id, event_type, payload, actor_auth_id)
                SELECT m_id, 'group_assigned',
                       jsonb_build_object(
                           'test_group_id',    grp_id,
                           'group_sequence',   grp_seq,
                           'is_champion',      m_id = champion_id,
                           'member_count',     chunk_size,
                           'redry',            false,
                           'sampling_method',  p_sampling_method
                       ),
                       auth.uid()
                FROM unnest(member_ids) AS m_id;

                groups := groups || jsonb_build_array(jsonb_build_object(
                    'test_group_id',    grp_id,
                    'group_sequence',   grp_seq,
                    'production_lot_id', grp_rec.production_lot_id,
                    'member_count',     chunk_size,
                    'champion_id',      champion_id,
                    'member_ids',       to_jsonb(member_ids),
                    'redry',            false,
                    'sampling_method',  p_sampling_method
                ));
            ELSE
                -- Method 1, or Method 2 with R=0 / T<=N: chunk by N, remainder solo.
                chunk_idx := 0;
                WHILE chunk_idx < T_count LOOP
                    member_ids := cart_ids[chunk_idx + 1 : LEAST(chunk_idx + sample_n, T_count)];
                    chunk_size := array_length(member_ids, 1);
                    grp_seq := grp_seq + 1;

                    INSERT INTO qc_test_group (production_lot_id, group_sequence, member_count)
                    VALUES (grp_rec.production_lot_id, grp_seq, chunk_size)
                    RETURNING id INTO grp_id;

                    champion_id := member_ids[1];

                    UPDATE qc_drying_sub_lot
                    SET test_group_id    = grp_id,
                        is_test_champion = (id = champion_id),
                        status = CASE WHEN id = champion_id THEN 'pending' ELSE 'awaiting_group_result' END,
                        updated_at = now()
                    WHERE id = ANY(member_ids);

                    INSERT INTO qc_quality_event (drying_sub_lot_id, event_type, payload, actor_auth_id)
                    SELECT m_id, 'group_assigned',
                           jsonb_build_object(
                               'test_group_id',    grp_id,
                               'group_sequence',   grp_seq,
                               'is_champion',      m_id = champion_id,
                               'member_count',     chunk_size,
                               'redry',            false,
                               'sampling_method',  p_sampling_method
                           ),
                           auth.uid()
                    FROM unnest(member_ids) AS m_id;

                    groups := groups || jsonb_build_array(jsonb_build_object(
                        'test_group_id',    grp_id,
                        'group_sequence',   grp_seq,
                        'production_lot_id', grp_rec.production_lot_id,
                        'member_count',     chunk_size,
                        'champion_id',      champion_id,
                        'member_ids',       to_jsonb(member_ids),
                        'redry',            false,
                        'sampling_method',  p_sampling_method
                    ));

                    chunk_idx := chunk_idx + sample_n;
                END LOOP;
            END IF;
        END LOOP;
    END IF;

    -- ── Step 2b: re-group REDRY carts (same algorithm) ──────────────────────
    IF redry_ids IS NOT NULL THEN
        FOR grp_rec IN
            SELECT sl.production_lot_id,
                   sl.test_group_id AS original_group_id,
                   COALESCE(sku.sample_every_n_carts, 1) AS sample_n,
                   array_agg(sl.id ORDER BY sl.sub_lot_code DESC) AS cart_ids
            FROM qc_drying_sub_lot sl
            JOIN qc_production_lot lot ON lot.id = sl.production_lot_id
            LEFT JOIN qc_product_sku sku ON sku.id = lot.sku_id
            WHERE sl.id = ANY(redry_ids)
            GROUP BY sl.production_lot_id, sl.test_group_id, sku.sample_every_n_carts
        LOOP
            sample_n := GREATEST(1, grp_rec.sample_n);
            cart_ids := grp_rec.cart_ids;
            T_count := array_length(cart_ids, 1);
            R_count := T_count % sample_n;

            SELECT COALESCE(MAX(group_sequence), 0) INTO grp_seq
              FROM qc_test_group WHERE production_lot_id = grp_rec.production_lot_id;

            IF p_sampling_method = 'method_2' AND T_count > sample_n AND R_count > 0 THEN
                full_chunks := (T_count / sample_n) - 1;

                FOR i IN 0..full_chunks-1 LOOP
                    member_ids := cart_ids[i*sample_n+1 : (i+1)*sample_n];
                    chunk_size := array_length(member_ids, 1);
                    grp_seq := grp_seq + 1;

                    INSERT INTO qc_test_group (production_lot_id, group_sequence, member_count)
                    VALUES (grp_rec.production_lot_id, grp_seq, chunk_size)
                    RETURNING id INTO grp_id;

                    champion_id := member_ids[1];

                    UPDATE qc_drying_sub_lot
                    SET test_group_id    = grp_id,
                        is_test_champion = (id = champion_id),
                        status = CASE WHEN id = champion_id THEN 'pending' ELSE 'awaiting_group_result' END,
                        updated_at = now()
                    WHERE id = ANY(member_ids);

                    INSERT INTO qc_quality_event (drying_sub_lot_id, event_type, payload, actor_auth_id)
                    SELECT m_id, 'group_assigned',
                           jsonb_build_object(
                               'test_group_id',       grp_id,
                               'group_sequence',      grp_seq,
                               'is_champion',         m_id = champion_id,
                               'member_count',        chunk_size,
                               'redry',               true,
                               'original_group_id',   grp_rec.original_group_id,
                               'sampling_method',     p_sampling_method
                           ),
                           auth.uid()
                    FROM unnest(member_ids) AS m_id;

                    groups := groups || jsonb_build_array(jsonb_build_object(
                        'test_group_id',     grp_id,
                        'group_sequence',    grp_seq,
                        'production_lot_id', grp_rec.production_lot_id,
                        'member_count',      chunk_size,
                        'champion_id',       champion_id,
                        'member_ids',        to_jsonb(member_ids),
                        'redry',             true,
                        'original_group_id', grp_rec.original_group_id,
                        'sampling_method',   p_sampling_method
                    ));
                END LOOP;

                member_ids := cart_ids[full_chunks*sample_n+1 : T_count];
                chunk_size := array_length(member_ids, 1);
                grp_seq := grp_seq + 1;

                INSERT INTO qc_test_group (production_lot_id, group_sequence, member_count)
                VALUES (grp_rec.production_lot_id, grp_seq, chunk_size)
                RETURNING id INTO grp_id;

                champ_pos := chunk_size - (chunk_size / 2);
                champion_id := member_ids[champ_pos];

                UPDATE qc_drying_sub_lot
                SET test_group_id    = grp_id,
                    is_test_champion = (id = champion_id),
                    status = CASE WHEN id = champion_id THEN 'pending' ELSE 'awaiting_group_result' END,
                    updated_at = now()
                WHERE id = ANY(member_ids);

                INSERT INTO qc_quality_event (drying_sub_lot_id, event_type, payload, actor_auth_id)
                SELECT m_id, 'group_assigned',
                       jsonb_build_object(
                           'test_group_id',       grp_id,
                           'group_sequence',      grp_seq,
                           'is_champion',         m_id = champion_id,
                           'member_count',        chunk_size,
                           'redry',               true,
                           'original_group_id',   grp_rec.original_group_id,
                           'sampling_method',     p_sampling_method
                       ),
                       auth.uid()
                FROM unnest(member_ids) AS m_id;

                groups := groups || jsonb_build_array(jsonb_build_object(
                    'test_group_id',     grp_id,
                    'group_sequence',    grp_seq,
                    'production_lot_id', grp_rec.production_lot_id,
                    'member_count',      chunk_size,
                    'champion_id',       champion_id,
                    'member_ids',        to_jsonb(member_ids),
                    'redry',             true,
                    'original_group_id', grp_rec.original_group_id,
                    'sampling_method',   p_sampling_method
                ));
            ELSE
                chunk_idx := 0;
                WHILE chunk_idx < T_count LOOP
                    member_ids := cart_ids[chunk_idx + 1 : LEAST(chunk_idx + sample_n, T_count)];
                    chunk_size := array_length(member_ids, 1);
                    grp_seq := grp_seq + 1;

                    INSERT INTO qc_test_group (production_lot_id, group_sequence, member_count)
                    VALUES (grp_rec.production_lot_id, grp_seq, chunk_size)
                    RETURNING id INTO grp_id;

                    champion_id := member_ids[1];

                    UPDATE qc_drying_sub_lot
                    SET test_group_id    = grp_id,
                        is_test_champion = (id = champion_id),
                        status = CASE WHEN id = champion_id THEN 'pending' ELSE 'awaiting_group_result' END,
                        updated_at = now()
                    WHERE id = ANY(member_ids);

                    INSERT INTO qc_quality_event (drying_sub_lot_id, event_type, payload, actor_auth_id)
                    SELECT m_id, 'group_assigned',
                           jsonb_build_object(
                               'test_group_id',       grp_id,
                               'group_sequence',      grp_seq,
                               'is_champion',         m_id = champion_id,
                               'member_count',        chunk_size,
                               'redry',               true,
                               'original_group_id',   grp_rec.original_group_id,
                               'sampling_method',     p_sampling_method
                           ),
                           auth.uid()
                    FROM unnest(member_ids) AS m_id;

                    groups := groups || jsonb_build_array(jsonb_build_object(
                        'test_group_id',     grp_id,
                        'group_sequence',    grp_seq,
                        'production_lot_id', grp_rec.production_lot_id,
                        'member_count',      chunk_size,
                        'champion_id',       champion_id,
                        'member_ids',        to_jsonb(member_ids),
                        'redry',             true,
                        'original_group_id', grp_rec.original_group_id,
                        'sampling_method',   p_sampling_method
                    ));

                    chunk_idx := chunk_idx + sample_n;
                END LOOP;
            END IF;
        END LOOP;
    END IF;

    RETURN jsonb_build_object(
        'requested', requested,
        'succeeded', succeeded,
        'failed',    failed,
        'groups',    groups
    );
END;
$$;


-- ===== merged from 20260527000015_qc_soft_limits.sql (duplicate-version dedup for fresh db build) =====

-- M-118: Soft tolerance band + supervisor-only override on QC inspections.
--
-- WHY: M-109's qc_submit_inspection lets ANY user with qc.testing.submit_inspection
-- override the auto-computed PASS/FAIL freely in either direction. Operations
-- reported this is too loose — readings well outside the spec range were being
-- pushed through as PASS by anyone. The new model has THREE bands per template:
--
--   • Hard inside [lower_limit, upper_limit]                 → auto PASS
--   • Soft band   [soft_lower, lower) ∪ (upper, soft_upper]  → SUPERVISOR decides
--   • Outside soft                                           → forced FAIL
--
-- Supervisors are users holding the new permission `qc.testing.supervisor_judge`.
-- Non-supervisors can only submit when their reading sits inside the hard band
-- (the system's auto-suggested verdict). They cannot override in any direction.
-- Even supervisors cannot override outside the soft band — the spec says
-- "anything beyond soft tolerance MUST fail" and the backend enforces it.
--
-- Migration default: backfill `soft = hard` so the new band logic kicks in
-- immediately for every existing SKU (closes the override loophole). Ops then
-- explicitly widen soft for each SKU that needs supervisor discretion.
--
-- CHANGES:
--   1) qc_inspection_template: add soft_lower_limit, soft_upper_limit (numeric 10,4
--      NOT NULL after backfill). CHECK constraints ensure soft wraps hard and
--      soft_lower <= soft_upper.
--   2) qc_submit_inspection: inject three-band logic; reject manual override
--      outside soft band; require supervisor permission for soft-band override.
--   3) qc_list_products: expose soft limits per template so ProductManagement
--      can edit them.
--   4) Seed permission qc.testing.supervisor_judge for the two existing dev
--      accounts (ysha@smu.edu, shayiqing16@gmail.com) so demos keep working.
--
-- Depends on: M-109 (20260527000006, qc_submit_inspection), M-088
--   (20260525000009, qc_list_products with test_type catalog).
-- Affects: src/services/qcApi.ts, src/pages/qc/ProductManagement.tsx,
--   src/pages/qc/TestingPage.tsx, src/lib/permissionStructure.ts,
--   docs/database/03_migrations-and-edge-functions.md, docs/modules/09_qc.md.

-- ── 1) Schema ──────────────────────────────────────────────────────────────
ALTER TABLE qc_inspection_template
  ADD COLUMN IF NOT EXISTS soft_lower_limit numeric(10, 4),
  ADD COLUMN IF NOT EXISTS soft_upper_limit numeric(10, 4);

-- Backfill: existing rows have soft = hard so the new "outside soft = forced
-- FAIL" rule activates immediately. Ops widen soft per SKU as needed.
UPDATE qc_inspection_template
   SET soft_lower_limit = lower_limit,
       soft_upper_limit = upper_limit
 WHERE soft_lower_limit IS NULL OR soft_upper_limit IS NULL;

ALTER TABLE qc_inspection_template
  ALTER COLUMN soft_lower_limit SET NOT NULL,
  ALTER COLUMN soft_upper_limit SET NOT NULL;

-- Drop and recreate CHECKs idempotently so re-running this migration is safe.
ALTER TABLE qc_inspection_template
  DROP CONSTRAINT IF EXISTS qc_inspection_template_soft_wraps_hard,
  DROP CONSTRAINT IF EXISTS qc_inspection_template_soft_order;

ALTER TABLE qc_inspection_template
  ADD CONSTRAINT qc_inspection_template_soft_wraps_hard
    CHECK (soft_lower_limit <= lower_limit AND soft_upper_limit >= upper_limit),
  ADD CONSTRAINT qc_inspection_template_soft_order
    CHECK (soft_lower_limit <= soft_upper_limit);

-- ── 2) qc_submit_inspection: three-band logic + supervisor gate ─────────────
CREATE OR REPLACE FUNCTION qc_submit_inspection(
    p_sub_lot_id uuid,
    p_aw numeric,
    p_sample_pk uuid DEFAULT NULL,
    p_result text DEFAULT NULL,
    p_remark text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
    s qc_drying_sub_lot%ROWTYPE;
    lot qc_production_lot%ROWTYPE;
    tmpl qc_inspection_template%ROWTYPE;
    has_tmpl boolean := false;
    suggested text;
    judged text;
    new_status text;
    event_type text;
    rec_id uuid;
    sample qc_sample%ROWTYPE;
    propagated_count int := 0;
    in_hard boolean := false;
    in_soft boolean := true;   -- absent template behaves as "anything goes" for backward compat
    is_supervisor boolean := false;
    is_override boolean := false;
BEGIN
    IF p_aw IS NULL OR p_aw < 0 OR p_aw > 2 THEN
        RAISE EXCEPTION 'Invalid Aw value: %', p_aw;
    END IF;
    IF p_result IS NOT NULL AND p_result NOT IN ('pass', 'fail') THEN
        RAISE EXCEPTION 'Invalid result: %', p_result;
    END IF;

    SELECT * INTO s FROM qc_drying_sub_lot WHERE id = p_sub_lot_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Sub-lot not found'; END IF;

    IF p_sample_pk IS NOT NULL THEN
      SELECT * INTO sample FROM qc_sample WHERE id = p_sample_pk FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Sample not found'; END IF;
      IF sample.drying_sub_lot_id <> p_sub_lot_id THEN
        RAISE EXCEPTION 'Sample does not belong to this sub-lot';
      END IF;
      IF sample.status <> 'pending' THEN
        RAISE EXCEPTION 'Sample is already % — take a new sample to re-test', sample.status;
      END IF;
    END IF;

    IF s.status = 'pending' THEN
        UPDATE qc_drying_sub_lot SET status = 'inspecting', updated_at = now() WHERE id = p_sub_lot_id;
        s.status := 'inspecting';
    END IF;

    IF s.status <> 'inspecting' THEN
        RAISE EXCEPTION 'Sub-lot not inspectable (status=%)', s.status;
    END IF;

    SELECT * INTO lot FROM qc_production_lot WHERE id = s.production_lot_id;
    SELECT * INTO tmpl FROM qc_inspection_template WHERE sku_id = lot.sku_id LIMIT 1;
    has_tmpl := FOUND;

    IF has_tmpl THEN
        in_hard := (p_aw >= tmpl.lower_limit      AND p_aw <= tmpl.upper_limit);
        in_soft := (p_aw >= tmpl.soft_lower_limit AND p_aw <= tmpl.soft_upper_limit);
        suggested := CASE WHEN in_hard THEN 'pass' ELSE 'fail' END;
    ELSE
        suggested := NULL;
    END IF;

    -- Manual override gate. We only enforce when the caller's p_result diverges
    -- from `suggested` AND there's a template to validate against. The "no
    -- template, no manual result" failure mode still raises below.
    is_override := has_tmpl AND p_result IS NOT NULL AND p_result <> suggested;
    IF is_override THEN
        IF NOT in_soft THEN
            RAISE EXCEPTION 'Reading % is outside soft tolerance [%, %] — manual override not allowed',
                p_aw, tmpl.soft_lower_limit, tmpl.soft_upper_limit;
        END IF;
        SELECT EXISTS (
            SELECT 1
              FROM user_permission_grant g
              JOIN erp_user u ON u.id = g.user_id
             WHERE u.auth_user_id = auth.uid()
               AND g.module_id = 'qc'
               AND g.resource  = 'testing'
               AND g.permission = 'supervisor_judge'
        ) INTO is_supervisor;
        IF NOT is_supervisor THEN
            RAISE EXCEPTION 'Supervisor permission (qc.testing.supervisor_judge) required to override the auto-judgment';
        END IF;
    END IF;

    -- Final result: manual decision wins; fall back to the suggestion (legacy
    -- auto-judge path / bulk submit).
    judged := COALESCE(p_result, suggested);
    IF judged IS NULL THEN
        RAISE EXCEPTION 'No inspection template for SKU and no manual result provided';
    END IF;

    INSERT INTO qc_inspection_record (drying_sub_lot_id, inspector_auth_id, values_json, result, sample_id, remark)
    VALUES (p_sub_lot_id, auth.uid(),
            jsonb_build_object(
              'aw', p_aw,
              'suggested', suggested,
              'in_hard', in_hard,
              'in_soft', in_soft
            ),
            judged, p_sample_pk, p_remark)
    RETURNING id INTO rec_id;

    IF p_sample_pk IS NOT NULL THEN
      UPDATE qc_sample SET status = 'inspected', inspection_record_id = rec_id
      WHERE id = p_sample_pk;
    END IF;

    IF judged = 'pass' THEN
        new_status := 'passed';
        event_type := 'inspection_passed';
    ELSE
        new_status := 'hold';
        event_type := 'inspection_failed_hold';
    END IF;

    UPDATE qc_drying_sub_lot SET status = new_status, updated_at = now() WHERE id = p_sub_lot_id;

    -- ── Champion group propagation (unchanged from M-109) ───────────────────
    IF s.is_test_champion AND s.test_group_id IS NOT NULL THEN
        IF judged = 'pass' THEN
            UPDATE qc_drying_sub_lot
            SET status = 'passed', updated_at = now()
            WHERE test_group_id = s.test_group_id
              AND id <> p_sub_lot_id
              AND is_test_champion = false
              AND status IN ('awaiting_group_result', 'pending');
            GET DIAGNOSTICS propagated_count = ROW_COUNT;

            UPDATE qc_test_group
            SET status = 'passed', resolved_at = now()
            WHERE id = s.test_group_id;

            INSERT INTO qc_quality_event (drying_sub_lot_id, event_type, payload, actor_auth_id)
            SELECT id, 'group_passed_by_champion',
                   jsonb_build_object('test_group_id', s.test_group_id, 'champion_id', s.id),
                   auth.uid()
            FROM qc_drying_sub_lot
            WHERE test_group_id = s.test_group_id AND id <> s.id AND status = 'passed'
              AND is_test_champion = false;
        ELSE
            UPDATE qc_drying_sub_lot
            SET status = 'hold', updated_at = now()
            WHERE test_group_id = s.test_group_id
              AND id <> p_sub_lot_id
              AND is_test_champion = false
              AND status IN ('awaiting_group_result', 'pending');
            GET DIAGNOSTICS propagated_count = ROW_COUNT;

            UPDATE qc_test_group
            SET status = 'closed_failed', resolved_at = now()
            WHERE id = s.test_group_id;

            INSERT INTO qc_quality_event (drying_sub_lot_id, event_type, payload, actor_auth_id)
            SELECT id, 'group_failed_by_champion',
                   jsonb_build_object(
                       'test_group_id', s.test_group_id,
                       'champion_id', s.id,
                       'champion_aw', p_aw
                   ),
                   auth.uid()
            FROM qc_drying_sub_lot
            WHERE test_group_id = s.test_group_id AND id <> s.id AND status = 'hold'
              AND is_test_champion = false;
        END IF;
    END IF;

    INSERT INTO qc_quality_event (drying_sub_lot_id, event_type, payload, actor_auth_id)
    VALUES (p_sub_lot_id, event_type,
            jsonb_build_object(
              'aw', p_aw, 'result', judged,
              'suggested', suggested,
              'in_hard', in_hard,
              'in_soft', in_soft,
              'manual_override', is_override,
              'manual_override_by_supervisor', (is_override AND is_supervisor),
              'remark', p_remark,
              'limits',      CASE WHEN has_tmpl THEN jsonb_build_array(tmpl.lower_limit,       tmpl.upper_limit) END,
              'soft_limits', CASE WHEN has_tmpl THEN jsonb_build_array(tmpl.soft_lower_limit,  tmpl.soft_upper_limit) END,
              'sample_pk', p_sample_pk,
              'sample_id', sample.sample_id,
              'is_test_champion', s.is_test_champion,
              'group_members_propagated', propagated_count
            ),
            auth.uid());

    RETURN jsonb_build_object(
        'id', rec_id,
        'drying_sub_lot_id', p_sub_lot_id,
        'result', judged,
        'suggested', suggested,
        'remark', p_remark,
        'values_json', jsonb_build_object('aw', p_aw),
        'submitted_at', now(),
        'new_status', new_status,
        'sample_pk', p_sample_pk,
        'group_members_propagated', propagated_count
    );
END;
$$;

-- ── 3) qc_list_products: expose soft limits per template ───────────────────
CREATE OR REPLACE FUNCTION qc_list_products()
RETURNS jsonb LANGUAGE sql STABLE AS $$
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id',                     sku.id,
            'code',                   sku.code,
            'name',                   sku.name,
            'standard_drying_minutes', sku.standard_drying_minutes,
            'sample_every_n_carts',   sku.sample_every_n_carts,
            'templates', COALESCE((
                SELECT jsonb_agg(jsonb_build_object(
                    'id',               t.id,
                    'sku_id',           t.sku_id,
                    'test_type_id',     t.test_type_id,
                    'item_name',        COALESCE(tt.name, t.item_name),
                    'unit',             COALESCE(tt.unit, t.unit),
                    'lower_limit',      t.lower_limit,
                    'upper_limit',      t.upper_limit,
                    'soft_lower_limit', t.soft_lower_limit,
                    'soft_upper_limit', t.soft_upper_limit
                ) ORDER BY t.created_at)
                FROM qc_inspection_template t
                LEFT JOIN qc_test_type tt ON tt.id = t.test_type_id
                WHERE t.sku_id = sku.id
            ), '[]'::jsonb)
        ) ORDER BY sku.code
    ), '[]'::jsonb)
    FROM qc_product_sku sku;
$$;

-- ── 4) Seed qc.testing.supervisor_judge for existing dev accounts ──────────
INSERT INTO user_permission_grant (user_id, module_id, resource, permission, approval_limit)
SELECT eu.id, 'qc', 'testing', 'supervisor_judge', NULL
FROM erp_user eu
WHERE eu.email IN ('ysha@smu.edu', 'shayiqing16@gmail.com')
ON CONFLICT (user_id, module_id, resource, permission) DO NOTHING;
