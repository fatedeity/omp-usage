export const PROVIDER_ID = "zhipu-coding-plan";
export const USAGE_ENDPOINT =
    "https://open.bigmodel.cn/api/monitor/usage/quota/limit";

export type UsageWindow = {
    id: string;
    label: string;
    durationMs?: number;
    resetsAt?: number;
};

export type UsageAmount = {
    used: number;
    limit: number;
    remaining: number;
    usedFraction: number;
    remainingFraction: number;
    unit: "tokens" | "credits" | "requests" | "percent";
};

export type UsageLimit = {
    id: string;
    label: string;
    scope: {
        provider: string;
        windowId: string;
        shared: boolean;
    };
    window: UsageWindow;
    amount: UsageAmount;
    status: "ok" | "exhausted";
};

export type UsageReport = {
    provider: string;
    fetchedAt: number;
    limits: UsageLimit[];
    metadata?: {
        planType?: string;
    };
};

type JsonRecord = Record<string, unknown>;

type ZhipuLimitItem = {
    type?: unknown;
    unit?: unknown;
    number?: unknown;
    usage?: unknown;
    currentValue?: unknown;
    remaining?: unknown;
    percentage?: unknown;
    nextResetTime?: unknown;
};

export type FetchLike = (
    input: RequestInfo | URL,
    init?: RequestInit,
) => Promise<Response>;

function asRecord(value: unknown): JsonRecord | null {
    return value !== null && typeof value === "object"
        ? (value as JsonRecord)
        : null;
}

function finiteNumber(value: unknown): number | undefined {
    if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
    return value;
}

function positiveInteger(value: unknown, fallback: number): number {
    const number = finiteNumber(value);
    if (number === undefined || number <= 0) return fallback;
    return Math.max(1, Math.round(number));
}

function clampFraction(value: number): number {
    return Math.min(1, Math.max(0, value));
}

function normalizePercentage(
    value: unknown,
    allowFraction = false,
): number | undefined {
    const number = finiteNumber(value);
    if (number === undefined) return undefined;
    // 智谱接口文档使用 0..100。只有没有绝对计数时，才兼容 0..1 的小数响应。
    const percentage =
        allowFraction && number >= 0 && number <= 1 ? number * 100 : number;
    return Math.min(100, Math.max(0, percentage));
}

function resolveWindow(item: ZhipuLimitItem): UsageWindow {
    const type = typeof item.type === "string" ? item.type : "LIMIT";
    const unit = finiteNumber(item.unit);
    const number = positiveInteger(item.number, 1);

    // 智谱接口使用 TIME_LIMIT、unit=5、number=1 表示月度 MCP/工具调用额度。
    if (type === "TIME_LIMIT" && unit === 5 && number === 1) {
        return {
            id: "1mo",
            label: "1 month",
            durationMs: 30 * 24 * 60 * 60 * 1000,
            resetsAt: finiteNumber(item.nextResetTime),
        };
    }

    if (unit === 3) {
        return {
            id: `${number}h`,
            label: number === 1 ? "1 hour" : `${number} hours`,
            durationMs: number * 60 * 60 * 1000,
            resetsAt: finiteNumber(item.nextResetTime),
        };
    }

    if (unit === 6) {
        const days = number * 7;
        return {
            id: `${days}d`,
            label: days === 7 ? "7 days" : `${number} week${number === 1 ? "" : "s"}`,
            durationMs: days * 24 * 60 * 60 * 1000,
            resetsAt: finiteNumber(item.nextResetTime),
        };
    }

    if (unit === 1) {
        return {
            id: `${number}d`,
            label: number === 1 ? "1 day" : `${number} days`,
            durationMs: number * 24 * 60 * 60 * 1000,
            resetsAt: finiteNumber(item.nextResetTime),
        };
    }

    if (unit === 5) {
        return {
            id: `${number}m`,
            label: number === 1 ? "1 minute" : `${number} minutes`,
            durationMs: number * 60 * 1000,
            resetsAt: finiteNumber(item.nextResetTime),
        };
    }

    const id = unit === undefined ? `custom-${number}` : `unit-${unit}-${number}`;
    return {
        id,
        label: `Custom window (${id})`,
        resetsAt: finiteNumber(item.nextResetTime),
    };
}

function metricForType(type: unknown): {
    id: "tokens" | "credits" | "requests";
    unit: UsageAmount["unit"];
    label: string;
} {
    if (type === "CREDIT_LIMIT") {
        return { id: "credits", unit: "credits", label: "" };
    }
    if (type === "TIME_LIMIT") {
        return { id: "requests", unit: "requests", label: "tool calls" };
    }
    return { id: "tokens", unit: "tokens", label: "" };
}

