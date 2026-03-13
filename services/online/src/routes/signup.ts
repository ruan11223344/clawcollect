import { Hono } from "hono";
import type { Context } from "hono";
import type { Env } from "../env";
import { provisionHostedWorkspace } from "../lib/hosted-provisioning";
import {
  renderSignupDisabledPage,
  renderSignupPage,
  renderSignupSuccessPage,
} from "../lib/signup-html";

const signup = new Hono<{ Bindings: Env }>();

function wantsJson(c: Context): boolean {
  const accept = c.req.header("Accept") ?? "";
  if (accept.includes("application/json")) return true;
  return c.req.query("format") === "json";
}

function hostedSignupEnabled(env: Env): boolean {
  return env.HOSTED_SIGNUP_ENABLED === "true";
}

function signupCodeRequired(env: Env): boolean {
  return !!env.HOSTED_SIGNUP_CODE?.trim();
}

function originFromRequest(c: Context): string {
  return new URL(c.req.url).origin;
}

function stringField(value: string | File | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function jsonError(c: Context, error: string, status: number) {
  if (wantsJson(c)) return c.json({ error }, status as 400);
  return c.html(
    renderSignupPage({
      apiUrl: originFromRequest(c),
      error,
      requiresCode: signupCodeRequired(c.env),
    }),
    status as 400,
  );
}

signup.get("/", (c) => {
  if (!hostedSignupEnabled(c.env)) {
    if (wantsJson(c)) return c.json({ error: "Hosted signup is disabled" }, 503);
    return c.html(renderSignupDisabledPage(), 503);
  }

  return c.html(
    renderSignupPage({
      apiUrl: originFromRequest(c),
      requiresCode: signupCodeRequired(c.env),
    }),
  );
});

signup.post("/", async (c) => {
  if (!hostedSignupEnabled(c.env)) {
    if (wantsJson(c)) return c.json({ error: "Hosted signup is disabled" }, 503);
    return c.html(renderSignupDisabledPage(), 503);
  }

  const form = await c.req.parseBody();
  const workspaceName = stringField(form.workspaceName);
  const ownerName = stringField(form.ownerName);
  const ownerEmail = stringField(form.ownerEmail).toLowerCase();
  const signupCode = stringField(form.signupCode);
  const requiresCode = signupCodeRequired(c.env);

  if (requiresCode && signupCode !== c.env.HOSTED_SIGNUP_CODE?.trim()) {
    return jsonError(c, "Invalid signup code", 403);
  }

  try {
    const result = await provisionHostedWorkspace(c.env.DB, {
      workspaceName,
      ownerName,
      ownerEmail,
      plan: "free",
    });

    if (wantsJson(c)) {
      return c.json(
        {
          workspace: {
            id: result.workspaceId,
            name: result.workspaceName,
            plan: result.plan,
          },
          owner: {
            id: result.userId,
            email: result.ownerEmail,
            name: result.ownerName,
          },
          api_token: {
            id: result.tokenId,
            token: result.token,
            expires_at: result.tokenExpiresAt,
            created_at: result.createdAt,
          },
          config: {
            online: {
              enabled: true,
              apiUrl: originFromRequest(c),
              apiToken: result.token,
            },
          },
        },
        201,
      );
    }

    return c.html(
      renderSignupSuccessPage({
        apiUrl: originFromRequest(c),
        workspaceName: result.workspaceName,
        ownerEmail: result.ownerEmail,
        token: result.token,
      }),
      201,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create hosted workspace";
    return c.html(
      renderSignupPage({
        apiUrl: originFromRequest(c),
        error: message,
        requiresCode,
        values: {
          workspaceName,
          ownerName,
          ownerEmail,
        },
      }),
      400,
    );
  }
});

export { signup };
