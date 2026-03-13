-- ClawCollect Online Service: Initial Schema
-- Covers: users, workspaces, subscriptions, entitlements, forms, form_links,
--         responses, usage_counters, webhook_events

----------------------------------------------------------------------
-- users
----------------------------------------------------------------------
CREATE TABLE users (
  id            TEXT PRIMARY KEY,          -- usr_<nanoid>
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL DEFAULT '',
  avatar_url    TEXT NOT NULL DEFAULT '',
  paddle_customer_id TEXT,                 -- set after first Paddle interaction
  created_at    INTEGER NOT NULL,          -- unix epoch seconds
  last_login_at INTEGER NOT NULL
);

----------------------------------------------------------------------
-- workspaces
----------------------------------------------------------------------
CREATE TABLE workspaces (
  id         TEXT PRIMARY KEY,             -- ws_<nanoid>
  name       TEXT NOT NULL,
  owner_id   TEXT NOT NULL REFERENCES users(id),
  plan       TEXT NOT NULL DEFAULT 'free', -- free | pro | team
  suspended  INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

----------------------------------------------------------------------
-- workspace_members
----------------------------------------------------------------------
CREATE TABLE workspace_members (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  user_id      TEXT NOT NULL REFERENCES users(id),
  role         TEXT NOT NULL DEFAULT 'member', -- owner | admin | member
  invited_at   INTEGER,
  joined_at    INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, user_id)
);

----------------------------------------------------------------------
-- subscriptions  (local mirror of Paddle subscription state)
----------------------------------------------------------------------
CREATE TABLE subscriptions (
  id                     TEXT PRIMARY KEY,  -- sub_<nanoid>
  workspace_id           TEXT NOT NULL REFERENCES workspaces(id),
  paddle_subscription_id TEXT UNIQUE,
  paddle_customer_id     TEXT,
  status                 TEXT NOT NULL DEFAULT 'active',
    -- active | trialing | past_due | canceled | paused | unpaid
  plan                   TEXT NOT NULL,     -- pro | team
  billing_cycle          TEXT NOT NULL DEFAULT 'monthly', -- monthly | annual
  quantity               INTEGER NOT NULL DEFAULT 1,      -- seats
  current_period_start   INTEGER,
  current_period_end     INTEGER,
  trial_ends_at          INTEGER,
  canceled_at            INTEGER,
  paused_at              INTEGER,
  synced_at              INTEGER NOT NULL
);

CREATE INDEX idx_subscriptions_workspace ON subscriptions(workspace_id);

----------------------------------------------------------------------
-- entitlements  (derived snapshot, one per workspace)
----------------------------------------------------------------------
CREATE TABLE entitlements (
  workspace_id            TEXT PRIMARY KEY REFERENCES workspaces(id),
  plan                    TEXT NOT NULL DEFAULT 'free',
  status                  TEXT NOT NULL DEFAULT 'active',
  active_forms_limit      INTEGER NOT NULL DEFAULT 3,
  monthly_responses_limit INTEGER NOT NULL DEFAULT 100,
  total_forms_limit       INTEGER NOT NULL DEFAULT 10,
  file_upload_enabled     INTEGER NOT NULL DEFAULT 0,
  file_storage_limit_bytes INTEGER NOT NULL DEFAULT 0,
  export_enabled          INTEGER NOT NULL DEFAULT 0,
  password_protection     INTEGER NOT NULL DEFAULT 0,
  link_expiration         INTEGER NOT NULL DEFAULT 0,
  custom_domain           INTEGER NOT NULL DEFAULT 0,
  remove_branding         INTEGER NOT NULL DEFAULT 0,
  scheduled_close         INTEGER NOT NULL DEFAULT 0,
  webhook_notification    INTEGER NOT NULL DEFAULT 0,
  audit_log               INTEGER NOT NULL DEFAULT 0,
  team_seats_limit        INTEGER NOT NULL DEFAULT 1,
  current_period_end      INTEGER,
  updated_at              INTEGER NOT NULL
);

----------------------------------------------------------------------
-- forms
----------------------------------------------------------------------
CREATE TABLE forms (
  id                  TEXT PRIMARY KEY,    -- frm_<nanoid>
  workspace_id        TEXT NOT NULL REFERENCES workspaces(id),
  created_by          TEXT NOT NULL REFERENCES users(id),
  title               TEXT NOT NULL,
  description         TEXT NOT NULL DEFAULT '',
  schema              TEXT NOT NULL DEFAULT '[]', -- JSON: field definitions
  settings            TEXT NOT NULL DEFAULT '{}', -- JSON: reminder, auto-close, etc.
  status              TEXT NOT NULL DEFAULT 'draft', -- draft | active | closed | archived
  file_upload_enabled INTEGER NOT NULL DEFAULT 0,
  responses_count     INTEGER NOT NULL DEFAULT 0,  -- cached counter
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL,
  closes_at           INTEGER                      -- optional scheduled close
);

CREATE INDEX idx_forms_workspace ON forms(workspace_id);
CREATE INDEX idx_forms_status    ON forms(workspace_id, status);

----------------------------------------------------------------------
-- form_links
----------------------------------------------------------------------
CREATE TABLE form_links (
  id              TEXT PRIMARY KEY,         -- lnk_<nanoid>
  form_id         TEXT NOT NULL REFERENCES forms(id),
  token           TEXT NOT NULL UNIQUE,     -- 32-byte hex, used in /f/:token
  access_type     TEXT NOT NULL DEFAULT 'private',
    -- private | expiring | password | email_verified
  password_hash   TEXT,                     -- bcrypt, only for 'password' type
  expires_at      INTEGER,                  -- only for 'expiring' type
  allowed_emails  TEXT,                     -- JSON array, only for 'email_verified'
  max_responses   INTEGER,                  -- optional per-link cap
  is_active       INTEGER NOT NULL DEFAULT 1,
  created_at      INTEGER NOT NULL
);

CREATE INDEX idx_form_links_form  ON form_links(form_id);
CREATE INDEX idx_form_links_token ON form_links(token);

----------------------------------------------------------------------
-- responses
----------------------------------------------------------------------
CREATE TABLE responses (
  id               TEXT PRIMARY KEY,        -- rsp_<nanoid>
  form_id          TEXT NOT NULL REFERENCES forms(id),
  link_id          TEXT REFERENCES form_links(id),
  data             TEXT NOT NULL DEFAULT '{}', -- JSON: submitted fields
  respondent_ip    TEXT,                    -- truncated to /24
  respondent_email TEXT,
  created_at       INTEGER NOT NULL
);

CREATE INDEX idx_responses_form ON responses(form_id);

----------------------------------------------------------------------
-- usage_counters  (per billing period)
----------------------------------------------------------------------
CREATE TABLE usage_counters (
  workspace_id       TEXT NOT NULL REFERENCES workspaces(id),
  period_start       INTEGER NOT NULL,
  period_end         INTEGER NOT NULL,
  responses_count    INTEGER NOT NULL DEFAULT 0,
  forms_created_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (workspace_id, period_start)
);

----------------------------------------------------------------------
-- webhook_events  (idempotency + audit for Paddle webhooks)
----------------------------------------------------------------------
CREATE TABLE webhook_events (
  id           TEXT PRIMARY KEY,            -- Paddle event_id
  event_type   TEXT NOT NULL,
  payload      TEXT NOT NULL,               -- raw JSON
  processed    INTEGER NOT NULL DEFAULT 0,
  processed_at INTEGER,
  created_at   INTEGER NOT NULL
);

CREATE INDEX idx_webhook_events_type ON webhook_events(event_type);
