import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";

import { PROVIDER_DEFINITIONS } from "./provider-registry.js";
import { renderUsageBar } from "./status-line.js";

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

// 额度条：aboveEditor widget，右对齐到输入框上方一行的右上角。
// 会话启动和每轮对话结束后刷新；拉取失败时静默清除。
let latestBar: string | undefined;

const ANSI_RE = /\x1b\[[0-9;]*m/g;

function usageWidget(): (
  tui: unknown,
  theme: unknown,
) => { render(width: number): readonly string[] } {
  return () => ({
    render(width: number): readonly string[] {
      if (!latestBar) return [];
      const visible = latestBar.replace(ANSI_RE, "").length;
      return [" ".repeat(Math.max(0, width - visible)) + latestBar];
    },
  });
}

async function refreshUsageStatus(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
): Promise<void> {
  for (const provider of PROVIDER_DEFINITIONS) {
    const apiKey = await readConfiguredApiKey(pi, provider.id);
    const report = await provider.fetchUsage(apiKey, fetch);
    if (report) {
      latestBar = renderUsageBar(report, ctx.ui.theme);
      ctx.ui.setWidget("omp-usage", latestBar ? usageWidget() : undefined, {
        placement: "aboveEditor",
      });
      return;
    }
  }
  latestBar = undefined;
  ctx.ui.setWidget("omp-usage", undefined, { placement: "aboveEditor" });
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

  pi.on("session_start", async (_event, ctx) => {
    await refreshUsageStatus(pi, ctx);
  });

  pi.on("turn_end", async (_event, ctx) => {
    await refreshUsageStatus(pi, ctx);
  });
}
