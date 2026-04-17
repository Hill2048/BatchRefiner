import { useAppStore } from '@/store';
import { X } from 'lucide-react';
import React, { useState, useRef, useEffect } from 'react';

export function Lightbox() {
  const lightboxTaskId = useAppStore(state => state.lightboxTaskId);
  const setLightboxTask = useAppStore(state => state.setLightboxTask);
  const tasks = useAppStore(state => state.tasks);
  
  const [sliderPosition, setSliderPosition] = useState(50);
  const containerRef = useRef<HTMLDivElement>(null);
  
  const task = tasks.find(t => t.id === lightboxTaskId);

  useEffect(() => {
     const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') setLightboxTask(null);
        if (e.key === 'ArrowRight') {
           const currentIndex = tasks.findIndex(t => t.id === lightboxTaskId);
           if (currentIndex !== -1 && currentIndex < tasks.length - 1) {
              setLightboxTask(tasks[currentIndex + 1].id);
              setSliderPosition(50);
           }
        }
        if (e.key === 'ArrowLeft') {
           const currentIndex = tasks.findIndex(t => t.id === lightboxTaskId);
           if (currentIndex > 0) {
              setLightboxTask(tasks[currentIndex - 1].id);
              setSliderPosition(50);
           }
        }
     };
     window.addEventListener('keydown', handleKeyDown);
     return () => window.removeEventListener('keydown', handleKeyDown);
  }, [lightboxTaskId, tasks, setLightboxTask]);

  if (!task) return null;

  const hasBoth = task.sourceImage && task.resultImage;
  const showImage = task.resultImage || task.sourceImage;

  const handleMouseMove = (e: React.MouseEvent | React.TouchEvent) => {
      if (!hasBoth || !containerRef.current) return;
      // Handle simple slider drag without dragging state for simplicity
      // just respond to mouse move inside the container
  };

  const handleDrag = (e: React.MouseEvent | React.TouchEvent) => {
      if (!hasBoth || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
      const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
      const percentage = (x / rect.width) * 100;
      setSliderPosition(percentage);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/90 flex flex-col items-center justify-center animate-in fade-in duration-200">
       <div className="absolute top-6 right-6 z-50 flex gap-4">
          <button onClick={() => setLightboxTask(null)} className="w-10 h-10 bg-white/10 hover:bg-white/20 rounded-full flex items-center justify-center text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
       </div>
       
       <div className="absolute top-6 left-6 z-50 text-white font-mono text-sm opacity-80 select-none">
          {task.title} • {task.status}
       </div>

       <div 
         ref={containerRef}
         className="relative w-full max-w-5xl aspect-video max-h-[85vh] select-none"
         onMouseMove={(e) => { if (e.buttons === 1) handleDrag(e); }}
         onTouchMove={handleDrag}
         onMouseDown={handleDrag}
       >
         {!hasBoth && showImage && (
            <img src={showImage} className="w-full h-full object-contain pointer-events-none" />
         )}

         {hasBoth && (
            <>
               {/* Base: Result Image */}
               <img src={task.resultImage} className="absolute inset-0 w-full h-full object-contain pointer-events-none" alt="Result" />
               
               {/* Overlay: Source Image (GPU Accelerated Masking) */}
               <div 
                  className="absolute inset-0 overflow-hidden" 
                  style={{ clipPath: `polygon(0 0, ${sliderPosition}% 0, ${sliderPosition}% 100%, 0 100%)` }}
               >
                  <img src={task.sourceImage} className="absolute top-0 left-0 w-full h-full object-contain pointer-events-none" alt="Source" />
               </div>

               {/* Slider Handle */}
               <div 
                  className="absolute top-0 bottom-0 w-1 bg-white cursor-ew-resize shadow-[0_0_10px_rgba(0,0,0,0.5)] z-20 flex items-center justify-center transform -translate-x-1/2"
                  style={{ left: `${sliderPosition}%` }}
               >
                  <div className="w-6 h-6 bg-white rounded-full flex items-center justify-center shadow-md">
                     <div className="w-1 h-3 flex gap-0.5">
                       <div className="w-[1px] h-full bg-gray-400"></div>
                       <div className="w-[1px] h-full bg-gray-400"></div>
                     </div>
                  </div>
               </div>
               
               <div className="absolute top-4 left-4 bg-black/60 text-white text-xs px-2 py-1 rounded-md backdrop-blur-sm">原图</div>
               <div className="absolute top-4 right-4 bg-black/60 text-white text-xs px-2 py-1 rounded-md backdrop-blur-sm">生成结果</div>
            </>
         )}
       </div>
    </div>
  );
}
