import type { OpenClawPluginApi } from "openclaw/plugin-sdk";

import {
  DEFAULT_ALLOWED_BOUNDARIES,
  DEFAULT_BLOCKED_BOUNDARIES,
  evaluateClawCollectPolicy,
} from "./policy.js";
import {
  createReminderPayload,
  flattenPayloadFields,
  renderPayloadText,
} from "./presentation.js";
import { parseScopeKey, scopeToMessageTarget } from "./scope.js";
import { loadStore, updateStore } from "./storage.js";
import type {
  ClawCollectAdapterConfig,
  ClawCollectAdapterKind,
  ClawCollectAudienceConfig,
  ClawCollectAudienceKind,
  ClawCollectBoundaryKind,
  ClawCollectEffectKind,
  ClawCollectEffectRouteConfig,
  ClawCollectEndpointConfig,
  ClawCollectDeliveryPayload,
  ClawCollectEventName,
  ClawCollectEventRouteConfig,
  ClawCollectPresentationConfig,
  ClawCollectPluginConfig,
  ClawCollectProfileConfig,
  ClawCollectRiskLevel,
  ClawCollectStore,
  Reminder,
} from "./types.js";

type ResolvedAdapter = ClawCollectAdapterConfig & {
  id: string;
  kind: ClawCollectAdapterKind;
  enabled: boolean;
  source: "config" | "legacy_onboarding";
};

type ResolvedEndpoint = ClawCollectEndpointConfig & {
  adapterId: string;
  presentationId?: string;
  source: "profile" | "audience" | "legacy_onboarding";
};

type ResolvedAudience = {
  id: string;
  kind: ClawCollectAudienceKind;
  endpoints: ResolvedEndpoint[];
  description?: string;
  presentationId?: string;
  source: "config" | "legacy_onboarding";
};

type ResolvedEffectRoute = {
  id: string;
  kind: ClawCollectEffectKind;
  enabled: boolean;
  presentationId?: string;
  audiences: ResolvedAudience[];
  source: "config" | "legacy_onboarding" | "default";
};

type ResolvedEventRoute = {
  event: ClawCollectEventName;
  enabled: boolean;
  effects: ResolvedEffectRoute[];
  source: "config" | "legacy_onboarding" | "default";
};

type DeliveryEventRequest = {
  event: ClawCollectEventName;
  entityId: string;
  payload: ClawCollectDeliveryPayload;
  boundary: ClawCollectBoundaryKind;
  risk: ClawCollectRiskLevel;
  title?: string;
  dueAt?: string;
  reminderId?: string;
  approved?: boolean;
  originScopeKey?: string;
  metadata?: Record<string, string>;
};

type DeliveryResult = {
  status: "sent" | "skipped" | "failed" | "blocked";
  detail: string;
};

type ResolvedOriginScope = {
  scopeKey: string;
  channel: string;
  accountId: string;
  chatKind: "direct" | "group" | "channel";
  target: string;
};

type ResolvedOpenClawDestination = {
  channel: string;
  target: string;
  accountId?: string;
};

export const BUILTIN_EVENT_IDS = {
  introAvailable: "clawcollect.system.intro_available",
  reminderDue: "clawcollect.reminder.due",
} as const;

function resolveAdapterKind(rawKind: ClawCollectAdapterConfig["kind"]): ClawCollectAdapterKind {
  if (rawKind === "command" || rawKind === "noop" || rawKind === "openclaw_message") {
    return rawKind;
  }
  return "command";
}

function resolveLegacyOnboardingAdapter(
  pluginConfig: ClawCollectPluginConfig,
): ResolvedAdapter | null {
  const channel = pluginConfig.onboarding?.channel?.trim();
  const target = pluginConfig.onboarding?.target?.trim();
  if (!channel || !target) {
    return null;
  }

  return {
    id: "legacy_onboarding_adapter",
    kind: "openclaw_message",
    enabled: pluginConfig.onboarding?.enabled === true,
    source: "legacy_onboarding",
    description: "Legacy onboarding adapter",
  };
}

