export type ChecklistItemStatus = "open" | "done";
export type ReminderStatus = "pending" | "due" | "done";
export type CollectionStatus = "open" | "closed";
export type OnlineCollectionStatus = "open" | "closed";
export type ItemOrigin = "manual" | "capture";
export type AssetKind = "image" | "file" | "audio" | "video" | "url" | "unknown";
export type ClawCollectAdapterKind = "openclaw_message" | "command" | "noop";
export type ClawCollectEventName = string;
export type ClawCollectEffectKind = string;
export type ClawCollectAudienceKind = "profiles" | "literal" | "none";
export type ClawCollectEndpointTargetRef = "origin_scope";
export type ClawCollectBoundaryKind =
  | "informational"
  | "reminder_only"
  | "organizational"
  | "sensitive"
  | "transactional";
export type ClawCollectRiskLevel = "low" | "medium" | "high";

export interface ChecklistItem {
  id: string;
  text: string;
  normalizedText: string;
  status: ChecklistItemStatus;
  requestedBy: string[];
  createdFrom: ItemOrigin;
  createdAt: string;
  updatedAt: string;
}

export interface Checklist {
  id: string;
  title: string;
  kind?: string;
  items: ChecklistItem[];
  createdAt: string;
  updatedAt: string;
}

export interface ReminderDeliveryState {
  attemptCount: number;
  lastAttemptAt?: string;
  nextAttemptAt?: string;
  lastError?: string;
  completedAt?: string;
}

export interface Reminder {
  id: string;
  title: string;
  dueAt: string;
  timezone?: string;
  originScopeKey?: string;
  status: ReminderStatus;
  relatedListId?: string;
  note?: string;
  delivery?: ReminderDeliveryState;
  createdAt: string;
  updatedAt: string;
}

export interface CollectionSession {
  id: string;
  title: string;
  listId: string;
  scopeKey: string;
  status: CollectionStatus;
  boundary?: ClawCollectBoundaryKind;
  risk?: ClawCollectRiskLevel;
  approved?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CaptureRecord {
  id: string;
  scopeKey: string;
  from: string;
  content: string;
  extractedItems: string[];
  assets: AssetRef[];
  capturedAt: string;
}

export interface AssetRef {
  id: string;
  kind: AssetKind;
  name?: string;
  mimeType?: string;
  url?: string;
  localPath?: string;
}

export interface OnlineCollection {
  id: string;
  scopeKey: string;
  title: string;
  remoteFormId: string;
  remoteLinkUrl: string;
  status: OnlineCollectionStatus;
  createdAt: string;
  updatedAt: string;
  lastKnownResponsesCount: number;
}

export interface ClawCollectStore {
  version: 4;
  lists: Checklist[];
  reminders: Reminder[];
  collectionSessions: CollectionSession[];
  captures: CaptureRecord[];
  onlineCollections: OnlineCollection[];
  dispatches: {
    sent: Record<string, string>;
  };
}

export interface ClawCollectAdapterConfig {
  kind?: ClawCollectAdapterKind;
  enabled?: boolean;
  description?: string;
  argv?: string[];
}

export interface ClawCollectEndpointConfig {
  adapterId?: string;
  description?: string;
  presentationId?: string;
  targetRef?: ClawCollectEndpointTargetRef;
  channel?: string;
  target?: string;
  accountId?: string;
  argv?: string[];
}

export interface ClawCollectProfileConfig {
  description?: string;
  endpoints?: ClawCollectEndpointConfig[];
}

export interface ClawCollectAudienceConfig {
  kind?: ClawCollectAudienceKind;
  description?: string;
  presentationId?: string;
  profileIds?: string[];
  endpoints?: ClawCollectEndpointConfig[];
}

export interface ClawCollectDeliveryPayload {
  kind?: string;
  title?: string;
  summary?: string;
  body?: string;
  lines?: string[];
  fields?: Record<string, string>;
}

export interface ClawCollectPresentationConfig {
  template?: string;
  header?: string;
  footer?: string;
  linePrefix?: string;
  separator?: string;
}

export interface ClawCollectEffectRouteConfig {
  kind?: ClawCollectEffectKind;
  enabled?: boolean;
  presentationId?: string;
  audienceIds?: string[];
  audiences?: ClawCollectAudienceConfig[];
}

export interface ClawCollectEventRouteConfig {
  enabled?: boolean;
  effects?: ClawCollectEffectRouteConfig[];
}

export interface ClawCollectPolicyConfig {
  mode?: "enforce" | "warn";
  allowBoundaries?: ClawCollectBoundaryKind[];
  blockBoundaries?: ClawCollectBoundaryKind[];
  requireApprovalBoundaries?: ClawCollectBoundaryKind[];
}

export interface ClawCollectPluginConfig {
  capture?: {
    autoExtractMessages?: boolean;
    onlyWhenCollectionOpen?: boolean;
    storeRawOutsideCollection?: boolean;
  };
  reminders?: {
    sweepIntervalSec?: number;
    messageTemplate?: string;
    maxDeliveryAttempts?: number;
    retryBackoffSec?: number;
  };
  timezone?: {
    default?: string;
    bySender?: Record<string, string>;
    byScope?: Record<string, string>;
    byChannel?: Record<string, string>;
  };
  intro?: {
    text?: string;
  };
  adapters?: Record<string, ClawCollectAdapterConfig>;
  profiles?: Record<string, ClawCollectProfileConfig>;
  audiences?: Record<string, ClawCollectAudienceConfig>;
  presentations?: Record<string, ClawCollectPresentationConfig>;
  events?: Record<string, ClawCollectEventRouteConfig>;
  policy?: ClawCollectPolicyConfig;
  onboarding?: {
    enabled?: boolean;
    channel?: string;
    target?: string;
    accountId?: string;
    introText?: string;
  };
  storage?: {
    filePath?: string;
  };
  online?: {
    enabled?: boolean;
    apiUrl?: string;
    apiToken?: string;
  };
}

export interface LifeCommandContext {
  senderId?: string;
  channel: string;
  channelId?: string;
  isAuthorizedSender: boolean;
  args?: string;
  commandBody: string;
  from?: string;
  to?: string;
  accountId?: string;
  messageThreadId?: number;
}

export interface LifeMessageContext {
  channelId: string;
  accountId?: string;
  conversationId?: string;
}

export interface LifeMessageEvent {
  from: string;
  content: string;
  timestamp?: number;
  metadata?: Record<string, unknown>;
}
