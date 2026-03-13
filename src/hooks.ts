import type { OpenClawPluginApi } from "openclaw/plugin-sdk";

import { captureFragmentForScope } from "./app";
import { resolveMessageScope } from "./scope";
import type {
  ClawCollectPluginConfig,
  LifeMessageContext,
  LifeMessageEvent,
} from "./types";

export async function handleMessageReceived(
  api: OpenClawPluginApi,
  event: LifeMessageEvent,
  ctx: LifeMessageContext,
  pluginConfig: ClawCollectPluginConfig,
): Promise<void> {
  if (pluginConfig.capture?.autoExtractMessages === false) {
    return;
  }

  const scope = resolveMessageScope(ctx, event);
  if (!scope) {
    return;
  }

  const stateDir = api.runtime.state.resolveStateDir();
  const content = event.content.trim();
  if (!content) {
    return;
  }

  const result = await captureFragmentForScope(
    stateDir,
    pluginConfig,
    scope.scopeKey,
    event.from ?? "unknown",
    content,
    event.metadata,
  );

  if (!result.ok || result.code === "capture_ignored") {
    return;
  }

  if ((result.data?.added ?? 0) > 0 || (result.data?.merged ?? 0) > 0) {
    api.logger.info(
      `[clawcollect] captured ${result.data?.extractedItems.length ?? 0} item(s) in ${scope.scopeKey}`,
    );
  }
}
