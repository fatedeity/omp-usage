import { describe, expect, test } from "bun:test";

import { nextBackoffMs } from "../src/index.js";

describe("nextBackoffMs", () => {
  test("60s 起步连续翻倍", () => {
    expect(nextBackoffMs(1)).toBe(60_000);
    expect(nextBackoffMs(2)).toBe(120_000);
    expect(nextBackoffMs(3)).toBe(240_000);
    expect(nextBackoffMs(4)).toBe(480_000);
  });

  test("封顶 30 分钟", () => {
    expect(nextBackoffMs(6)).toBe(1_800_000);
    expect(nextBackoffMs(20)).toBe(1_800_000);
  });
});
