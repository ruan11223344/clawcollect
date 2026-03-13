import type { OpenClawPluginApi } from "openclaw/plugin-sdk";

import { registerClawCollectCommands } from "./commands";
import type { ClawCollectPluginConfig } from "./types";

function resolvePluginConfig(raw: unknown): ClawCollectPluginConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }
  return raw as ClawCollectPluginConfig;
}

const clawCollectPlugin = {
  id: "clawcollect",
  name: "ClawCollect",
  description: "OpenClaw bridge for hosted form collection via the ClawCollect online service.",

  register(api: OpenClawPluginApi) {
    const pluginConfig = resolvePluginConfig(api.pluginConfig);

    registerClawCollectCommands(api, pluginConfig);

    api.logger.info("[clawcollect] loaded");
  },
};

export default clawCollectPlugin;
