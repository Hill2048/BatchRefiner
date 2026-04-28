import { useAppStore } from '@/store';
import { ChevronLeft, ChevronRight, GripVertical, X } from 'lucide-react';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { getCurrentTaskResultImages } from '@/lib/taskResults';
import type { TaskResultImage } from '@/types';
import { getStoredImageAsset } from '@/lib/imageAssetStore';

function preventNativeImageDrag(e: React.DragEvent<HTMLImageElement>) {
  e.preventDefault();
}

function getTaskStatusLabel(status?: string) {
  switch (status) {
    case 'Idle':
      return '待处理';
    case 'Waiting':
      return '排队中';
    case 'Prompting':
      return '生成提示词';
    case 'Rendering':
      return '生成图片';
    case 'Running':
      return '处理中';
    case 'Success':
      return '已完成';
    case 'Error':
      return '失败';
    default:
      return status || '未知状态';
  }
}

function getResultFullSrc(result?: TaskResultImage | null) {
  return result?.originalSrc || result?.assetSrc || result?.src || result?.previewSrc;
}

export function Lightbox() {
  const lightboxTaskId = useAppStore((state) => state.lightboxTaskId);
  const lightboxImageIndex = useAppStore((state) => state.lightboxImageIndex);
  const setLightboxTask = useAppStore((state) => state.setLightboxTask);
  const tasks = useAppStore((state) => state.tasks);

  const [sliderPosition, setSliderPosition] = useState(50);
  const [isCompareDragging, setIsCompareDragging] = useState(false);
  const [compareEnabled, setCompareEnabled] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [resolvedAssetSrc, setResolvedAssetSrc] = useState<string | null>(null);
  const [resolvedSourceAssetSrc, setResolvedSourceAssetSrc] = useState<string | null>(null);
  const panStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  const task = tasks.find((item) => item.id === lightboxTaskId);
  const taskIndex = useMemo(() => tasks.findIndex((item) => item.id === lightboxTaskId), [tasks, lightboxTaskId]);
  const resultImages = task ? getCurrentTaskResultImages(task) : [];
  const currentResultImage = resultImages[lightboxImageIndex] || resultImages[0];
  const currentResultImageSrc = getResultFullSrc(currentResultImage);
  const displayResultImageSrc = resolvedAssetSrc || currentResultImageSrc;
  const displaySourceImageSrc = task?.sourceImage || resolvedSourceAssetSrc || task?.sourceImagePreview || '';
  const hasResultGallery = resultImages.length > 1;
  const hasCompareSource = Boolean(displaySourceImageSrc && displayResultImageSrc);
  const hasCompareView = hasCompareSource && compareEnabled;
  const displayImage = displayResultImageSrc || displaySourceImageSrc;
  const canGoPrevImage = hasResultGallery ? lightboxImageIndex > 0 : taskIndex > 0;
  const canGoNextImage = hasResultGallery
    ? lightboxImageIndex < resultImages.length - 1
    : taskIndex !== -1 && taskIndex < tasks.length - 1;

  const resetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setSliderPosition(50);
  };

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;

    setResolvedAssetSrc(null);
    if (!currentResultImage?.assetId) return undefined;

    getStoredImageAsset(currentResultImage.assetId).then((asset) => {
      if (cancelled || !asset?.blob) return;
      objectUrl = URL.createObjectURL(asset.blob);
      setResolvedAssetSrc(objectUrl);
    });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [currentResultImage?.assetId, currentResultImage?.id]);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;

    setResolvedSourceAssetSrc(null);
    if (!task || task.sourceImage || !task.sourceImageAssetId) return undefined;

    getStoredImageAsset(task.sourceImageAssetId)
      .then((asset) => {
        if (cancelled || !asset?.blob) return;
        objectUrl = URL.createObjectURL(asset.blob);
        setResolvedSourceAssetSrc(objectUrl);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [task?.id, task?.sourceImage, task?.sourceImageAssetId]);

  useEffect(() => {
    setCompareEnabled(false);
    resetView();
    setIsPanning(false);
  }, [lightboxTaskId, lightboxImageIndex, currentResultImage?.id]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!task) return;

      if (event.key === 'Escape') {
        setLightboxTask(null, 0);
        return;
      }

      if (event.key === 'ArrowRight' && canGoNextImage) {
        if (hasResultGallery) {
          setLightboxTask(task.id, lightboxImageIndex + 1);
        } else if (taskIndex !== -1 && taskIndex < tasks.length - 1) {
          setLightboxTask(tasks[taskIndex + 1].id, 0);
        }
        resetView();
      }

      if (event.key === 'ArrowLeft' && canGoPrevImage) {
        if (hasResultGallery) {
          setLightboxTask(task.id, lightboxImageIndex - 1);
        } else if (taskIndex > 0) {
          setLightboxTask(tasks[taskIndex - 1].id, 0);
        }
        resetView();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [canGoNextImage, canGoPrevImage, hasResultGallery, lightboxImageIndex, setLightboxTask, task, taskIndex, tasks]);

  useEffect(() => {
    if (!isCompareDragging) return;

    const stopDragging = () => setIsCompareDragging(false);
    window.addEventListener('mouseup', stopDragging);
    window.addEventListener('touchend', stopDragging);

    return () => {
      window.removeEventListener('mouseup', stopDragging);
      window.removeEventListener('touchend', stopDragging);
    };
  }, [isCompareDragging]);

  useEffect(() => {
    if (!isPanning) return;

    const handleMove = (event: MouseEvent) => {
      setPan({
        x: panStartRef.current.panX + event.clientX - panStartRef.current.x,
        y: panStartRef.current.panY + event.clientY - panStartRef.current.y,
      });
    };
    const handleUp = () => setIsPanning(false);

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [isPanning]);

  if (!task) return null;

  const updateSlider = (clientX: number) => {
    if (!containerRef.current || !hasCompareView) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
    setSliderPosition((x / rect.width) * 100);
  };

  const handleComparePointerMove = (event: React.MouseEvent | React.TouchEvent) => {
    if (!isCompareDragging || !hasCompareView) return;
    const clientX = 'touches' in event ? event.touches[0].clientX : event.clientX;
    updateSlider(clientX);
  };

  const handleComparePointerDown = (event: React.MouseEvent | React.TouchEvent) => {
    if (!hasCompareView) return;
    event.stopPropagation();
    setIsCompareDragging(true);
    const clientX = 'touches' in event ? event.touches[0].clientX : event.clientX;
    updateSlider(clientX);
  };

  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const direction = event.deltaY < 0 ? 1.12 : 0.88;
    setZoom((current) => {
      const next = Math.max(1, Math.min(6, Number((current * direction).toFixed(3))));
      if (next === 1) setPan({ x: 0, y: 0 });
      return next;
    });
  };

  const handleImageMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    if (zoom <= 1 || (event.target as HTMLElement).closest('button')) return;
    event.preventDefault();
    panStartRef.current = {
      x: event.clientX,
      y: event.clientY,
      panX: pan.x,
      panY: pan.y,
    };
    setIsPanning(true);
  };

  const goPrev = () => {
    if (!canGoPrevImage) return;
    if (hasResultGallery) {
      setLightboxTask(task.id, lightboxImageIndex - 1);
    } else if (taskIndex > 0) {
      setLightboxTask(tasks[taskIndex - 1].id, 0);
    }
    resetView();
  };

  const goNext = () => {
    if (!canGoNextImage) return;
    if (hasResultGallery) {
      setLightboxTask(task.id, lightboxImageIndex + 1);
    } else if (taskIndex !== -1 && taskIndex < tasks.length - 1) {
      setLightboxTask(tasks[taskIndex + 1].id, 0);
    }
    resetView();
  };

  const imageLayerStyle: React.CSSProperties = {
    transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})`,
    transformOrigin: 'center center',
  };

  return (
    <div className="fixed inset-0 z-50 bg-[rgba(20,19,17,0.78)] backdrop-blur-sm animate-in fade-in duration-200">
      <div className="flex h-full w-full items-center justify-center p-3 md:p-4">
        <div className="relative flex h-full max-h-[960px] w-full max-w-[1440px] flex-col overflow-hidden rounded-[28px] border border-white/12 bg-[rgba(24,23,21,0.82)] shadow-[0_20px_80px_rgba(0,0,0,0.28)]">
          <div className="flex items-center justify-between gap-4 border-b border-white/8 px-5 py-4 md:px-6">
            <div className="min-w-0">
              <div className="truncate font-serif text-[18.9px] tracking-tight text-[#F2EFEB]">{task.title}</div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-[11.55px] text-white/55">
                <span>#{task.index.toString().padStart(3, '0')}</span>
                <span className="inline-block h-1 w-1 rounded-full bg-white/20" />
                <span>{getTaskStatusLabel(task.status)}</span>
                {currentResultImage && resultImages.length > 0 ? (
                  <>
                    <span className="inline-block h-1 w-1 rounded-full bg-white/20" />
                    <span>
                      {Math.min(lightboxImageIndex + 1, resultImages.length)}/{resultImages.length}
                    </span>
                  </>
                ) : null}
              </div>
            </div>

            <div className="flex items-center gap-2">
              {hasCompareSource ? (
                <button
                  type="button"
                  onClick={() => {
                    setCompareEnabled((value) => !value);
                    resetView();
                  }}
                  className={`h-10 rounded-full border px-3 text-[11.55px] font-medium transition-colors ${
                    compareEnabled
                      ? 'border-white/18 bg-white/14 text-white'
                      : 'border-white/10 bg-white/6 text-white/70 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  对比
                </button>
              ) : null}
              <button
                type="button"
                onClick={resetView}
                className="h-10 rounded-full border border-white/10 bg-white/6 px-3 text-[11.55px] font-medium text-white/70 transition-colors hover:bg-white/10 hover:text-white"
              >
                适应
              </button>
              <button
                type="button"
                disabled={!canGoPrevImage}
                onClick={goPrev}
                className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/6 text-white/70 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                disabled={!canGoNextImage}
                onClick={goNext}
                className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/6 text-white/70 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setLightboxTask(null, 0)}
                className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/6 text-white/70 transition-colors hover:bg-white/10 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="flex flex-1 items-center justify-center px-3 py-3 md:px-4 md:py-4">
            <div
              ref={containerRef}
              className={`relative flex h-full w-full items-center justify-center overflow-hidden rounded-[24px] border border-white/8 bg-transparent ${
                zoom > 1 ? isPanning ? 'cursor-grabbing' : 'cursor-grab' : 'cursor-zoom-in'
              }`}
              onMouseMove={handleComparePointerMove}
              onTouchMove={handleComparePointerMove}
              onWheel={handleWheel}
              onMouseDown={handleImageMouseDown}
            >
              {!hasCompareView && displayImage ? (
                <div className="absolute inset-0 flex items-center justify-center will-change-transform" style={imageLayerStyle}>
                  <img
                    src={displayImage}
                    alt={task.title}
                    className="max-h-full max-w-full select-none object-contain"
                    draggable={false}
                    onDragStart={preventNativeImageDrag}
                  />
                </div>
              ) : null}

              {hasCompareView && currentResultImage ? (
                <>
                  <div className="absolute inset-0 will-change-transform" style={imageLayerStyle}>
                    <img
                      src={displayResultImageSrc || ''}
                      className="absolute inset-0 h-full w-full select-none object-contain"
                      alt="结果图"
                      draggable={false}
                      onDragStart={preventNativeImageDrag}
                    />
                    <div
                      className="absolute inset-0 overflow-hidden"
                      style={{ clipPath: `polygon(0 0, ${sliderPosition}% 0, ${sliderPosition}% 100%, 0 100%)` }}
                    >
                      <img
                        src={displaySourceImageSrc}
                        className="absolute inset-0 h-full w-full select-none object-contain"
                        alt="原图"
                        draggable={false}
                        onDragStart={preventNativeImageDrag}
                      />
                    </div>
                  </div>

                  <div className="pointer-events-none absolute left-5 top-5 rounded-full border border-white/10 bg-[rgba(18,18,17,0.42)] px-3 py-1 text-[11.55px] font-medium text-[#F2EFEB] backdrop-blur-md">
                    原图
                  </div>
                  <div className="pointer-events-none absolute right-5 top-5 rounded-full border border-white/10 bg-[rgba(18,18,17,0.42)] px-3 py-1 text-[11.55px] font-medium text-[#F2EFEB] backdrop-blur-md">
                    结果图 #{lightboxImageIndex + 1}
                  </div>

                  <div className="absolute inset-y-0 z-20 flex -translate-x-1/2 items-center justify-center" style={{ left: `${sliderPosition}%` }}>
                    <div className="absolute inset-y-0 w-px bg-white/90 shadow-[0_0_18px_rgba(255,255,255,0.28)]" />
                    <button
                      type="button"
                      onMouseDown={handleComparePointerDown}
                      onTouchStart={handleComparePointerDown}
                      className={`relative flex h-11 w-11 cursor-ew-resize items-center justify-center rounded-full border border-white/18 bg-[rgba(245,244,240,0.92)] text-[#2C2B29] shadow-[0_10px_30px_rgba(0,0,0,0.2)] transition-transform ${isCompareDragging ? 'scale-105' : ''}`}
                    >
                      <GripVertical className="h-4 w-4 opacity-75" />
                    </button>
                  </div>
                </>
              ) : null}
            </div>
          </div>

          <div className="flex items-center justify-between border-t border-white/8 px-5 py-3 text-[11.55px] text-white/50 md:px-6">
            <span>
              {hasCompareView ? '拖动中线对比前后差异' : '滚轮缩放，放大后拖动画面查看细节'}
              {zoom > 1 ? ` / ${Math.round(zoom * 100)}%` : ''}
            </span>
            <span>{hasResultGallery ? 'ESC 关闭 / ← → 切换当前任务结果图' : 'ESC 关闭 / ← → 切换任务'}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
