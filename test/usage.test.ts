import { describe, expect, test } from "bun:test";

import {
  fetchZhipuUsage,
  parseBuiltinUsageReports,
  parseZhipuUsage,
  PROVIDER_ID,
  USAGE_ENDPOINT,
} from "../src/usage.js";
import { PROVIDER_DEFINITIONS } from "../src/provider-registry.js";

const fetchedAt = 1_800_000_000_000;

const payload = {
  code: 200,
  msg: "操作成功",
  success: true,
  data: {
    level: "lite",
    limits: [
      {
        type: "TOKENS_LIMIT",
        unit: 3,
        number: 5,
        usage: 500_000,
        currentValue: 120_000,
        remaining: 380_000,
        percentage: 24,
        nextResetTime: fetchedAt + 3_600_000,
      },
      {
        type: "TOKENS_LIMIT",
        unit: 6,
        number: 1,
        usage: 2_000_000,
        currentValue: 400_000,
        remaining: 1_600_000,
        percentage: 20,
        nextResetTime: fetchedAt + 86_400_000,
      },
      {
        type: "TIME_LIMIT",
        unit: 5,
        number: 1,
        usage: 100,
        currentValue: 28,
        remaining: 72,
        percentage: 28,
        nextResetTime: fetchedAt + 10_000_000,
      },
    ],
  },
};
describe("provider 注册表", () => {
  test("包含智谱 provider", () => {
    expect(PROVIDER_DEFINITIONS.map(provider => provider.id)).toContain(
      PROVIDER_ID,
    );
  });
});

describe("parseZhipuUsage", () => {
  test("映射 5 小时、7 天和月度工具调用额度", () => {
    const report = parseZhipuUsage(payload, fetchedAt);

    expect(report).not.toBeNull();
    expect(report?.provider).toBe(PROVIDER_ID);
    expect(report?.fetchedAt).toBe(fetchedAt);
    // omp usage 面板据此显示 `plan: lite`，不是扩展内部使用，删了会掉面板信息。
    expect(report?.metadata).toEqual({ planType: "lite" });
    expect(report?.limits).toHaveLength(3);

    const fiveHour = report?.limits[0];
    expect(fiveHour?.window.id).toBe("5h");
    expect(fiveHour?.amount).toMatchObject({
      used: 120_000,
      limit: 500_000,
      remaining: 380_000,
      usedFraction: 0.24,
      unit: "tokens",
    });
    expect(fiveHour?.window.resetsAt).toBe(fetchedAt + 3_600_000);

    const weekly = report?.limits[1];
    expect(weekly?.window).toMatchObject({ id: "7d", label: "7 days" });

    const monthlyTools = report?.limits[2];
    expect(monthlyTools?.label).toBe("1 month tool calls");
    expect(monthlyTools?.amount.unit).toBe("requests");
  });
  test("按窗口时长升序输出额度（5 小时在前）", () => {
    const report = parseZhipuUsage(
      {
        ...payload,
        data: {
          ...payload.data,
          limits: [payload.data.limits[1], payload.data.limits[0], payload.data.limits[2]],
        },
      },
      fetchedAt,
    );

    expect(report?.limits.map(limit => limit.window.id)).toEqual(["5h", "7d", "1mo"]);
    expect(report?.limits.map(limit => limit.label)).toEqual([
      "5 hours",
      "7 days",
      "1 month tool calls",
    ]);
  });
  test("将智谱接口的 1 表示为 1% 而不是 100%", () => {
    const report = parseZhipuUsage(
      {
        success: true,
        data: {
          limits: [
            {
              type: "CREDIT_LIMIT",
              unit: 3,
              number: 5,
              usage: 2_000,
              currentValue: 0,
              remaining: 1_999,
              percentage: 1,
            },
          ],
        },
      },
      fetchedAt,
    );

    expect(report?.limits[0]?.amount).toMatchObject({
      used: 0,
      limit: 2_000,
      remaining: 1_999,
      usedFraction: 0.01,
    });
  });

  test("绝对计数缺失时回退到百分比额度", () => {
    const report = parseZhipuUsage(
      {
        success: true,
        data: {
          limits: [
            {
              type: "CREDIT_LIMIT",
              unit: 3,
              number: 5,
              percentage: 0.25,
            },
          ],
        },
      },
      fetchedAt,
    );

    expect(report?.limits[0]?.amount).toMatchObject({
      used: 25,
      limit: 100,
      remaining: 75,
      usedFraction: 0.25,
      unit: "percent",
    });
  });

  test("拒绝失败响应和空额度响应", () => {
    expect(parseZhipuUsage({ success: false, data: { limits: [] } })).toBeNull();
    expect(parseZhipuUsage({ success: true, data: { limits: [] } })).toBeNull();
    expect(parseZhipuUsage({ success: true })).toBeNull();
  });
});

