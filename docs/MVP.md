# ClawCollect MVP — Form Bridge

## Product framing

ClawCollect is a form bridge plugin for OpenClaw. The main product is the hosted online form collection service (`services/online/`). This plugin connects OpenClaw chats to that service.

The plugin does NOT try to be a standalone collection platform. It is a thin bridge:

```
OpenClaw chat → plugin → online service → web form → responses → summary back in chat
```

## MVP scope

The plugin handles:

1. Creating a form on the online service
2. Publishing it and generating a public link
3. Displaying the link in chat for sharing
4. Checking response count from the remote service
5. Fetching and displaying accepted responses as a text summary
6. Closing the form

## Command design

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

## Local state

The plugin caches minimal state locally (JSON file):

- `onlineCollections[]` — remote form ID, link URL, status, response count

This allows the plugin to resolve which form is active in each scope without querying the remote service on every command.

Other store fields (`lists`, `reminders`, `collectionSessions`, `captures`, `dispatches`) are legacy from earlier versions and preserved for data compatibility. They are not used by the current MVP.

## Architecture

```
src/index.ts        — plugin entry, registers commands only
src/commands.ts     — /collect command handler (form commands + status/doctor)
src/online-client.ts — HTTP client for the online service API
src/storage.ts      — local JSON store (caches remote form state)
src/helpers.ts      — utilities (ID generation, text helpers)
src/scope.ts        — scope key resolution
src/types.ts        — type definitions
```

## Online service dependency

The plugin requires a running instance of the online service (`services/online/`). Without it, all `/collect form` commands will fail with a connection error.

See [services/online/README.md](../services/online/README.md) for service setup.

## Not in MVP

These capabilities exist in the codebase as legacy code but are not registered or exposed:

- Chat collection (passive message capture and local summarization)
- Checklists and list management
- Reminders and scheduled follow-up
- AI tool registration (clawcollect_capture, clawcollect_organize, clawcollect_query)
- Event routing, delivery, adapters, audiences, presentations
- Policy enforcement and safety guards
- Onboarding and intro messages

## Suggested next steps

1. Custom form schema — let users define fields from the chat command
2. AI-powered summary — use the model to synthesize responses
3. Multiple concurrent forms per scope
4. Web dashboard for form management