export function resolveAdapters(pluginConfig: ClawCollectPluginConfig): ResolvedAdapter[] {
  const resolved: ResolvedAdapter[] = [];

  for (const [id, rawConfig] of Object.entries(pluginConfig.adapters ?? {})) {
    if (!rawConfig || typeof rawConfig !== "object") {
      continue;
    }

    const config = rawConfig as ClawCollectAdapterConfig;
    resolved.push({
      ...config,
      id,
      kind: resolveAdapterKind(config.kind),
      enabled: config.enabled !== false,
      source: "config",
    });
  }

  const legacyAdapter = resolveLegacyOnboardingAdapter(pluginConfig);
  if (legacyAdapter) {
    resolved.push(legacyAdapter);
  }

  return resolved;
}

function resolveConfiguredProfiles(
  pluginConfig: ClawCollectPluginConfig,
): Array<[string, ClawCollectProfileConfig]> {
  return Object.entries(pluginConfig.profiles ?? {}).filter(
    ([, profile]) => profile && typeof profile === "object",
  ) as Array<[string, ClawCollectProfileConfig]>;
}

function resolveConfiguredAudiences(
  pluginConfig: ClawCollectPluginConfig,
): Array<[string, ClawCollectAudienceConfig]> {
  return Object.entries(pluginConfig.audiences ?? {}).filter(
    ([, audience]) => audience && typeof audience === "object",
  ) as Array<[string, ClawCollectAudienceConfig]>;
}

function resolveLegacyOnboardingAudience(
  pluginConfig: ClawCollectPluginConfig,
): ResolvedAudience | null {
  const channel = pluginConfig.onboarding?.channel?.trim();
  const target = pluginConfig.onboarding?.target?.trim();
  if (!channel || !target) {
    return null;
  }

  return {
    id: "legacy_onboarding_audience",
    kind: "literal",
    description: "Legacy onboarding recipient",
    source: "legacy_onboarding",
    endpoints: [
      {
        adapterId: "legacy_onboarding_adapter",
        channel,
        target,
        accountId: pluginConfig.onboarding?.accountId?.trim(),
        source: "legacy_onboarding",
      },
    ],
  };
}

function resolveAudienceKind(audience: ClawCollectAudienceConfig): ClawCollectAudienceKind {
  if (audience.kind === "profiles" || audience.kind === "literal" || audience.kind === "none") {
    return audience.kind;
  }
  if (Array.isArray(audience.profileIds) && audience.profileIds.length > 0) {
    return "profiles";
  }
  if (Array.isArray(audience.endpoints) && audience.endpoints.length > 0) {
    return "literal";
  }
  return "none";
}

function resolvePresentationRef(rawPresentationId: string | undefined): string | undefined {
  const presentationId = rawPresentationId?.trim();
  return presentationId || undefined;
}

function resolveProfileEndpoints(profile: ClawCollectProfileConfig): ResolvedEndpoint[] {
  return (profile.endpoints ?? [])
    .filter((endpoint): endpoint is ClawCollectEndpointConfig => Boolean(endpoint))
    .map((endpoint) => ({
      ...endpoint,
      adapterId: endpoint.adapterId?.trim() ?? "",
      presentationId: resolvePresentationRef(endpoint.presentationId),
      source: "profile" as const,
    }))
    .filter((endpoint) => endpoint.adapterId.length > 0);
}

function resolveAudienceFromConfig(
  pluginConfig: ClawCollectPluginConfig,
  id: string,
  audience: ClawCollectAudienceConfig,
  source: "config",
): ResolvedAudience {
  const kind = resolveAudienceKind(audience);
  const profileMap = new Map(resolveConfiguredProfiles(pluginConfig));

  if (kind === "profiles") {
    const endpoints = (audience.profileIds ?? [])
      .map((profileId) => profileMap.get(profileId))
      .filter((profile): profile is ClawCollectProfileConfig => Boolean(profile))
      .flatMap((profile) =>
        resolveProfileEndpoints(profile).map((endpoint) => ({
          ...endpoint,
          presentationId:
            endpoint.presentationId ?? resolvePresentationRef(audience.presentationId),
        })),
      );

    return {
      id,
      kind,
      description: audience.description,
      presentationId: resolvePresentationRef(audience.presentationId),
      endpoints,
      source,
    };
  }

  if (kind === "literal") {
    const endpoints = (audience.endpoints ?? [])
      .filter((endpoint): endpoint is ClawCollectEndpointConfig => Boolean(endpoint))
      .map((endpoint) => ({
        ...endpoint,
        adapterId: endpoint.adapterId?.trim() ?? "",
        presentationId:
          resolvePresentationRef(endpoint.presentationId) ??
          resolvePresentationRef(audience.presentationId),
        source: "audience" as const,
      }))
      .filter((endpoint) => endpoint.adapterId.length > 0);

    return {
      id,
      kind,
      description: audience.description,
      presentationId: resolvePresentationRef(audience.presentationId),
      endpoints,
      source,
    };
  }

  return {
    id,
    kind: "none",
    description: audience.description,
    presentationId: resolvePresentationRef(audience.presentationId),
    endpoints: [],
    source,
  };
}

