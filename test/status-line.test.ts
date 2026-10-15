import { describe, expect, test } from "bun:test";

import { parseZhipuUsage, type UsageReport } from "../src/usage.js";
import {
  formatResetIn,
  renderUsageBar,
  type UsageTheme,
} from "../src/status-line.js";

const fetchedAt = 1_800_000_000_000;

const stubTheme: UsageTheme = {
  fg: (color, text) => `[${color}]${text}[/]`,
};

function payloadWithPercentages(
  percentages: Record<string, number>,
  resetsInMinutes?: Record<string, number>,
): unknown {
  const unitNumber: Record<string, { type: string; unit: number; number: number }> = {
    "5h": { type: "TOKENS_LIMIT", unit: 3, number: 5 },
    "7d": { type: "TOKENS_LIMIT", unit: 6, number: 1 },
    // 月度 MCP/工具调用额度：TIME_LIMIT + unit=5 + number=1
    "1mo": { type: "TIME_LIMIT", unit: 5, number: 1 },
  };
  return {
    code: 200,
    success: true,
    data: {
      limits: Object.entries(percentages).map(([windowId, percentage]) => ({
        ...unitNumber[windowId],
        percentage,
        ...(resetsInMinutes?.[windowId] !== undefined
          ? {
              nextResetTime:
                fetchedAt + resetsInMinutes[windowId] * 60_000,
            }
          : {}),
      })),
    },
  };
}

function stripAnsi(text: string): string {
  return text.replace(/\[[a-z]+\]|\[\/\]/g, "");
}

