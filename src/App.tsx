/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, useState } from 'react';
import { PanelLeftClose } from 'lucide-react';
import { Topbar } from './components/layout/Topbar';
import { Sidebar } from './components/layout/Sidebar';
import { TaskList } from './components/workspace/TaskList';
import { Lightbox } from './components/workspace/Lightbox';
import { useAppStore } from './store';
import { Toaster } from './components/ui/sonner';
import { QuotaStatus } from './components/layout/QuotaStatus';
import { Button } from './components/ui/button';
import packageJson from '../package.json';

const COMPACT_BREAKPOINT = 1023;
const NARROW_DESKTOP_BREAKPOINT = 1279;

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
  const isBatchRunning = useAppStore(state => state.isBatchRunning);
  const textModel = useAppStore(state => state.textModel) || 'gemini-3.1-flash-lite';
  const imageModel = useAppStore(state => state.imageModel) || 'banana2';
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
      setSidebarWidth(current => Math.max(bounds.min, Math.min(current || preferredWidth, bounds.max)));
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
        if (!sidebarRef.current) return;
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

  const statusBadge = (
    <div
      className={`z-40 ${
        isCompactLayout
          ? 'fixed bottom-3 right-3 left-3'
          : 'absolute bottom-4 left-1/2 -translate-x-1/2'
      }`}
    >
      <div
        className={`flex items-center bg-white/88 backdrop-blur-md rounded-full shadow-sm border border-border/50 text-text-secondary ${
          isCompactLayout
            ? 'gap-2 px-3 py-2 text-[10.5px] justify-between'
            : 'gap-4 px-4 py-2 text-[11.55px]'
        }`}
      >
        <span className="flex items-center gap-2 min-w-0" title="当前连接的文本模型">
          <span className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]"></span>
          <span className="font-mono opacity-80 truncate">{textModel}</span>
        </span>
        {!isCompactLayout && <span className="w-px h-3 bg-border" />}
        <span className="flex items-center gap-2 min-w-0">
          <span className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]"></span>
          <span className="font-mono opacity-80 truncate">{imageModel}</span>
        </span>
        {!isCompactLayout && <span className="w-px h-3 bg-border" />}
        <span className={`font-medium whitespace-nowrap ${isBatchRunning ? 'text-button-main' : ''}`}>
          {isBatchRunning ? '处理中...' : '准备就绪'}
        </span>
        <span className="w-px h-3 bg-border/70 shrink-0" />
        <QuotaStatus />
        {!isCompactLayout && (
          <>
            <span className="w-px h-3 bg-border/70" />
            <span className="text-[10px] tracking-[0.12em] text-black/30 select-none">
              V{packageJson.appVersion}
            </span>
          </>
        )}
      </div>
    </div>
  );

  return (
    <div className="flex flex-col h-screen bg-background text-foreground font-sans selection:bg-button-main/10 selection:text-button-main relative overflow-hidden">
      <Topbar
        isCompactLayout={isCompactLayout}
        onOpenSidebar={isCompactLayout ? () => setIsSidebarOpen(true) : undefined}
      />
      <div className={`flex flex-1 overflow-hidden relative ${isCompactLayout ? 'px-2 pb-16' : 'px-2 pb-2'}`}>
        {!isCompactLayout && (
          <>
            <div
              ref={sidebarRef}
              className="flex-shrink-0 z-20 flex bg-transparent transition-all duration-300 ease-out"
              style={{ width: sidebarWidth }}
            >
              <Sidebar className="w-full flex-1 border-none px-4" compact={false} />
            </div>

            <div
              className="w-1.5 hover:w-2 cursor-col-resize flex-shrink-0 z-30 flex items-center justify-center -ml-1 transition-all group group-hover:bg-button-main/10 rounded-full my-4"
              onMouseDown={(e) => {
                e.preventDefault();
                isDragging.current = true;
                document.body.style.cursor = 'col-resize';
              }}
            />
          </>
        )}

        <main
          className={`flex-1 flex overflow-hidden bg-card relative z-10 claude-shadow border border-border/40 ${
            isCompactLayout ? 'rounded-[22px]' : 'rounded-2xl ml-1'
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
          <aside className="absolute inset-y-0 left-0 w-[min(92vw,380px)] bg-background shadow-[0_12px_40px_rgba(0,0,0,0.12)] border-r border-border/70">
            <div className="flex h-full flex-col">
              <div className="flex items-center justify-between px-4 pt-4 pb-2 shrink-0">
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
                  <PanelLeftClose className="w-4 h-4" />
                </Button>
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
