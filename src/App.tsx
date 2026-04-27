/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, useState } from 'react';
import { PanelLeftClose } from 'lucide-react';
import { toast } from 'sonner';
import packageJson from '../package.json';
import { Topbar } from './components/layout/Topbar';
import { Sidebar } from './components/layout/Sidebar';
import { TaskList } from './components/workspace/TaskList';
import { Lightbox } from './components/workspace/Lightbox';
import { QuotaStatus } from './components/layout/QuotaStatus';
import { Toaster } from './components/ui/sonner';
import { Button } from './components/ui/button';
import { useAppStore } from './store';

const COMPACT_BREAKPOINT = 1023;
const NARROW_DESKTOP_BREAKPOINT = 1279;

const PLATFORM_PRESET_LABELS = {
  'comfly-chat': 'comfly.chat',
  yunwu: '云雾',
  'openai-compatible': 'OpenAI',
  'gemini-native': 'Gemini',
  custom: '自定义',
} as const;

function getSidebarBounds(isNarrowDesktop: boolean) {
  if (typeof window === 'undefined') {
    return { min: 250, max: isNarrowDesktop ? 360 : 600 };
  }

  const viewportCap = Math.floor(window.innerWidth * (isNarrowDesktop ? 0.4 : 0.48));
  return {
    min: 250,
    max: Math.max(250, Math.min(isNarrowDesktop ? 360 : 600, viewportCap)),
  };
}

