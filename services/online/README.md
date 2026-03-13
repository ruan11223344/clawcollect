# ClawCollect Online Service

Cloudflare Workers service providing online form collection, public link sharing, and response submission for ClawCollect.

This service is intended to be deployed into the operator's own Cloudflare account. Public form pages, collector results pages, and response data belong to that deployment.

## Status

**MVP in progress.** This is the backend skeleton for form collection (`/collect form ...`).

### What works now

- Form CRUD: create, list, get, update, publish, close
- **Server-side schema validation**: form submissions validated against field definitions
- Public link generation with high-entropy tokens (access types: `private`, `expiring`, `password`)
- Public form HTML page (`GET /f/:token`) — server-side rendered, content negotiation (JSON via `Accept: application/json` or `?format=json`), confirmation summary after submit
- Collector results page (`GET /r/:token`) — read-only HTML view for owners via a dedicated results token
- Public response submission (`POST /f/:token/submit`) with schema validation + password verification
- **Response editing**: respondents can edit their submission via edit token (time-limited, SHA-256 hashed), including in-page HTML edit after submit
- **Response moderation**: form owners can mark responses as `accepted`/`hidden`/`spam` (owner/admin only)
- **Response listing**: paginated, filterable by status
- **API token auth**: Bearer token authentication with SHA-256 hashed storage
- **Role-based access**: owner/admin/member roles; moderation and token management require owner/admin
- Entitlement engine: Free/Pro/Team plan defaults, auto-provisioned from D1
- Quota checks: active forms limit, monthly responses limit, total forms limit
- **Deterministic billing periods**: UTC calendar month for free workspaces, real Paddle `current_period_start`/`current_period_end` for paid
- Paddle webhook receiver: HMAC-SHA256 signature verification, idempotent event processing, explicit product→plan mapping, subscription state → entitlement sync
- Webhook error handling: returns 5xx on failure so Paddle retries
- CORS: env-based origin allowlist for `/api/*`, open for `/f/*`
- Dev mode: `X-Dev-User-Id` + `X-Dev-Workspace-Id` headers bypass auth with auto-provisioned test data (role=owner)

### Not yet implemented

- **email_verified access type**: Schema supports it, but the API rejects creation with 501. No verification flow exists yet.
- **Turnstile**: Captcha verification on submit endpoint (placeholder comment in code)
- **Rate limiting**: Not yet implemented (planned for Cloudflare rate limiting rules)
- **File upload**: R2 integration not yet wired
- **Password hashing**: Uses SHA-256 instead of bcrypt (bcrypt not available in Workers runtime — consider argon2 via WASM)
- **Dashboard frontend**: No UI — API-only for now
- **Team management**: No invite/member endpoints yet
- **Export**: No CSV/JSON export endpoint yet
- **Audit logs**: Schema not yet created

## API Authentication

### Bearer Token Auth

API tokens are managed via `POST /api/tokens` (requires owner/admin role). The plaintext token is returned **only once** at creation; the DB stores only the SHA-256 hash.

```bash
# Create token (via dev headers or existing Bearer token)
curl -X POST http://localhost:8787/api/tokens \
  -H "Content-Type: application/json" \
  -H "X-Dev-User-Id: usr_test123" \
  -H "X-Dev-Workspace-Id: ws_test123" \
  -d '{"name": "My API Token"}'
# => {"id":"tok_xxx","token":"cc_tok_abc123...","name":"My API Token",...}

# Use the token
curl http://localhost:8787/api/forms \
  -H "Authorization: Bearer cc_tok_abc123..."

# List tokens
curl http://localhost:8787/api/tokens \
  -H "Authorization: Bearer cc_tok_abc123..."

# Revoke a token
curl -X DELETE http://localhost:8787/api/tokens/tok_xxx \
  -H "Authorization: Bearer cc_tok_abc123..."
```

### Dev Mode

In development (`ENVIRONMENT=development`), you can use dev headers instead of Bearer tokens:

```
X-Dev-User-Id: usr_test123
X-Dev-Workspace-Id: ws_test123
```