export function resolveAudiences(pluginConfig: ClawCollectPluginConfig): ResolvedAudience[] {
  const audiences = resolveConfiguredAudiences(pluginConfig).map(([id, audience]) =>
    resolveAudienceFromConfig(pluginConfig, id, audience, "config"),
  );

  const legacyAudience = resolveLegacyOnboardingAudience(pluginConfig);
  if (legacyAudience) {
    audiences.push(legacyAudience);
  }

  return audiences;
}

function resolveEventConfig(
  pluginConfig: ClawCollectPluginConfig,
  event: ClawCollectEventName,
): ClawCollectEventRouteConfig | undefined {
  return pluginConfig.events?.[event];
}

function resolveEffectKind(rawKind: ClawCollectEffectRouteConfig["kind"]): ClawCollectEffectKind {
  return rawKind?.trim() || "notify";
}

function resolvePresentationId(
  rawPresentationId: ClawCollectEffectRouteConfig["presentationId"],
): string | undefined {
  const presentationId = rawPresentationId?.trim();
  return presentationId || undefined;
}

function resolveConfiguredEffect(
  pluginConfig: ClawCollectPluginConfig,
  effect: ClawCollectEffectRouteConfig,
  index: number,
): ResolvedEffectRoute {
  const audienceMap = new Map(resolveAudiences(pluginConfig).map((audience) => [audience.id, audience]));
  const audiences: ResolvedAudience[] = [];

  for (const audienceId of effect.audienceIds ?? []) {
    const audience = audienceMap.get(audienceId);
    if (audience) {
      audiences.push(audience);
    }
  }

  for (const [inlineIndex, audience] of (effect.audiences ?? []).entries()) {
    audiences.push(
      resolveAudienceFromConfig(
        pluginConfig,
        `inline_${index}_${inlineIndex}`,
        audience,
        "config",
      ),
    );
  }

  return {
    id: `effect_${index}`,
    kind: resolveEffectKind(effect.kind),
    enabled: effect.enabled !== false,
    presentationId: resolvePresentationId(effect.presentationId),
    audiences,
    source: "config",
  };
}

export function resolveEventRoute(
  pluginConfig: ClawCollectPluginConfig,
  event: ClawCollectEventName,
): ResolvedEventRoute {
  const configured = resolveEventConfig(pluginConfig, event);
  if (configured) {
    return {
      event,
      enabled: configured.enabled === true,
      effects: (configured.effects ?? []).map((effect, index) =>
        resolveConfiguredEffect(pluginConfig, effect, index),
      ),
      source: "config",
    };
  }

  // Only fall back to legacy onboarding when the events system is not configured at all.
  // If the user has configured events routing (even for other events), respect that
  // and do not silently route to the hardcoded legacy DM endpoint.
  const hasEventsConfig =
    pluginConfig.events && typeof pluginConfig.events === "object" &&
    Object.keys(pluginConfig.events).length > 0;

  if (!hasEventsConfig && event === BUILTIN_EVENT_IDS.introAvailable) {
    const legacyAudience = resolveLegacyOnboardingAudience(pluginConfig);
    if (legacyAudience) {
      return {
        event,
        enabled: pluginConfig.onboarding?.enabled === true,
        effects: [
          {
            id: "legacy_onboarding_notify",
            kind: "notify",
            enabled: true,
            audiences: [legacyAudience],
            source: "legacy_onboarding",
          },
        ],
        source: "legacy_onboarding",
      };
    }
  }

  return {
    event,
    enabled: false,
    effects: [],
    source: "default",
  };
}

