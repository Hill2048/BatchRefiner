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
    <div className="flex flex-col h-screen bg-background text-foreground font-sans selection:bg-[#E8E5DF] selection:text-[#121212]">
      <Topbar />
      <div className="flex flex-1 overflow-hidden relative">
        {/* Wrapping Sidebar to isolate DOM width adjustments */}
        <div ref={sidebarRef} className="flex-shrink-0 z-20 flex border-r border-[#E6E4DF] bg-sidebar" style={{ width: 300 }}>
          <Sidebar className="w-full flex-1 border-none" />
        </div>
        
        {/* Resizer Handle */}
        <div 
          className="w-2 hover:w-3 cursor-col-resize flex-shrink-0 z-30 flex items-center justify-center -ml-1 transition-all group group-hover:bg-button-main/20"
          onMouseDown={(e) => {
             e.preventDefault();
             isDragging.current = true;
             document.body.style.cursor = 'col-resize';
          }}
        >
          <div className="h-8 w-1 rounded-full bg-border/40 group-hover:bg-button-main/50" />
        </div>

        <main className="flex-1 flex overflow-hidden bg-background relative z-10 transition-colors duration-200">
          <Workspace />
        </main>
      </div>
      <footer className="h-[36px] bg-[#F2EFEB] flex items-center px-6 text-[12px] text-text-secondary gap-6 shrink-0 z-30 transition-colors duration-200 border-t border-[#E6E4DF]">
        <div className="flex flex-col md:flex-row md:items-center gap-1 md:gap-4 flex-1">
          <span className="flex items-center gap-2" title="当前连接的模型">
            <span className="w-2.5 h-2.5 rounded-full bg-[#2A7E4F] shadow-[0_0_8px_rgba(42,126,79,0.5)]"></span>
            文字: <span className="font-mono text-[11px] opacity-80">{textModel}</span>
          </span>
          <span className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-[#2A7E4F] shadow-[0_0_8px_rgba(42,126,79,0.5)]"></span>
            图像: <span className="font-mono text-[11px] opacity-80">{imageModel}</span>
          </span>
        </div>
        <span>{isBatchRunning ? '正在处理任务...' : '准备就绪'}</span>
        <span className="ml-auto font-mono text-[11px] opacity-60 shrink-0">v2.1.0</span>
      </footer>
      <Toaster position="bottom-right" />
      <Lightbox />
    </div>
  );
}
