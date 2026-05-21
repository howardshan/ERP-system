-- Migration M-042: Drop the obsolete qc.batches.* permission group.
--
-- The "Batches" sidebar entry (and standalone LotsList page) is being
-- removed because its Create-New-Batch action overlapped with the
-- Production form's Create Batch flow (one row in qc_production_lot in
-- both cases). To prevent the duplicated control surface, the
-- qc.batches.* resource is dropped from PERMISSION_STRUCTURE and the
-- existing grants for the dev user are cleaned up here.
--
-- LotsList.tsx is intentionally kept as dead code so the file history
-- and any future "manage batches" admin view can be revived without a
-- new migration; just no sidebar exposure or permission gate.

DELETE FROM user_permission_grant
WHERE module_id = 'qc' AND resource = 'batches';