describe("renderUsageBar", () => {
  test("渲染 5h 与 7d 两段，带百分比与 reset 倒计时", () => {
    const report = parseZhipuUsage(
      payloadWithPercentages({ "5h": 64, "7d": 31 }, {
        "5h": 134,
        "7d": 4 * 24 * 60 + 6 * 60,
      }),
      fetchedAt,
    ) as UsageReport;

    const plain = stripAnsi(renderUsageBar(report, stubTheme, fetchedAt) ?? "");
    expect(plain).toBe(
      "5h ▰▰▰▰▰▰▱▱▱▱ 64% 2h14m  7d ▰▰▰▱▱▱▱▱▱▱ 31% 4d6h",
    );
  });

  test("reset 倒计时着 dim 色，条与百分比着分级色", () => {
    const report = parseZhipuUsage(
      payloadWithPercentages({ "5h": 64 }, { "5h": 30 }),
      fetchedAt,
    ) as UsageReport;

    const bar = renderUsageBar(report, stubTheme, fetchedAt) ?? "";
    expect(bar).toContain("[warning]");
    expect(bar).toContain("[dim]30m[/]");
  });

  test("显示 Codex 可用重置卡数与最近到期倒计时", () => {
    const report = {
      ...(parseZhipuUsage(payloadWithPercentages({ "1mo": 95 }), fetchedAt) as UsageReport),
      resetCredits: {
        availableCount: 2,
        credits: [
          { expiresAt: new Date(fetchedAt + 4 * 86_400_000).toISOString() },
          { expiresAt: new Date(fetchedAt + 2 * 86_400_000).toISOString() },
        ],
      },
    };

    const plain = stripAnsi(renderUsageBar(report, stubTheme, fetchedAt) ?? "");
    expect(plain).toContain("✦ 2 · 2d");
    expect(renderUsageBar(report, stubTheme, fetchedAt)).toContain(
      "[success]✦ 2 · 2d[/]",
    );
  });

  test("重置卡无到期信息时只显示数量", () => {
    const report = {
      ...(parseZhipuUsage(payloadWithPercentages({ "1mo": 95 }), fetchedAt) as UsageReport),
      resetCredits: { availableCount: 2, credits: [] },
    };

    const plain = stripAnsi(renderUsageBar(report, stubTheme, fetchedAt) ?? "");
    expect(plain).toContain("✦ 2");
    expect(plain).not.toContain("·");
  });

  test("重置卡全部已过期时不显示", () => {
    const report = {
      ...(parseZhipuUsage(payloadWithPercentages({ "1mo": 95 }), fetchedAt) as UsageReport),
      resetCredits: {
        availableCount: 2,
        credits: [
          { expiresAt: new Date(fetchedAt - 86_400_000).toISOString() },
        ],
      },
    };

    expect(stripAnsi(renderUsageBar(report, stubTheme, fetchedAt) ?? "")).not.toContain("✦");
  });

  test("按已用比例填充格子（四舍五入）", () => {
    const report = parseZhipuUsage(
      payloadWithPercentages({ "5h": 64, "7d": 25 }),
      fetchedAt,
    ) as UsageReport;

    const plain = stripAnsi(renderUsageBar(report, stubTheme, fetchedAt) ?? "");
    const [fiveHour, sevenDay] = plain.split("  ");
    expect(fiveHour).toContain("▰".repeat(6) + "▱".repeat(4));
    expect(sevenDay).toContain("▰".repeat(3) + "▱".repeat(7));
    expect(fiveHour).toContain("64%");
    expect(sevenDay).toContain("25%");
  });

  test("颜色分级：<60% success、60–85% warning、>85% error", () => {
    const cases: [number, string][] = [
      [59, "[success]"],
      [60, "[warning]"],
      [85, "[warning]"],
      [86, "[error]"],
    ];
    for (const [percentage, color] of cases) {
      const report = parseZhipuUsage(
        payloadWithPercentages({ "5h": percentage }),
        fetchedAt,
      ) as UsageReport;
      expect(renderUsageBar(report, stubTheme, fetchedAt)).toContain(color);
    }
  });

  test("纯百分比响应（无绝对计数）也能渲染", () => {
    const report = parseZhipuUsage(
      payloadWithPercentages({ "5h": 90 }),
      fetchedAt,
    ) as UsageReport;

    expect(stripAnsi(renderUsageBar(report, stubTheme, fetchedAt) ?? "")).toBe(
      "5h " + "▰".repeat(9) + "▱ 90%",
    );
  });

  test("渲染非 5h/7d 窗口（如月度）", () => {
    const report = parseZhipuUsage(
      payloadWithPercentages({ "1mo": 10 }),
      fetchedAt,
    );
    expect(report).not.toBeNull();
    expect(
      stripAnsi(renderUsageBar(report as UsageReport, stubTheme, fetchedAt) ?? ""),
    ).toBe("1mo ▰" + "▱".repeat(9) + " 10%");
  });

  test("内置报告的 monthly 窗口在额度条上显示为 1mo", () => {
    const report: UsageReport = {
      provider: "alibaba-token-plan",
      fetchedAt,
      limits: [
        {
          id: "credits:monthly",
          label: "Monthly Credits",
          scope: {
            provider: "alibaba-token-plan",
            windowId: "monthly",
            shared: true,
          },
          window: {
            id: "monthly",
            label: "Monthly Credits",
            resetsAt: fetchedAt + 2 * 86_400_000,
          },
          amount: {
            used: 19.3,
            limit: 100,
            remaining: 80.7,
            usedFraction: 0.193,
            remainingFraction: 0.807,
            unit: "percent",
          },
          status: "ok",
        },
      ],
    };

    expect(stripAnsi(renderUsageBar(report, stubTheme, fetchedAt) ?? "")).toBe(
      "1mo ▰▰" + "▱".repeat(8) + " 19% 2d",
    );
  });
});

describe("formatResetIn", () => {
  test("按长度分级省略零分量（秒级向上取整为 1m）", () => {
    const now = 0;
    expect(formatResetIn(30_000, now)).toBe("1m");
    expect(formatResetIn(60_000, now)).toBe("1m");
    expect(formatResetIn(45 * 60_000, now)).toBe("45m");
    expect(formatResetIn(2 * 3_600_000, now)).toBe("2h");
    expect(formatResetIn(2 * 3_600_000 + 14 * 60_000, now)).toBe("2h14m");
    expect(formatResetIn(4 * 86_400_000, now)).toBe("4d");
    expect(formatResetIn(4 * 86_400_000 + 6 * 3_600_000, now)).toBe("4d6h");
  });

  test("缺失或已过期时不显示", () => {
    expect(formatResetIn(undefined, 0)).toBeUndefined();
    expect(formatResetIn(-1, 0)).toBeUndefined();
  });
});

