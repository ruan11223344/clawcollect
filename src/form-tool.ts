import type { AnyAgentTool, OpenClawPluginApi } from "openclaw/plugin-sdk";

import { handleFormCommand } from "./commands.js";
import { resolveToolScope } from "./scope.js";
import type { ClawCollectPluginConfig } from "./types.js";

function toolReply(text: string) {
  return {
    content: [{ type: "text" as const, text }],
    details: undefined,
  };
}

type ToolCtx = {
  sessionKey?: string;
  messageChannel?: string;
  agentAccountId?: string;
  requesterSenderId?: string;
};

export function createClawCollectFormToolFactory(
  api: OpenClawPluginApi,
  pluginConfig: ClawCollectPluginConfig,
): (ctx: ToolCtx) => AnyAgentTool {
  const stateDir = api.runtime.state.resolveStateDir();

  return (ctx: ToolCtx): AnyAgentTool => {
    const scope = resolveToolScope(ctx);
    const scopeKey = scope?.scopeKey ?? "unknown:default:direct:user:unknown";

    return {
      name: "clawcollect_form",
      label: "ClawCollect Form",
      description: [
        "Manage hosted form collections for gathering responses from participants.",
        "Use this tool when the user wants to:",
        "- Create or open an online form or survey (action: open, requires title)",
        "- Check how many responses have been received (action: status)",
        "- See a text summary of all accepted responses (action: summary)",
        "- Close the form to stop accepting new responses (action: close)",
        "After opening a form, a public link is returned that anyone can use to submit responses.",
      ].join(" "),
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          action: {
            type: "string",
            enum: ["open", "status", "summary", "close"],
            description: "The form action to perform.",
          },
          title: {
            type: "string",
            description: "The form title. Required when action is 'open'.",
          },
        },
        required: ["action"],
      },
      execute: async (_toolCallId, rawParams) => {
        const params = rawParams as { action?: unknown; title?: unknown };
        const action = typeof params.action === "string" ? params.action.trim() : "";
        const title = typeof params.title === "string" ? params.title.trim() : "";

        if (!action) {
          return toolReply("Missing required parameter: action (open|status|summary|close)");
        }

        if (action === "open" && !title) {
          return toolReply("Missing required parameter: title (required when action is 'open')");
        }

        const args = action === "open" ? `open ${title}` : action;
        const result = await handleFormCommand(pluginConfig, stateDir, scopeKey, args);
        return toolReply(result.text);
      },
    };
  };
}
