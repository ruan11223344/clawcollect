-- Add form-level response cap
ALTER TABLE forms ADD COLUMN max_responses INTEGER;
