import {
  fetchZhipuUsage,
  PROVIDER_ID,
  type FetchLike,
  type UsageReport,
} from "./usage.js";

export type UsageProviderDefinition = {
  id: string;
  displayName: string;
  baseUrl: string;
  api: string;
  fetchUsage: (apiKey: string | undefined, fetcher: FetchLike) => Promise<UsageReport | null>;
};

export const PROVIDER_DEFINITIONS: readonly UsageProviderDefinition[] = [
  {
    id: PROVIDER_ID,
    displayName: "Zhipu GLM Coding Plan",
    baseUrl: "https://open.bigmodel.cn/api/coding/paas/v4",
    api: "openai-completions",
    fetchUsage: fetchZhipuUsage,
  },
];
