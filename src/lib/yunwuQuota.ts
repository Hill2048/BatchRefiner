const YUNWU_QUOTA_API_BASE = "https://api.apiplus.org";

export interface YunwuQuotaSnapshot {
  balanceUsd: number;
  usageUsd: number;
  accessUntil?: string | number;
  tokenName?: string;
  fetchedAt: number;
}

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

export async function fetchYunwuQuota(apiKey: string, signal?: AbortSignal): Promise<YunwuQuotaSnapshot> {
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
    balanceUsd: Number(subscriptionData?.hard_limit_usd || 0),
    usageUsd: Number(usageData?.total_usage || 0) / 100,
    accessUntil: subscriptionData?.access_until,
    tokenName: subscriptionData?.token_name,
    fetchedAt: Date.now(),
  };
}
