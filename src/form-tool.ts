import type { AnyAgentTool, OpenClawPluginApi } from "openclaw/plugin-sdk";

import { handleFormCommand } from "./commands.js";
import { resolveToolScope } from "./scope.js";
import type { ClawCollectPluginConfig, FormQuestion } from "./types.js";

function isConfigured(pluginConfig: ClawCollectPluginConfig): boolean {
  return !!(
    pluginConfig.online?.enabled &&
    pluginConfig.online.apiUrl?.trim() &&
    pluginConfig.online.apiToken?.trim()
  );
}

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
        "IMPORTANT: When action is 'open', you MUST ALWAYS include the 'questions' array.",
        "Design 4-8 questions appropriate for the user's purpose before calling this tool.",
        "NEVER call with action=open without passing questions — the default 2-field schema is unacceptable.",
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
          description: {
            type: "string",
            description: "Optional description shown at the top of the form.",
          },
          questions: {
            type: "array",
            description:
              "REQUIRED when action is 'open'. Always design and pass 4-8 questions based on the user's intent. NEVER omit this when opening a form.",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["id", "type", "label"],
              properties: {
                id: { type: "string", description: "Unique question identifier, e.g. 'q1'." },
                type: {
                  type: "string",
                  enum: ["text", "textarea", "select", "checkbox", "number", "email", "date"],
                  description: "Question input type.",
                },
                label: { type: "string", description: "The question text shown to respondents." },
                required: { type: "boolean", description: "Whether the question must be answered." },
                options: {
                  type: "array",
                  items: { type: "string" },
                  description: "Answer choices for radio or checkbox questions.",
                },
                placeholder: {
                  type: "string",
                  description: "Placeholder hint text for text/textarea/number/email questions.",
                },
              },
            },
          },
        },
        required: ["action"],
      },
      execute: async (_toolCallId, rawParams) => {
        const params = rawParams as {
          action?: unknown;
          title?: unknown;
          description?: unknown;
          questions?: unknown;
        };
        const action = typeof params.action === "string" ? params.action.trim() : "";
        const title = typeof params.title === "string" ? params.title.trim() : "";

        if (!action) {
          return toolReply("Missing required parameter: action (open|status|summary|close)");
        }

        if (action === "open" && !title) {
          return toolReply("Missing required parameter: title (required when action is 'open')");
        }

        if (!isConfigured(pluginConfig)) {
          return toolReply(
            [
              "CLAWCOLLECT_NOT_CONFIGURED",
              "ClawCollect is not connected to an online service yet.",
              "To set it up, ask the user for their workspace name and email, then run:",
              "  /collect connect hosted <workspace name> | <email>",
              "After it outputs /config set commands, run each one, then run /restart, then /collect connect check.",
              "Guide the user through this naturally without dumping all commands at once.",
            ].join("\n"),
          );
        }

        const description = typeof params.description === "string" ? params.description : undefined;
        const questions = Array.isArray(params.questions) ? (params.questions as FormQuestion[]) : undefined;

        const args = action === "open" ? `open ${title}` : action;
        const result = await handleFormCommand(pluginConfig, stateDir, scopeKey, args, {
          description,
          questions,
        });
        return toolReply(result.text);
      },
    };
  };
}