Dev users are auto-provisioned with `role=owner`.

### Role-Based Permissions

| Action | Required role |
|--------|-------------|
| Form CRUD, publish, close | Any authenticated |
| Response listing | Any authenticated |
| Response moderation | owner, admin |
| Token create/list/revoke | owner, admin |
| Link creation | Any authenticated |

## Billing Periods

| Workspace type | Period start | Period end |
|---------------|-------------|-----------|
| Free | 1st of current UTC month | 1st of next UTC month |
| Paid (Paddle) | `current_period_start` from Paddle webhook | `current_period_end` from Paddle webhook |

Both `current_period_start` and `current_period_end` are stored in the `entitlements` table and updated on every subscription webhook event. Usage counters are keyed by `(workspace_id, period_start)`.

## Schema Validation

### Supported field types

| Type | Value type | Notes |
|------|-----------|-------|
| `text` | string | Single-line text |
| `textarea` | string | Multi-line text |
| `email` | string | Validated against email format |
| `number` | number | Must be finite |
| `select` | string | Must match one of `options` |
| `checkbox` | boolean | true/false |
| `date` | string | Must be `YYYY-MM-DD` format |

### Supported validation rules

| Rule | Applies to | Description |
|------|-----------|-------------|
| `required` | all | Field must be present and non-empty |
| `minLength` | text, textarea | Minimum string length |
| `maxLength` | text, textarea | Maximum string length |
| `min` | number | Minimum numeric value |
| `max` | number | Maximum numeric value |
| `pattern` | text, textarea | Regex pattern to match |
| `options` | select | Array of valid option strings |

### Schema definition format

```json
[
  { "id": "name", "type": "text", "label": "Your Name", "required": true, "maxLength": 100 },
  { "id": "email", "type": "email", "label": "Email", "required": true },
  { "id": "count", "type": "number", "label": "How many?", "min": 1, "max": 100 },
  { "id": "meal", "type": "select", "label": "Meal", "options": ["beef", "chicken", "veggie"] },
  { "id": "agree", "type": "checkbox", "label": "I agree to terms", "required": true },
  { "id": "date", "type": "date", "label": "Preferred Date" }
]
```

Schema is validated when creating or updating a form (`POST /api/forms`, `PATCH /api/forms/:id`). Submissions are validated against the schema at `POST /f/:token/submit` and `PUT /f/:token/responses/:responseId`.

Validation errors return structured responses:

```json
{
  "error": "validation_failed",
  "field_errors": [
    { "field": "email", "code": "invalid_email", "message": "Email is not a valid email address" },
    { "field": "count", "code": "min", "message": "How many? must be at least 1" }
  ]
}
```

Unknown fields (not defined in schema) are rejected with `unknown_field` errors.

## Response Editing

Respondents can edit their own submission within a time window.

### Enabling

Set `allow_response_edit: true` in form settings when creating or updating a form:

```bash
# On create
curl -X POST http://localhost:8787/api/forms \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer cc_tok_xxx" \
  -d '{"title": "BBQ", "settings": {"allow_response_edit": true}}'

# On update
curl -X PATCH http://localhost:8787/api/forms/frm_xxx \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer cc_tok_xxx" \
  -d '{"settings": {"allow_response_edit": true}}'
```

Optionally set `edit_window_seconds` (default: 86400 = 24 hours):

```json
{"settings": {"allow_response_edit": true, "edit_window_seconds": 3600}}
```

### Flow

1. Submit — response includes `edit_token` and `edit_expires_at`:

```bash
curl -X POST http://localhost:8787/f/<token>/submit \
  -H "Content-Type: application/json" \
  -d '{"data": {"name": "Alice", "email": "alice@example.com"}}'
# => {"id":"rsp_xxx","submitted_at":1741...,"edit_token":"abc123...","edit_expires_at":1741...}
```

2. Edit using the token:

