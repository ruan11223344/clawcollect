# ClawCollect

ClawCollect adds hosted form collection to OpenClaw.

From any OpenClaw chat, you can open a form, share a public link, check progress, and summarize responses. The plugin is intentionally thin — the main collection system lives in `services/online/` (Cloudflare Workers + D1).

## Hosting model

ClawCollect should feel directly usable for end users.

The recommended product shape is `hosted by default`, with `self-hosted` available as an advanced option.

### Hosted mode

- Users connect the plugin to a managed ClawCollect-compatible service
- Public form pages (`/f/:token`) and collector results pages (`/r/:token`) are hosted for them
- The plugin only needs an `apiUrl` and `apiToken`
- Example hosted service URL: `https://collect.dorapush.com`
- Self-serve signup is available at `https://collect.dorapush.com/signup`
- Fastest chat flow: `/collect connect` -> `/collect connect token <cc_tok_...>` -> `/collect connect check`

### Self-hosted mode

- Advanced users can deploy the online service in `services/online/` to their own Cloudflare account
- Public form pages, collector results pages, and response data then belong to that deployment
- The plugin still connects over the same HTTP API

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

For a hosted deployment, users only need a reachable service URL and API token.

For self-hosting, deploy the backend separately from `services/online/`.

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
            apiUrl: "https://collect.dorapush.com",
            apiToken: "cc_tok_xxxxx"
          }
        }
      }
    }
  }
}
```

In hosted mode, the service operator provides the API token.

In self-hosted mode, start the online service and run `POST /api/tokens`.

## Commands

```text
/collect              — show status and quick actions
/collect help         — show available commands
/collect connect      — show hosted setup steps
/collect connect token <cc_tok_...> — generate exact /config commands
/collect connect check — verify hosted/self-hosted connectivity
/collect status       — show active form collections
/collect doctor       — show diagnostics

/collect form open <title>   — create a form and get a shareable link
/collect form status         — check response count
/collect form summary        — list all accepted responses
/collect form close          — close the form
```

## Usage flow

1. `/collect connect` — shows the hosted signup link and the shortest connection path.
2. Sign up at `https://collect.dorapush.com/signup`, then copy your `apiToken`.
3. `/collect connect token <cc_tok_...>` — generates exact `/config set ...` commands plus `/restart`.
4. `/collect connect check` — verifies the plugin can reach your hosted workspace.
5. `/collect form open BBQ March 30` — creates a form on your configured online service, publishes it, and returns a public link plus a collector results page link.
6. Share the link with participants. They submit responses via the web form (no auth required).
7. `/collect form status` — check how many responses have come in and reopen the results page.
8. `/collect form summary` — see accepted responses as a text summary in chat.
9. `/collect form close` — close the form so no more responses are accepted.

## Online service

The backend implementation lives at `services/online/`. See [services/online/README.md](./services/online/README.md) for API reference, self-hosting setup, and architecture details.

The plugin communicates with a ClawCollect-compatible online service via a REST API using Bearer token authentication. The plugin bridge interface is documented in [services/online/src/lib/plugin-bridge.ts](./services/online/src/lib/plugin-bridge.ts).

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
