# Plugin Bridge Smoke Test

Manual QA checklist for verifying the ClawCollect OpenClaw plugin form bridge.

## Prerequisites

1. Online service running: `cd services/online && npm run dev`
2. D1 migrations applied: `npm run db:migrate:local`
3. API token ready — create one with dev headers:

```bash
curl -s -X POST http://localhost:8787/api/tokens \
  -H "Content-Type: application/json" \
  -H "X-Dev-User-Id: my-user" \
  -H "X-Dev-Workspace-Id: my-ws" \
  -d '{"name":"plugin-test"}' | jq .token
```

Copy the `cc_tok_...` value from the output.
4. Plugin installed and configured:

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
            apiToken: "cc_tok_xxxxx"  // your token here
          }
        }
      }
    }
  }
}
```

5. OpenClaw daemon restarted: `openclaw daemon restart`

## Checklist

### Basic commands

| # | Action | Expected |
|---|--------|----------|
| 1 | `/collect` | Shows status: active form collections count |
| 2 | `/collect help` | Lists: form open/status/summary/close commands |
| 3 | `/collect doctor` | Shows: online service enabled, API URL, store path |

### Form lifecycle

| # | Action | Expected |
|---|--------|----------|
| 4 | `/collect form open BBQ Friday` | Returns: form ID + public link URL + results page URL |
| 5 | Open public link in browser | Form page loads with Name + Response fields |
| 6 | Submit a response via the form | 201 success |
| 7 | Submit a second response | 201 success |
| 8 | `/collect form status` | Shows: responses count >= 2 + results page URL |
| 9 | `/collect form summary` | Lists both responses with name + text + results page URL |
| 10 | `/collect form close` | Confirms form closed |
| 11 | Try submitting via public link again | Rejected (form closed) |

### Failure scenarios

| # | Action | Expected |
|---|--------|----------|
| 12 | Remove `online` config, restart, run `/collect form open X` | Error: "Form collection is not enabled" |
| 13 | Set `apiToken` to garbage, restart, run `/collect form status` | Error: "Auth failed" |
| 14 | Stop online service, run `/collect form open X` | Error: "Failed to reach online service" |

### Status after close

| # | Action | Expected |
|---|--------|----------|
| 15 | `/collect status` | Shows: 0 active form collections |
| 16 | `/collect form status` | Shows: "No active form collection here" |

## Pass criteria

All 16 checks pass. No unexpected errors in OpenClaw gateway log.
