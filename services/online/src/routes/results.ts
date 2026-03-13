import { Hono } from "hono";
import type { Context } from "hono";
import type { Env } from "../env";
import { renderStatusPage } from "../lib/html";
import { renderCollectorResultsPage } from "../lib/results-html";
import { parseSchema } from "../lib/validation";

const VALID_FILTERS = new Set(["accepted", "hidden", "spam"]);

interface FormResultsRow {
  id: string;
  title: string;
  description: string;
  schema: string;
  status: string;
  closes_at: number | null;
  owner_results_token: string | null;
}

interface ResponseRow {
  id: string;
  link_id: string | null;
  data: string;
  respondent_email: string | null;
  status: "accepted" | "hidden" | "spam";
  created_at: number;
  updated_at: number;
}

function wantsJson(c: Context): boolean {
  const accept = c.req.header("Accept") ?? "";
  if (accept.includes("application/json")) return true;
  return c.req.query("format") === "json";
}

const results = new Hono<{ Bindings: Env }>();

results.get("/:token", async (c) => {
  const token = c.req.param("token");
  const json = wantsJson(c);
  const db = c.env.DB;

  const form = await db
    .prepare(
      "SELECT id, title, description, schema, status, closes_at, owner_results_token FROM forms WHERE owner_results_token = ?",
    )
    .bind(token)
    .first<FormResultsRow>();

  if (!form) {
    if (json) return c.json({ error: "Results page not found" }, 404);
    return c.html(renderStatusPage("Not Found", "Results page not found"), 404);
  }

  const filterQuery = c.req.query("status");
  const activeFilter = VALID_FILTERS.has(filterQuery ?? "") ? (filterQuery as "accepted" | "hidden" | "spam") : "all";
  const limit = 100;

  const countRows = await db
    .prepare("SELECT status, COUNT(*) as total FROM responses WHERE form_id = ? GROUP BY status")
    .bind(form.id)
    .all<{ status: "accepted" | "hidden" | "spam"; total: number }>();

  const counts = {
    all: 0,
    accepted: 0,
    hidden: 0,
    spam: 0,
  };

  for (const row of countRows.results ?? []) {
    if (!row || typeof row !== "object") continue;
    const status = String(row.status) as keyof typeof counts;
    const total = typeof row.total === "number" ? row.total : 0;
    if (status in counts) {
      counts[status] = total;
      counts.all += total;
    }
  }

  let query = `SELECT id, link_id, data, respondent_email, status, created_at,
    COALESCE(updated_at, created_at) as updated_at
    FROM responses WHERE form_id = ?`;
  const params: unknown[] = [form.id];

  if (activeFilter !== "all") {
    query += " AND status = ?";
    params.push(activeFilter);
  }

  query += " ORDER BY created_at DESC LIMIT ?";
  params.push(limit);

  const responseRows = await db
    .prepare(query)
    .bind(...params)
    .all<ResponseRow>();

  const responses = (responseRows.results ?? []).map((row) => ({
    id: row.id,
    link_id: row.link_id,
    data: typeof row.data === "string" ? JSON.parse(row.data) as Record<string, unknown> : {},
    respondent_email: row.respondent_email,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }));

  if (json) {
    return c.json({
      form: {
        id: form.id,
        title: form.title,
        description: form.description,
        status: form.status,
        closes_at: form.closes_at,
      },
      counts,
      active_filter: activeFilter,
      responses,
    });
  }

  const html = renderCollectorResultsPage({
    title: form.title,
    description: form.description ?? "",
    formStatus: form.status,
    closesAt: form.closes_at,
    counts,
    activeFilter,
    responses,
    schema: parseSchema(form.schema) ?? [],
    limit,
    showing: responses.length,
    resultsUrlBase: `/r/${token}`,
  });

  return c.html(html);
});

export { results };
