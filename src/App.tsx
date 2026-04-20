/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useRef, useEffect } from 'react';
import { Topbar } from './components/layout/Topbar';
import { Sidebar } from './components/layout/Sidebar';
import { Workspace } from './components/layout/Workspace';
import { Lightbox } from './components/workspace/Lightbox';
import { useAppStore } from './store';
import { Toaster } from './components/ui/sonner';
import { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from './components/ui/tooltip';

export default function App() {
  const isBatchRunning = useAppStore(state => state.isBatchRunning);
  const textModel = useAppStore(state => state.textModel) || 'gemini-3.1-flash-lite';
  const imageModel = useAppStore(state => state.imageModel) || 'banana2';
  const isDragging = useRef(false);
  const sidebarRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
     let animationFrameId: number;
     const handleMouseMove = (e: MouseEvent) => {
        if (!isDragging.current || !sidebarRef.current) return;
        // Avoid overloading DOM updates, though assigning style.width directly is already very fast
        if (animationFrameId) cancelAnimationFrame(animationFrameId);
        animationFrameId = requestAnimationFrame(() => {
           if (!sidebarRef.current) return;
           const newWidth = Math.max(250, Math.min(600, e.clientX));
           sidebarRef.current.style.width = `${newWidth}px`;
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
  }, []);

  return (
    <TooltipProvider delay={300}>
      <div className="flex flex-col h-screen bg-background text-foreground font-sans selection:bg-secondary selection:text-foreground">
        <Topbar />
        <div className="flex flex-1 overflow-hidden relative">
          {/* Wrapping Sidebar to isolate DOM width adjustments */}
          <div ref={sidebarRef} className="flex-shrink-0 z-20 flex border-r border-border bg-card" style={{ width: 300 }}>
            <Sidebar className="w-full flex-1 border-none" />
          </div>
          
          {/* Resizer Handle (Extremely subtle) */}
          <div 
            className="w-1.5 hover:w-2 cursor-col-resize flex-shrink-0 z-30 flex items-center justify-center -ml-[3px] transition-colors group hover:bg-black/5"
            onMouseDown={(e) => {
               e.preventDefault();
               isDragging.current = true;
               document.body.style.cursor = 'col-resize';
            }}
          >
            <div className="h-full w-px bg-transparent group-hover:bg-border transition-colors duration-300" />
          </div>

          <main className="flex-1 flex overflow-hidden bg-background relative z-10 transition-colors duration-200">
            <Workspace />
          </main>
        </div>
        <footer className="h-[36px] bg-muted flex items-center px-6 text-[12px] text-muted-foreground gap-6 shrink-0 z-30 transition-colors duration-200 border-t border-border">
          <div className="flex flex-col md:flex-row md:items-center gap-1 md:gap-4 flex-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="flex items-center gap-2 cursor-default">
                  <span className="w-2 h-2 rounded-full bg-emerald-600 shadow-[0_0_8px_var(--color-emerald-600)] opacity-70"></span>
                  文字: <span className="font-mono text-[11px] opacity-80">{textModel}</span>
                </span>
              </TooltipTrigger>
              <TooltipContent>当前工作的文本结构化与提示词模型</TooltipContent>
            </Tooltip>
            
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="flex items-center gap-2 cursor-default">
                  <span className="w-2 h-2 rounded-full bg-emerald-600 shadow-[0_0_8px_var(--color-emerald-600)] opacity-70"></span>
                  图像: <span className="font-mono text-[11px] opacity-80">{imageModel}</span>
                </span>
              </TooltipTrigger>
              <TooltipContent>当前连接的生图大模型</TooltipContent>
            </Tooltip>
          </div>
          <span className="font-medium text-foreground/80">{isBatchRunning ? `正在处理任务队列...` : '准备就绪'}</span>
          <span className="ml-auto font-mono text-[11px] opacity-60 shrink-0">BatchRefiner v2.1.0</span>
        </footer>
        <Toaster position="bottom-right" />
        <Lightbox />
      </div>
    </TooltipProvider>
  );
}
