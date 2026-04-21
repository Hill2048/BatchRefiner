/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useRef, useEffect } from 'react';
import { Topbar } from './components/layout/Topbar';
import { Sidebar } from './components/layout/Sidebar';
import { TaskList } from './components/workspace/TaskList';
import { Lightbox } from './components/workspace/Lightbox';
import { useAppStore } from './store';
import { Toaster } from './components/ui/sonner';
import { QuotaStatus } from './components/layout/QuotaStatus';

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
    <div className="flex flex-col h-screen bg-background text-foreground font-sans selection:bg-button-main/10 selection:text-button-main relative">
      <Topbar />
      <div className="flex flex-1 overflow-hidden relative px-2 pb-2">
        {/* Sidebar Space */}
        <div ref={sidebarRef} className="flex-shrink-0 z-20 flex bg-transparent transition-all duration-300 ease-out" style={{ width: 320 }}>
          <Sidebar className="w-full flex-1 border-none px-4" />
        </div>
        
        {/* Resizer Handle */}
        <div 
          className="w-1.5 hover:w-2 cursor-col-resize flex-shrink-0 z-30 flex items-center justify-center -ml-1 transition-all group group-hover:bg-button-main/10 rounded-full my-4"
          onMouseDown={(e) => {
             e.preventDefault();
             isDragging.current = true;
             document.body.style.cursor = 'col-resize';
          }}
        />

        {/* Elevated Workspace */}
        <main className="flex-1 flex overflow-hidden bg-card rounded-2xl relative z-10 claude-shadow border border-border/40 ml-1">
          <TaskList />
          
          {/* Floating Status Badge replacing the old footer */}
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-40">
             <div className="flex items-center gap-4 bg-white/80 backdrop-blur-md px-4 py-2 rounded-full shadow-sm border border-border/50 text-[11.55px] text-text-secondary">
               <span className="flex items-center gap-2" title="当前连接的文本模型">
                 <span className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]"></span>
                 <span className="font-mono opacity-80">{textModel}</span>
               </span>
               <span className="w-px h-3 bg-border" />
               <span className="flex items-center gap-2">
                 <span className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]"></span>
                 <span className="font-mono opacity-80">{imageModel}</span>
               </span>
               <span className="w-px h-3 bg-border" />
               <span className={`font-medium ${isBatchRunning ? 'text-button-main' : ''}`}>{isBatchRunning ? '处理中...' : '准备就绪'}</span>
               <span className="w-px h-3 bg-border/70" />
               <QuotaStatus />
               <span className="w-px h-3 bg-border/70" />
               <span className="text-[10px] tracking-[0.12em] text-black/30 select-none">V1.1</span>
             </div>
          </div>
        </main>
      </div>
      <Toaster position="bottom-right" />
      <Lightbox />
    </div>
  );
}
