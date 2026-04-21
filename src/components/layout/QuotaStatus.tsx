import * as React from "react";
import { useAppStore } from "@/store";
import { fetchYunwuQuota, type YunwuQuotaSnapshot } from "@/lib/yunwuQuota";

function formatUsd(value: number) {
  return `$${value.toFixed(value >= 100 ? 0 : 2)}`;
}

function formatAccessUntil(value?: string | number) {
  if (!value) return "";
  const date = typeof value === "number" ? new Date(value * 1000) : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("zh-CN");
}

export function QuotaStatus() {
  const apiKey = useAppStore((state) => state.apiKey);
  const platformPreset = useAppStore((state) => state.platformPreset);
  const [snapshot, setSnapshot] = React.useState<YunwuQuotaSnapshot | null>(null);
  const [status, setStatus] = React.useState<"idle" | "loading" | "success" | "error">("idle");

  React.useEffect(() => {
    if (platformPreset !== "yunwu" || !apiKey.trim()) {
      setSnapshot(null);
      setStatus("idle");
      return;
    }

    const controller = new AbortController();

    const load = async () => {
      try {
        setStatus((current) => (snapshot ? current : "loading"));
        const nextSnapshot = await fetchYunwuQuota(apiKey, controller.signal);
        setSnapshot(nextSnapshot);
        setStatus("success");
      } catch (error: any) {
        if (controller.signal.aborted) return;
        setStatus("error");
        setSnapshot(null);
        console.error("Failed to fetch yunwu quota", error);
      }
    };

    load();
    const intervalId = window.setInterval(load, 5 * 60 * 1000);

    return () => {
      controller.abort();
      window.clearInterval(intervalId);
    };
  }, [apiKey, platformPreset]);

  if (platformPreset !== "yunwu" || !apiKey.trim()) return null;

  if (status === "loading" && !snapshot) {
    return <span className="opacity-70">额度查询中...</span>;
  }

  if (!snapshot) {
    return <span className="text-amber-700">额度不可用</span>;
  }

  const totalQuota = Math.max(snapshot.balanceUsd + snapshot.usageUsd, 0);
  const remainingRatio = totalQuota > 0 ? Math.min(snapshot.balanceUsd / totalQuota, 1) : 0;
  const ringLength = 43.98;
  const accessUntilText = formatAccessUntil(snapshot.accessUntil);
  const title = [
    snapshot.tokenName ? `令牌：${snapshot.tokenName}` : "",
    accessUntilText ? `有效期至：${accessUntilText}` : "",
    `已使用：${formatUsd(snapshot.usageUsd)}`,
    `最近更新：${new Date(snapshot.fetchedAt).toLocaleTimeString("zh-CN")}`,
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <span className="flex items-center gap-2.5" title={title}>
      <span className="relative flex h-5 w-5 items-center justify-center">
        <svg viewBox="0 0 20 20" className="h-5 w-5 -rotate-90">
          <circle cx="10" cy="10" r="7" fill="none" stroke="rgba(15, 23, 42, 0.10)" strokeWidth="2" />
          <circle
            cx="10"
            cy="10"
            r="7"
            fill="none"
            stroke="#E07A53"
            strokeWidth="2"
            strokeLinecap="round"
            strokeDasharray={ringLength}
            strokeDashoffset={ringLength * (1 - remainingRatio)}
          />
        </svg>
      </span>
      <span className="font-medium text-text-primary">{formatUsd(snapshot.balanceUsd)}</span>
    </span>
  );
}
