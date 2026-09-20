import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

import {
    fetchZhipuUsage,
    formatUsageReport,
    PROVIDER_ID,
    USAGE_ENDPOINT,
} from "./usage.js";

async function readConfiguredApiKey(
    pi: ExtensionAPI,
): Promise<string | undefined> {
    const result = await pi.exec("omp", ["token", PROVIDER_ID, "--raw"], {
        timeout: 10_000,
    });
    if (result.code !== 0) return undefined;
    const apiKey = result.stdout.trim();
    return apiKey || undefined;
}

export default function registerZhipuUsage(pi: ExtensionAPI): void {
    pi.registerProvider(PROVIDER_ID, {
        baseUrl: "https://open.bigmodel.cn/api/paas/v4",
        api: "openai-completions",
        usage: {
            id: PROVIDER_ID,
            async fetchUsage(params, { fetch }) {
                return fetchZhipuUsage(params.credential.apiKey, fetch);
            },
        },
    });

    pi.registerCommand("glm-usage", {
        description: "显示 GLM 编程套餐额度",
        handler: async (_args, ctx) => {
            const apiKey = await readConfiguredApiKey(pi);
            const report = await fetchZhipuUsage(apiKey, fetch);

            if (!report) {
                ctx.ui.notify(
                    "无法读取 GLM 编程套餐额度，请检查 zhipu-coding-plan 凭据和网络连接。",
                    "error",
                );
                return;
            }

            ctx.ui.notify(formatUsageReport(report), "info");
        },
    });

    pi.logger?.debug?.(
        `[omp-usage-zhipu-coding-plan] usage endpoint: ${USAGE_ENDPOINT}`,
    );
}
