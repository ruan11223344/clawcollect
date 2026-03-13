/**
 * Lightweight HTTP client for the ClawCollect online service.
 *
 * Uses only the runtime `fetch` — no extra dependencies.
 */

export class OnlineServiceError extends Error {
  constructor(
    public readonly status: number,
    public readonly serverMessage: string,
  ) {
    super(`Online service error (${status}): ${serverMessage}`);
    this.name = "OnlineServiceError";
  }
}

export interface OnlineClientConfig {
  apiUrl: string;
  apiToken: string;
}

export interface RemoteForm {
  id: string;
  title: string;
  description: string;
  status: string;
  responses_count: number;
  created_at: number;
  updated_at: number;
  closes_at: number | null;
}

export interface RemoteLink {
  id: string;
  token: string;
  url: string;
  access_type: string;
}

export interface RemoteResultsLink {
  token: string;
  url: string;
  created_at: number;
}

export interface RemoteResponse {
  id: string;
  form_id: string;
  data: Record<string, unknown>;
  status: string;
  created_at: number;
  updated_at: number;
}

export interface ResponsesPage {
  responses: RemoteResponse[];
  total: number;
  limit: number;
  offset: number;
}

export interface FormsPage {
  forms: RemoteForm[];
}

export class OnlineClient {
  private readonly baseUrl: string;
  private readonly token: string;

  constructor(config: OnlineClientConfig) {
    this.baseUrl = config.apiUrl.replace(/\/+$/, "");
    this.token = config.apiToken;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
    };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
    }

    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (err) {
      throw new Error(
        `Network error connecting to online service at ${this.baseUrl}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (!res.ok) {
      let serverMsg = `HTTP ${res.status}`;
      try {
        const errBody = (await res.json()) as { error?: string };
        if (errBody.error) {
          serverMsg = errBody.error;
        }
      } catch {
        // ignore parse errors
      }
      throw new OnlineServiceError(res.status, serverMsg);
    }

    return (await res.json()) as T;
  }

  async createForm(params: {
    title: string;
    description?: string;
    schema?: unknown[];
    settings?: Record<string, unknown>;
  }): Promise<{ id: string; status: string; created_at: number }> {
    return this.request("POST", "/api/forms", params);
  }

  async publishForm(formId: string): Promise<void> {
    await this.request("POST", `/api/forms/${formId}/publish`);
  }

  async createLink(
    formId: string,
    accessType = "private",
  ): Promise<RemoteLink> {
    return this.request("POST", `/api/forms/${formId}/links`, {
      access_type: accessType,
    });
  }

  async ensureResultsLink(formId: string): Promise<RemoteResultsLink> {
    return this.request("POST", `/api/forms/${formId}/results-link`);
  }

  async listForms(options?: { status?: string }): Promise<FormsPage> {
    const params = new URLSearchParams();
    if (options?.status) params.set("status", options.status);
    const qs = params.toString();
    return this.request("GET", `/api/forms${qs ? `?${qs}` : ""}`);
  }

  async getForm(formId: string): Promise<{ form: RemoteForm }> {
    return this.request("GET", `/api/forms/${formId}`);
  }

  async listResponses(
    formId: string,
    options?: { status?: string; limit?: number; offset?: number },
  ): Promise<ResponsesPage> {
    const params = new URLSearchParams();
    if (options?.status) params.set("status", options.status);
    if (options?.limit) params.set("limit", String(options.limit));
    if (options?.offset) params.set("offset", String(options.offset));
    const qs = params.toString();
    return this.request(
      "GET",
      `/api/forms/${formId}/responses${qs ? `?${qs}` : ""}`,
    );
  }

  async closeForm(formId: string): Promise<void> {
    await this.request("POST", `/api/forms/${formId}/close`);
  }
}
