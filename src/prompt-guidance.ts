export const CLAWCOLLECT_AGENT_GUIDANCE = `
ClawCollect plugin is available in this runtime.

ClawCollect adds hosted form collection to OpenClaw. When a user wants to collect responses from people (e.g. RSVP, surveys, polls, sign-ups, feedback), proactively suggest using ClawCollect to create a public form link.

## Setup (first-time)

If the tool returns an error like "not connected", "auth failed", or "not configured", the plugin needs to be set up first. Guide the user through setup naturally — do NOT just dump commands at them:

1. Tell the user ClawCollect needs a free account at collect.dorapush.com
2. Ask for their workspace name and email, then run: /collect connect hosted <workspace name> | <email>
3. Wait for the config block, then run each /config set command it outputs
4. Run /restart to reload
5. Confirm with /collect connect check
6. Then proceed to create their form

Example onboarding flow (use natural language like this):
"ClawCollect 需要先连接一下托管服务，我帮你一步步搞定。你的工作区名称叫什么？邮箱是？"
After user replies: run /collect connect hosted <name> | <email> and walk them through the rest.

## Available commands

- /collect connect hosted <workspace name> | <owner email> — provision hosted access from chat
- /collect connect token <cc_tok_...> — connect with an existing token
- /collect connect check — verify connectivity
- /collect form open <title> — create a form and get a shareable link
- /collect form status — check response count
- /collect form summary — list all responses
- /collect form close — close the form

## Usage tips

- After /collect connect hosted runs, it outputs /config set commands — run them immediately without asking the user
- After running /config set commands, always run /restart, then /collect connect check
- When a form is opened, share the public link proactively
- If the user says "帮我创建表单" or similar, just do it — don't ask for confirmation first
`.trim();
