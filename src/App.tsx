/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from 'react';
import { Download, History, Settings } from 'lucide-react';
import { toast } from 'sonner';
import packageJson from '../package.json';
import { QuotaStatus } from './components/layout/QuotaStatus';
import { Topbar } from './components/layout/Topbar';
import { UnsavedRefreshGuard } from './components/UnsavedRefreshGuard';
import { Toaster } from './components/ui/sonner';
import { DockProgress, FloatingTaskDock } from './components/workspace/FloatingTaskDock';
import { Lightbox } from './components/workspace/Lightbox';
import { TaskList } from './components/workspace/TaskList';
import { startLocalCacheAutoSave } from './lib/localCachePersistence';
import { useAppStore } from './store';

const COMPACT_BREAKPOINT = 1023;

const PLATFORM_PRESET_LABELS = {
  'comfly-chat': 'comfly.chat',
  yunwu: '云雾',
  'openai-compatible': 'OpenAI',
  'gemini-native': 'Gemini',
  custom: '自定义',
} as const;

export default function App() {
  const isBatchRunning = useAppStore((state) => state.isBatchRunning);
  const platformPreset = useAppStore((state) => state.platformPreset);
  const textModel = useAppStore((state) => state.textModel) || 'gemini-3.1-flash-lite';
  const imageModel = useAppStore((state) => state.imageModel) || 'banana2';
  const platformLabel = PLATFORM_PRESET_LABELS[platformPreset] || '自定义';

  const [isCompactLayout, setIsCompactLayout] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth <= COMPACT_BREAKPOINT : false,
  );

  useEffect(() => {
    const handleResize = () => {
      setIsCompactLayout(window.innerWidth <= COMPACT_BREAKPOINT);
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

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

  useEffect(() => startLocalCacheAutoSave(), []);

  const statusBadge = (
    <div
      className={`z-40 ${
        isCompactLayout ? 'fixed left-3 right-3 top-[72px]' : 'absolute bottom-3 right-5'
      }`}
    >
      <div
        className={`flex max-w-full text-text-secondary transition-opacity duration-300 hover:opacity-100 ${
          isCompactLayout
            ? 'items-center justify-between gap-2 rounded-full border border-white/70 bg-white/72 px-3 py-2 text-[10.5px] shadow-[0_10px_30px_rgba(23,18,14,0.08)] backdrop-blur-xl'
            : 'flex-col items-end gap-0.5 rounded-[18px] bg-white/24 px-2.5 py-1.5 text-[9.5px] opacity-55 backdrop-blur-sm'
        }`}
      >
        <span className="shrink-0 whitespace-nowrap font-medium text-foreground/80">{platformLabel}</span>
        {!isCompactLayout && <span className="hidden" />}
        <span className="flex min-w-0 items-center gap-1.5" title="当前文本模型">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]" />
          <span className="truncate font-mono opacity-80">{textModel}</span>
        </span>
        {!isCompactLayout && <span className="hidden" />}
        <span className="flex min-w-0 items-center gap-1.5" title="当前图片模型">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]" />
          <span className="truncate font-mono opacity-80">{imageModel}</span>
        </span>
        {!isCompactLayout && <span className="hidden" />}
        <span className={`whitespace-nowrap font-medium ${isBatchRunning ? 'text-button-main' : ''}`}>
          {isBatchRunning ? '处理中...' : '准备就绪'}
        </span>
        <span className={isCompactLayout ? 'h-3 w-px shrink-0 bg-border/70' : 'hidden'} />
        <QuotaStatus />
        {!isCompactLayout && (
          <>
            <span className="hidden" />
            <span className="select-none text-[9px] tracking-[0.12em] text-black/30">
              V{packageJson.appVersion}
            </span>
          </>
        )}
      </div>
    </div>
  );

  const topActionBadge = (
    <div
      className={`pointer-events-none z-40 ${
        isCompactLayout ? 'hidden' : 'absolute right-14 top-5'
      }`}
    >
      <div className="group pointer-events-auto flex items-center gap-2 px-1.5 py-1 text-text-secondary transition-all duration-300 hover:translate-y-0.5 hover:bg-white/28 hover:backdrop-blur-sm">
        <div className="flex items-center gap-1 pr-1">
          <button
            type="button"
            className="flex h-9 w-9 items-center justify-center rounded-full transition-all duration-200 hover:-translate-y-0.5 hover:bg-white/78 hover:text-foreground hover:shadow-[0_8px_22px_rgba(23,18,14,0.08)]"
            title="历史生图"
            onClick={() => window.dispatchEvent(new CustomEvent('batch-refiner:open-history'))}
          >
            <History className="h-4 w-4" strokeWidth={1.8} />
          </button>
          <button
            type="button"
            className="flex h-9 w-9 items-center justify-center rounded-full transition-all duration-200 hover:-translate-y-0.5 hover:bg-white/78 hover:text-foreground hover:shadow-[0_8px_22px_rgba(23,18,14,0.08)]"
            title="批量下载"
            onClick={() => window.dispatchEvent(new CustomEvent('batch-refiner:export-results'))}
          >
            <Download className="h-4 w-4" strokeWidth={1.8} />
          </button>
          <button
            type="button"
            className="flex h-9 w-9 items-center justify-center rounded-full transition-all duration-200 hover:-translate-y-0.5 hover:bg-white/78 hover:text-foreground hover:shadow-[0_8px_22px_rgba(23,18,14,0.08)]"
            title="设置"
            onClick={() => window.dispatchEvent(new CustomEvent('batch-refiner:open-settings'))}
          >
            <Settings className="h-4 w-4" strokeWidth={1.8} />
          </button>
        </div>
        <span className="h-5 w-px bg-border/25 transition-colors group-hover:bg-border/55" />
        <DockProgress />
      </div>
    </div>
  );

  return (
    <div className="relative flex h-screen flex-col overflow-hidden bg-background font-sans text-foreground selection:bg-button-main/10 selection:text-button-main">
      <Topbar isCompactLayout={isCompactLayout} />

      <div className={`relative flex flex-1 overflow-hidden ${isCompactLayout ? 'px-2 pb-16' : 'px-2 pb-2'}`}>
        <main
          className={`relative z-10 flex flex-1 overflow-hidden border border-border/40 bg-card claude-shadow ${
            isCompactLayout ? 'rounded-[22px]' : 'rounded-2xl'
          }`}
        >
          <TaskList />
          <FloatingTaskDock />
        </main>

        {topActionBadge}
        {statusBadge}
      </div>

      <Toaster position="bottom-right" />
      <Lightbox />
      <UnsavedRefreshGuard />
    </div>
  );
}
