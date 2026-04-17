import { Task } from '@/types';
import { useAppStore } from '@/store';
import { Card } from '../ui/card';
import { ImageIcon, Loader2, Upload, Play, Eye, Fullscreen, GripVertical, Settings2, Trash2 } from 'lucide-react';
import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';
import * as React from 'react';
import { generateTaskPrompt, processSingleTask } from '@/lib/batchRunner';
import { toast } from 'sonner';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GenerateParamsSelector } from '../GenerateParamsSelector';

export const TaskCard = React.memo(function TaskCard({ taskId }: { taskId: string; key?: React.Key }) {
  const task = useAppStore(state => state.tasks.find(t => t.id === taskId));
  const setActiveTask = useAppStore(state => state.setActiveTask);
  const isActive = useAppStore(state => state.activeTaskId === taskId);
  const updateTask = useAppStore(state => state.updateTask);
  const removeTask = useAppStore(state => state.removeTask);
  const setLightboxTask = useAppStore(state => state.setLightboxTask);
  const viewMode = useAppStore(state => state.viewMode);
  
  const isSelected = useAppStore(state => state.selectedTaskIds.includes(taskId));
  const toggleTaskSelection = useAppStore(state => state.toggleTaskSelection);
  const globalReferenceImages = useAppStore(state => state.globalReferenceImages);
  
  if (!task) return null;

  const [localDesc, setLocalDesc] = React.useState(task.description || '');
  const [localPrompt, setLocalPrompt] = React.useState(task.promptText || '');

  React.useEffect(() => {
     setLocalDesc(task.description || '');
  }, [task.description]);

  React.useEffect(() => {
     setLocalPrompt(task.promptText || '');
  }, [task.promptText]);

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: taskId });
  const style: React.CSSProperties = {
      transform: CSS.Transform.toString(transform),
      transition,
      opacity: isDragging ? 0.4 : 1,
      zIndex: isDragging ? 50 : 1,
      contentVisibility: 'auto',
      containIntrinsicSize: '350px'
  };

  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const cardRef = React.useRef<HTMLDivElement>(null);
  
  React.useEffect(() => {
     const handleScroll = (e: CustomEvent) => {
        if (e.detail === task.id && cardRef.current) {
           cardRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
     };
     window.addEventListener('scroll-to-task' as any, handleScroll);
     return () => window.removeEventListener('scroll-to-task' as any, handleScroll);
  }, [task.id]);

  const isListMode = viewMode === 'list';

  const getStatusDisplay = () => {
    switch (task.status) {
      case 'Waiting':
      case 'Idle':
         return <span className="text-[10px] px-2.5 py-[3px] rounded-full font-medium bg-black/[0.03] text-black/50 border border-black/[0.04]">待处理</span>;
      case 'Prompting':
         return <span className="text-[10px] px-2.5 py-[3px] rounded-full font-medium bg-[#FDF8EB] text-[#C99130] border border-[#C99130]/20 flex items-center gap-1.5"><span className="relative flex h-1.5 w-1.5"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#C99130] opacity-75"></span><span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-[#C99130]"></span></span>扩写中</span>;
      case 'Rendering':
         return <span className="text-[10px] px-2.5 py-[3px] rounded-full font-medium bg-[#FDF5F2] text-[#D97757] border border-[#D97757]/20 flex items-center gap-1.5"><span className="relative flex h-1.5 w-1.5"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#D97757] opacity-75"></span><span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-[#D97757]"></span></span>生成中</span>;
      case 'Success':
         return <span className="text-[10px] px-2.5 py-[3px] rounded-full font-medium bg-[#F3F9F5] text-[#2D734C] border border-[#2D734C]/10">已完成</span>;
      case 'Error':
         return <span className="text-[10px] px-2.5 py-[3px] rounded-full font-medium bg-[#FEF4F4] text-[#BE3827] border border-[#BE3827]/10">失败</span>;
    }
  };

  const idStr = `#${task.index.toString().padStart(3, '0')}`;

  const handleRunTask = (e: React.MouseEvent) => {
     e.stopPropagation();
     processSingleTask(task.id);
  };

  const handlePreviewPrompt = async (e: React.MouseEvent) => {
      e.stopPropagation();
      toast.promise(generateTaskPrompt(task.id), {
        loading: '正在通过 AI 生成提示词...',
        success: '提示词生成成功',
        error: '提示词生成失败'
      });
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
     if (e.target.files && e.target.files.length > 0) {
        const file = e.target.files[0];
        const reader = new FileReader();
        reader.onload = (event) => {
           if (event.target?.result) {
               updateTask(task.id, {
                  referenceImages: [...(task.referenceImages || []), event.target.result as string]
               });
           }
        };
        reader.readAsDataURL(file);
     }
  };

  return (
    <Card 
      ref={(node: any) => {
         setNodeRef(node);
         if (node) cardRef.current = node;
      }}
      style={style}
      className={`p-0 gap-0 bg-white flex overflow-hidden cursor-pointer transition-all duration-300 relative group
      ${isListMode ? 'flex-row items-center h-[140px]' : 'flex-col'} 
      ${isActive ? (isListMode ? 'border-black/10 shadow-md rounded-2xl h-auto items-stretch' : 'col-span-2 row-span-2 border-black/10 shadow-lg scale-[1.01] rounded-2xl z-40') : 'border border-black/[0.04] shadow-sm hover:shadow-md hover:border-black/10 rounded-2xl'}
      ${isSelected ? 'ring-2 ring-button-main ring-offset-2' : ''}`}
      onClick={(e) => {
         const target = e.target as HTMLElement;
         if (target.closest('button') || target.closest('.drag-handle') || target.tagName === 'TEXTAREA' || target.tagName === 'INPUT') return;
         setActiveTask(isActive ? null : task.id);
      }}
    >
      <div className={`bg-[#F5F4F0] flex items-center justify-center relative isolate overflow-hidden min-h-0 shrink-0
        ${isListMode ? 'border-r border-black/5' : 'border-b border-black/5'}
        ${isListMode ? (isActive ? 'w-[280px]' : 'w-[180px] h-full') : (isActive ? 'h-[280px] w-full' : 'flex-1 w-full aspect-[4/3]')}`}
      >
        {/* Skeleton effect when Rendering */}
        {(task.status === 'Rendering' || task.status === 'Prompting') && (
           <div className="absolute inset-0 z-10 bg-black/20 flex flex-col items-center justify-center">
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent -translate-x-full animate-[shimmer_1.5s_infinite]" />
           </div>
        )}
        
        {task.resultImage ? (
          <div className="relative w-full h-full group/result">
            <img src={task.resultImage} alt={task.title} loading="lazy" decoding="async" className="w-full h-full rounded-none object-contain drop-shadow-sm" referrerPolicy="no-referrer" />
            <div className="absolute bottom-3 right-12 opacity-0 group-hover:opacity-100 transition-opacity flex z-20">
               <button 
                  onClick={async (e) => {
                     e.stopPropagation();
                     try {
                        const { saveAs } = await import('file-saver');
                        if (task.resultImage?.startsWith('http')) {
                            const res = await fetch(task.resultImage);
                            const blob = await res.blob();
                            saveAs(blob, `${task.title}.jpg`);
                        } else {
                            saveAs(task.resultImage as string, `${task.title}.jpg`);
                        }
                     } catch(err) {
                        window.open(task.resultImage, '_blank');
                     }
                  }}
                  className="w-8 h-8 bg-black/40 hover:bg-black/70 text-white rounded-full flex items-center justify-center backdrop-blur-sm shadow-sm"
                  title="下载结果图"
               >
                 <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>
               </button>
            </div>
          </div>
        ) : task.sourceImage ? (
          <div className="w-full h-full rounded-none overflow-hidden relative group/source">
             <img src={task.sourceImage} alt="Source" loading="lazy" decoding="async" className="w-full h-full object-contain drop-shadow-sm" referrerPolicy="no-referrer" />
             {isActive && (
                <div 
                   className="absolute inset-0 bg-black/40 opacity-0 group-hover/source:opacity-100 transition-opacity flex items-center justify-center cursor-pointer"
                   onClick={(e) => {
                      e.stopPropagation();
                      const input = document.createElement('input');
                      input.type = 'file';
                      input.accept = 'image/*';
                      input.onchange = (ev: any) => {
                         if (ev.target.files && ev.target.files.length > 0) {
                            const reader = new FileReader();
                            reader.onload = (e) => updateTask(task.id, { sourceImage: e.target?.result as string });
                            reader.readAsDataURL(ev.target.files[0]);
                         }
                      };
                      input.click();
                   }}
                >
                   <span className="text-white text-[11px] bg-black/60 px-3 py-1.5 rounded-full backdrop-blur-sm shadow-sm flex items-center gap-1"><Upload className="w-3 h-3"/> 替换原图</span>
                </div>
             )}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center text-text-secondary/50 gap-2">
             <ImageIcon className="w-6 h-6 opacity-30" strokeWidth={1} />
          </div>
        )}
        
        {/* Selection Checkbox & Drag Handle */}
        <div className="absolute top-3 left-3 flex gap-2 items-center z-20">
           <div className="drag-handle p-1 bg-white/60 hover:bg-white rounded cursor-grab opacity-0 group-hover:opacity-100 backdrop-blur-sm shadow-sm transition-opacity" {...attributes} {...listeners}>
              <GripVertical className="w-3.5 h-3.5 text-black" />
           </div>
           <input 
              type="checkbox" 
              className={`w-4 h-4 rounded appearance-none border border-black/30 checked:bg-button-main checked:border-button-main flex items-center justify-center cursor-pointer relative bg-white/60 backdrop-blur-sm transition-all
              ${isSelected ? 'opacity-100 after:content-["✓"] after:absolute after:text-white after:text-[10px]' : 'opacity-0 group-hover:opacity-100'}`}
              checked={isSelected}
              onChange={() => toggleTaskSelection(task.id)}
              onClick={e => e.stopPropagation()}
           />
        </div>

        {/* Lightbox Trigger */}
        {(task.resultImage || task.sourceImage) && (
           <button 
             onClick={(e) => { e.stopPropagation(); setLightboxTask(task.id); }}
             className="absolute bottom-3 right-3 w-8 h-8 bg-black/40 hover:bg-black/70 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity backdrop-blur-sm z-20"
           >
              <Fullscreen className="w-4 h-4" />
           </button>
        )}

        {/* Delete Task Button */}
        <button
           onClick={(e) => { 
             e.stopPropagation(); 
             removeTask(task.id); 
           }}
           className="absolute top-3 right-3 w-8 h-8 bg-black/40 hover:bg-red-500/90 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity backdrop-blur-sm shadow-sm z-20"
           title="删除任务"
        >
           <Trash2 className="w-4 h-4" />
        </button>
      </div>
      
      <div className="p-4 shrink-0 bg-white flex flex-col flex-1 border-t border-transparent relative z-10 w-full">
         <div className="flex justify-between items-center mb-1.5">
           <span className="text-[10px] font-mono text-text-secondary">{idStr}</span>
           {getStatusDisplay()}
         </div>
         <div className="text-[13px] font-serif leading-tight whitespace-nowrap overflow-hidden text-ellipsis text-foreground font-medium">
            {task.title}
         </div>
         
         {!isActive && task.description && <div className="text-[11px] text-text-secondary truncate mt-1">{task.description}</div>}

         {isActive && (
            <div className="mt-3 flex flex-col gap-3 animate-in fade-in slide-in-from-top-2 duration-300 w-full min-w-0">
               
               {/* --- Top Metadata Row (References & Params) --- */}
               <div className="flex flex-wrap items-stretch gap-2.5 bg-black/[0.02] p-2 rounded-lg border border-black/5">
                 
                 {/* Global Ref Images (Read Only Mode) */}
                 {globalReferenceImages.length > 0 && (
                   <div className="flex flex-col gap-1.5 shrink-0 border-r border-black/5 pr-2.5">
                      <span className="text-[9px] font-bold text-black/50 uppercase tracking-wider flex items-center gap-1">
                        <span className="w-1.5 h-1.5 bg-button-main/60 rounded-full"></span> 全局参考图 (已应用)
                      </span>
                      <div className="flex gap-1.5 opacity-80 pointer-events-none">
                         {globalReferenceImages.map((img, i) => (
                            <div key={i} className="w-7 h-7 rounded-sm overflow-hidden border border-black/10 shadow-sm">
                               <img src={img} className="w-full h-full object-cover" alt="Global Ref" />
                            </div>
                         ))}
                      </div>
                   </div>
                 )}

                 {/* Local References */}
                 <div className="flex flex-col gap-1.5 shrink-0 border-r border-black/5 pr-2.5">
                    <span className="text-[9px] font-bold text-black/40 px-0.5 uppercase tracking-wider">独立参考图</span>
                    <div className="flex gap-1.5 flex-wrap">
                       {task.referenceImages?.map((img, i) => (
                          <div key={i} className="w-7 h-7 rounded-sm overflow-hidden border border-black/10 shadow-sm relative group/ref">
                             <img src={img} className="w-full h-full object-cover" alt="Ref" />
                             <div className="absolute inset-0 bg-black/60 opacity-0 group-hover/ref:opacity-100 flex flex-col items-center justify-center transition-opacity text-white backdrop-blur-sm">
                                <div 
                                  className="w-full text-center py-0.5 hover:bg-white/20 text-[9px] cursor-pointer leading-none"
                                  onClick={(e) => {
                                     e.stopPropagation();
                                     const input = document.createElement('input');
                                     input.type = 'file';
                                     input.accept = 'image/*';
                                     input.onchange = (ev: any) => {
                                        if (ev.target.files && ev.target.files.length > 0) {
                                           const reader = new FileReader();
                                           reader.onload = (re) => {
                                              const newRefs = [...(task.referenceImages || [])];
                                              newRefs[i] = re.target?.result as string;
                                              updateTask(task.id, { referenceImages: newRefs });
                                           };
                                           reader.readAsDataURL(ev.target.files[0]);
                                        }
                                     };
                                     input.click();
                                  }}
                                >
                                   换
                                </div>
                                <div className="h-px w-full bg-white/20 my-0.5" />
                                <div 
                                  className="w-full text-center py-0.5 hover:bg-red-500/50 text-[9px] cursor-pointer leading-none"
                                  onClick={() => updateTask(task.id, { referenceImages: task.referenceImages?.filter((_, idx) => idx !== i) })}
                                >
                                   删
                                </div>
                             </div>
                          </div>
                       ))}
                       <div 
                          className="w-7 h-7 flex items-center justify-center border border-dashed border-black/20 rounded-sm text-black/40 cursor-pointer hover:bg-black/5 bg-white/50 transition-colors shrink-0 shadow-sm"
                          onClick={() => fileInputRef.current?.click()}
                       >
                          <Upload className="w-3.5 h-3.5 opacity-70" strokeWidth={2} />
                       </div>
                    </div>
                 </div>

                 {/* Local Params Override */}
                 <div className="flex flex-col gap-1.5 shrink-0 justify-between">
                    <span className="text-[9px] font-bold text-black/40 px-0.5 uppercase tracking-wider">专属参数</span>
                    <GenerateParamsSelector 
                      aspectRatio={task.aspectRatio || useAppStore.getState().globalAspectRatio}
                      resolution={task.resolution || useAppStore.getState().globalResolution}
                      onAspectRatioChange={(ar) => updateTask(task.id, { aspectRatio: ar === useAppStore.getState().globalAspectRatio ? undefined : ar })}
                      onResolutionChange={(res) => updateTask(task.id, { resolution: res === useAppStore.getState().globalResolution ? undefined : res })}
                      triggerClassName="w-fit h-7 text-[10px] px-2 bg-white shadow-sm border-black/10 hover:border-black/20"
                    />
                 </div>
               </div>

               {/* 2. User Desc vs AI Prompt Comparison */}
               <div className="flex flex-col gap-2.5">
                  <div className="flex flex-col gap-1">
                    <span className="text-[9px] font-bold text-black/40 px-0.5 uppercase tracking-wider">生成指示</span>
                    <Textarea 
                       value={localDesc}
                       onChange={(e) => setLocalDesc(e.target.value)}
                       onBlur={() => { if (localDesc !== task.description) updateTask(task.id, { description: localDesc }) }}
                       placeholder="输入简短的中/英文要求..."
                       className="min-h-[30px] text-[12px] leading-relaxed text-text-secondary bg-transparent border border-black/5 hover:border-black/10 focus-visible:border-black/20 resize-none shadow-sm px-2.5 py-2 rounded-lg transition-colors"
                    />
                  </div>
                  
                  {task.promptText && (
                     <div className="flex flex-col gap-1">
                        <span className="text-[9px] font-bold text-black/40 px-0.5 uppercase tracking-wider">AI PROMPT</span>
                        <Textarea 
                           value={localPrompt}
                           onChange={(e) => setLocalPrompt(e.target.value)}
                           onBlur={() => { if (localPrompt !== task.promptText) updateTask(task.id, { promptText: localPrompt }) }}
                           className="min-h-[60px] text-[11px] font-mono leading-relaxed text-black/70 bg-black/[0.03] border border-transparent hover:border-black/10 focus-visible:border-black/20 focus-visible:bg-white resize-y shadow-inner px-2.5 py-2 rounded-lg transition-all"
                        />
                     </div>
                  )}
               </div>

               <div className="mt-1 pt-2.5 flex items-center justify-between gap-2">
                   <Button variant="ghost" className="h-7 px-2.5 rounded-md text-[11px] font-medium hover:bg-black/5 text-text-secondary disabled:opacity-50" onClick={handlePreviewPrompt} disabled={task.status === 'Prompting'}>
                      <Eye className="w-3 h-3 mr-1 opacity-70" /> 预览提示词
                   </Button>
                   <Button className="h-7 px-3.5 rounded-md shadow-sm bg-[#1A1A1A] hover:bg-[#2C2B29] text-white text-[11px] font-medium disabled:opacity-50" onClick={handleRunTask} disabled={task.status === 'Rendering' || task.status === 'Prompting'}>
                      执行此项
                   </Button>
               </div>
               
               {task.status === 'Error' && task.errorLog && (
                  <div className="mt-1 p-3 bg-[#FEF4F4] text-[#BE3827] text-[11.5px] rounded-xl border border-[#BE3827]/10 flex flex-col gap-1 leading-relaxed">
                     <div className="font-semibold flex items-center gap-1.5 -ml-0.5"><div className="w-1.5 h-1.5 rounded-full bg-[#BE3827]"></div> {task.errorLog.stage === 'Prompt Generation' ? '提示词生成' : (task.errorLog.stage === 'Image Generation' ? '图像生成' : task.errorLog.stage)} 失败</div>
                     <span className="opacity-80 break-words font-mono text-[10.5px]">{task.errorLog.message}</span>
                  </div>
               )}
            </div>
         )}
      </div>
    </Card>
  );
});
