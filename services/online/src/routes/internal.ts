import { Hono } from "hono";
import type { Env } from "../env";
import {
  provisionHostedWorkspace,
  type ProvisionWorkspaceInput,
} from "../lib/hosted-provisioning";

const internal = new Hono<{ Bindings: Env }>();

function requireInternalProvisioningSecret(request: Request, env: Env): string | null {
  const expected = env.INTERNAL_PROVISIONING_SECRET?.trim();
  if (!expected) {
    return "Internal provisioning is not configured";
  }

  const authHeader = request.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return "Unauthorized";
  }

  const provided = authHeader.slice(7).trim();
  if (!provided || provided !== expected) {
    return "Unauthorized";
  }

  return null;
}

internal.post("/provision-workspace", async (c) => {
  const authError = requireInternalProvisioningSecret(c.req.raw, c.env);
  if (authError === "Internal provisioning is not configured") {
    return c.json({ error: authError }, 503);
  }
  if (authError) {
    return c.json({ error: authError }, 401);
  }

  let body: ProvisionWorkspaceInput;
  try {
    body = await c.req.json<ProvisionWorkspaceInput>();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  try {
    const provisioned = await provisionHostedWorkspace(c.env.DB, body);
    const apiUrl = new URL(c.req.url).origin;
    return c.json(
      {
        workspace: {
          id: provisioned.workspaceId,
          name: provisioned.workspaceName,
          plan: provisioned.plan,
        },
        owner: {
          id: provisioned.userId,
          email: provisioned.ownerEmail,
          name: provisioned.ownerName,
        },
        api_token: {
          id: provisioned.tokenId,
          token: provisioned.token,
          expires_at: provisioned.tokenExpiresAt,
          created_at: provisioned.createdAt,
        },
        config: {
          online: {
            enabled: true,
            apiUrl,
            apiToken: provisioned.token,
          },
        },
      },
      201,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Provisioning failed";
    const status = message.includes("required") || message.includes("valid email") || message.includes("Unsupported")
      || message.includes("future unix epoch")
      ? 400
      : 500;
    return c.json({ error: message }, status);
  }
});

export { internal };
