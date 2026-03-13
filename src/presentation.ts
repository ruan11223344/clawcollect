import { formatClawCollectDateTime } from "./timezone.js";
import type {
  Checklist,
  ChecklistItem,
  ClawCollectDeliveryPayload,
  ClawCollectPresentationConfig,
  Reminder,
} from "./types.js";

function cleanText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function cleanLines(lines: string[] | undefined): string[] {
  return (lines ?? []).map((line) => line.trim()).filter(Boolean);
}

function renderChecklistItemLine(item: ChecklistItem): string {
  const requestedBy = item.requestedBy.length > 0 ? ` <- ${item.requestedBy.join(", ")}` : "";
  const marker = item.status === "done" ? "[x]" : "[ ]";
  return `${marker} ${item.id} ${item.text}${requestedBy}`;
}

export function createTextPayload(
  payload: ClawCollectDeliveryPayload,
): ClawCollectDeliveryPayload {
  return {
    kind: cleanText(payload.kind),
    title: cleanText(payload.title),
    summary: cleanText(payload.summary),
    body: cleanText(payload.body),
    lines: cleanLines(payload.lines),
    fields: Object.fromEntries(
      Object.entries(payload.fields ?? {}).filter(([, value]) => value.trim().length > 0),
    ),
  };
}

export function createChecklistPayload(
  list: Checklist,
  timeZone?: string,
): ClawCollectDeliveryPayload {
  const openCount = list.items.filter((item) => item.status === "open").length;
  const doneCount = list.items.filter((item) => item.status === "done").length;
  const updatedAt = formatClawCollectDateTime(list.updatedAt, timeZone);
  const kind = list.kind?.trim();

  return createTextPayload({
    kind: kind ? `checklist.${kind}` : "checklist",
    title: list.title,
    summary: `list ${list.id}${kind ? ` | kind ${kind}` : ""} | open ${openCount} | done ${doneCount}`,
    body: `updated ${updatedAt}`,
    lines:
      list.items.length > 0
        ? list.items.map((item) => renderChecklistItemLine(item))
        : ["No items yet."],
    fields: {
      list_id: list.id,
      list_kind: kind ?? "",
      updated_at: updatedAt,
      open_count: String(openCount),
      done_count: String(doneCount),
      total_count: String(list.items.length),
    },
  });
}

export function createReminderPayload(
  reminder: Reminder,
  relatedList?: Checklist,
  timeZone?: string,
): ClawCollectDeliveryPayload {
  const effectiveTimeZone = reminder.timezone ?? timeZone;
  const dueAt = formatClawCollectDateTime(reminder.dueAt, effectiveTimeZone);
  const lines = [
    reminder.note?.trim(),
    relatedList ? `list ${relatedList.title} (${relatedList.id})` : undefined,
  ].filter((value): value is string => Boolean(value));

  return createTextPayload({
    kind: "reminder",
    title: reminder.title,
    summary: `${reminder.status} | ${dueAt}`,
    lines,
    fields: {
      reminder_id: reminder.id,
      reminder_status: reminder.status,
      due_at: dueAt,
      related_list_id: reminder.relatedListId ?? "",
      related_list_title: relatedList?.title ?? "",
      note: reminder.note?.trim() ?? "",
    },
  });
}

export function flattenPayloadFields(
  payload: ClawCollectDeliveryPayload,
  separator = "\n",
): Record<string, string> {
  const normalized = createTextPayload(payload);
  const joinedLines = normalized.lines?.join(separator) ?? "";

  return {
    kind: normalized.kind ?? "",
    payload_kind: normalized.kind ?? "",
    title: normalized.title ?? "",
    payload_title: normalized.title ?? "",
    summary: normalized.summary ?? "",
    payload_summary: normalized.summary ?? "",
    body: normalized.body ?? "",
    payload_body: normalized.body ?? "",
    lines: joinedLines,
    payload_lines: joinedLines,
    ...normalized.fields,
  };
}

function renderPayloadTemplate(
  template: string,
  payload: ClawCollectDeliveryPayload,
  separator = "\n",
): string {
  let rendered = template;
  for (const [key, value] of Object.entries(flattenPayloadFields(payload, separator))) {
    rendered = rendered.replaceAll(`{${key}}`, value);
  }
  return rendered.replace(/\n{3,}/g, "\n\n").trim();
}

export function renderPayloadText(
  payload: ClawCollectDeliveryPayload,
  presentation?: ClawCollectPresentationConfig,
): string {
  const normalized = createTextPayload(payload);
  const separator = cleanText(presentation?.separator) ?? "\n";

  if (cleanText(presentation?.template)) {
    return renderPayloadTemplate(presentation?.template ?? "", normalized, separator);
  }

  const linePrefix = presentation?.linePrefix ?? "";
  const lines = (normalized.lines ?? []).map((line) => `${linePrefix}${line}`);
  const parts = [
    cleanText(presentation?.header),
    normalized.title,
    normalized.summary,
    normalized.body,
    ...lines,
    cleanText(presentation?.footer),
  ].filter((value): value is string => Boolean(value));

  return parts.join(separator).replace(/\n{3,}/g, "\n\n").trim();
}
