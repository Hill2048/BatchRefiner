import * as React from "react";
import { Wallet } from "lucide-react";
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

  const accessUntilText = formatAccessUntil(snapshot.accessUntil);
  const title = [
    snapshot.tokenName ? `令牌：${snapshot.tokenName}` : "",
    accessUntilText ? `有效期至：${accessUntilText}` : "",
    `最近更新：${new Date(snapshot.fetchedAt).toLocaleTimeString("zh-CN")}`,
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <span className="flex items-center gap-2" title={title}>
      <Wallet className="w-3.5 h-3.5 text-emerald-600" />
      <span className="font-medium text-text-primary">余额 {formatUsd(snapshot.balanceUsd)}</span>
      <span className="opacity-40">/</span>
      <span>本月 {formatUsd(snapshot.usageUsd)}</span>
    </span>
  );
}
