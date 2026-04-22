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
      source?: "user-self" | "token-quota";
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

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const normalized = Number(value);
    return Number.isFinite(normalized) ? normalized : null;
  }
  return null;
}

function pickNumber(input: any, keys: string[]) {
  for (const key of keys) {
    const value = toNumber(input?.[key]);
    if (value != null) return value;
  }
  return null;
}

function pickString(input: any, keys: string[]) {
  for (const key of keys) {
    const value = input?.[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function extractComflyAccountId(payload: any): number | undefined {
  const scoped = payload?.data ?? payload?.user ?? payload;
  return (
    pickNumber(scoped, ["id", "user_id", "uid"]) ??
    pickNumber(payload, ["id", "user_id", "uid"]) ??
    undefined
  ) as number | undefined;
}

function extractComflyAccountName(payload: any): string | undefined {
  const scoped = payload?.data ?? payload?.user ?? payload;
  return (
    pickString(scoped, ["name", "username", "nickname", "display_name"]) ??
    pickString(payload, ["name", "username", "nickname", "display_name"])
  );
}

function extractComflyQuota(payload: any): number {
  const scoped = payload?.data ?? payload?.user ?? payload;
  return (
    pickNumber(scoped, [
      "quota",
      "balance",
      "remain_quota",
      "remaining_quota",
      "available_balance",
      "available_quota",
      "quota_balance",
      "credit",
      "credits",
    ]) ??
    0
  );
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

  let rawBaseUrl = apiBaseUrl.trim().replace(/\/+$/, "");
  if (!rawBaseUrl) {
    rawBaseUrl = "https://ai.comfly.chat";
  }

  const rootBaseUrl = rawBaseUrl.replace(/\/v1(?:\/.*)?$/i, "");
  let v1BaseUrl = rawBaseUrl;
  if (!v1BaseUrl.endsWith("/v1") && !v1BaseUrl.includes("/v1/")) {
    v1BaseUrl += "/v1";
  }

  const quotaResponse = await fetch(`${v1BaseUrl}/token/quota`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${trimmedApiKey}`,
    },
    signal,
  });

  const quotaData = await parseJsonSafe(quotaResponse);
  if (!quotaResponse.ok) {
    throw new Error(quotaData?.error?.message || quotaData?.message || "额度查询失败");
  }

  const accountId = extractComflyAccountId(quotaData);
  const accountName = extractComflyAccountName(quotaData);
  const fallbackQuota = extractComflyQuota(quotaData);

  if (accountId != null) {
    const selfResponse = await fetch(`${rootBaseUrl}/api/user/self`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${trimmedApiKey}`,
        "New-API-User": String(accountId),
      },
      signal,
    });

    const selfData = await parseJsonSafe(selfResponse);
    if (selfResponse.ok) {
      return {
        platform: "comfly-chat",
        quota: extractComflyQuota(selfData),
        accountId,
        accountName: extractComflyAccountName(selfData) || accountName,
        source: "user-self",
        fetchedAt: Date.now(),
      };
    }
  }

  return {
    platform: "comfly-chat",
    quota: fallbackQuota,
    accountId,
    accountName,
    source: "token-quota",
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
