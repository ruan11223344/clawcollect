import type { ClawCollectPluginConfig } from "./types";

type ClawCollectTimezoneContext = {
  scopeKey?: string;
  senderId?: string;
  channel?: string;
};

type DateParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function safeTimeZone(raw: string | undefined): string | undefined {
  const value = raw?.trim();
  if (!value) {
    return undefined;
  }

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date());
    return value;
  } catch {
    return undefined;
  }
}

function getSystemTimeZone(): string | undefined {
  return safeTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
}

function getZonedParts(date: Date, timeZone: string): DateParts {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });

  const values = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );

  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
  };
}

function getTimeZoneOffsetMs(timeZone: string, date: Date): number {
  const parts = getZonedParts(date, timeZone);
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return asUtc - date.getTime();
}

function zonedDateTimeToUtc(parts: DateParts, timeZone: string): Date {
  const baseUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );

  let guess = baseUtc;
  for (let index = 0; index < 4; index += 1) {
    const offset = getTimeZoneOffsetMs(timeZone, new Date(guess));
    const next = baseUtc - offset;
    if (Math.abs(next - guess) < 1_000) {
      guess = next;
      break;
    }
    guess = next;
  }

  return new Date(guess);
}

function parseLocalDateTime(raw: string): DateParts | null {
  const match = raw
    .trim()
    .match(
      /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2})(?::(\d{1,2}))(?::(\d{1,2}))?)?$/,
    );
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4] ?? "0");
  const minute = Number(match[5] ?? "0");
  const second = Number(match[6] ?? "0");

  if (
    !Number.isInteger(year) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59 ||
    second < 0 ||
    second > 59
  ) {
    return null;
  }

  return { year, month, day, hour, minute, second };
}

function hasExplicitOffset(raw: string): boolean {
  return /(?:[zZ]|[+-]\d{2}:\d{2})$/.test(raw.trim());
}

export function resolveClawCollectTimeZone(
  pluginConfig: ClawCollectPluginConfig,
  context: ClawCollectTimezoneContext,
): string | undefined {
  const byScope = context.scopeKey
    ? safeTimeZone(pluginConfig.timezone?.byScope?.[context.scopeKey])
    : undefined;
  if (byScope) {
    return byScope;
  }

  const bySender = context.senderId
    ? safeTimeZone(pluginConfig.timezone?.bySender?.[context.senderId])
    : undefined;
  if (bySender) {
    return bySender;
  }

  const byChannel = context.channel
    ? safeTimeZone(pluginConfig.timezone?.byChannel?.[context.channel])
    : undefined;
  if (byChannel) {
    return byChannel;
  }

  return safeTimeZone(pluginConfig.timezone?.default) ?? getSystemTimeZone();
}

export function parseClawCollectDateTime(raw: string, timeZone?: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  const normalizedTimeZone = safeTimeZone(timeZone);
  if (hasExplicitOffset(trimmed) || !normalizedTimeZone) {
    const candidate = trimmed.includes("T") ? trimmed : trimmed.replace(" ", "T");
    const parsed = new Date(candidate);
    if (Number.isNaN(parsed.getTime())) {
      return null;
    }
    return parsed.toISOString();
  }

  const parts = parseLocalDateTime(trimmed);
  if (!parts) {
    return null;
  }

  const utcDate = zonedDateTimeToUtc(parts, normalizedTimeZone);
  if (Number.isNaN(utcDate.getTime())) {
    return null;
  }

  return utcDate.toISOString();
}

export function formatClawCollectDateTime(iso: string, timeZone?: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }

  const normalizedTimeZone = safeTimeZone(timeZone) ?? getSystemTimeZone();
  if (!normalizedTimeZone) {
    const pad = (value: number): string => String(value).padStart(2, "0");
    return [
      `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
      `${pad(date.getHours())}:${pad(date.getMinutes())}`,
    ].join(" ");
  }

  const parts = getZonedParts(date, normalizedTimeZone);
  const pad = (value: number): string => String(value).padStart(2, "0");
  return [
    `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`,
    `${pad(parts.hour)}:${pad(parts.minute)}`,
  ].join(" ");
}
