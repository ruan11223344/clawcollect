# ClawCollect

ClawCollect adds hosted form collection to OpenClaw.

From any OpenClaw chat, you can open a form, share a public link, check progress, and summarize responses. The plugin is intentionally thin — the main collection system lives in `services/online/` (Cloudflare Workers + D1).

## Hosting model

ClawCollect is currently designed for self-hosting.

- You deploy the online service in `services/online/` to your own Cloudflare account
- Public form pages (`/f/:token`) and collector results pages (`/r/:token`) run on your own Worker/domain
- Response data is stored in your own D1 database
- The OpenClaw plugin only calls that service over HTTP; it does not host forms by itself

There is no managed ClawCollect-hosted SaaS in this repository today.

## Install

### OpenClaw plugin

Install from a local checkout during development:

```bash
cd /Users/ruanjunsen/project/clawcollect
openclaw plugins install -l .
openclaw plugins enable clawcollect
openclaw daemon restart
```

For a future community-plugin release, the intended install path is:

```bash
openclaw plugins install @clawcollect/clawcollect
openclaw plugins enable clawcollect
openclaw daemon restart
```

### Online service

Deploy the backend separately from `services/online/`. The plugin requires a reachable online service URL and API token.

## Config

```json5
{
  plugins: {
    entries: {
      clawcollect: {
        enabled: true,
        config: {
          online: {
            enabled: true,
            apiUrl: "http://localhost:8787",
            apiToken: "cc_tok_xxxxx"
          }
        }
      }
    }
  }
}
```

To get an API token, start the online service and run `POST /api/tokens`.

## Commands

```text
/collect              — show status and quick actions
/collect help         — show available commands
/collect status       — show active form collections
/collect doctor       — show diagnostics

/collect form open <title>   — create a form and get a shareable link
/collect form status         — check response count
/collect form summary        — list all accepted responses
/collect form close          — close the form
```

## Usage flow

1. `/collect form open BBQ March 30` — creates a form on your online service, publishes it, and returns a public link plus a collector results page link.
2. Share the link with participants. They submit responses via the web form (no auth required).
3. `/collect form status` — check how many responses have come in and reopen the results page.
4. `/collect form summary` — see accepted responses as a text summary in chat.
5. `/collect form close` — close the form so no more responses are accepted.

## Online service

The backend lives at `services/online/`. See [services/online/README.md](./services/online/README.md) for setup, API reference, and architecture details.

The plugin communicates with your deployed online service via a REST API using Bearer token authentication. The plugin bridge interface is documented in [services/online/src/lib/plugin-bridge.ts](./services/online/src/lib/plugin-bridge.ts).

## What is supported

- Open / status / summary / close workflow
- Default schema: name (optional text) + response (required textarea)
- Public link generation
- Deterministic text summary (no AI)

## What is NOT supported yet

- Custom form schema from the chat command
- Password-protected or expiring links
- File upload fields
- Dashboard or web management UI
- AI-powered summary

## Upgrading from LifeHub (v0.1.x)

> **Breaking change in v0.2.0**: The plugin has been renamed from `lifehub` to `clawcollect`.

See **[MIGRATION.md](./MIGRATION.md)** for the full upgrade guide.

## Current limitations

- Storage uses a local JSON file for caching remote form state
- One active form collection per scope at a time

## Testing

- **Online service smoke test**: `cd services/online && npm run smoke` — see [services/online/README.md](./services/online/README.md)
- **Role & isolation smoke**: `cd services/online && npm run smoke:roles` — multi-workspace isolation + owner permissions
- **Browser E2E smoke**: `cd services/online && npm run smoke:e2e` — public form browser flow (requires Playwright)
- **Plugin bridge smoke test**: [docs/PLUGIN-SMOKE.md](./docs/PLUGIN-SMOKE.md)
- **Form UI checklist**: [docs/FORM-UI-CHECKLIST.md](./docs/FORM-UI-CHECKLIST.md) — visual/interaction QA for public form pages
- **Release checklist**: [docs/RELEASE-CHECKLIST.md](./docs/RELEASE-CHECKLIST.md)

See [docs/MVP.md](./docs/MVP.md) for the product design.
