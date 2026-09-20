import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

import {
  findProviderDefinition,
  PROVIDER_DEFINITIONS,
  PROVIDER_ENDPOINTS,
} from "./provider-registry.js";
import { formatUsageReport } from "./usage.js";

async function readConfiguredApiKey(
  pi: ExtensionAPI,
  providerId: string,
): Promise<string | undefined> {
  const result = await pi.exec("omp", ["token", providerId, "--raw"], {
    timeout: 10_000,
  });
  if (result.code !== 0) return undefined;
  const apiKey = result.stdout.trim();
  return apiKey || undefined;
}

export default function registerUsageExtension(pi: ExtensionAPI): void {
  for (const provider of PROVIDER_DEFINITIONS) {
    pi.registerProvider(provider.id, {
      baseUrl: provider.baseUrl,
      api: provider.api,
      usage: {
        id: provider.id,
        async fetchUsage(params, { fetch }) {
          return provider.fetchUsage(params.credential.apiKey, fetch);
        },
      },
    });
  }

  pi.registerCommand("omp-usage", {
    description: "查询 provider 额度",
    handler: async (args, ctx) => {
      const defaultProvider = PROVIDER_DEFINITIONS[0];
      const providerId = args.trim() || defaultProvider?.id;
      if (!providerId) {
        ctx.ui.notify("当前没有可用的额度 provider。", "error");
        return;
      }

      const provider = findProviderDefinition(providerId);
      if (!provider) {
        const supported = PROVIDER_DEFINITIONS.map(item => item.id).join(", ");
        ctx.ui.notify(
          `不支持 provider：${providerId}。当前支持：${supported}。`,
          "error",
        );
        return;
      }

      const apiKey = await readConfiguredApiKey(pi, provider.id);
      const report = await provider.fetchUsage(apiKey, fetch);
      if (!report) {
        ctx.ui.notify(
          `无法读取 ${provider.displayName} 额度，请检查凭据和网络连接。`,
          "error",
        );
        return;
      }

      ctx.ui.notify(formatUsageReport(report, provider.displayName), "info");
    },
  });

  for (const [providerId, endpoint] of Object.entries(PROVIDER_ENDPOINTS)) {
    pi.logger?.debug?.(
      `[omp-usage] provider=${providerId} usage endpoint=${endpoint}`,
    );
  }
}