```bash
curl -X PUT http://localhost:8787/f/<token>/responses/rsp_xxx \
  -H "Content-Type: application/json" \
  -d '{"edit_token": "abc123...", "data": {"name": "Alice Smith", "email": "alice@example.com"}}'
# => {"id":"rsp_xxx","updated_at":1741...,"edited":true}
```

### Constraints

- Edit token returned **only once** at submission; DB stores SHA-256 hash only
- Default edit window: 24 hours (configurable via `edit_window_seconds`)
- Editing does **not** increment `responses_count` or usage counters
- Editing requires the form to still be active (not closed/expired)
- Forms without `allow_response_edit` do not generate edit tokens and block editing
- The HTML form page shows a confirmation summary after submit; if `edit_token` is returned, the same page can reopen the form and save changes via `PUT /f/:token/responses/:responseId`

## Collector Results Links

Owners can create a read-only results link for a form. This is meant for browser viewing or safe sharing in chat without exposing the main API token.

### Create or fetch the stable results link

```bash
curl -X POST http://localhost:8787/api/forms/frm_xxx/results-link \
  -H "Authorization: Bearer cc_tok_xxx"
# => {"token":"...","url":"/r/<token>","created_at":1741...}
```

### Open the results page

```bash
# HTML by default
open http://localhost:8787/r/<token>

# JSON if needed
curl http://localhost:8787/r/<token>?format=json
```

### Behavior

- Read-only owner/collector view
- Shows all / accepted / hidden / spam filters
- Marks responses that were edited after submit
- Uses `link_id` presence to distinguish public-link submissions from imported/non-link entries
- Remains available after the public form has been closed

## Response Moderation

Form owners (owner/admin role) can mark responses as `accepted`, `hidden`, or `spam`. This is for anti-spam and organization, **not** an approval workflow.

### Listing responses

```bash
# All responses
curl http://localhost:8787/api/forms/frm_xxx/responses \
  -H "Authorization: Bearer cc_tok_xxx"

# Filter by status
curl "http://localhost:8787/api/forms/frm_xxx/responses?status=spam" \
  -H "Authorization: Bearer cc_tok_xxx"

# Paginate
curl "http://localhost:8787/api/forms/frm_xxx/responses?limit=20&offset=40" \
  -H "Authorization: Bearer cc_tok_xxx"
```

Response:

```json
{
  "responses": [
    {"id":"rsp_xxx","form_id":"frm_xxx","data":{...},"status":"accepted","created_at":1741...,"updated_at":1741...}
  ],
  "total": 42,
  "limit": 50,
  "offset": 0
}
```

### Moderating

```bash
# Mark as spam (requires owner/admin role)
curl -X PATCH http://localhost:8787/api/forms/frm_xxx/responses/rsp_xxx/moderation \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer cc_tok_xxx" \
  -d '{"status": "spam"}'

# Restore
curl -X PATCH http://localhost:8787/api/forms/frm_xxx/responses/rsp_xxx/moderation \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer cc_tok_xxx" \
  -d '{"status": "accepted"}'
```

### Constraints