function describeAdapter(adapter: ResolvedAdapter): string {
  const status = adapter.enabled ? "enabled" : "disabled";
  const argv = adapter.argv?.join(" ") ?? "(n/a)";
  return `${adapter.id} | ${status} | ${adapter.kind} | ${argv} | ${adapter.source}`;
}

function describeProfile(profileId: string, profile: ClawCollectProfileConfig): string {
  return `${profileId} | endpoints ${(profile.endpoints ?? []).length}`;
}

function describeAudience(audience: ResolvedAudience): string {
  const presentationId = audience.presentationId ?? "inherit";
  return `${audience.id} | ${audience.kind} | endpoints ${audience.endpoints.length} | presentation ${presentationId} | ${audience.source}`;
}

function describeEffect(effect: ResolvedEffectRoute): string {
  const audienceIds =
    effect.audiences.length > 0
      ? effect.audiences.map((audience) => audience.id).join(", ")
      : "none";
  const presentationId = effect.presentationId ?? "default";
  return `${effect.id} | ${effect.kind} | ${effect.enabled ? "enabled" : "disabled"} | audiences ${audienceIds} | presentation ${presentationId} | ${effect.source}`;
}

function describeEventRoute(route: ResolvedEventRoute): string[] {
  if (route.effects.length === 0) {
    return [
      `- event: ${route.event} | ${route.enabled ? "enabled" : "disabled"} | no effects | ${route.source}`,
    ];
  }

  return route.effects.map(
    (effect) =>
      `- event: ${route.event} | ${route.enabled ? "enabled" : "disabled"} | effect ${describeEffect(effect)}`,
  );
}

export function describeDeliverySetup(
  pluginConfig: ClawCollectPluginConfig,
  store: ClawCollectStore,
): string[] {
  const adapters = resolveAdapters(pluginConfig);
  const audiences = resolveAudiences(pluginConfig);
  const profiles = resolveConfiguredProfiles(pluginConfig);
  const presentations = Object.entries(pluginConfig.presentations ?? {}).filter(
    ([, presentation]) => presentation && typeof presentation === "object",
  ) as Array<[string, ClawCollectPresentationConfig]>;
  const routes = [
    resolveEventRoute(pluginConfig, BUILTIN_EVENT_IDS.introAvailable),
    resolveEventRoute(pluginConfig, BUILTIN_EVENT_IDS.reminderDue),
  ];

  const lines = [`- dispatches.sent: ${Object.keys(store.dispatches.sent).length}`];

  if (adapters.length === 0) {
    lines.push("- adapters: none configured");
  } else {
    lines.push(...adapters.map((adapter) => `- adapter: ${describeAdapter(adapter)}`));
  }

  if (profiles.length === 0) {
    lines.push("- profiles: none configured");
  } else {
    lines.push(...profiles.map(([id, profile]) => `- profile: ${describeProfile(id, profile)}`));
  }

  if (audiences.length === 0) {
    lines.push("- audiences: none configured");
  } else {
    lines.push(...audiences.map((audience) => `- audience: ${describeAudience(audience)}`));
  }

  if (presentations.length === 0) {
    lines.push("- presentations: none configured");
  } else {
    lines.push(
      ...presentations.map(
        ([id, presentation]) =>
          `- presentation: ${id} | template ${presentation.template ? "yes" : "no"}`,
      ),
    );
  }

  for (const route of routes) {
    lines.push(...describeEventRoute(route));
  }

  const mode = pluginConfig.policy?.mode ?? "enforce";
  const allowBoundaries =
    pluginConfig.policy?.allowBoundaries?.join(", ") || DEFAULT_ALLOWED_BOUNDARIES.join(", ");
  const blockBoundaries =
    pluginConfig.policy?.blockBoundaries?.join(", ") || DEFAULT_BLOCKED_BOUNDARIES.join(", ");
  const requireApproval = pluginConfig.policy?.requireApprovalBoundaries?.join(", ") || "none";
  lines.push(`- policy.mode: ${mode}`);
  lines.push(`- policy.allowBoundaries: ${allowBoundaries}`);
  lines.push(`- policy.blockBoundaries: ${blockBoundaries}`);
  lines.push(`- policy.requireApprovalBoundaries: ${requireApproval}`);

  return lines;
}

