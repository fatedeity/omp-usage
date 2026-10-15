import type { UsageReport } from "./usage.js";

const BAR_WIDTH = 10;
const FULL = "▰";
const EMPTY = "▱";

// 内置报告的窗口 id 偏冗长（alibaba-token-plan 用 "monthly"），与智谱路径的 `1mo` / `5h` / `7d` 风格对齐。
// OMP 自身的卡片/`omp usage` 面板用的是内置 provider 的标签，扩展改不了（见 AGENTS.md）。
const WINDOW_ID_ALIASES: Record<string, string> = { monthly: "1mo" };

/** renderUsageBar 需要的最小主题面（ctx.ui.theme 的结构子集，便于测试 stub）。 */
export interface UsageTheme {
  fg(color: "success" | "warning" | "error" | "dim", text: string): string;
}

/** 重置倒计时，尽可能短：<1m、45m、2h14m、4d6h。缺失或已过期时不显示。 */
export function formatResetIn(
  resetsAt: number | undefined,
  now: number,
): string | undefined {
  if (resetsAt === undefined) return undefined;
  const totalMinutes = Math.ceil((resetsAt - now) / 60_000);
  if (totalMinutes < 1) return undefined;
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  if (hours < 24) {
    const minutes = totalMinutes % 60;
    return minutes > 0 ? `${hours}h${minutes}m` : `${hours}h`;
  }
  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours > 0 ? `${days}d${restHours}h` : `${days}d`;
}

/**
 * 渲染额度条（单行紧凑）：`5h ▰▰▰▰▰▰▱▱▱▱ 64% 2h14m  7d ▰▰▰▱▱▱▱▱▱▱ 31% 4d6h`。
 * 颜色取主题语义色（success/warning/error），reset 倒计时用 dim。
 * 没有任何可显示内容时返回 undefined（不显示该 widget）。
 */
export function renderUsageBar(
  report: UsageReport,
  theme: UsageTheme,
  now = Date.now(),
): string | undefined {
  const parts: string[] = [];
  const limits = [...report.limits].sort(
    (a, b) => (a.window.durationMs ?? Infinity) - (b.window.durationMs ?? Infinity),
  );
  for (const limit of limits) {
    const fraction = limit.amount.usedFraction;
    const filled = Math.round(fraction * BAR_WIDTH);
    const color =
      fraction > 0.85 ? "error" : fraction >= 0.6 ? "warning" : "success";
    const bar =
      theme.fg(color, FULL.repeat(filled)) + EMPTY.repeat(BAR_WIDTH - filled);
    const windowId = WINDOW_ID_ALIASES[limit.window.id] ?? limit.window.id;
    const segment = `${windowId} ${bar} ${theme.fg(color, `${Math.round(fraction * 100)}%`)}`;
    const reset = formatResetIn(limit.window.resetsAt, now);
    parts.push(reset ? `${segment} ${theme.fg("dim", reset)}` : segment);
  }
  const resetCredits = report.resetCredits;
  if (resetCredits && resetCredits.availableCount > 0) {
    let nextExpiry: number | undefined;
    for (const credit of resetCredits.credits ?? []) {
      const expiresAt = credit.expiresAt ? Date.parse(credit.expiresAt) : NaN;
      if (
        Number.isFinite(expiresAt) &&
        expiresAt > now &&
        (nextExpiry === undefined || expiresAt < nextExpiry)
      ) {
        nextExpiry = expiresAt;
      }
    }
    // availableCount 与 credits 可能短暂不同步：有卡记录但全部已过期时不显示，避免误导。
    if (nextExpiry !== undefined || !resetCredits.credits?.length) {
      const expiry = formatResetIn(nextExpiry, now);
      parts.push(
        theme.fg("success", `✦ ${resetCredits.availableCount}${expiry ? ` · ${expiry}` : ""}`),
      );
    }
  }
  return parts.length > 0 ? parts.join("  ") : undefined;
}
