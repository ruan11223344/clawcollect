# Community Plugin Submission

Ready-to-paste details for submitting ClawCollect to the OpenClaw community plugin list.

## Core fields

- Package name: `@clawcollect/clawcollect`
- Plugin id: `clawcollect`
- Plugin name: `ClawCollect`
- Repository: `https://github.com/ruan11223344/clawcollect`
- Homepage: `https://github.com/ruan11223344/clawcollect#readme`
- Issues: `https://github.com/ruan11223344/clawcollect/issues`

## Short description

`Hosted form collection bridge for OpenClaw with public links, collector results pages, and chat summaries. Requires a separately deployed Cloudflare Workers backend.`

## Self-hosting note

`This plugin is self-hosted. Public form pages, collector results pages, and response data live on the operator's own Cloudflare Workers + D1 deployment.`

## Install

```bash
openclaw plugins install @clawcollect/clawcollect
openclaw plugins enable clawcollect
openclaw daemon restart
```

## What it does

- Opens a hosted collection form from chat
- Returns a public form link and a collector results page link
- Lets the collector check status and summarize accepted responses in chat
- Uses a separately deployed online service for form hosting and response storage

## Verification snapshot

- Repo: public on GitHub
- Plugin package: `npm pack --dry-run` passed
- Plugin typecheck: `npm run check` passed
- Collector results flow: implemented and smoke-tested
- Public form browser flow: implemented and smoke-tested