function resolvePresentation(
  pluginConfig: ClawCollectPluginConfig,
  request: DeliveryEventRequest,
  effect: ResolvedEffectRoute,
  audience: ResolvedAudience,
  endpoint: ResolvedEndpoint,
): ClawCollectPresentationConfig | undefined {
  const explicitPresentationId =
    endpoint.presentationId ?? audience.presentationId ?? effect.presentationId;
  if (explicitPresentationId) {
    const configured = pluginConfig.presentations?.[explicitPresentationId];
    if (configured && typeof configured === "object") {
      return configured;
    }
  }

  if (
    request.event === BUILTIN_EVENT_IDS.reminderDue &&
    pluginConfig.reminders?.messageTemplate?.trim()
  ) {
    return {
      template: pluginConfig.reminders.messageTemplate.trim(),
    };
  }

  return undefined;
}

function resolveOriginScope(request: DeliveryEventRequest): ResolvedOriginScope | null {
  const scope = parseScopeKey(request.originScopeKey);
  if (!scope) {
    return null;
  }

  return {
    scopeKey: scope.scopeKey,
    channel: scope.channel,
    accountId: scope.accountId,
    chatKind: scope.chatKind,
    target: scopeToMessageTarget(scope),
  };
}

function resolveOpenClawDestination(
  request: DeliveryEventRequest,
  endpoint: ResolvedEndpoint,
): ResolvedOpenClawDestination | null {
  if (endpoint.targetRef === "origin_scope") {
    const origin = resolveOriginScope(request);
    if (origin) {
      return {
        channel: origin.channel,
        target: origin.target,
        accountId: origin.accountId,
      };
    }
  }

  const channel = endpoint.channel?.trim();
  const target = endpoint.target?.trim();
  if (!channel || !target) {
    return null;
  }

  return {
    channel,
    target,
    accountId: endpoint.accountId?.trim() || undefined,
  };
}

function buildEndpointSignature(
  request: DeliveryEventRequest,
  adapter: ResolvedAdapter,
  endpoint: ResolvedEndpoint,
): string {
  if (adapter.kind === "openclaw_message") {
    const destination = resolveOpenClawDestination(request, endpoint);
    if (destination) {
      return [
        adapter.kind,
        destination.channel,
        destination.accountId ?? "",
        destination.target,
      ].join(":");
    }

    return [
      adapter.kind,
      endpoint.channel?.trim() ?? "",
      endpoint.accountId?.trim() ?? "",
      endpoint.targetRef?.trim() ?? "",
      endpoint.target?.trim() ?? "",
    ].join(":");
  }

  if (adapter.kind === "command") {
    return [adapter.kind, ...(endpoint.argv ?? adapter.argv ?? [])].join(":");
  }

  return `${adapter.kind}:${endpoint.adapterId}`;
}

function buildDispatchKey(
  request: DeliveryEventRequest,
  effect: ResolvedEffectRoute,
  adapter: ResolvedAdapter,
  endpoint: ResolvedEndpoint,
): string {
  return [
    request.event,
    effect.id,
    effect.kind,
    buildEndpointSignature(request, adapter, endpoint),
    request.entityId,
  ].join(":");
}

function buildLegacyDispatchKeyAliases(
  request: DeliveryEventRequest,
  adapter: ResolvedAdapter,
  endpoint: ResolvedEndpoint,
): string[] {
  const oldAction =
    request.event === BUILTIN_EVENT_IDS.introAvailable
      ? "intro"
      : request.event === BUILTIN_EVENT_IDS.reminderDue
        ? "reminder_due"
        : null;
  if (!oldAction) {
    return [];
  }
  return [`${oldAction}:${buildEndpointSignature(request, adapter, endpoint)}:${request.entityId}`];
}

function hasDispatched(
  store: ClawCollectStore,
  request: DeliveryEventRequest,
  effect: ResolvedEffectRoute,
  adapter: ResolvedAdapter,
  endpoint: ResolvedEndpoint,
): boolean {
  const keys = [
    buildDispatchKey(request, effect, adapter, endpoint),
    ...buildLegacyDispatchKeyAliases(request, adapter, endpoint),
  ];
  return keys.some((key) => Boolean(store.dispatches.sent[key]));
}

