# ClawCollect Build Review

## Goal

ClawCollect is a form bridge plugin for OpenClaw. It connects OpenClaw chats to a hosted online form collection service.

## Product Boundary

ClawCollect targets:

- Creating and managing web forms from chat
- Sharing public links for response collection
- Summarizing responses back in chat

The plugin is intentionally thin. The main collection system (form hosting, response storage, moderation, billing) lives in the online service at `services/online/`.

## Current Architecture

### 1. Plugin entry (`src/index.ts`)

Registers the `/collect` command handler. No AI tools, no event hooks, no background services.

### 2. Command handler (`src/commands.ts`)

Handles all slash commands:
- `/collect`, `/collect help`, `/collect status`, `/collect doctor`
- `/collect form open|status|summary|close`

Form commands call the online service via `OnlineClient` and cache results locally.

### 3. Online client (`src/online-client.ts`)

Lightweight HTTP client wrapping the online service REST API. Uses Bearer token authentication. Covers: form CRUD, publish, link creation, response listing, form close.

### 4. Local storage (`src/storage.ts`)

JSON file store that caches remote form state (`onlineCollections`). Includes legacy field support for backward-compatible store loading.

### 5. Online service (`services/online/`)

Cloudflare Workers + D1 backend. Handles:
- Form creation, publishing, and link generation
- Public response submission
- Response moderation
- API token authentication
- Paddle webhook integration for billing

See [services/online/README.md](../services/online/README.md).

## Key Design Decisions

### Bridge, not platform

The plugin does not try to be a standalone collection platform. It delegates all form hosting and response storage to the online service.

### Minimal local state

The plugin only caches enough to know which form is active in each scope. All authoritative data lives in the online service.

### No AI tools in MVP

AI tool registration was removed from the plugin entry. The form bridge workflow is fully driven by slash commands. AI tools may be reintroduced later for natural-language form creation.

## What Was Verified

- TypeScript compile passes
- Plugin loads in OpenClaw
- End-to-end form workflow tested: create → publish → link → submit → status → summary → close

## Legacy Code

The codebase contains modules from earlier product directions that are no longer registered or exposed:

- `src/ai-tool.ts` — AI tool definitions (capture, organize, query)
- `src/hooks.ts` — passive message capture
- `src/app.ts` — chat collection and checklist operations
- `src/policy.ts`, `src/safety-guard.ts` — boundary enforcement
- `src/delivery.ts`, `src/presentation.ts` — event routing and rendering

These files are not imported from the active plugin entry point (`src/index.ts`).

## Main Files

Active:
- `src/index.ts`
- `src/commands.ts`
- `src/online-client.ts`
- `src/storage.ts`
- `src/helpers.ts`
- `src/scope.ts`
- `src/types.ts`

Legacy (not registered):
- `src/ai-tool.ts`
- `src/hooks.ts`
- `src/app.ts`
- `src/policy.ts`
- `src/safety-guard.ts`
- `src/delivery.ts`
- `src/presentation.ts`
- `src/domain.ts`
