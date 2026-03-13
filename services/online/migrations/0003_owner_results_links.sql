-- 0003: Add read-only collector results links for form owners
--
-- Supports:
--   1. Stable browser-openable results pages for collectors/owners
--   2. Safe sharing of read-only results URLs in chat without exposing API tokens

ALTER TABLE forms ADD COLUMN owner_results_token TEXT;
ALTER TABLE forms ADD COLUMN owner_results_created_at INTEGER;

CREATE UNIQUE INDEX idx_forms_owner_results_token ON forms(owner_results_token);
