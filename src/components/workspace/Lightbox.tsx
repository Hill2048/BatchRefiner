import { useAppStore } from '@/store';
import { ChevronLeft, ChevronRight, GripVertical, X } from 'lucide-react';
import React, { useEffect, useMemo, useRef, useState } from 'react';

function preventNativeImageDrag(e: React.DragEvent<HTMLImageElement>) {
  e.preventDefault();
}

export function Lightbox() {
  const lightboxTaskId = useAppStore(state => state.lightboxTaskId);
  const setLightboxTask = useAppStore(state => state.setLightboxTask);
  const tasks = useAppStore(state => state.tasks);

  const [sliderPosition, setSliderPosition] = useState(50);
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const task = tasks.find(t => t.id === lightboxTaskId);
  const taskIndex = useMemo(
    () => tasks.findIndex(t => t.id === lightboxTaskId),
    [tasks, lightboxTaskId]
  );

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!task) return;

      if (e.key === 'Escape') setLightboxTask(null);
      if (e.key === 'ArrowRight' && taskIndex !== -1 && taskIndex < tasks.length - 1) {
        setLightboxTask(tasks[taskIndex + 1].id);
        setSliderPosition(50);
      }
      if (e.key === 'ArrowLeft' && taskIndex > 0) {
        setLightboxTask(tasks[taskIndex - 1].id);
        setSliderPosition(50);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [task, taskIndex, tasks, setLightboxTask]);

  useEffect(() => {
    if (!isDragging) return;

    const stopDragging = () => setIsDragging(false);
    window.addEventListener('mouseup', stopDragging);
    window.addEventListener('touchend', stopDragging);

    return () => {
      window.removeEventListener('mouseup', stopDragging);
      window.removeEventListener('touchend', stopDragging);
    };
  }, [isDragging]);

  if (!task) return null;

  const hasBoth = Boolean(task.sourceImage && task.resultImage);
  const showImage = task.resultImage || task.sourceImage;
  const canGoPrev = taskIndex > 0;
  const canGoNext = taskIndex !== -1 && taskIndex < tasks.length - 1;

  const updateSlider = (clientX: number) => {
    if (!containerRef.current || !hasBoth) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
    setSliderPosition((x / rect.width) * 100);
  };

  const handlePointerMove = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDragging || !hasBoth) return;
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    updateSlider(clientX);
  };

  const handlePointerDown = (e: React.MouseEvent | React.TouchEvent) => {
    if (!hasBoth) return;
    setIsDragging(true);
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    updateSlider(clientX);
  };

  return (
    <div className="fixed inset-0 z-50 bg-[rgba(20,19,17,0.78)] backdrop-blur-sm animate-in fade-in duration-200">
      <div className="flex h-full w-full items-center justify-center p-3 md:p-4">
        <div className="relative flex h-full max-h-[960px] w-full max-w-[1440px] flex-col overflow-hidden rounded-[28px] border border-white/12 bg-[rgba(24,23,21,0.82)] shadow-[0_20px_80px_rgba(0,0,0,0.28)]">
          <div className="flex items-center justify-between border-b border-white/8 px-5 py-4 md:px-6">
            <div className="min-w-0">
              <div className="truncate font-serif text-[18.9px] text-[#F2EFEB] tracking-tight">
                {task.title}
              </div>
              <div className="mt-1 flex items-center gap-2 text-[11.55px] text-white/55">
                <span>#{task.index.toString().padStart(3, '0')}</span>
                <span className="inline-block h-1 w-1 rounded-full bg-white/20" />
                <span>{task.status}</span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={!canGoPrev}
                onClick={() => {
                  if (canGoPrev) {
                    setLightboxTask(tasks[taskIndex - 1].id);
                    setSliderPosition(50);
                  }
                }}
                className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/6 text-white/70 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                disabled={!canGoNext}
                onClick={() => {
                  if (canGoNext) {
                    setLightboxTask(tasks[taskIndex + 1].id);
                    setSliderPosition(50);
                  }
                }}
                className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/6 text-white/70 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setLightboxTask(null)}
                className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/6 text-white/70 transition-colors hover:bg-white/10 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="flex flex-1 items-center justify-center px-3 py-3 md:px-4 md:py-4">
            <div
              ref={containerRef}
              className="relative flex h-full w-full items-center justify-center overflow-hidden rounded-[24px] border border-white/8 bg-transparent"
              onMouseMove={handlePointerMove}
              onTouchMove={handlePointerMove}
            >
              {!hasBoth && showImage && (
                <img
                  src={showImage}
                  alt={task.title}
                  className="h-full w-full object-contain select-none"
                  draggable={false}
                  onDragStart={preventNativeImageDrag}
                />
              )}

              {hasBoth && (
                <>
                  <img
                    src={task.resultImage}
                    className="absolute inset-0 h-full w-full object-contain select-none"
                    alt="结果"
                    draggable={false}
                    onDragStart={preventNativeImageDrag}
                  />

                  <div
                    className="absolute inset-0 overflow-hidden"
                    style={{ clipPath: `polygon(0 0, ${sliderPosition}% 0, ${sliderPosition}% 100%, 0 100%)` }}
                  >
                    <img
                      src={task.sourceImage}
                      className="absolute inset-0 h-full w-full object-contain select-none"
                      alt="原图"
                      draggable={false}
                      onDragStart={preventNativeImageDrag}
                    />
                  </div>

                  <div className="absolute left-5 top-5 rounded-full border border-white/10 bg-[rgba(18,18,17,0.42)] px-3 py-1 text-[11.55px] font-medium text-[#F2EFEB] backdrop-blur-md">
                    原图
                  </div>
                  <div className="absolute right-5 top-5 rounded-full border border-white/10 bg-[rgba(18,18,17,0.42)] px-3 py-1 text-[11.55px] font-medium text-[#F2EFEB] backdrop-blur-md">
                    结果
                  </div>

                  <div
                    className="absolute inset-y-0 z-20 flex -translate-x-1/2 items-center justify-center"
                    style={{ left: `${sliderPosition}%` }}
                  >
                    <div className="absolute inset-y-0 w-px bg-white/90 shadow-[0_0_18px_rgba(255,255,255,0.28)]" />
                    <button
                      type="button"
                      onMouseDown={handlePointerDown}
                      onTouchStart={handlePointerDown}
                      className={`relative flex h-11 w-11 items-center justify-center rounded-full border border-white/18 bg-[rgba(245,244,240,0.92)] text-[#2C2B29] shadow-[0_10px_30px_rgba(0,0,0,0.2)] transition-transform ${isDragging ? 'scale-105' : ''} cursor-ew-resize`}
                    >
                      <GripVertical className="h-4 w-4 opacity-75" />
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between border-t border-white/8 px-5 py-3 text-[11.55px] text-white/50 md:px-6">
            <span>{hasBoth ? '拖动中线查看前后差异' : '查看任务大图'}</span>
            <span>ESC 关闭 · ← → 切换任务</span>
          </div>
        </div>
      </div>
    </div>
  );
}
