# Release Checklist

Run through before every release.

## 1. Build verification

- [ ] Root project: `npm run check` passes
- [ ] Online service: `cd services/online && npm run typecheck` passes

## 2. Database

- [ ] D1 migrations from empty DB: `npm run db:migrate:local` succeeds
- [ ] All migrations apply in order (0001, 0002, 0003)

## 3. Smoke tests

- [ ] Online service smoke: `cd services/online && npm run smoke` — all pass
  - Requires: service running (`npm run dev`), migrations applied
- [ ] Role & isolation smoke: `cd services/online && npm run smoke:roles` — all pass
  - Requires: service running, migrations applied
- [ ] Browser E2E smoke: `cd services/online && npm run smoke:e2e` — all pass
  - Requires: service running, migrations applied, Playwright installed
- [ ] Plugin bridge smoke: follow [docs/PLUGIN-SMOKE.md](./PLUGIN-SMOKE.md) — all 16 checks pass
  - Requires: service running, plugin installed + configured, OpenClaw daemon running

## 4. Migration / compatibility

- [ ] Store loads from legacy path (`plugins/lifehub/store.json`) if new path missing
- [ ] Store loads with version 1/2/3 data and upgrades to version 4
- [ ] Plugin starts with empty/missing `online` config without crashing
- [ ] Plugin starts with legacy config keys (capture, reminders, etc.) without crashing

## 5. UI / visual

- [ ] Form UI checklist reviewed on desktop width: [docs/FORM-UI-CHECKLIST.md](./FORM-UI-CHECKLIST.md)
- [ ] Form UI checklist reviewed on mobile width (375px)
  - Test at both desktop and mobile (375px) widths

## 6. Product boundary

- [ ] `/collect help` output matches README command surface (8 commands)
- [ ] README first line describes form bridge, not collection platform
- [ ] No promotion of chat collection, reminders, or checklists in help text
- [ ] `src/index.ts` registers only the command handler (no AI tools, no hooks, no services)

## 7. Documentation

- [ ] README matches current command surface
- [ ] RELEASE-NOTES.md updated for this version
- [ ] MIGRATION.md still accurate

## Notes

- Online smoke test uses dev mode headers (X-Dev-User-Id / X-Dev-Workspace-Id) by default
- For staging/production (where dev headers are disabled), supply `SMOKE_API_TOKEN=cc_tok_xxxxx` to skip token creation and use an existing Bearer token
- If smoke test fails, fix the issue before releasing
