# Migrating from LifeHub to ClawCollect

This guide covers upgrading from the `lifehub` plugin id to `clawcollect` (introduced in v0.2.0).

This is a **breaking change** for configuration, event routing, and AI tool ids. Your stored data (lists, reminders, captures) is preserved automatically.

---

## What changed

| Area | Before | After |
|---|---|---|
| Plugin id | `lifehub` | `clawcollect` |
| Config key | `plugins.entries.lifehub` | `plugins.entries.clawcollect` |
| Event ids | `lifehub.system.intro_available`, `lifehub.reminder.due` | `clawcollect.system.intro_available`, `clawcollect.reminder.due` |
| AI tool ids | `lifehub_capture`, `lifehub_organize`, `lifehub_schedule`, `lifehub_query` | `clawcollect_capture`, `clawcollect_organize`, `clawcollect_query` |
| Default store path | `~/.openclaw/plugins/lifehub/store.json` | `~/.openclaw/plugins/clawcollect/store.json` |
| Slash command | `/life` | `/collect` |

## What is automatic

- **Store data migration**: The plugin reads from `plugins/clawcollect/store.json` first. If that file does not exist, it falls back to `plugins/lifehub/store.json`. New writes always go to the new path. No manual file move is needed.
- **Slash command**: Renamed from `/life` to `/collect`. Sub-commands `collect` and `collect-online` are now `chat` and `form` respectively (e.g. `/collect chat open ...`, `/collect form open ...`).
- **Legacy `onboarding.*` config**: Still supported as a compatibility path for the intro event.

## What you must update manually

### 1. Plugin enable command

```bash
# Old
openclaw plugins enable lifehub

# New
openclaw plugins enable clawcollect
```

### 2. Config key

Rename the top-level config key in your OpenClaw configuration file:

**Before:**

```json5
{
  plugins: {
    entries: {
      lifehub: {
        enabled: true,
        config: { /* ... */ }
      }
    }
  }
}
```

**After:**

```json5
{
  plugins: {
    entries: {
      clawcollect: {
        enabled: true,
        config: { /* ... */ }
      }
    }
  }
}
```

If the old `lifehub` key remains, OpenClaw will not pass the config to the plugin. The plugin will load with empty defaults.

### 3. Event routing keys

If your config contains event routing entries, rename the event ids:

```diff
  events: {
-   "lifehub.system.intro_available": { ... },
-   "lifehub.reminder.due": { ... }
+   "clawcollect.system.intro_available": { ... },
+   "clawcollect.reminder.due": { ... }
  }
```

If old event ids remain, those routes will never match. Reminders and intro delivery will silently stop working.

### 4. AI tool references

If you have any of the following that reference tool ids by name, update them:

- Agent prompt overrides or system instructions
- Tool allowlists or blocklists
- Hardcoded scripts or automation that invoke tools by name
- External monitoring or logging filters

```diff
- lifehub_capture    -> clawcollect_capture
- lifehub_organize   -> clawcollect_organize
- lifehub_query      -> clawcollect_query
```

### 5. Custom event ids

If you defined your own event ids using the `lifehub.*` namespace in your config, rename them to use `clawcollect.*` or any namespace you prefer. The plugin only requires the two built-in ids listed above; custom ids just need to be consistent between event producers and the `events` config block.

---

## Step-by-step upgrade

```bash
# 1. Stop the OpenClaw daemon
openclaw daemon stop

# 2. Install the new plugin version
cd /path/to/clawcollect
openclaw plugins install -l .

# 3. Enable with the new plugin id
openclaw plugins enable clawcollect

# 4. Edit your OpenClaw config:
#    - Rename plugins.entries.lifehub -> plugins.entries.clawcollect
#    - Rename event ids: lifehub.* -> clawcollect.*
#    (See examples above)

# 5. Update any external scripts, prompts, or tool allowlists
#    that reference lifehub_* tool ids

# 6. Restart
openclaw daemon restart

# 7. Verify (see below)
```

---

## Verification

After upgrading, confirm these:

| Check | Command / action | Expected |
|---|---|---|
| Plugin loads | Check gateway log for `[clawcollect] loaded` | Present |
| Config applied | `/collect doctor` | Shows your configured values (capture settings, form collection status, etc.) |
| Slash command works | `/collect status` | Shows active collections and capture count |
| AI tools visible | Ask the agent to show available tools | `clawcollect_capture`, `clawcollect_organize`, `clawcollect_query` |

---

## Known edge cases

### Dispatch deduplication keys

The plugin tracks which events have already been delivered using composite keys that include the event id. After renaming, keys stored under the old `lifehub.*` event ids will not match the new `clawcollect.*` ids. This means:

- **Intro event**: May be re-delivered once after upgrade if it was previously sent under the old id. This is harmless.
- **Reminder events**: Not affected, because reminder delivery is keyed by reminder id and marked `done` after delivery, not by dispatch dedup alone.

### Custom dispatch keys

If you wrote custom automation that writes directly to `store.dispatches.sent`, those keys referencing old event ids will no longer match. The practical impact is that a previously-sent custom event may re-fire once.

---

## Rollback

If you need to revert:

1. Re-enable the old plugin version with `openclaw plugins enable lifehub`
2. Rename the config key back to `plugins.entries.lifehub`
3. Rename event ids back to `lifehub.*`
4. Restart the daemon

The store file at the new path (`plugins/clawcollect/store.json`) will need to be copied back to `plugins/lifehub/store.json` if the old version does not have the fallback logic.
