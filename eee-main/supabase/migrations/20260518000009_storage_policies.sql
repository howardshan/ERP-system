-- Migration M-017: Storage RLS policies for journal-attachments bucket
-- Without these, authenticated users get "new row violates row-level security policy"
-- when uploading to the private bucket.

CREATE POLICY "je_attach_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'journal-attachments');

CREATE POLICY "je_attach_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'journal-attachments');

CREATE POLICY "je_attach_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'journal-attachments');
