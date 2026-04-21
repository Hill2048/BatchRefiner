import { PlatformPreset } from "@/types";

const YUNWU_QUOTA_API_BASE = "https://api.apiplus.org";

export type PlatformQuotaSnapshot =
  | {
      platform: "yunwu";
      balanceUsd: number;
      usageUsd: number;
      accessUntil?: string | number;
      tokenName?: string;
      fetchedAt: number;
    }
  | {
      platform: "comfly-chat";
      quota: number;
      accountId?: number;
      accountName?: string;
      fetchedAt: number;
    };

function buildMonthRange() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);

  const format = (date: Date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  return {
    startDate: format(start),
    endDate: format(end),
  };
}

async function parseJsonSafe(response: Response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export async function fetchYunwuQuota(apiKey: string, signal?: AbortSignal): Promise<PlatformQuotaSnapshot> {
  const trimmedApiKey = apiKey.trim();
  if (!trimmedApiKey) {
    throw new Error("缺少 API Key");
  }

  const { startDate, endDate } = buildMonthRange();
  const headers = {
    Authorization: `Bearer ${trimmedApiKey}`,
  };

  const [subscriptionResponse, usageResponse] = await Promise.all([
    fetch(`${YUNWU_QUOTA_API_BASE}/v1/dashboard/billing/subscription`, { headers, signal }),
    fetch(`${YUNWU_QUOTA_API_BASE}/v1/dashboard/billing/usage?start_date=${startDate}&end_date=${endDate}`, { headers, signal }),
  ]);

  const [subscriptionData, usageData] = await Promise.all([
    parseJsonSafe(subscriptionResponse),
    parseJsonSafe(usageResponse),
  ]);

  if (!subscriptionResponse.ok) {
    throw new Error(subscriptionData?.error?.message || "额度查询失败");
  }

  if (!usageResponse.ok) {
    throw new Error(usageData?.error?.message || "用量查询失败");
  }

  return {
    platform: "yunwu",
    balanceUsd: Number(subscriptionData?.hard_limit_usd || 0),
    usageUsd: Number(usageData?.total_usage || 0) / 100,
    accessUntil: subscriptionData?.access_until,
    tokenName: subscriptionData?.token_name,
    fetchedAt: Date.now(),
  };
}

export async function fetchComflyQuota(apiBaseUrl: string, apiKey: string, signal?: AbortSignal): Promise<PlatformQuotaSnapshot> {
  const trimmedApiKey = apiKey.trim();
  if (!trimmedApiKey) {
    throw new Error("缺少 API Key");
  }

  let baseUrl = apiBaseUrl.trim().replace(/\/+$/, "");
  if (!baseUrl) {
    baseUrl = "https://ai.comfly.chat";
  }
  if (!baseUrl.endsWith("/v1") && !baseUrl.includes("/v1/")) {
    baseUrl += "/v1";
  }

  const response = await fetch(`${baseUrl}/token/quota`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${trimmedApiKey}`,
    },
    signal,
  });

  const data = await parseJsonSafe(response);
  if (!response.ok) {
    throw new Error(data?.error?.message || data?.message || "额度查询失败");
  }

  return {
    platform: "comfly-chat",
    quota: Number(data?.quota || 0),
    accountId: typeof data?.id === "number" ? data.id : undefined,
    accountName: typeof data?.name === "string" ? data.name : undefined,
    fetchedAt: Date.now(),
  };
}

export async function fetchPlatformQuota(
  platformPreset: PlatformPreset,
  apiBaseUrl: string,
  apiKey: string,
  signal?: AbortSignal
): Promise<PlatformQuotaSnapshot> {
  if (platformPreset === "yunwu") {
    return fetchYunwuQuota(apiKey, signal);
  }

  if (platformPreset === "comfly-chat") {
    return fetchComflyQuota(apiBaseUrl, apiKey, signal);
  }

  throw new Error("当前平台暂不支持额度查询");
}
