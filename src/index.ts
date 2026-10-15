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

// 透传 OMP 内置账号额度（如 openai-codex 的 ChatGPT 订阅、alibaba-token-plan 的百炼 Token Plan）。
// 凭据刷新与缓存都由 omp usage 处理；只取与当前模型 provider 匹配的报告：
// 精确同名优先，前缀互匹配只为 openai → openai-codex 这类映射，
// 绝不兜底返回其他 provider 的报告——未登录/无数据时额度条应静默隐藏。
export async function readBuiltinUsageReport(
  pi: ExtensionAPI,
  providerId: string,
): Promise<UsageReport | undefined> {
  const result = await pi.exec("omp", ["usage", "--json", "--redact"], {
    timeout: 30_000,
  });
  if (result.code !== 0) return undefined;
  try {
    const reports = parseBuiltinUsageReports(JSON.parse(result.stdout));
    return (
      reports.find(report => report.provider === providerId) ??
      reports.find(report =>
        report.provider.startsWith(providerId) ||
        providerId.startsWith(report.provider),
      )
    );
  } catch {
    return undefined;
  }
}

// 额度条：aboveEditor widget，右对齐到输入框上方一行的右上角。
// 会话启动/切换、每轮对话结束后和轮询保鲜时刷新；拉取失败时保留旧显示。
let latestBar: string | undefined;
let latestProviderId: string | undefined;
let refreshInFlight = false;

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

// ---------- 刷新策略：5 分钟 TTL 缓存 + 失败指数退避（社区惯例 1-5 分钟，查询接口无官方限频） ----------
const CACHE_TTL_MS = 5 * 60_000;
const BACKOFF_BASE_MS = 60_000;
const BACKOFF_MAX_MS = 30 * 60_000;

// 连续失败 n 次后的退避时长：60s 起步翻倍，封顶 30 分钟。
export function nextBackoffMs(consecutiveFailures: number): number {
  return Math.min(
    BACKOFF_BASE_MS * 2 ** (consecutiveFailures - 1),
    BACKOFF_MAX_MS,
  );
}

// alibaba-token-plan 的额度只有百炼 console session 可查，OMP 内置 usage provider
// （`omp login alibaba-token-plan` 后可用）已实现解析，走内置报告分支即可。
const ALIBABA_PROVIDER_ID = "alibaba-token-plan";

type SourceKey = typeof PROVIDER_ID | typeof ALIBABA_PROVIDER_ID | "openai";
type CacheEntry = { report: UsageReport; fetchedAt: number };
// 按数据源分桶缓存；键集合固定（三个源），值运行时填充。
const reportCache: Partial<Record<SourceKey, CacheEntry>> = {};
const backoffUntil: Partial<Record<SourceKey, number>> = {};
const consecutiveFailures: Partial<Record<SourceKey, number>> = {};

export function sourceKey(providerId: string | undefined): SourceKey | undefined {
  if (providerId === PROVIDER_ID) return PROVIDER_ID;
  if (providerId === ALIBABA_PROVIDER_ID) return ALIBABA_PROVIDER_ID;
  if (providerId?.startsWith("openai")) return "openai";
  return undefined;
}

async function fetchSourceReport(
  pi: ExtensionAPI,
  key: SourceKey,
  providerId: string | undefined,
): Promise<UsageReport | undefined> {
  if (key === PROVIDER_ID) {
    const provider = PROVIDER_DEFINITIONS.find(item => item.id === PROVIDER_ID);
    if (!provider) return undefined;
    const apiKey = await readConfiguredApiKey(pi, provider.id);
    return (await provider.fetchUsage(apiKey, fetch)) ?? undefined;
  }
  return readBuiltinUsageReport(pi, providerId!);
}

function applyBar(ctx: ExtensionContext, report: UsageReport | undefined): void {
  const bar = report ? renderUsageBar(report, ctx.ui.theme) : undefined;
  latestBar = bar;
  ctx.ui.setWidget("omp-usage", bar ? usageWidget() : undefined, {
    placement: "aboveEditor",
  });
}

// 额度条刷新：按当前活跃模型的 provider 分流——
// 智谱模型 → 注册表 fetchUsage；openai 系 / 阿里百炼模型 → 内置账号报告；
// 其他 provider 无数据源，隐藏额度条。
// 所有触发源（事件/轮询）都进这里，由 TTL 与退避统一裁决是否真正拉接口。
async function refreshUsageStatus(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
): Promise<void> {
  if (refreshInFlight) return;
  refreshInFlight = true;
  try {
    const providerId = ctx.model?.provider;
    const providerChanged = (providerId ?? undefined) !== latestProviderId;
    latestProviderId = providerId;
    const key = sourceKey(providerId);

    if (!key) {
      applyBar(ctx, undefined);
      return;
    }

    const now = Date.now();
    const cached = reportCache[key];
    if (providerChanged) applyBar(ctx, cached?.report);
    if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
      applyBar(ctx, cached.report);
      return;
    }
    // 退避窗口内不动，保留现有显示，避免继续打非公开接口。
    if (now < (backoffUntil[key] ?? 0)) return;

    let report: UsageReport | undefined;
    try {
      report = await fetchSourceReport(pi, key, providerId);
    } catch {
      report = undefined;
    }
    if (report) {
      consecutiveFailures[key] = 0;
      backoffUntil[key] = 0;
      reportCache[key] = { report, fetchedAt: Date.now() };
      applyBar(ctx, report);
    } else {
      const failures = (consecutiveFailures[key] ?? 0) + 1;
      consecutiveFailures[key] = failures;
      backoffUntil[key] = Date.now() + nextBackoffMs(failures);
    }
  } finally {
    refreshInFlight = false;
  }
}

// 切换模型没有扩展事件可订阅：轮询统一承担换源感知与 5 分钟保鲜。
// 每 2s 调一次 refreshUsageStatus（内部先查 TTL/退避，绝大多数时候直接返回），
// 定时器由 harness 托管（TUI 退出自动清理）。
const PROVIDER_POLL_MS = 2_000;

function startProviderWatch(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
): void {
  if (typeof ctx.setInterval !== "function") return;
  ctx.setInterval(() => {
    const providerId = ctx.model?.provider;
    const key = sourceKey(providerId);
    const cached = key ? reportCache[key] : undefined;
    const stale =
      !!key &&
      Date.now() >= (backoffUntil[key] ?? 0) &&
      (!cached || Date.now() - cached.fetchedAt >= CACHE_TTL_MS);
    if ((providerId ?? undefined) !== latestProviderId || stale) {
      void refreshUsageStatus(pi, ctx);
    }
  }, PROVIDER_POLL_MS);
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

  let providerWatchStarted = false;

  const refresh = async (_event: unknown, ctx: ExtensionContext) => {
    await refreshUsageStatus(pi, ctx);
  };

  pi.on("session_start", async (_event, ctx) => {
    if (!providerWatchStarted) {
      providerWatchStarted = true;
      startProviderWatch(pi, ctx);
    }
    await refresh(_event, ctx);
  });

  pi.on("session_switch", refresh);
  pi.on("turn_start", refresh);
  pi.on("turn_end", refresh);
}
