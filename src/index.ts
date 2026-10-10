import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";

import { PROVIDER_DEFINITIONS } from "./provider-registry.js";
import { renderUsageBar } from "./status-line.js";
import { parseBuiltinUsageReports, PROVIDER_ID, type UsageReport } from "./usage.js";

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

// 透传 OMP 内置账号额度（如 openai-codex 的 ChatGPT 订阅）。
// 凭据刷新与缓存都由 omp usage 处理；返回第一个有 5h/7d 窗口的报告。
async function readBuiltinUsageReport(
  pi: ExtensionAPI,
): Promise<UsageReport | undefined> {
  const result = await pi.exec("omp", ["usage", "--json", "--redact"], {
    timeout: 30_000,
  });
  if (result.code !== 0) return undefined;
  try {
    return parseBuiltinUsageReports(JSON.parse(result.stdout)).find(report =>
      report.limits.some(limit => ["5h", "7d"].includes(limit.window.id)),
    );
  } catch {
    return undefined;
  }
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

// 额度条刷新：按当前活跃模型的 provider 分流——
// 智谱模型 → 注册表 fetchUsage；openai 系模型 → 内置账号报告（openai-codex）；
// 其他 provider 无数据源，隐藏额度条。
async function refreshUsageStatus(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
): Promise<void> {
  const providerId = ctx.model?.provider;
  let bar: string | undefined;

  if (providerId === PROVIDER_ID) {
    for (const provider of PROVIDER_DEFINITIONS) {
      if (provider.id !== PROVIDER_ID) continue;
      const apiKey = await readConfiguredApiKey(pi, provider.id);
      const report = await provider.fetchUsage(apiKey, fetch);
      if (report) {
        bar = renderUsageBar(report, ctx.ui.theme);
        break;
      }
    }
  } else if (providerId?.startsWith("openai")) {
    const report = await readBuiltinUsageReport(pi);
    if (report) {
      bar = renderUsageBar(report, ctx.ui.theme);
    }
  }

  latestBar = bar;
  ctx.ui.setWidget("omp-usage", bar ? usageWidget() : undefined, {
    placement: "aboveEditor",
  });
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
