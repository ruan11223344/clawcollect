# Release Notes

## v0.2.0 — Form bridge MVP

**Release date:** 2026-03-12

### Product direction change

ClawCollect is now a **form bridge plugin** for OpenClaw. The plugin connects OpenClaw chats to a hosted online form collection service (`services/online/`). All previous local collection, checklist, reminder, and routing capabilities have been removed from the active surface.

### Breaking changes

**Plugin rename:**

- Plugin id: `lifehub` -> `clawcollect`
- Config key: `plugins.entries.lifehub` -> `plugins.entries.clawcollect`
- Slash command: `/life` -> `/collect`

See [MIGRATION.md](./MIGRATION.md) for the full upgrade guide.

**Removed from command surface:**

- `/collect chat ...` (local chat collection)
- `/collect intro`, `/collect export`, `/collect list`, `/collect reminder`

**Removed from runtime:**

- AI tool registration (`clawcollect_capture`, `clawcollect_organize`, `clawcollect_query`)
- Passive message capture hook
- Reminder sweep service
- Onboarding service
- Policy enforcement and safety guard hooks
- Prompt guidance injection

### Final command surface

```text
/collect
/collect help
/collect status
/collect doctor
/collect form open <title>
/collect form status
/collect form summary
/collect form close
```

### Backward-compatible

- **Store data**: Automatically loaded from the legacy path. Legacy fields (lists, reminders, captures, etc.) are preserved in the store schema for data compatibility but are not used by the current MVP.
- **Config**: Legacy config keys (capture, reminders, adapters, etc.) are accepted without errors.

### Internal changes

- Plugin entry (`src/index.ts`) now registers only the command handler
- README rewritten as form bridge product description
- docs/MVP.md and docs/BUILD-REVIEW.md rewritten for form bridge architecture
- Legacy modules (ai-tool, hooks, app, policy, safety-guard, delivery, presentation, service, intro) remain in the codebase but are not imported from the active entry point

---

## v0.1.0 — Initial release

Initial MVP release as `lifehub` / `LifeHub`.
