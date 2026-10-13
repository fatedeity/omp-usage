import { describe, expect, test } from "bun:test";

import { readBuiltinUsageReport, sourceKey } from "../src/index.js";

function fakePi(stdout: string, code = 0) {
  return {
    exec: async () => ({ code, stdout }),
  } as never;
}

function reportJson(provider: string): string {
  return JSON.stringify({
    reports: [
      {
        provider,
        fetchedAt: 1,
        limits: [
          {
            label: "5 hours",
            window: { id: "5h", label: "5 hours", durationMs: 18_000_000 },
            amount: {
              used: 10,
              limit: 100,
              usedFraction: 0.1,
              unit: "percent",
            },
          },
        ],
      },
    ],
  });
}

describe("sourceKey", () => {
  test("三个数据源各自的 provider 分流", () => {
    expect(sourceKey("zhipu-coding-plan")).toBe("zhipu-coding-plan");
    expect(sourceKey("alibaba-token-plan")).toBe("alibaba-token-plan");
    expect(sourceKey("openai")).toBe("openai");
    expect(sourceKey("openai-codex")).toBe("openai");
  });

  test("无数据源的 provider 不分流", () => {
    expect(sourceKey("anthropic")).toBeUndefined();
    expect(sourceKey(undefined)).toBeUndefined();
  });
});

describe("readBuiltinUsageReport", () => {
  test("同名报告优先精确匹配", async () => {
    const payload = JSON.stringify({
      reports: [
        JSON.parse(reportJson("openai-codex")).reports[0],
        JSON.parse(reportJson("alibaba-token-plan")).reports[0],
      ],
    });
    const report = await readBuiltinUsageReport(
      fakePi(payload),
      "alibaba-token-plan",
    );
    expect(report?.provider).toBe("alibaba-token-plan");
  });

  test("openai 前缀匹配到 openai-codex 报告", async () => {
    const report = await readBuiltinUsageReport(
      fakePi(reportJson("openai-codex")),
      "openai",
    );
    expect(report?.provider).toBe("openai-codex");
  });

  test("目标 provider 无报告时不兜底返回别人的额度", async () => {
    const report = await readBuiltinUsageReport(
      fakePi(reportJson("openai-codex")),
      "alibaba-token-plan",
    );
    expect(report).toBeUndefined();
  });

  test("omp usage 失败或载荷非法时返回 undefined", async () => {
    expect(
      await readBuiltinUsageReport(fakePi("boom", 1), "alibaba-token-plan"),
    ).toBeUndefined();
    expect(
      await readBuiltinUsageReport(fakePi("not json"), "alibaba-token-plan"),
    ).toBeUndefined();
  });
});
