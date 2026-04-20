import { Task } from '@/types';
import { useAppStore } from '@/store';
import { Card } from '../ui/card';
import { ImageIcon, Upload, Eye, Fullscreen, GripVertical, Trash2 } from 'lucide-react';
import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';
import * as React from 'react';
import { generateTaskPrompt, processSingleTask } from '@/lib/batchRunner';
import { toast } from 'sonner';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GenerateParamsSelector } from '../GenerateParamsSelector';

type TaskCardProps = {
  taskId: string;
  key?: React.Key;
  isFileDropTarget?: boolean;
  onFileDragEnter?: (taskId: string) => void;
  onFileDragLeave?: (taskId: string) => void;
  onFileDrop?: (taskId: string, files: File[]) => void;
};

function hasImageFiles(dataTransfer?: DataTransfer | null) {
  if (!dataTransfer) return false;
  return Array.from(dataTransfer.items || []).some((item) => item.kind === 'file' && item.type.startsWith('image/'));
}

function preventNativeImageDrag(e: React.DragEvent<HTMLImageElement>) {
  e.preventDefault();
}

export const TaskCard = React.memo(function TaskCard({
  taskId,
  isFileDropTarget = false,
  onFileDragEnter,
  onFileDragLeave,
  onFileDrop
}: TaskCardProps) {
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
  const globalAspectRatio = useAppStore(state => state.globalAspectRatio);
  const globalResolution = useAppStore(state => state.globalResolution);

  if (!task) return null;

  const [localDesc, setLocalDesc] = React.useState(task.description || '');
  const [localPrompt, setLocalPrompt] = React.useState(task.promptText || '');
  const isListMode = viewMode === 'list';

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
  const dragDepthRef = React.useRef(0);

  React.useEffect(() => {
    const handleScroll = (e: CustomEvent) => {
      if (e.detail?.id === task.id && cardRef.current) {
        cardRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    };
    window.addEventListener('scroll-to-task' as any, handleScroll);
    return () => window.removeEventListener('scroll-to-task' as any, handleScroll);
  }, [task.id]);

  const getStatusDisplay = () => {
    switch (task.status) {
      case 'Waiting':
      case 'Idle':
        return <span className="text-[10.5px] px-2.5 py-[3px] rounded-full font-medium bg-black/[0.03] text-black/50 border border-black/[0.04]">待处理</span>;
      case 'Prompting':
        return <span className="text-[10.5px] px-2.5 py-[3px] rounded-full font-medium bg-[#FDF8EB] text-[#C99130] border border-[#C99130]/20 flex items-center gap-1.5"><span className="relative flex h-1.5 w-1.5"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#C99130] opacity-75"></span><span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-[#C99130]"></span></span>生成提示词中</span>;
      case 'Rendering':
        return <span className="text-[10.5px] px-2.5 py-[3px] rounded-full font-medium bg-[#FDF5F2] text-[#D97757] border border-[#D97757]/20 flex items-center gap-1.5"><span className="relative flex h-1.5 w-1.5"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#D97757] opacity-75"></span><span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-[#D97757]"></span></span>生成图片中</span>;
      case 'Success':
        return <span className="text-[10.5px] px-2.5 py-[3px] rounded-full font-medium bg-[#F3F9F5] text-[#2D734C] border border-[#2D734C]/10">已完成</span>;
      case 'Error':
        return <span className="text-[10.5px] px-2.5 py-[3px] rounded-full font-medium bg-[#FEF4F4] text-[#BE3827] border border-[#BE3827]/10">失败</span>;
      default:
        return null;
    }
  };

  const idStr = `#${task.index.toString().padStart(3, '0')}`;

  const getOutputSizeLabel = () => {
    if (!task.resultImageWidth || !task.resultImageHeight) return null;
    return `${task.resultImageWidth} × ${task.resultImageHeight}`;
  };

  const hasTaskReferenceImages = (task.referenceImages?.length || 0) > 0;
  const hasCustomAspectRatio = Boolean(task.aspectRatio && task.aspectRatio !== globalAspectRatio);
  const hasCustomResolution = Boolean(task.resolution && task.resolution !== globalResolution);

  const getCompactParamsLabel = () => {
    const parts: string[] = [];
    if (hasCustomAspectRatio && task.aspectRatio) {
      parts.push(task.aspectRatio === 'auto' ? '??' : task.aspectRatio);
    }
    if (hasCustomResolution && task.resolution) {
      parts.push(task.resolution);
    }
    return parts.join(' ? ');
  };

  const handleRunTask = (e: React.MouseEvent) => {
    e.stopPropagation();
    processSingleTask(task.id);
  };

  const handlePreviewPrompt = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const previewPromise = generateTaskPrompt(task.id).then((generatedPrompt) => {
      updateTask(task.id, { promptText: generatedPrompt, promptSource: 'auto' });
      return generatedPrompt;
    });

    toast.promise(previewPromise, {
      loading: '正在通过 AI 生成提示词...',
      success: '提示词已更新',
      error: '提示词生成失败'
    });

    await previewPromise;
  };

  const updateReferenceImage = (index: number, value: string) => {
    const nextRefs = [...(task.referenceImages || [])];
    nextRefs[index] = value;
    updateTask(task.id, { referenceImages: nextRefs });
  };

  const appendReferenceImage = (value: string) => {
    updateTask(task.id, { referenceImages: [...(task.referenceImages || []), value] });
  };

  const readImageFile = (file: File, onLoad: (result: string) => void) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const result = event.target?.result;
      if (typeof result === 'string') onLoad(result);
    };
    reader.readAsDataURL(file);
  };

  const renderSourceArea = () => {
    if (task.resultImage) {
      return (
        <div className="relative w-full h-full group/result">
          <img src={task.resultImage} alt={task.title} loading="lazy" decoding="async" className="w-full h-full rounded-none object-contain drop-shadow-sm" referrerPolicy="no-referrer" draggable={false} onDragStart={preventNativeImageDrag} />
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
                } catch {
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
      );
    }

    if (task.sourceImage) {
      return (
        <div className="w-full h-full rounded-none overflow-hidden relative group/source">
          <img src={task.sourceImage} alt="Source" loading="lazy" decoding="async" className="w-full h-full object-contain drop-shadow-sm" referrerPolicy="no-referrer" draggable={false} onDragStart={preventNativeImageDrag} />

        {isActive && (
            <div
              className="absolute inset-0 bg-black/40 opacity-0 group-hover/source:opacity-100 transition-opacity flex items-center justify-center cursor-pointer"
              onClick={(e) => {
                e.stopPropagation();
                const input = document.createElement('input');
                input.type = 'file';
                input.accept = 'image/*';
                input.onchange = (ev: any) => {
                  if (ev.target.files?.length) {
                    readImageFile(ev.target.files[0], (result) => updateTask(task.id, { sourceImage: result }));
                  }
                };
                input.click();
              }}
            >
              <span className="text-white text-[11.55px] bg-black/60 px-3 py-1.5 rounded-full backdrop-blur-sm shadow-sm flex items-center gap-1">
                <Upload className="w-3 h-3" /> 替换原图
              </span>
            </div>
          )}
        </div>
      );
    }

    return (
      <div className="flex flex-col items-center justify-center text-text-secondary/50 gap-2">
        <ImageIcon className="w-6 h-6 opacity-30" strokeWidth={1} />
      </div>
    );
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
      ${isActive ? (isListMode ? 'border-border/50 shadow-[0_8px_30px_rgb(0,0,0,0.08)] rounded-2xl h-auto items-stretch' : 'col-span-2 row-span-2 shadow-[0_12px_40px_-5px_rgba(0,0,0,0.12)] scale-[1.01] rounded-[24px] z-40 border border-transparent') : 'border border-border/40 shadow-sm hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] hover:border-border/80 rounded-2xl hover:-translate-y-0.5'}
      ${isSelected ? 'ring-2 ring-button-main ring-offset-2' : ''}
      ${isFileDropTarget ? 'ring-2 ring-button-main/70 ring-offset-2 shadow-[0_12px_40px_-5px_rgba(223,122,87,0.22)]' : ''}`}
      onClick={(e) => {
        const target = e.target as HTMLElement;
        if (target.closest('button') || target.closest('.drag-handle') || target.tagName === 'TEXTAREA' || target.tagName === 'INPUT') return;
        setActiveTask(isActive ? null : task.id);
      }}
      onDragEnter={(e) => {
        if (!hasImageFiles(e.dataTransfer)) return;
        e.preventDefault();
        e.stopPropagation();
        dragDepthRef.current += 1;
        onFileDragEnter?.(task.id);
      }}
      onDragOver={(e) => {
        if (!hasImageFiles(e.dataTransfer)) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'copy';
        onFileDragEnter?.(task.id);
      }}
      onDragLeave={(e) => {
        if (!hasImageFiles(e.dataTransfer)) return;
        e.preventDefault();
        e.stopPropagation();
        dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
        if (dragDepthRef.current === 0) {
          onFileDragLeave?.(task.id);
        }
      }}
      onDrop={(e) => {
        if (!hasImageFiles(e.dataTransfer)) return;
        e.preventDefault();
        e.stopPropagation();
        dragDepthRef.current = 0;
        const files = Array.from(e.dataTransfer.files || []) as File[];
        const imageFiles = files.filter(file => file.type.startsWith('image/'));
        if (imageFiles.length > 0) {
          onFileDrop?.(task.id, imageFiles);
        }
      }}
    >
      <div
        className={`bg-[#F9F8F6] flex items-center justify-center relative isolate overflow-hidden min-h-0 shrink-0
        ${isListMode ? 'border-r border-border/40' : 'border-b border-border/40'}
        ${isListMode ? (isActive ? 'w-[280px]' : 'w-[180px] h-full') : (isActive ? 'h-[280px] w-full rounded-t-[24px]' : 'flex-1 w-full aspect-[4/3] rounded-t-2xl')}`}
      >
        {(task.status === 'Rendering' || task.status === 'Prompting') && (
          <div className="absolute inset-0 z-10 bg-black/20 flex flex-col items-center justify-center">
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent -translate-x-full animate-[shimmer_1.5s_infinite]" />
          </div>
        )}

        {renderSourceArea()}

        {isFileDropTarget && (
          <div className="absolute inset-0 z-20 bg-white/55 backdrop-blur-[1px] border-2 border-dashed border-button-main/50 flex items-center justify-center pointer-events-none">
            <div className="px-3 py-1.5 rounded-full bg-white/90 text-[12.6px] text-text-primary shadow-sm border border-button-main/15">
              松手添加为参考图
            </div>
          </div>
        )}

        {task.resultImageWidth && task.resultImageHeight && (
          <div className="absolute left-3 bottom-3 z-20 pointer-events-none">
            <div className="inline-flex items-center rounded-md border border-black/10 bg-white/68 px-2 py-1 text-[10.5px] text-black/45 backdrop-blur-sm">
              <span className="font-mono">{getOutputSizeLabel()}</span>
            </div>
          </div>
        )}

        <div className="absolute top-3 left-3 flex gap-2 items-center z-20">
          <div className="drag-handle p-1 bg-white/60 hover:bg-white rounded cursor-grab opacity-0 group-hover:opacity-100 backdrop-blur-sm shadow-sm transition-opacity" {...attributes} {...listeners}>
            <GripVertical className="w-3.5 h-3.5 text-black" />
          </div>
          <input
            type="checkbox"
            className={`w-4 h-4 rounded appearance-none border border-black/30 checked:bg-button-main checked:border-button-main flex items-center justify-center cursor-pointer relative bg-white/60 backdrop-blur-sm transition-all
            ${isSelected ? 'opacity-100 after:content-["✓"] after:absolute after:text-white after:text-[10.5px]' : 'opacity-0 group-hover:opacity-100'}`}
            checked={isSelected}
            onChange={() => toggleTaskSelection(task.id)}
            onClick={(e) => e.stopPropagation()}
          />
        </div>

        {(task.resultImage || task.sourceImage) && (
          <button
            onClick={(e) => { e.stopPropagation(); setLightboxTask(task.id); }}
            className="absolute bottom-3 right-3 w-8 h-8 bg-black/40 hover:bg-black/70 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity backdrop-blur-sm z-20"
          >
            <Fullscreen className="w-4 h-4" />
          </button>
        )}

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
          <span className="text-[10.5px] font-mono text-text-secondary">{idStr}</span>
          {getStatusDisplay()}
        </div>
        <div className="text-[13.65px] font-serif leading-tight whitespace-nowrap overflow-hidden text-ellipsis text-foreground font-medium">
          {task.title}
        </div>

        {!isActive && task.description && <div className="text-[11.55px] text-text-secondary truncate mt-1">{task.description}</div>}

        {!isActive && (hasTaskReferenceImages || hasCustomAspectRatio || hasCustomResolution) && (
          <div className="mt-2 flex items-center gap-2 min-h-[28px]">
            {hasTaskReferenceImages && (
              <div className="flex items-center gap-1.5">
                {task.referenceImages.slice(0, 2).map((img, i) => (
                  <div
                    key={`${task.id}-compact-ref-${i}`}
                    className="w-7 h-7 rounded-md overflow-hidden border border-black/10 bg-white shadow-sm"
                    title="任务参考图"
                  >
                    <img
                      src={img}
                      className="w-full h-full object-cover"
                      alt="Task reference"
                      draggable={false}
                      onDragStart={preventNativeImageDrag}
                    />
                  </div>
                ))}
                {(task.referenceImages?.length || 0) > 2 && (
                  <div className="h-7 min-w-7 px-1.5 rounded-md border border-black/8 bg-black/[0.03] text-[10.5px] text-black/45 flex items-center justify-center shadow-sm">
                    +{(task.referenceImages?.length || 0) - 2}
                  </div>
                )}
              </div>
            )}

            {(hasCustomAspectRatio || hasCustomResolution) && (
              <div className="inline-flex items-center rounded-md border border-black/10 bg-black/[0.025] px-2 py-1 text-[10.5px] text-black/55">
                {getCompactParamsLabel()}
              </div>
            )}
          </div>
        )}

        {isActive && (
          <div className="mt-3 flex flex-col gap-3 animate-in fade-in slide-in-from-top-2 duration-300 w-full min-w-0">
            <div className="grid grid-cols-[auto_auto_1fr] items-stretch gap-0 bg-black/[0.02] rounded-xl border border-black/5 overflow-hidden min-h-[92px]">
              {globalReferenceImages.length > 0 && (
                <div className="flex flex-col justify-between gap-2 px-4 py-3 border-r border-black/5 min-w-[96px]">
                  <span className="text-[9.45px] font-bold text-black/45 uppercase tracking-wider flex items-center gap-1">
                    <span className="w-1.5 h-1.5 bg-button-main/60 rounded-full"></span> 全局参考图
                  </span>
                  <div className="flex gap-2 opacity-80 pointer-events-none">
                    {globalReferenceImages.map((img, i) => (
                      <div key={i} className="w-11 h-11 rounded-lg overflow-hidden border border-black/10 shadow-sm bg-white">
                        <img src={img} className="w-full h-full object-cover" alt="Global Ref" draggable={false} onDragStart={preventNativeImageDrag} />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex flex-col justify-between gap-2 px-4 py-3 border-r border-black/5 min-w-[188px]">
                <span className="text-[9.45px] font-bold text-black/45 uppercase tracking-wider">任务参考图</span>
                <div className="flex gap-2 items-center">
                  {task.referenceImages?.map((img, i) => (
                    <div key={i} className="w-11 h-11 rounded-lg overflow-hidden border border-black/10 shadow-sm relative group/ref cursor-pointer bg-white" onClick={(e) => { e.stopPropagation(); window.open(img, '_blank'); }}>
                      <img src={img} className="w-full h-full object-cover" alt="Ref" title="点击预览参考图" draggable={false} onDragStart={preventNativeImageDrag} />
                      <div className="absolute inset-0 bg-black/50 opacity-0 group-hover/ref:opacity-100 transition-opacity backdrop-blur-[1px]">
                        <div className="absolute inset-x-0 bottom-0 grid grid-cols-2 gap-px bg-white/15">
                          <button
                            type="button"
                            className="h-5 bg-black/60 hover:bg-black/75 text-white text-[9px] font-medium"
                            onClick={(e) => {
                              e.stopPropagation();
                              const input = document.createElement('input');
                              input.type = 'file';
                              input.accept = 'image/*';
                              input.onchange = (ev: any) => {
                                if (ev.target.files?.length) {
                                  readImageFile(ev.target.files[0], (result) => updateReferenceImage(i, result));
                                }
                              };
                              input.click();
                            }}
                          >
                            换
                          </button>
                          <button
                            type="button"
                            className="h-5 bg-black/60 hover:bg-red-500/85 text-white text-[9px] font-medium"
                            onClick={(e) => {
                              e.stopPropagation();
                              updateTask(task.id, { referenceImages: task.referenceImages.filter((_, idx) => idx !== i) });
                            }}
                          >
                            删
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                  <button
                    type="button"
                    className="h-11 w-11 flex items-center justify-center border border-dashed border-black/20 rounded-lg text-black/50 cursor-pointer hover:bg-black/5 bg-white/80 transition-colors shrink-0 shadow-sm"
                    onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
                  >
                    <Upload className="w-3.5 h-3.5 opacity-70" strokeWidth={2} />
                  </button>
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    ref={fileInputRef}
                    onChange={(e) => {
                      if (e.target.files?.length) {
                        readImageFile(e.target.files[0], appendReferenceImage);
                      }
                      e.target.value = '';
                    }}
                  />
                </div>
              </div>

              <div className="flex flex-col justify-between gap-2 px-4 py-3 min-w-[152px]">
                <span className="text-[9.45px] font-bold text-black/45 uppercase tracking-wider">专属参数</span>
                <GenerateParamsSelector
                  aspectRatio={task.aspectRatio || globalAspectRatio}
                  resolution={task.resolution || globalResolution}
                  onAspectRatioChange={(ar) => updateTask(task.id, { aspectRatio: ar === globalAspectRatio ? undefined : ar })}
                  onResolutionChange={(res) => updateTask(task.id, { resolution: res === globalResolution ? undefined : res })}
                  triggerClassName="w-fit h-9 text-[10.5px] px-3 bg-white shadow-sm border-black/10 hover:border-black/20"
                />
              </div>
            </div>

            <div className="flex flex-col gap-2.5">
              <div className="flex flex-col gap-1">
                <span className="text-[9.45px] font-bold text-black/40 px-0.5 uppercase tracking-wider">生成指示</span>
                <Textarea
                  value={localDesc}
                  onChange={(e) => setLocalDesc(e.target.value)}
                  onBlur={() => {
                    if (localDesc !== task.description) updateTask(task.id, { description: localDesc });
                  }}
                  placeholder="输入这条任务的处理要求..."
                  className="min-h-[30px] text-[12.6px] leading-relaxed text-text-secondary bg-transparent border border-black/5 hover:border-black/10 focus-visible:border-black/20 resize-none shadow-sm px-2.5 py-2 rounded-lg transition-colors"
                />
              </div>

              {task.promptText && (
                <div className="flex flex-col gap-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[9.45px] font-bold text-black/40 px-0.5 uppercase tracking-wider">AI PROMPT</span>
                    <span className={`text-[9.45px] px-2 py-0.5 rounded-full border uppercase tracking-wider ${
                      task.promptSource === 'manual'
                        ? 'text-[#9A6700] bg-[#FFF7DB] border-[#F0D27A]'
                        : 'text-[#2D734C] bg-[#F3F9F5] border-[#B9D6C4]'
                    }`}>
                      {task.promptSource === 'manual' ? 'manual' : 'auto'}
                    </span>
                  </div>
                  <Textarea
                    value={localPrompt}
                    onChange={(e) => setLocalPrompt(e.target.value)}
                    onBlur={() => {
                      if (localPrompt !== task.promptText) {
                        updateTask(task.id, { promptText: localPrompt, promptSource: 'manual' });
                      }
                    }}
                    className="min-h-[60px] text-[11.55px] font-mono leading-relaxed text-black/70 bg-black/[0.03] border border-transparent hover:border-black/10 focus-visible:border-black/20 focus-visible:bg-white resize-y shadow-inner px-2.5 py-2 rounded-lg transition-all"
                  />
                </div>
              )}

            </div>

            <div className="mt-1 pt-2.5 flex items-center justify-between gap-2">
              <Button variant="ghost" className="h-7 px-2.5 rounded-md text-[11.55px] font-medium hover:bg-black/5 text-text-secondary disabled:opacity-50" onClick={handlePreviewPrompt} disabled={task.status === 'Prompting'}>
                <Eye className="w-3 h-3 mr-1 opacity-70" /> 预览提示词
              </Button>
              <Button className="h-7 px-3.5 rounded-md shadow-sm bg-[#1A1A1A] hover:bg-[#2C2B29] text-white text-[11.55px] font-medium disabled:opacity-50" onClick={handleRunTask} disabled={task.status === 'Rendering' || task.status === 'Prompting'}>
                执行此项
              </Button>
            </div>

            {task.status === 'Error' && task.errorLog && (
              <div className="mt-1 p-3 bg-[#FEF4F4] text-[#BE3827] text-[12.08px] rounded-xl border border-[#BE3827]/10 flex flex-col gap-1 leading-relaxed">
                <div className="font-semibold flex items-center gap-1.5 -ml-0.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-[#BE3827]"></div>
                  {task.errorLog.stage === 'Prompt Generation' ? '提示词生成' : (task.errorLog.stage === 'Image Generation' ? '图片生成' : task.errorLog.stage)} 失败
                </div>
                <span className="opacity-80 break-words font-mono text-[11.03px]">{task.errorLog.message}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </Card>
  );
});
