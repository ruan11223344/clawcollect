# Community Plugin Release

Checklist for publishing ClawCollect as an OpenClaw community plugin.

## Product positioning

ClawCollect is an OpenClaw plugin plus a separately deployed backend service.

- The plugin is what gets listed as a community plugin
- The backend in `services/online/` is self-hosted by the user/operator
- Public form pages and collector results pages run on the operator's Cloudflare account, not on OpenClaw itself

## Before publish

1. Confirm plugin metadata is correct in [openclaw.plugin.json](/Users/ruanjunsen/project/clawcollect/openclaw.plugin.json)
2. Confirm package metadata is correct in [package.json](/Users/ruanjunsen/project/clawcollect/package.json)
3. Run plugin typecheck: `npm run check`
4. Run online service typecheck: `cd services/online && npm run typecheck`
5. Run online browser smoke: `cd services/online && npm run smoke:e2e`
6. Verify README install/config instructions from a clean environment
7. Verify the online service deployment guide in [services/online/README.md](/Users/ruanjunsen/project/clawcollect/services/online/README.md)

## Publish steps

1. Publish the plugin package to npm:
   `npm publish`
2. Ensure the source repository is public
3. Ensure the repository has:
   - setup instructions
   - usage instructions
   - issue tracker enabled
4. Prepare the community plugin submission with:
   - package name: `@clawcollect/clawcollect`
   - plugin id: `clawcollect`
   - short description
   - repository URL
   - note that the plugin requires a separately deployed online service

## Submission notes

Recommended short description:

`Hosted form collection bridge for OpenClaw with public links, collector results pages, and chat summaries. Requires a separately deployed Cloudflare Workers backend.`

Recommended caveat text:

`This plugin is self-hosted. Form pages and response data live on the operator's own Cloudflare Workers + D1 deployment.`

## Missing release metadata

These should be filled before public release:

- `repository` field in `package.json`
- `homepage` field in `package.json`
- `bugs` field in `package.json`
- final npm ownership / access checks
