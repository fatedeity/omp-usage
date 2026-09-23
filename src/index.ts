import type { ExtensionAPI, ExtensionCommandContext } from "@oh-my-pi/pi-coding-agent";

import {
  findProviderDefinition,
  PROVIDER_DEFINITIONS,
  PROVIDER_ENDPOINTS,
} from "./provider-registry.js";
import {
  formatUsageReport,
  parseBuiltinUsageReports,
  type UsageReport,
} from "./usage.js";

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

// 透传 OMP 内置账号报告（如 openai-codex）。凭据刷新与缓存都由 omp usage 处理。
async function readBuiltinUsageReports(
  pi: ExtensionAPI,
): Promise<UsageReport[]> {
  const result = await pi.exec("omp", ["usage", "--json", "--redact"], {
    timeout: 30_000,
  });
  if (result.code !== 0) return [];
  try {
    return parseBuiltinUsageReports(JSON.parse(result.stdout));
  } catch {
    return [];
  }
}

async function showAggregatedUsage(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
): Promise<void> {
  const sections: string[] = [];
  const covered = new Set<string>();

  for (const provider of PROVIDER_DEFINITIONS) {
    covered.add(provider.id);
    const apiKey = await readConfiguredApiKey(pi, provider.id);
    const report = await provider.fetchUsage(apiKey, fetch);
    if (report) {
      sections.push(formatUsageReport(report, provider.displayName));
    }
  }

  for (const report of await readBuiltinUsageReports(pi)) {
    if (covered.has(report.provider)) continue;
    sections.push(formatUsageReport(report, report.provider));
  }

  if (sections.length === 0) {
    ctx.ui.notify("没有可显示的额度报告，请检查凭据和网络连接。", "error");
    return;
  }

  ctx.ui.notify(sections.join("\n\n"), "info");
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
    getArgumentCompletions: prefix => {
      const items = [
        { value: "all", label: "all", description: "聚合所有 provider 与内置账号额度" },
        ...PROVIDER_DEFINITIONS.map(provider => ({
          value: provider.id,
          label: provider.id,
          description: provider.displayName,
        })),
      ];
      const lowered = prefix.trim().toLowerCase();
      const filtered = lowered
        ? items.filter(item => item.value.startsWith(lowered))
        : items;
      return filtered.length > 0 ? filtered : null;
    },
    handler: async (args, ctx) => {
      const trimmed = args.trim();
      if (trimmed === "all") {
        await showAggregatedUsage(pi, ctx);
        return;
      }

      const defaultProvider = PROVIDER_DEFINITIONS[0];
      const providerId = trimmed || defaultProvider?.id;
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