export default function App() {
  const isBatchRunning = useAppStore((state) => state.isBatchRunning);
  const platformPreset = useAppStore((state) => state.platformPreset);
  const textModel = useAppStore((state) => state.textModel) || 'gemini-3.1-flash-lite';
  const imageModel = useAppStore((state) => state.imageModel) || 'banana2';
  const platformLabel = PLATFORM_PRESET_LABELS[platformPreset] || '自定义';

  const isDragging = useRef(false);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const [isCompactLayout, setIsCompactLayout] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth <= COMPACT_BREAKPOINT : false,
  );
  const [isNarrowDesktop, setIsNarrowDesktop] = useState(() =>
    typeof window !== 'undefined'
      ? window.innerWidth > COMPACT_BREAKPOINT && window.innerWidth <= NARROW_DESKTOP_BREAKPOINT
      : false,
  );
  const [sidebarWidth, setSidebarWidth] = useState(320);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  useEffect(() => {
    const handleResize = () => {
      const compact = window.innerWidth <= COMPACT_BREAKPOINT;
      const narrowDesktop =
        window.innerWidth > COMPACT_BREAKPOINT && window.innerWidth <= NARROW_DESKTOP_BREAKPOINT;

      setIsCompactLayout(compact);
      setIsNarrowDesktop(narrowDesktop);

      if (compact) {
        setIsSidebarOpen(false);
      }

      const bounds = getSidebarBounds(narrowDesktop);
      const preferredWidth = narrowDesktop ? 280 : 320;
      setSidebarWidth((current) => Math.max(bounds.min, Math.min(current || preferredWidth, bounds.max)));
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (!isCompactLayout) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = isSidebarOpen ? 'hidden' : '';

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isCompactLayout, isSidebarOpen]);

  useEffect(() => {
    let animationFrameId: number;

    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current || !sidebarRef.current || isCompactLayout) return;
      if (animationFrameId) cancelAnimationFrame(animationFrameId);
      animationFrameId = requestAnimationFrame(() => {
        const bounds = getSidebarBounds(isNarrowDesktop);
        const newWidth = Math.max(bounds.min, Math.min(bounds.max, e.clientX));
        setSidebarWidth(newWidth);
      });
    };

    const handleMouseUp = () => {
      isDragging.current = false;
      document.body.style.cursor = '';
      if (animationFrameId) cancelAnimationFrame(animationFrameId);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      if (animationFrameId) cancelAnimationFrame(animationFrameId);
    };
  }, [isCompactLayout, isNarrowDesktop]);

  useEffect(() => {
    const handlePersistWarning = (event: Event) => {
      const customEvent = event as CustomEvent<{ message?: string }>;
      const message = customEvent.detail?.message;
      if (message) {
        toast.warning(message, { duration: 8000 });
      }
    };

    window.addEventListener('batch-refiner:persist-warning', handlePersistWarning as EventListener);
    return () =>
      window.removeEventListener('batch-refiner:persist-warning', handlePersistWarning as EventListener);
  }, []);

  const statusBadge = (
    <div
      className={`z-40 ${
        isCompactLayout ? 'fixed bottom-3 left-3 right-3' : 'absolute bottom-4 left-1/2 -translate-x-1/2'
      }`}
    >
      <div
        className={`flex items-center rounded-full border border-border/50 bg-white/88 text-text-secondary shadow-sm backdrop-blur-md ${
          isCompactLayout ? 'justify-between gap-2 px-3 py-2 text-[10.5px]' : 'gap-4 px-4 py-2 text-[11.55px]'
        }`}
      >
        <span className="shrink-0 whitespace-nowrap font-medium text-foreground/80">{platformLabel}</span>
        {!isCompactLayout && <span className="h-3 w-px bg-border/70" />}
        <span className="flex min-w-0 items-center gap-2" title="当前文本模型">
          <span className="h-2 w-2 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]" />
          <span className="truncate font-mono opacity-80">{textModel}</span>
        </span>
        {!isCompactLayout && <span className="h-3 w-px bg-border" />}
        <span className="flex min-w-0 items-center gap-2" title="当前图片模型">
          <span className="h-2 w-2 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]" />
          <span className="truncate font-mono opacity-80">{imageModel}</span>
        </span>
        {!isCompactLayout && <span className="h-3 w-px bg-border" />}
        <span className={`whitespace-nowrap font-medium ${isBatchRunning ? 'text-button-main' : ''}`}>
          {isBatchRunning ? '处理中...' : '准备就绪'}
        </span>
        <span className="h-3 w-px shrink-0 bg-border/70" />
        <QuotaStatus />
        {!isCompactLayout && (
          <>
            <span className="h-3 w-px bg-border/70" />
            <span className="select-none text-[10px] tracking-[0.12em] text-black/30">
              V{packageJson.appVersion}
            </span>
          </>
        )}
      </div>
    </div>
  );

  return (
    <div className="relative flex h-screen flex-col overflow-hidden bg-background font-sans text-foreground selection:bg-button-main/10 selection:text-button-main">
      <Topbar
        isCompactLayout={isCompactLayout}
        onOpenSidebar={isCompactLayout ? () => setIsSidebarOpen(true) : undefined}
      />

      <div className={`relative flex flex-1 overflow-hidden ${isCompactLayout ? 'px-2 pb-16' : 'px-2 pb-2'}`}>
        {!isCompactLayout && (
          <>
            <div
              ref={sidebarRef}
              className="z-20 flex flex-shrink-0 bg-transparent transition-all duration-300 ease-out"
              style={{ width: sidebarWidth }}
            >
              <Sidebar className="w-full flex-1 border-none px-4" compact={false} />
            </div>

            <div
              className="group z-30 my-4 -ml-1 flex w-1.5 flex-shrink-0 cursor-col-resize items-center justify-center rounded-full transition-all hover:w-2 group-hover:bg-button-main/10"
              onMouseDown={(e) => {
                e.preventDefault();
                isDragging.current = true;
                document.body.style.cursor = 'col-resize';
              }}
            />
          </>
        )}

        <main
          className={`relative z-10 flex flex-1 overflow-hidden border border-border/40 bg-card claude-shadow ${
            isCompactLayout ? 'rounded-[22px]' : 'ml-1 rounded-2xl'
          }`}
        >
          <TaskList />
        </main>

        {statusBadge}
      </div>

      {isCompactLayout && isSidebarOpen && (
        <div className="fixed inset-0 z-50">
          <button
            type="button"
            aria-label="关闭配置面板"
            className="absolute inset-0 bg-black/15 backdrop-blur-[2px]"
            onClick={() => setIsSidebarOpen(false)}
          />

          <aside className="absolute inset-y-0 left-0 w-[min(92vw,380px)] border-r border-border/70 bg-background shadow-[0_12px_40px_rgba(0,0,0,0.12)]">
            <div className="flex h-full flex-col">
              <div className="shrink-0 px-4 pb-2 pt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-[11px] uppercase tracking-[0.16em] text-text-secondary">配置面板</div>
                    <div className="text-[18px] font-serif text-foreground">任务与全局参数</div>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="rounded-xl"
                    onClick={() => setIsSidebarOpen(false)}
                    title="关闭配置面板"
                  >
                    <PanelLeftClose className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              <Sidebar className="flex-1 px-4 pb-4" compact onRequestClose={() => setIsSidebarOpen(false)} />
            </div>
          </aside>
        </div>
      )}

      <Toaster position="bottom-right" />
      <Lightbox />
    </div>
  );
}
