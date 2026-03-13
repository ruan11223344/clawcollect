-- 0002: Add edit token and moderation status to responses
--
-- Supports:
--   1. Response editing by respondent (via edit_token_hash)
--   2. Lightweight moderation by form owner (status: accepted/hidden/spam)

ALTER TABLE responses ADD COLUMN updated_at INTEGER;
ALTER TABLE responses ADD COLUMN edit_token_hash TEXT;
ALTER TABLE responses ADD COLUMN edit_expires_at INTEGER;
ALTER TABLE responses ADD COLUMN status TEXT NOT NULL DEFAULT 'accepted';

CREATE INDEX idx_responses_status ON responses(form_id, status);
