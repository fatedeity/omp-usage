import {
  fetchZhipuUsage,
  PROVIDER_ID,
  USAGE_ENDPOINT,
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
    displayName: "智谱 GLM 编程套餐",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    api: "openai-completions",
    fetchUsage: fetchZhipuUsage,
  },
];

export const PROVIDER_ENDPOINTS: Readonly<Record<string, string>> = {
  [PROVIDER_ID]: USAGE_ENDPOINT,
};

export function findProviderDefinition(
  providerId: string,
): UsageProviderDefinition | undefined {
  return PROVIDER_DEFINITIONS.find(provider => provider.id === providerId);
}