function buildAmount(
    item: ZhipuLimitItem,
    metricUnit: UsageAmount["unit"],
): UsageAmount | null {
    const total = finiteNumber(item.usage);
    const current = finiteNumber(item.currentValue);
    const reportedRemaining = finiteNumber(item.remaining);

    const hasAbsoluteValues =
        total !== undefined || current !== undefined || reportedRemaining !== undefined;
    const percentage = normalizePercentage(item.percentage, !hasAbsoluteValues);


    if (!hasAbsoluteValues && percentage === undefined) return null;

    const limit =
        total ??
        (current !== undefined && reportedRemaining !== undefined
            ? current + reportedRemaining
            : 100);
    const used =
        current ??
        (reportedRemaining !== undefined
            ? Math.max(0, limit - reportedRemaining)
            : percentage !== undefined
                ? (limit * percentage) / 100
                : 0);
    const remaining =
        reportedRemaining ?? Math.max(0, limit - used);
    const fraction =
        percentage !== undefined
            ? percentage / 100
            : limit > 0
                ? used / limit
                : 0;
    const usedFraction = clampFraction(fraction);

    return {
        used,
        limit,
        remaining,
        usedFraction,
        remainingFraction: 1 - usedFraction,
        unit: hasAbsoluteValues ? metricUnit : "percent",
    };
}

function buildLimit(
    item: ZhipuLimitItem,
    index: number,
): UsageLimit | null {
    const type = typeof item.type === "string" ? item.type : "TOKENS_LIMIT";
    const metric = metricForType(type);
    const window = resolveWindow(item);
    const amount = buildAmount(item, metric.unit);
    if (!amount) return null;

    const isExhausted = amount.limit > 0 && amount.remaining <= 0;
    const label = metric.label ? `${window.label} ${metric.label}` : window.label;

    return {
        id: `${PROVIDER_ID}:${metric.id}:${window.id}:${index}`,
        label,
        scope: {
            provider: PROVIDER_ID,
            windowId: window.id,
            shared: true,
        },
        window,
        amount,
        status: isExhausted ? "exhausted" : "ok",
    };
}

export function parseZhipuUsage(
    payload: unknown,
    fetchedAt = Date.now(),
): UsageReport | null {
    const root = asRecord(payload);
    const data = asRecord(root?.data);
    const rawLimits = data?.limits;

    if (!Array.isArray(rawLimits)) return null;
    if (root?.success === false) return null;

    const limits = rawLimits
        .map((item, index) => buildLimit(asRecord(item) ?? {}, index))
        .filter((item): item is UsageLimit => item !== null)
        .sort(
            (a, b) =>
                (a.window.durationMs ?? Infinity) - (b.window.durationMs ?? Infinity),
        );
    if (limits.length === 0) return null;

    const planType = typeof data?.level === "string" ? data.level : undefined;
    return {
        provider: PROVIDER_ID,
        fetchedAt,
        limits,
        ...(planType ? { metadata: { planType } } : {}),
    };
}

export async function fetchZhipuUsage(
    apiKey: string | undefined,
    fetcher: FetchLike,
    fetchedAt = Date.now(),
): Promise<UsageReport | null> {
    if (!apiKey) return null;

    try {
        const response = await fetcher(USAGE_ENDPOINT, {
            headers: {
                Authorization: `Bearer ${apiKey}`,
                Accept: "application/json",
            },
        });

        if (!response.ok) return null;
        return parseZhipuUsage(await response.json(), fetchedAt);
    } catch {
        return null;
    }
}
export function formatUsageReport(
    report: UsageReport,
    title = "额度",
): string {
    const plan = report.metadata?.planType ?? "未知";
    const formatNumber = new Intl.NumberFormat("zh-CN");
    const unitLabels: Record<UsageAmount["unit"], string> = {
        tokens: "Token",
        credits: "额度",
        requests: "次",
        percent: "%",
    };
    const lines = [`${title}（${plan}）`];

    for (const limit of report.limits) {
        const amount = limit.amount;
        const used = formatNumber.format(amount.used);
        const total = formatNumber.format(amount.limit);
        const percent = `${(amount.usedFraction * 100).toFixed(1)}%`;
        const reset = limit.window.resetsAt
            ? new Date(limit.window.resetsAt).toLocaleString("zh-CN")
            : "未知";
        lines.push(
            `${limit.label}：${used} / ${total} ${unitLabels[amount.unit]}（已用 ${percent}），重置时间：${reset}`,
        );
    }

    return lines.join("\n");
}
