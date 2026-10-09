-- ─────────────────────────────────────────────────────────────────────────────
-- M-173  qc_regroup_pending_sampling: honour the 1-hour in_time window (BR-Q84)
--
-- M-172 added the regroup RPC by mirroring check-out's Step 2a as it stood at
-- M-137: chunk the whole WO's waiting carts by sample_every_n_carts. M-165 then
-- redefined check-out (BR-Q84): carts are first split into 1-hour check-in
-- (in_time) windows per WO, and the method_1/method_2 chunking runs WITHIN each
-- window. The two landed on separate branches, so the regroup was left chunking
-- across window boundaries — it could merge carts that entered the dryer hours
-- apart into one sampling group, producing a grouping check-out itself would
-- never produce.
--
-- FIX: re-chunk per (1-hour in_time window) exactly like the new Step 2a —
-- qc__intime_windows(ids, 60) → per window, same chunk loop. grp_seq keeps
-- incrementing across windows, as in check-out.
--
-- Everything else is unchanged from M-172: only fully un-judged 'sampling' groups
-- are dissolved, their still-pending samples are voided, and re-assignment goes
-- through qc__assign_test_group.
--
-- The carts are already checked out here, but check-out only stamps out_time and
-- clears location/dryer — in_time survives, so the window split is still exactly
-- the one check-out would have computed.
--
-- Note the regroup deliberately treats every cart as a FRESH re-chunk
-- (redry=false, original_group_id=NULL): its whole purpose is to re-apply the
-- sampling rate, so the redry "keep the original champion" fast path (Step 2b)
-- must NOT fire — that would preserve the very grouping we're replacing.
--
-- The window loop + chunk loop below are a verbatim mirror of Step 2a in
-- 20260714000002 (M-165), so BR-Q84's windowing and method_2's tail-split rule
-- cannot drift between the two call sites.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION qc_regroup_pending_sampling(
    p_production_lot_id uuid,
    p_sampling_method text DEFAULT 'method_2'
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
    sample_n      int;
    old_group_ids uuid[];
    all_ids       uuid[];      -- every eligible cart of this lot
    cart_ids      uuid[];      -- carts of the window currently being chunked
    voided_count  int := 0;
    groups        jsonb := '[]'::jsonb;
    win_rec       record;
    n_windows     int := 0;
    T_count       int;
    grp_seq       int;
    member_ids    uuid[];
    chunk_idx     int;
    remaining     int;
    champ_low_abs int;
    WINDOW_MIN constant numeric := 60;   -- same-batch check-in window (BR-Q84)
BEGIN
    IF p_sampling_method NOT IN ('method_1', 'method_2') THEN
        RAISE EXCEPTION 'Invalid p_sampling_method: % (expected method_1 or method_2)', p_sampling_method;
    END IF;

    SELECT GREATEST(1, COALESCE(sku.sample_every_n_carts, 1))
      INTO sample_n
      FROM qc_production_lot lot
      LEFT JOIN qc_product_sku sku ON sku.id = lot.sku_id
     WHERE lot.id = p_production_lot_id;

    IF sample_n IS NULL THEN
        RAISE EXCEPTION 'Production lot not found: %', p_production_lot_id;
    END IF;

    -- Only dissolve groups where EVERY member is still awaiting its verdict.
    -- (Deleting a group SET NULLs test_group_id on all its members, so a group
    -- holding an inspecting/passed/failed/hold cart must be skipped wholesale or
    -- that cart would be orphaned from its result.)
    SELECT array_agg(g.id)
      INTO old_group_ids
      FROM qc_test_group g
     WHERE g.production_lot_id = p_production_lot_id
       AND g.status = 'sampling'
       AND EXISTS (
             SELECT 1 FROM qc_drying_sub_lot sl WHERE sl.test_group_id = g.id
           )
       AND NOT EXISTS (
             SELECT 1 FROM qc_drying_sub_lot sl
              WHERE sl.test_group_id = g.id
                AND sl.status NOT IN ('pending', 'awaiting_group_result')
           );

    IF old_group_ids IS NULL THEN
        RETURN jsonb_build_object(
            'production_lot_id', p_production_lot_id, 'sample_n', sample_n,
            'carts', 0, 'windows', 0, 'dissolved_groups', 0, 'voided_samples', 0,
            'groups', '[]'::jsonb);
    END IF;

    SELECT array_agg(sl.id)
      INTO all_ids
      FROM qc_drying_sub_lot sl
     WHERE sl.test_group_id = ANY(old_group_ids);

    -- Void still-pending samples of the groups being dissolved.
    WITH v AS (
        UPDATE qc_sample sa
           SET status            = 'voided',
               voided_at         = now(),
               voided_by_auth_id = auth.uid(),
               void_reason       = 'Sampling regrouped to 1 per ' || sample_n || ' carts'
         WHERE sa.status = 'pending'
           AND (sa.drying_sub_lot_id = ANY(all_ids) OR sa.test_group_id = ANY(old_group_ids))
        RETURNING sa.id, sa.drying_sub_lot_id, sa.sample_id
    ), ev AS (
        INSERT INTO qc_quality_event (drying_sub_lot_id, event_type, payload, actor_auth_id)
        SELECT v.drying_sub_lot_id, 'sample_voided',
               jsonb_build_object(
                   'sample_id', v.sample_id,
                   'reason',    'sampling_regrouped',
                   'sample_n',  sample_n),
               auth.uid()
          FROM v
        RETURNING 1
    )
    SELECT count(*) INTO voided_count FROM v;

    -- Detach carts, then drop the dissolved groups. Both
    -- qc_drying_sub_lot.test_group_id and qc_sample.test_group_id are
    -- ON DELETE SET NULL, so the DELETE clears the links for us.
    UPDATE qc_drying_sub_lot
       SET is_test_champion = false, updated_at = now()
     WHERE id = ANY(all_ids);

    DELETE FROM qc_test_group WHERE id = ANY(old_group_ids);

    -- Number new groups after whatever resolved groups remain on this lot.
    SELECT COALESCE(MAX(group_sequence), 0) INTO grp_seq
      FROM qc_test_group WHERE production_lot_id = p_production_lot_id;

    -- ── Re-chunk per 1-hour in_time window (mirror of check-out Step 2a, M-165) ─
    FOR win_rec IN
        SELECT w.window_idx,
               array_agg(sl.id ORDER BY sl.sub_lot_code DESC) AS cart_ids
        FROM qc__intime_windows(all_ids, WINDOW_MIN) w
        JOIN qc_drying_sub_lot sl ON sl.id = w.cart_id
        GROUP BY w.window_idx
        ORDER BY w.window_idx
    LOOP
        cart_ids  := win_rec.cart_ids;
        T_count   := array_length(cart_ids, 1);
        n_windows := n_windows + 1;

        chunk_idx := 0;
        WHILE chunk_idx < T_count LOOP
            remaining := T_count - chunk_idx;
            IF p_sampling_method = 'method_2'
               AND remaining > sample_n AND remaining < 2 * sample_n THEN
                champ_low_abs := chunk_idx + 2 + ((remaining - 1) / 2);
                member_ids := cart_ids[chunk_idx + 1 : champ_low_abs - 1];
                grp_seq := grp_seq + 1;
                groups := groups || jsonb_build_array(qc__assign_test_group(
                    p_production_lot_id, grp_seq, member_ids,
                    member_ids[1], false, NULL, p_sampling_method));
                member_ids := cart_ids[champ_low_abs : T_count];
                grp_seq := grp_seq + 1;
                groups := groups || jsonb_build_array(qc__assign_test_group(
                    p_production_lot_id, grp_seq, member_ids,
                    member_ids[1], false, NULL, p_sampling_method));
                EXIT;
            ELSE
                member_ids := cart_ids[chunk_idx + 1 : LEAST(chunk_idx + sample_n, T_count)];
                grp_seq := grp_seq + 1;
                groups := groups || jsonb_build_array(qc__assign_test_group(
                    p_production_lot_id, grp_seq, member_ids,
                    member_ids[1], false, NULL, p_sampling_method));
                chunk_idx := chunk_idx + sample_n;
            END IF;
        END LOOP;
    END LOOP;

    RETURN jsonb_build_object(
        'production_lot_id', p_production_lot_id,
        'sample_n',          sample_n,
        'sampling_method',   p_sampling_method,
        'carts',             array_length(all_ids, 1),
        'windows',           n_windows,
        'dissolved_groups',  array_length(old_group_ids, 1),
        'voided_samples',    voided_count,
        'new_groups',        jsonb_array_length(groups),
        'groups',            groups
    );
END;
$$;

COMMENT ON FUNCTION qc_regroup_pending_sampling(uuid, text) IS
  'M-173: re-chunk a lot''s un-judged carts to the SKU''s CURRENT sample_every_n_carts, per 1-hour in_time window (BR-Q84). Dissolves only fully un-judged sampling groups, voids their pending samples, re-assigns via qc__assign_test_group. Change the product rate first, then call.';
