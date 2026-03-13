import type { FieldDefinition } from "./validation";

export interface CollectorResponseView {
  id: string;
  link_id: string | null;
  data: Record<string, unknown>;
  respondent_email: string | null;
  status: "accepted" | "hidden" | "spam";
  created_at: number;
  updated_at: number;
}

export interface CollectorResultsPageData {
  title: string;
  description: string;
  formStatus: string;
  closesAt: number | null;
  counts: {
    all: number;
    accepted: number;
    hidden: number;
    spam: number;
  };
  activeFilter: "all" | "accepted" | "hidden" | "spam";
  responses: CollectorResponseView[];
  schema: FieldDefinition[];
  limit: number;
  showing: number;
  resultsUrlBase: string;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatTimestamp(epochSeconds: number): string {
  const date = new Date(epochSeconds * 1000);
  if (Number.isNaN(date.getTime())) return "Unknown time";
  return date.toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

function filterHref(base: string, filter: CollectorResultsPageData["activeFilter"]): string {
  return filter === "all" ? base : `${base}?status=${filter}`;
}

function labelForField(schema: FieldDefinition[], key: string): string {
  const field = schema.find((entry) => entry.id === key);
  return field?.label ?? key;
}

function formatFieldValue(schema: FieldDefinition[], key: string, value: unknown): string {
  const field = schema.find((entry) => entry.id === key);
  if (value === null || value === undefined || value === "") return "";
  if (field?.type === "checkbox") {
    return value === true ? "Yes" : "No";
  }
  if (Array.isArray(value)) {
    return value.map((item) => String(item)).join(", ");
  }
  return String(value);
}

function renderFieldRows(schema: FieldDefinition[], data: Record<string, unknown>): string {
  const keys = new Set<string>([
    ...schema.map((field) => field.id),
    ...Object.keys(data),
  ]);

  const rows = [...keys]
    .filter((key) => data[key] !== undefined && data[key] !== null && data[key] !== "")
    .map((key) => `
      <div class="cr-field-row">
        <div class="cr-field-label">${esc(labelForField(schema, key))}</div>
        <div class="cr-field-value">${esc(formatFieldValue(schema, key, data[key]))}</div>
      </div>
    `)
    .join("");

  return rows || `<div class="cr-empty-inline">No captured fields</div>`;
}

function renderResponseCard(schema: FieldDefinition[], response: CollectorResponseView): string {
  const edited = response.updated_at > response.created_at;
  const sourceLabel = response.link_id ? "Public form" : "Imported";

  return `
  <article class="cr-response-card">
    <header class="cr-response-head">
      <div>
        <div class="cr-response-id">${esc(response.id)}</div>
        <div class="cr-response-meta">
          <span class="cr-pill cr-pill-status cr-pill-${esc(response.status)}">${esc(response.status)}</span>
          <span class="cr-pill cr-pill-source">${esc(sourceLabel)}</span>
          ${edited ? `<span class="cr-pill cr-pill-edited">edited</span>` : ""}
        </div>
      </div>
      <div class="cr-response-times">
        <div>Submitted: ${esc(formatTimestamp(response.created_at))}</div>
        <div>Updated: ${esc(formatTimestamp(response.updated_at))}</div>
      </div>
    </header>
    ${response.respondent_email ? `<div class="cr-respondent-email">Email: ${esc(response.respondent_email)}</div>` : ""}
    <div class="cr-fields">
      ${renderFieldRows(schema, response.data)}
    </div>
  </article>`;
}

export function renderCollectorResultsPage(data: CollectorResultsPageData): string {
  const closed = data.formStatus !== "active";
  const activeCount = data.activeFilter === "all" ? data.counts.all : data.counts[data.activeFilter];
  const filterTabs = [
    ["all", `All (${data.counts.all})`],
    ["accepted", `Accepted (${data.counts.accepted})`],
    ["hidden", `Hidden (${data.counts.hidden})`],
    ["spam", `Spam (${data.counts.spam})`],
  ]
    .map(([value, label]) => {
      const active = data.activeFilter === value;
      return `<a class="cr-filter${active ? " is-active" : ""}" href="${esc(filterHref(data.resultsUrlBase, value as CollectorResultsPageData["activeFilter"]))}">${esc(label)}</a>`;
    })
    .join("");

  const body = `
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(data.title)} - Collector Results</title>
<style>
*,*::before,*::after{box-sizing:border-box}
body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;background:linear-gradient(180deg,#f5f7fb 0%,#eef2f7 100%);color:#122033;line-height:1.5}
.cr-wrap{max-width:960px;margin:40px auto;padding:0 20px 40px}
.cr-hero{background:#fff;border:1px solid #d9e2ec;border-radius:20px;padding:28px 28px 20px;box-shadow:0 10px 30px rgba(15,23,42,.06)}
.cr-kicker{font-size:.82rem;letter-spacing:.08em;text-transform:uppercase;color:#5b7083;font-weight:700}
.cr-title{font-size:2rem;line-height:1.15;margin:10px 0 8px}
.cr-desc{margin:0;color:#516173;max-width:720px}
.cr-meta{display:flex;flex-wrap:wrap;gap:10px;margin-top:18px}
.cr-pill{display:inline-flex;align-items:center;gap:6px;border-radius:999px;padding:6px 10px;font-size:.82rem;font-weight:600}
.cr-pill-form{background:#e8f1ff;color:#1f4fbf}
.cr-pill-closed{background:#fff4e5;color:#9a4d00}
.cr-pill-status{background:#edf7ed;color:#1b6f2d}
.cr-pill-hidden{background:#f3f4f6;color:#455468}
.cr-pill-spam{background:#feecec;color:#b42318}
.cr-pill-source{background:#eef6ff;color:#175cd3}
.cr-pill-edited{background:#fff7d6;color:#8a6116}
.cr-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-top:22px}
.cr-stat{background:#f8fafc;border:1px solid #e2e8f0;border-radius:14px;padding:14px 16px}
.cr-stat-label{font-size:.85rem;color:#61758a}
.cr-stat-value{font-size:1.4rem;font-weight:700;color:#122033;margin-top:4px}
.cr-section{margin-top:22px}
.cr-filters{display:flex;flex-wrap:wrap;gap:10px}
.cr-filter{display:inline-flex;align-items:center;justify-content:center;padding:10px 14px;border-radius:999px;border:1px solid #d0d5dd;background:#fff;color:#344054;text-decoration:none;font-weight:600}
.cr-filter.is-active{background:#122033;color:#fff;border-color:#122033}
.cr-note{margin-top:14px;font-size:.9rem;color:#61758a}
.cr-response-list{display:grid;gap:16px;margin-top:16px}
.cr-response-card{background:#fff;border:1px solid #d9e2ec;border-radius:18px;padding:20px;box-shadow:0 8px 24px rgba(15,23,42,.04)}
.cr-response-head{display:flex;justify-content:space-between;gap:20px;align-items:flex-start}
.cr-response-id{font-weight:700;font-size:1.05rem}
.cr-response-meta{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
.cr-response-times{font-size:.85rem;color:#61758a;text-align:right;min-width:220px}
.cr-respondent-email{margin-top:14px;font-size:.92rem;color:#344054}
.cr-fields{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin-top:18px}
.cr-field-row{background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:12px 14px}
.cr-field-label{font-size:.82rem;font-weight:700;color:#61758a;margin-bottom:4px}
.cr-field-value{white-space:pre-wrap;word-break:break-word;color:#122033}
.cr-empty{padding:24px;border-radius:16px;background:#fff;border:1px dashed #cbd5e1;color:#61758a}
.cr-empty-inline{color:#61758a}
@media (max-width:720px){
  .cr-wrap{margin:24px auto}
  .cr-hero{padding:22px 20px 18px}
  .cr-title{font-size:1.65rem}
  .cr-response-head{flex-direction:column}
  .cr-response-times{text-align:left;min-width:0}
  .cr-fields{grid-template-columns:1fr}
}
</style>
</head>
<body>
  <div class="cr-wrap">
    <section class="cr-hero">
      <div class="cr-kicker">Collector Results</div>
      <h1 class="cr-title">${esc(data.title)}</h1>
      ${data.description ? `<p class="cr-desc">${esc(data.description)}</p>` : ""}
      <div class="cr-meta">
        <span class="cr-pill ${closed ? "cr-pill-closed" : "cr-pill-form"}">Form status: ${esc(data.formStatus)}</span>
        ${data.closesAt ? `<span class="cr-pill cr-pill-form">Closes at: ${esc(formatTimestamp(data.closesAt))}</span>` : ""}
      </div>
      <div class="cr-stats">
        <div class="cr-stat"><div class="cr-stat-label">All responses</div><div class="cr-stat-value">${data.counts.all}</div></div>
        <div class="cr-stat"><div class="cr-stat-label">Accepted</div><div class="cr-stat-value">${data.counts.accepted}</div></div>
        <div class="cr-stat"><div class="cr-stat-label">Hidden</div><div class="cr-stat-value">${data.counts.hidden}</div></div>
        <div class="cr-stat"><div class="cr-stat-label">Spam</div><div class="cr-stat-value">${data.counts.spam}</div></div>
      </div>
    </section>

    <section class="cr-section">
      <div class="cr-filters">${filterTabs}</div>
      <div class="cr-note">
        Showing ${data.showing} ${data.activeFilter === "all" ? "latest" : esc(data.activeFilter)} response${data.showing === 1 ? "" : "s"}.
        ${activeCount > data.showing ? `Newest ${data.limit} shown on this page.` : ""}
      </div>
      ${
        data.responses.length > 0
          ? `<div class="cr-response-list">${data.responses.map((response) => renderResponseCard(data.schema, response)).join("")}</div>`
          : `<div class="cr-empty">No responses match this filter yet.</div>`
      }
    </section>
  </div>
</body>
</html>`;

  return body;
}