- Moderation does **not** affect billing quotas — `responses_count` and `usage_counters` unchanged
- New submissions default to `accepted`
- Only owner/admin can moderate (via authenticated API)
- No queue, no reviewers, no comments — this is not an approval workflow

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ENVIRONMENT` | Yes | `development` or `production` |
| `PADDLE_WEBHOOK_SECRET` | Production | Paddle webhook signing secret. Skipped in dev mode. |
| `PADDLE_PRODUCT_PRO` | Production | Paddle product_id for Pro plan |
| `PADDLE_PRODUCT_TEAM` | Production | Paddle product_id for Team plan |
| `ALLOWED_ORIGINS` | Production | Comma-separated CORS origins for `/api/*` routes |

## Local Development

### Prerequisites

- Node.js >= 20
- Wrangler CLI (installed as devDependency)

### Setup

```bash
cd services/online
npm install
npm run db:migrate:local
npm run dev
```

The server starts at `http://localhost:8787`.

### D1 Migrations

```bash
# Apply to local D1
npm run db:migrate:local

# Apply to remote (production) D1
npm run db:migrate:remote

# Reset local DB (delete state and re-apply)
rm -rf .wrangler/state && npm run db:migrate:local
```

### Testing with curl

```bash
# Create a form with schema and edit enabled
curl -X POST http://localhost:8787/api/forms \
  -H "Content-Type: application/json" \
  -H "X-Dev-User-Id: usr_test123" \
  -H "X-Dev-Workspace-Id: ws_test123" \
  -d '{
    "title": "BBQ March 30",
    "schema": [
      {"id": "name", "type": "text", "label": "Name", "required": true},
      {"id": "email", "type": "email", "label": "Email", "required": true},
      {"id": "count", "type": "number", "label": "How many?", "min": 1, "max": 20},
      {"id": "meal", "type": "select", "label": "Meal Preference", "options": ["beef", "chicken", "veggie"]}
    ],
    "settings": {"allow_response_edit": true}
  }'

# Create an API token (owner/admin only)
curl -X POST http://localhost:8787/api/tokens \
  -H "Content-Type: application/json" \
  -H "X-Dev-User-Id: usr_test123" \
  -H "X-Dev-Workspace-Id: ws_test123" \
  -d '{"name": "Dev Token"}'

# Use Bearer token for all subsequent calls
TOKEN="cc_tok_xxx"  # from above response

# Publish
curl -X POST http://localhost:8787/api/forms/frm_xxx/publish \
  -H "Authorization: Bearer $TOKEN"

# Create a private link
curl -X POST http://localhost:8787/api/forms/frm_xxx/links \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{}'

# Get public form (no auth needed)
curl http://localhost:8787/f/<token>

# Submit response (no auth needed) — returns edit_token if enabled
curl -X POST http://localhost:8787/f/<token>/submit \
  -H "Content-Type: application/json" \
  -d '{"data": {"name": "Alice", "email": "alice@example.com", "count": 3, "meal": "beef"}}'

# Edit response (use edit_token from submit)
curl -X PUT http://localhost:8787/f/<token>/responses/rsp_xxx \
  -H "Content-Type: application/json" \
  -d '{"edit_token": "<token_from_submit>", "data": {"name": "Alice Smith", "email": "alice@example.com", "count": 4, "meal": "chicken"}}'

# List responses (authenticated)
curl http://localhost:8787/api/forms/frm_xxx/responses \
  -H "Authorization: Bearer $TOKEN"

# Moderate a response (owner/admin only)
curl -X PATCH http://localhost:8787/api/forms/frm_xxx/responses/rsp_xxx/moderation \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"status": "spam"}'

# Check usage
curl http://localhost:8787/api/usage \
  -H "Authorization: Bearer $TOKEN"
```

### Simulating Paddle Webhook

Webhooks now require explicit product→plan mapping. In dev without `PADDLE_PRODUCT_PRO` / `PADDLE_PRODUCT_TEAM` set, webhooks with unrecognized product_ids will return 500.

To test, set the env vars in `.dev.vars`:

```
PADDLE_PRODUCT_PRO=pro_test_123
PADDLE_PRODUCT_TEAM=pro_test_456
```

Then:

```bash
curl -X POST http://localhost:8787/webhooks/paddle \
  -H "Content-Type: application/json" \
  -H "Paddle-Signature: ts=9999999999;h1=fakesig" \
  -d '{"event_id":"evt_test1","event_type":"subscription.created","data":{"id":"sub_paddle1","status":"active","custom_data":{"workspace_id":"ws_test123"},"customer_id":"cus_1","current_billing_period":{"starts_at":"2026-03-01T00:00:00Z","ends_at":"2026-04-01T00:00:00Z"},"items":[{"price":{"product_id":"pro_test_123"},"quantity":1}]}}'
```

## Project Structure

```
services/online/
├── migrations/
│   ├── 0001_initial.sql                     # D1 schema: users, workspaces, forms, etc.
│   ├── 0002_response_edit_moderation.sql    # Add edit token + moderation to responses
│   └── 0003_period_start_and_api_tokens.sql # Add period_start to entitlements + api_tokens table
├── src/
│   ├── index.ts                  # Hono app entry point, route mounting, CORS
│   ├── env.ts                    # Cloudflare bindings type definition
│   ├── db/
│   │   ├── entitlements.ts       # Entitlement CRUD + plan provisioning
│   │   └── quota.ts              # Quota checks, usage counters, period resolution
│   ├── lib/
│   │   ├── id.ts                 # Prefixed ID + link token generation
│   │   ├── plans.ts              # Plan constants (Free/Pro/Team)
│   │   ├── plugin-bridge.ts      # Plugin integration interface (design doc)
│   │   ├── time.ts               # Time utilities + deterministic billing periods
│   │   └── validation.ts         # Form schema definition + submission validation
│   ├── middleware/
│   │   ├── auth.ts               # Auth middleware (dev bypass + Bearer token auth)
│   │   ├── entitlements.ts       # Entitlement loading middleware
│   │   └── role.ts               # Role-based access control middleware
│   └── routes/
│       ├── forms.ts              # Form CRUD + publish/close + links + responses + moderation
│       ├── public.ts             # Public form get + submission + response editing
│       ├── tokens.ts             # API token management (create/list/revoke)
│       └── webhooks.ts           # Paddle webhook handler
├── wrangler.toml                 # Workers config + env var docs
├── tsconfig.json
├── package.json
└── README.md
```

## Smoke Test

Automated end-to-end smoke test covering the form lifecycle and failure scenarios.

### Prerequisites

- Service running: `npm run dev`
- Migrations applied: `npm run db:migrate:local`

### Run

```bash
npm run smoke
```

### Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `SMOKE_BASE_URL` | `http://localhost:8787` | Service URL |
| `SMOKE_API_TOKEN` | *(none)* | Pre-existing Bearer token — skips dev-header token creation |
| `SMOKE_USER_ID` | `smoke-user` | Dev user ID for token creation (ignored if `SMOKE_API_TOKEN` set) |
| `SMOKE_WORKSPACE_ID` | `smoke-ws` | Dev workspace ID (ignored if `SMOKE_API_TOKEN` set) |

For staging/production (where dev headers are disabled), supply a real token:

```bash
SMOKE_BASE_URL=https://staging.example.com SMOKE_API_TOKEN=cc_tok_xxxxx npm run smoke
```

### Coverage

**Main chain:**
- Create API token
- Create form → publish → create link
- Public GET form data
- Submit 2 responses
- GET form (check count) → GET responses (check data)
- Close form
- Submit after close rejected

**Failure scenarios:**
- Invalid bearer token → 401
- No bearer token → 401
- Form not found → 404
- Invalid public link → 404
- Schema validation failure (missing required field) → 400

### Role & Isolation Smoke (`npm run smoke:roles`)

Tests multi-workspace isolation and role-based access control.

```bash
npm run smoke:roles
```

**Coverage:**
- Owner creates token, form, link, moderates responses
- Cross-workspace isolation: workspace B cannot list/get/close/moderate workspace A's forms or responses (6 scenarios)
- Public respondent boundaries: cannot access /api/*, cannot moderate, cannot create tokens

**Limitation:** Dev headers always provision `role=owner`. There is no API to create member-role users yet, so member-specific restrictions (member cannot create tokens, member cannot moderate) are not tested. This requires a future team management API or direct DB seeding.

### Browser E2E Smoke (`npm run smoke:e2e`)

Tests the public form browser flow via Playwright.

```bash
npx playwright install chromium  # one-time setup
npm run smoke:e2e
```

**Coverage:**
- Open public form page → see title + field labels
- Fill Name + Response fields → submit → see confirmation summary
- Click "Edit response" → save changes → see updated summary
- Open collector results page → see latest submitted response
- Close form → reopen page → see closed/unavailable state
- Close form → collector results page still available with closed status

## Plugin Integration

The ClawCollect OpenClaw plugin integrates with this service via Bearer token auth. See `src/lib/plugin-bridge.ts` for the interface documentation.