function renderTemplate(
  template: string,
  request: DeliveryEventRequest,
  effect: ResolvedEffectRoute,
  adapter: ResolvedAdapter,
  endpoint: ResolvedEndpoint,
  renderedText: string,
): string {
  const payloadFields = flattenPayloadFields(request.payload);
  const origin = resolveOriginScope(request);
  const destination =
    adapter.kind === "openclaw_message" ? resolveOpenClawDestination(request, endpoint) : null;
  let rendered = template
    .replaceAll("{event}", request.event)
    .replaceAll("{effect}", effect.kind)
    .replaceAll("{entity_id}", request.entityId)
    .replaceAll("{text}", renderedText)
    .replaceAll("{title}", request.title ?? payloadFields.title ?? "")
    .replaceAll("{due_at}", request.dueAt ?? payloadFields.due_at ?? "")
    .replaceAll("{reminder_id}", request.reminderId ?? "")
    .replaceAll("{adapter_id}", adapter.id)
    .replaceAll("{endpoint_target}", destination?.target ?? endpoint.target ?? "")
    .replaceAll("{endpoint_channel}", destination?.channel ?? endpoint.channel ?? "")
    .replaceAll("{endpoint_account}", destination?.accountId ?? endpoint.accountId ?? "")
    .replaceAll("{origin_scope}", origin?.scopeKey ?? request.originScopeKey ?? "")
    .replaceAll("{origin_channel}", origin?.channel ?? "")
    .replaceAll("{origin_account}", origin?.accountId ?? "")
    .replaceAll("{origin_chat_kind}", origin?.chatKind ?? "")
    .replaceAll("{origin_target}", origin?.target ?? "");

  for (const [key, value] of Object.entries(payloadFields)) {
    rendered = rendered.replaceAll(`{${key}}`, value);
  }

  for (const [key, value] of Object.entries(request.metadata ?? {})) {
    rendered = rendered.replaceAll(`{${key}}`, value);
  }

  return rendered;
}

async function runEndpoint(
  api: OpenClawPluginApi,
  request: DeliveryEventRequest,
  effect: ResolvedEffectRoute,
  adapter: ResolvedAdapter,
  endpoint: ResolvedEndpoint,
  renderedText: string,
): Promise<DeliveryResult> {
  if (!adapter.enabled) {
    return { status: "skipped", detail: `${adapter.id} disabled` };
  }

  if (adapter.kind === "noop") {
    return { status: "skipped", detail: `${adapter.id} noop adapter` };
  }

  if (adapter.kind === "openclaw_message") {
    if (effect.kind !== "notify") {
      return {
        status: "skipped",
        detail: `${adapter.id} cannot apply ${effect.kind} through openclaw_message`,
      };
    }

    const destination = resolveOpenClawDestination(request, endpoint);
    if (!destination) {
      return {
        status: "failed",
        detail: `${adapter.id} endpoint missing channel/target or unresolved targetRef`,
      };
    }

    const argv = [
      process.env.OPENCLAW_BIN?.trim() || "openclaw",
      "message",
      "send",
      "--channel",
      destination.channel,
      "--target",
      destination.target,
      "--message",
      renderedText,
    ];

    const accountId = destination.accountId?.trim();
    if (accountId) {
      argv.push("--account", accountId);
    }

    const result = await api.runtime.system.runCommandWithTimeout(argv, {
      timeoutMs: 30_000,
      env: process.env,
    });

    if (result.code !== 0) {
      const detail = (result.stderr || result.stdout || "send failed").trim();
      return { status: "failed", detail: `${adapter.id} ${detail}` };
    }

    return { status: "sent", detail: `${adapter.id} delivered to ${destination.target}` };
  }

  const argv = (endpoint.argv ?? adapter.argv ?? []).map((part) =>
    renderTemplate(part, request, effect, adapter, endpoint, renderedText),
  );
  if (argv.length === 0) {
    return { status: "failed", detail: `${adapter.id} argv is empty` };
  }

  const result = await api.runtime.system.runCommandWithTimeout(argv, {
    timeoutMs: 30_000,
    env: process.env,
  });

  if (result.code !== 0) {
    const detail = (result.stderr || result.stdout || "command failed").trim();
    return { status: "failed", detail: `${adapter.id} ${detail}` };
  }

  return { status: "sent", detail: `${adapter.id} executed ${effect.kind}` };
}

