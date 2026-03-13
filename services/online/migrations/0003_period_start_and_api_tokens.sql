-- 0003: Add current_period_start to entitlements + create api_tokens table
--
-- 1. Billing period fix: store real period_start from Paddle instead of
--    deriving it as (period_end - 30 days). Free workspaces still use
--    calendar month — period_start stays NULL for them.
--
-- 2. API tokens: Bearer token auth for programmatic access.
--    Token stored as SHA-256 hash; plaintext returned only once on creation.

ALTER TABLE entitlements ADD COLUMN current_period_start INTEGER;

----------------------------------------------------------------------
-- api_tokens
----------------------------------------------------------------------
CREATE TABLE api_tokens (
  id            TEXT PRIMARY KEY,          -- tok_<nanoid>
  workspace_id  TEXT NOT NULL REFERENCES workspaces(id),
  created_by    TEXT NOT NULL REFERENCES users(id),
  name          TEXT NOT NULL DEFAULT '',  -- human-readable label
  token_hash    TEXT NOT NULL UNIQUE,      -- SHA-256 hex of the plaintext token
  last_used_at  INTEGER,
  expires_at    INTEGER,                   -- NULL = no expiration
  revoked       INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL
);

CREATE INDEX idx_api_tokens_workspace ON api_tokens(workspace_id);
CREATE INDEX idx_api_tokens_hash ON api_tokens(token_hash);
