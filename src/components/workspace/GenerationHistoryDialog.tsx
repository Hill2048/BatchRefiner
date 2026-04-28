import * as React from "react";
import { createPortal } from "react-dom";
import { Download, Image as ImageIcon, X } from "lucide-react";
import { toast } from "sonner";
import { useAppStore } from "@/store";
import { Task, TaskResultImage } from "@/types";
import { buildResultImageFileName } from "@/lib/resultImageFileName";
import { getResultImageAssetDimensions, getResultImageAssetExtension, getResultImageDownloadSourceType } from "@/lib/resultImageAsset";
import { getResultDownloadDiagnostics, resolveResultImageDownloadBlob, ResultImageDownloadError } from "@/lib/resultImageDownload";
import { getStoredImageAsset } from "@/lib/imageAssetStore";

type GenerationHistoryDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

type HistoryGroup = {
  key: string;
  task: Task;
  sessionId: string;
  images: TaskResultImage[];
  createdAt: number;
};

function formatHistorySessionTime(timestamp?: number) {
  if (!timestamp) return "较早批次";
  const date = new Date(timestamp);
  return `${date.getMonth() + 1}-${date.getDate()} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function getResultPreviewSrc(result?: TaskResultImage | null) {
  return result?.previewSrc || result?.src || result?.assetSrc || result?.originalSrc;
}

function getResultFullSrc(result?: TaskResultImage | null) {
  return result?.originalSrc || result?.assetSrc || result?.src || result?.previewSrc;
}

function getDownloadableResultImage(result: TaskResultImage): TaskResultImage {
  const fullSrc = getResultFullSrc(result);
  if (!fullSrc || fullSrc === result.src) return result;
  return {
    ...result,
    src: fullSrc,
    downloadSourceType: fullSrc.startsWith("data:") ? "data_url" : "src",
  };
}

function triggerDirectDownload(blob: Blob, fileName: string) {
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = fileName;
  link.rel = "noopener";
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

function preventNativeImageDrag(event: React.DragEvent<HTMLImageElement>) {
  event.preventDefault();
}

function buildHistoryGroups(tasks: Task[]) {
  const groups: HistoryGroup[] = [];

  tasks.forEach((task) => {
    const sessionMap = new Map<string, TaskResultImage[]>();
    (task.resultImages || []).forEach((image) => {
      const sessionId = image.sessionId || `legacy-${image.id}`;
      const existing = sessionMap.get(sessionId) || [];
      existing.push(image);
      sessionMap.set(sessionId, existing);
    });

    sessionMap.forEach((images, sessionId) => {
      const sortedImages = [...images].sort((left, right) => (left.createdAt || 0) - (right.createdAt || 0));
      groups.push({
        key: `${task.id}-${sessionId}`,
        task,
        sessionId,
        images: sortedImages,
        createdAt: Math.max(...sortedImages.map((image) => image.createdAt || 0), 0),
      });
    });
  });

  return groups.sort((left, right) => right.createdAt - left.createdAt);
}

export function GenerationHistoryDialog({ open, onOpenChange }: GenerationHistoryDialogProps) {
  const tasks = useAppStore((state) => state.tasks);
  const updateTask = useAppStore((state) => state.updateTask);
  const exportTemplate = useAppStore((state) => state.exportTemplate);
  const imageModel = useAppStore((state) => state.imageModel);
  const groups = React.useMemo(() => buildHistoryGroups(tasks), [tasks]);
  const totalImageCount = React.useMemo(
    () => groups.reduce((sum, group) => sum + group.images.length, 0),
    [groups],
  );
  const [previewImage, setPreviewImage] = React.useState<{
    task: Task;
    result: TaskResultImage;
    src: string;
    fileName: string;
  } | null>(null);
  const [previewAssetSrc, setPreviewAssetSrc] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (previewImage) {
          setPreviewImage(null);
          return;
        }
        onOpenChange(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onOpenChange, open, previewImage]);

  React.useEffect(() => {
    if (!open) {
      setPreviewImage(null);
    }
  }, [open]);

  React.useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;

    setPreviewAssetSrc(null);
    const assetId = previewImage?.result.assetId;
    if (!assetId) return undefined;

    getStoredImageAsset(assetId).then((asset) => {
      if (cancelled || !asset?.blob) return;
      objectUrl = URL.createObjectURL(asset.blob);
      setPreviewAssetSrc(objectUrl);
    });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [previewImage?.result.assetId, previewImage?.result.id]);

  const downloadResultImage = React.useCallback(async (task: Task, result: TaskResultImage, fileName: string) => {
    const downloadableResult = getDownloadableResultImage(result);
    try {
      const { blob, cacheStatus, status } = await resolveResultImageDownloadBlob(downloadableResult);
      try {
        const { saveAs } = await import("file-saver");
        saveAs(blob, fileName);
      } catch {
        triggerDirectDownload(blob, fileName);
      }

      if (cacheStatus !== result.downloadCacheStatus || status !== result.downloadStatus) {
        updateTask(task.id, {
          resultImages: (task.resultImages || []).map((image) =>
            image.id === result.id
              ? {
                  ...image,
                  downloadCacheStatus: cacheStatus === "miss" ? "primed" : cacheStatus,
                  downloadStatus: status,
                  downloadFailureStage: status === "cache_failed" ? "cache" : undefined,
                  downloadFailureReason: status === "cache_failed" ? "结果图缓存写入失败，但本次下载已完成" : undefined,
                }
              : image,
          ),
        });
      }
    } catch (error) {
      const failure = error instanceof ResultImageDownloadError
        ? error
        : new ResultImageDownloadError({
            message: error instanceof Error ? error.message : "下载失败",
            stage: "save",
            status: "save_failed",
            sourceType: getResultImageDownloadSourceType(downloadableResult),
            cacheStatus: result.downloadCacheStatus || "failed",
          });
      updateTask(task.id, {
        resultImages: (task.resultImages || []).map((image) =>
          image.id === result.id
            ? {
                ...image,
                downloadStatus: failure.status,
                downloadFailureStage: failure.stage,
                downloadFailureReason: failure.message,
                downloadCacheStatus: failure.cacheStatus,
              }
            : image,
        ),
      });
      toast.error(`下载失败：${failure.message}｜${getResultDownloadDiagnostics(result, failure)}`);
    }
  }, [updateTask]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[998] bg-[rgba(20,19,17,0.74)] backdrop-blur-sm animate-in fade-in duration-200">
      <div className="flex h-full w-full items-center justify-center p-3 md:p-4">
        <div className="relative flex h-full max-h-[920px] min-h-0 w-full max-w-[1120px] flex-col overflow-hidden rounded-[28px] border border-white/12 bg-[rgba(248,247,243,0.96)] shadow-[0_20px_80px_rgba(0,0,0,0.28)]">
          <div className="flex items-center justify-between gap-4 border-b border-black/8 px-5 py-4 md:px-6">
            <div className="min-w-0">
              <div className="truncate font-serif text-[18.9px] tracking-tight text-[#24221F]">历史生图</div>
              <div className="mt-1 text-[11.55px] text-black/50">
                共 {totalImageCount} 张，按任务和批次汇总，下载时优先读取本地缓存原图
              </div>
            </div>
            <button
              type="button"
              className="flex h-10 w-10 items-center justify-center rounded-full border border-black/10 bg-white/70 text-black/60 transition-colors hover:bg-white hover:text-black"
              onClick={() => onOpenChange(false)}
              title="关闭"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 custom-scrollbar md:px-6">
            {groups.length > 0 ? (
              <div className="space-y-4">
                {groups.map((group) => (
                  <div key={group.key} className="rounded-[22px] border border-black/8 bg-white/76 p-3 shadow-sm">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-[12.6px] font-medium text-black/76">
                          #{group.task.index.toString().padStart(3, "0")} {group.task.title}
                        </div>
                        <div className="mt-0.5 text-[10.5px] text-black/42">
                          {formatHistorySessionTime(group.createdAt)} / {group.images.length} 张
                        </div>
                      </div>
                      {group.sessionId === group.task.activeResultSessionId ? (
                        <span className="rounded-full bg-[#F7E9DD] px-2.5 py-1 text-[10.5px] font-medium text-[#A65F35]">
                          当前批次
                        </span>
                      ) : null}
                    </div>

                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                      {group.images.map((image, index) => {
                        const previewSrc = getResultPreviewSrc(image) || "";
                        const dimensions = getResultImageAssetDimensions(image);
                        const fileName = buildResultImageFileName({
                          task: group.task,
                          imageIndex: index,
                          extension: getResultImageAssetExtension(image),
                          result: image,
                          template: exportTemplate,
                          model: group.task.imageModelOverride || imageModel,
                        });

                        return (
                          <div key={image.id} className="group/history-card overflow-hidden rounded-[18px] border border-black/8 bg-[#FBFAF7]">
                            <button
                              type="button"
                              className="block aspect-[4/3] w-full overflow-hidden bg-[#F2EFE8]"
                              onClick={() => setPreviewImage({ task: group.task, result: image, src: previewSrc, fileName })}
                              title="查看历史生图"
                            >
                              {previewSrc ? (
                                <img
                                  src={previewSrc}
                                  alt={`历史生图 ${index + 1}`}
                                  loading="lazy"
                                  decoding="async"
                                  className="h-full w-full object-contain transition-transform duration-200 group-hover/history-card:scale-[1.02]"
                                  draggable={false}
                                  onDragStart={preventNativeImageDrag}
                                />
                              ) : (
                                <div className="flex h-full w-full items-center justify-center text-black/28">
                                  <ImageIcon className="h-6 w-6" />
                                </div>
                              )}
                            </button>
                            <div className="flex items-center justify-between gap-2 px-2.5 py-2">
                              <div className="min-w-0 text-[10.5px] text-black/48">
                                <div className="truncate">#{index + 1}</div>
                                {dimensions ? (
                                  <div className="font-mono">{dimensions.width}×{dimensions.height}</div>
                                ) : (
                                  <div>缓存图</div>
                                )}
                              </div>
                              <button
                                type="button"
                                className="inline-flex h-7 items-center gap-1 rounded-full bg-black px-2.5 text-[10.5px] font-medium text-white transition-colors hover:bg-[#2C2B29]"
                                onClick={() => void downloadResultImage(group.task, image, fileName)}
                                title="从缓存下载原图"
                              >
                                <Download className="h-3 w-3" />
                                下载
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex h-full items-center justify-center text-[13px] text-black/42">
                暂无历史生图
              </div>
            )}
          </div>

          <div className="flex items-center justify-between border-t border-black/8 px-5 py-3 text-[11.55px] text-black/42 md:px-6">
            <span>点击缩略图查看，下载会优先读取本地缓存原图</span>
            <span>ESC 关闭</span>
          </div>
        </div>
      </div>

      {previewImage ? (
        <div className="fixed inset-0 z-[999] bg-[rgba(20,19,17,0.78)] backdrop-blur-sm animate-in fade-in duration-200">
          <div className="flex h-full w-full items-center justify-center p-3 md:p-4">
            <div className="relative flex h-full max-h-[960px] min-h-0 w-full max-w-[1440px] flex-col overflow-hidden rounded-[28px] border border-white/12 bg-[rgba(24,23,21,0.82)] shadow-[0_20px_80px_rgba(0,0,0,0.28)]">
              <div className="flex items-center justify-between gap-4 border-b border-white/8 px-5 py-4 md:px-6">
                <div className="min-w-0">
                  <div className="truncate font-serif text-[18.9px] tracking-tight text-[#F2EFEB]">历史生图预览</div>
                  <div className="mt-1 text-[11.55px] text-white/55">{previewImage.task.title}</div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/6 text-white/70 transition-colors hover:bg-white/10 hover:text-white"
                    onClick={() => void downloadResultImage(previewImage.task, previewImage.result, previewImage.fileName)}
                    title="下载图片"
                  >
                    <Download className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/6 text-white/70 transition-colors hover:bg-white/10 hover:text-white"
                    onClick={() => setPreviewImage(null)}
                    title="关闭预览"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className="flex min-h-0 flex-1 items-center justify-center px-3 py-3 md:px-4 md:py-4">
                <div className="relative flex min-h-0 h-full w-full items-center justify-center overflow-hidden rounded-[24px] border border-white/8 bg-transparent">
                  <img
                    src={previewAssetSrc || previewImage.src}
                    alt="历史生图预览"
                    className="max-h-full max-w-full select-none object-contain"
                    draggable={false}
                    onDragStart={preventNativeImageDrag}
                  />
                </div>
              </div>

              <div className="flex items-center justify-between border-t border-white/8 px-5 py-3 text-[11.55px] text-white/50 md:px-6">
                <span>查看单张历史生图</span>
                <span>ESC 关闭</span>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>,
    document.body,
  );
}