export async function deliverClawCollectEvent(
  api: OpenClawPluginApi,
  pluginConfig: ClawCollectPluginConfig,
  request: DeliveryEventRequest,
): Promise<DeliveryResult> {
  const policy = evaluateClawCollectPolicy(pluginConfig, {
    subject: request.event,
    boundary: request.boundary,
    risk: request.risk,
    approved: request.approved,
  });
  if (policy.status === "blocked") {
    return { status: "blocked", detail: policy.detail };
  }

  const route = resolveEventRoute(pluginConfig, request.event);
  if (!route.enabled) {
    return { status: "skipped", detail: `${request.event} route disabled` };
  }

  if (route.effects.length === 0) {
    return { status: "skipped", detail: `${request.event} has no effects` };
  }

  const adapters = new Map(resolveAdapters(pluginConfig).map((adapter) => [adapter.id, adapter]));
  const stateDir = api.runtime.state.resolveStateDir();
  const store = await loadStore(stateDir, pluginConfig);
  const sentKeys: string[] = [];
  const outcomes: string[] = policy.status === "warn" ? [`policy warning: ${policy.detail}`] : [];
  let failed = false;

  for (const effect of route.effects) {
    if (!effect.enabled) {
      outcomes.push(`${effect.kind} disabled`);
      continue;
    }

    if (effect.audiences.length === 0) {
      outcomes.push(`${effect.kind} has no audience`);
      continue;
    }

    for (const audience of effect.audiences) {
      if (audience.endpoints.length === 0) {
        outcomes.push(`${audience.id} resolved to no endpoints`);
        continue;
      }

      for (const endpoint of audience.endpoints) {
        const adapter = adapters.get(endpoint.adapterId);
        if (!adapter) {
          failed = true;
          outcomes.push(`${audience.id}:${endpoint.adapterId} missing adapter`);
          continue;
        }

        const presentation = resolvePresentation(pluginConfig, request, effect, audience, endpoint);
        const renderedText = renderPayloadText(request.payload, presentation);
        if (!renderedText) {
          outcomes.push(`${audience.id}:${effect.id} rendered empty payload`);
          continue;
        }

        if (hasDispatched(store, request, effect, adapter, endpoint)) {
          outcomes.push(`${audience.id}:${adapter.id} already sent`);
          continue;
        }

        const result = await runEndpoint(
          api,
          request,
          effect,
          adapter,
          endpoint,
          renderedText,
        );
        outcomes.push(`${audience.id}:${result.detail}`);
        if (result.status === "sent") {
          sentKeys.push(buildDispatchKey(request, effect, adapter, endpoint));
          continue;
        }
        if (result.status === "failed") {
          failed = true;
        }
      }
    }
  }

  if (sentKeys.length > 0) {
    await updateStore(stateDir, pluginConfig, (nextStore) => {
      const sentAt = new Date().toISOString();
      for (const key of sentKeys) {
        nextStore.dispatches.sent[key] = sentAt;
      }
    });
    return { status: "sent", detail: outcomes.join("; ") };
  }

  if (failed) {
    return { status: "failed", detail: outcomes.join("; ") };
  }

  return { status: "skipped", detail: outcomes.join("; ") || "no delivery performed" };
}

export async function deliverDueReminder(
  api: OpenClawPluginApi,
  pluginConfig: ClawCollectPluginConfig,
  reminder: Reminder,
): Promise<DeliveryResult> {
  if (reminder.status === "done") {
    return { status: "skipped", detail: `${reminder.id} already marked done` };
  }
  const title = reminder.title.trim() || reminder.id;
  return await deliverClawCollectEvent(api, pluginConfig, {
    event: BUILTIN_EVENT_IDS.reminderDue,
    entityId: reminder.id,
    reminderId: reminder.id,
    boundary: "reminder_only",
    risk: "low",
    title,
    dueAt: reminder.dueAt,
    originScopeKey: reminder.originScopeKey,
    payload: createReminderPayload(reminder),
  });
}