describe("fetchZhipuUsage", () => {
  test("向智谱接口发送 Bearer 凭据", async () => {
    let request: { input: RequestInfo | URL; init?: RequestInit } | undefined;
    const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
      request = { input, init };
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    const report = await fetchZhipuUsage("secret-key", fetcher, fetchedAt);
    const headers = new Headers(request?.init?.headers);

    expect(request?.input).toBe(USAGE_ENDPOINT);
    expect(headers.get("authorization")).toBe("Bearer secret-key");
    expect(headers.get("accept")).toBe("application/json");
    expect(report?.limits).toHaveLength(3);
  });

  test("HTTP 或网络失败时返回空结果", async () => {
    const failedFetcher = async () =>
      new Response("网关错误", { status: 502 });
    const throwingFetcher = async () => {
      throw new Error("网络不可用");
    };

    expect(await fetchZhipuUsage("secret-key", failedFetcher, fetchedAt)).toBeNull();
    expect(await fetchZhipuUsage("secret-key", throwingFetcher, fetchedAt)).toBeNull();
    expect(await fetchZhipuUsage(undefined, throwingFetcher, fetchedAt)).toBeNull();
  });
});

describe("parseBuiltinUsageReports", () => {
  const builtinPayload = {
    generatedAt: fetchedAt,
    reports: [
      {
        provider: "openai-codex",
        fetchedAt,
        limits: [
          {
            id: "openai-codex:chat:5h:0",
            label: "5 hours",
            scope: { provider: "openai-codex", windowId: "5h", shared: true },
            window: {
              id: "5h",
              label: "5 hours",
              durationMs: 5 * 3_600_000,
              resetsAt: fetchedAt + 3_600_000,
            },
            amount: {
              used: 24,
              limit: 100,
              remaining: 76,
              usedFraction: 0.24,
              remainingFraction: 0.76,
              unit: "percent",
            },
            status: "ok",
          },
        ],
        resetCredits: {
          availableCount: 2,
          credits: [
            { expiresAt: "2026-10-22T20:42:53.777517Z" },
            { expiresAt: "2026-10-29T18:01:32.176209Z" },
          ],
        },
        metadata: {
          planType: "plus",
          email: "dev@example.com",
          accountId: "acc-123",
          orgId: "org-456",
        },
      },
    ],
    accountsWithoutUsage: [],
    disabledCredentials: [],
    capacity: {},
  };

  test("解析内置账号报告并保留重置卡信息", () => {
    const reports = parseBuiltinUsageReports(builtinPayload);

    expect(reports).toHaveLength(1);
    expect(reports[0]?.provider).toBe("openai-codex");
    expect(reports[0]?.limits).toHaveLength(1);
    expect(reports[0]?.resetCredits).toEqual({
      availableCount: 2,
      credits: [
        { expiresAt: "2026-10-22T20:42:53.777517Z" },
        { expiresAt: "2026-10-29T18:01:32.176209Z" },
      ],
    });
  });

  test("不把内置报告的账号与套餐字段带入结果", () => {
    const reports = parseBuiltinUsageReports(builtinPayload);

    expect(reports[0]).not.toHaveProperty("metadata");
  });
  test("percent 窗口缺 limit/remaining 时按百分制补全", () => {
    // alibaba-token-plan 内置报告的真实形状：只有 used/usedFraction/unit。
    const reports = parseBuiltinUsageReports({
      reports: [
        {
          provider: "alibaba-token-plan",
          fetchedAt,
          limits: [
            {
              id: "credits:monthly",
              label: "Monthly Credits",
              scope: {
                provider: "alibaba-token-plan",
                windowId: "monthly",
              },
              window: {
                id: "monthly",
                label: "Monthly Credits",
                resetsAt: fetchedAt + 31 * 86_400_000,
              },
              amount: {
                used: 0.22906502222222225,
                usedFraction: 0.0022906502222222224,
                unit: "percent",
              },
              status: "ok",
            },
          ],
          metadata: { source: "bailian-console" },
        },
      ],
    });

    expect(reports).toHaveLength(1);
    expect(reports[0]?.limits[0]?.amount).toEqual({
      used: 0.22906502222222225,
      limit: 100,
      remaining: 99.77093497777778,
      usedFraction: 0.0022906502222222224,
      remainingFraction: 0.9977093497777778,
      unit: "percent",
    });
  });

  test("拒绝畸形载荷与不可用条目", () => {
    expect(parseBuiltinUsageReports(null)).toEqual([]);
    expect(parseBuiltinUsageReports({})).toEqual([]);
    expect(parseBuiltinUsageReports({ reports: "nope" })).toEqual([]);
    expect(
      parseBuiltinUsageReports({ reports: [{ provider: "x" }] }),
    ).toEqual([]);
    expect(
      parseBuiltinUsageReports({
        reports: [{ provider: "x", limits: [{ label: "bad", amount: {} }] }],
      }),
    ).toEqual([]);
    expect(
      parseBuiltinUsageReports({ reports: [{ provider: "x", limits: [] }] }),
    ).toEqual([]);
  });
});
