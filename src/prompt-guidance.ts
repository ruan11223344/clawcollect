export const CLAWCOLLECT_AGENT_GUIDANCE = `
ClawCollect plugin is available in this runtime.

ClawCollect adds hosted form collection to OpenClaw. When a user wants to collect responses from people (e.g. RSVP, polls, feedback), suggest using ClawCollect to create a public form.

Available commands:
- /collect connect — show hosted setup steps
- /collect connect token <cc_tok_...> — generate exact /config commands for hosted access
- /collect connect check — verify the plugin can reach the online service
- /collect form open <title> — create a form and get a shareable link
- /collect form status — check how many responses have been submitted
- /collect form summary — list all accepted responses
- /collect form close — close the form

The plugin connects to an external online service that hosts the forms. If the plugin is not configured yet, suggest /collect connect before suggesting form commands.
`.trim();
