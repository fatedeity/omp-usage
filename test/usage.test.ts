import { describe, expect, test } from "bun:test";

import {
  fetchZhipuUsage,
  formatUsageReport,
  parseZhipuUsage,
  PROVIDER_ID,
  USAGE_ENDPOINT,
} from "../src/usage";

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

describe("parseZhipuUsage", () => {
  test("映射 5 小时、7 天和月度工具调用额度", () => {
    const report = parseZhipuUsage(payload, fetchedAt);

    expect(report).not.toBeNull();
    expect(report?.provider).toBe(PROVIDER_ID);
    expect(report?.fetchedAt).toBe(fetchedAt);
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
    expect(weekly?.window).toMatchObject({ id: "7d", label: "7 天" });

    const monthlyTools = report?.limits[2];
    expect(monthlyTools?.label).toBe("1 个月 工具调用");
    expect(monthlyTools?.amount.unit).toBe("requests");
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

describe("formatUsageReport", () => {
  test("格式化套餐、用量、百分比和重置时间", () => {
    const report = parseZhipuUsage(payload, fetchedAt);
    expect(report).not.toBeNull();

    const formatted = formatUsageReport(report!);
    expect(formatted).toContain("GLM 编程套餐（lite）");
    expect(formatted).toContain(
      "5 小时 Token：120,000 / 500,000 Token（已用 24.0%）",
    );
    expect(formatted).toContain(
      `重置时间：${new Date(fetchedAt + 3_600_000).toLocaleString("zh-CN")}`,
    );
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
