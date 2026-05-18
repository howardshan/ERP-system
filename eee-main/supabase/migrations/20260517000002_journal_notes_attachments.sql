-- Add notes field to journal_entry
ALTER TABLE journal_entry ADD COLUMN IF NOT EXISTS notes text;

-- Attachment tracking table
CREATE TABLE journal_entry_attachment (
    id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    journal_entry_id bigint       NOT NULL REFERENCES journal_entry(id),
    file_name        text         NOT NULL,
    file_size        integer,
    storage_path     text         NOT NULL,
    mime_type        text,
    created_at       timestamptz  NOT NULL DEFAULT now(),
    created_by       uuid
);
CREATE INDEX idx_jea_entry ON journal_entry_attachment(journal_entry_id);

-- Supabase Storage bucket for voucher attachments
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'journal-attachments',
    'journal-attachments',
    false,
    10485760,   -- 10 MB per file
    ARRAY['image/jpeg','image/png','image/webp','application/pdf',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'application/vnd.ms-excel']
)
ON CONFLICT (id) DO NOTHING;
