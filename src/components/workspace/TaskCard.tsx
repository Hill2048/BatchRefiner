import * as React from 'react';
import { CSS } from '@dnd-kit/utilities';
import { useSortable } from '@dnd-kit/sortable';
import { Download, Eye, Fullscreen, GripVertical, ImageIcon, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Task } from '@/types';
import { useAppStore } from '@/store';
import { generateTaskPrompt, processSingleTask } from '@/lib/batchRunner';
import { getBatchCountNumber, getEffectiveBatchCount, getPrimaryTaskResult, getTaskResultImages, getTaskResultProgress } from '@/lib/taskResults';
import { getTaskViewerItems, getTaskViewerMainImage } from '@/lib/taskViewer';
import { Card } from '../ui/card';
import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';
import { GenerateParamsSelector } from '../GenerateParamsSelector';
import { useAutoSaveTextEditor } from './useAutoSaveTextEditor';

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

type ViewerMode = 'result' | 'source';

export const TaskCard = React.memo(function TaskCard({
  taskId,
  isFileDropTarget = false,
  onFileDragEnter,
  onFileDragLeave,
  onFileDrop
}: TaskCardProps) {
  const task = useAppStore(state => state.tasks.find(t => t.id === taskId));
  const isActive = useAppStore(state => state.activeTaskId === taskId);
  const setActiveTask = useAppStore(state => state.setActiveTask);
  const updateTask = useAppStore(state => state.updateTask);
  const removeTask = useAppStore(state => state.removeTask);
  const setLightboxTask = useAppStore(state => state.setLightboxTask);
  const viewMode = useAppStore(state => state.viewMode);
  const isSelected = useAppStore(state => state.selectedTaskIds.includes(taskId));
  const toggleTaskSelection = useAppStore(state => state.toggleTaskSelection);
  const globalReferenceImages = useAppStore(state => state.globalReferenceImages);
  const globalAspectRatio = useAppStore(state => state.globalAspectRatio);
  const globalResolution = useAppStore(state => state.globalResolution);
  const globalBatchCount = useAppStore(state => state.globalBatchCount);
  const imageModel = useAppStore(state => state.imageModel);

  if (!task) return null;

  const resultImages = getTaskResultImages(task);
  const primaryResult = getPrimaryTaskResult(task);
  const resultProgress = getTaskResultProgress(task, globalBatchCount);
  const effectiveBatchCount = getEffectiveBatchCount(task, globalBatchCount);
  const isListMode = viewMode === 'list';
  const [selectedResultIndex, setSelectedResultIndex] = React.useState(0);
  const [viewerMode, setViewerMode] = React.useState<ViewerMode>('result');
  const descriptionEditor = useAutoSaveTextEditor({
    value: task.description || '',
    onSave: (nextValue) => updateTask(task.id, { description: nextValue }),
  });
  const promptEditor = useAutoSaveTextEditor({
    value: task.promptText || '',
    onSave: (nextValue) => updateTask(task.id, { promptText: nextValue, promptSource: 'manual' }),
  });

  React.useEffect(() => {
    if (resultImages.length === 0) {
      setSelectedResultIndex(0);
      setViewerMode(task.sourceImage ? 'source' : 'result');
      return;
    }
    if (selectedResultIndex > resultImages.length - 1) {
      setSelectedResultIndex(0);
    }
    if (viewerMode !== 'source') {
      setViewerMode('result');
    }
  }, [resultImages.length, selectedResultIndex, viewerMode, task.sourceImage]);

  const activeResult = resultImages[selectedResultIndex] || primaryResult;
  const coverImageSrc = primaryResult?.src || task.sourceImage;
  const showProgressBadge = resultProgress.requested > 1 && resultImages.length > 0;

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: taskId });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    zIndex: isDragging ? 50 : 1,
    contentVisibility: 'auto',
    containIntrinsicSize: '350px',
  };

  const cardRef = React.useRef<HTMLDivElement>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
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

  const downloadResultImage = async (resultSrc: string, fileName: string) => {
    try {
      const { saveAs } = await import('file-saver');
      if (resultSrc.startsWith('http')) {
        const res = await fetch(resultSrc);
        const blob = await res.blob();
        saveAs(blob, fileName);
      } else {
        saveAs(resultSrc, fileName);
      }
    } catch {
      window.open(resultSrc, '_blank');
    }
  };

  const handlePreviewPrompt = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const previewPromise = generateTaskPrompt(task.id).then((generatedPrompt) => {
      updateTask(task.id, { promptText: generatedPrompt, promptSource: 'auto' });
      return generatedPrompt;
    });

    toast.promise(previewPromise, {
      loading: '正在生成提示词...',
      success: '提示词已更新',
      error: '提示词生成失败',
    });

    await previewPromise;
  };

  const getStatusDisplay = () => {
    switch (task.status) {
      case 'Waiting':
      case 'Idle':
        return <span className="text-[10.5px] px-2.5 py-[3px] rounded-full font-medium bg-black/[0.03] text-black/50 border border-black/[0.04]">待处理</span>;
      case 'Prompting':
        return <span className="text-[10.5px] px-2.5 py-[3px] rounded-full font-medium bg-[#FDF8EB] text-[#C99130] border border-[#C99130]/20">提示词中</span>;
      case 'Rendering':
        return <span className="text-[10.5px] px-2.5 py-[3px] rounded-full font-medium bg-[#FDF5F2] text-[#D97757] border border-[#D97757]/20">生成中</span>;
      case 'Success':
        return <span className="text-[10.5px] px-2.5 py-[3px] rounded-full font-medium bg-[#F3F9F5] text-[#2D734C] border border-[#2D734C]/10">已完成</span>;
      case 'Error':
        return <span className="text-[10.5px] px-2.5 py-[3px] rounded-full font-medium bg-[#FEF4F4] text-[#BE3827] border border-[#BE3827]/10">失败</span>;
      default:
        return null;
    }
  };

  const compactParamParts = [
    task.aspectRatio && task.aspectRatio !== globalAspectRatio ? task.aspectRatio : '',
    task.resolution && task.resolution !== globalResolution ? task.resolution : '',
    task.batchCount && task.batchCount !== globalBatchCount ? task.batchCount : '',
  ].filter(Boolean);
  const showCollapsedHeaderMedia = !isActive;
  const lowerSectionClass = 'rounded-[18px] bg-[#FCFBF8] px-3 py-2.5 transition-all duration-200 ease-out';
  const textDisplayClass = 'rounded-[14px] bg-white/92 px-3 py-2.5 text-[12.3px] leading-relaxed text-text-secondary transition-all duration-200 ease-out hover:bg-white hover:-translate-y-[1px]';
  const textEditorClass = 'min-h-[120px] rounded-[14px] border border-black/8 bg-white px-3 py-2.5 shadow-none transition-all duration-200 ease-out hover:border-black/12 focus-visible:border-black/18 focus-visible:shadow-[0_0_0_3px_rgba(0,0,0,0.04)] resize-y';
  const overlayCheckboxClass = 'h-5 w-5 shrink-0 cursor-pointer rounded-[6px] border border-black/14 bg-white/80 accent-[#D97757] shadow-sm backdrop-blur-sm transition-colors hover:border-black/24';

  const activateDescEditor = (e: React.MouseEvent) => {
    promptEditor.closeEditor(true);
    descriptionEditor.openEditor(e);
  };

  const activatePromptEditor = (e: React.MouseEvent) => {
    descriptionEditor.closeEditor(true);
    promptEditor.openEditor(e);
  };

  const renderCollapsedMedia = () => (
    <div className="relative w-full h-full">
      {coverImageSrc ? (
        <img
          src={coverImageSrc}
          alt={task.title}
          loading="lazy"
          decoding="async"
          className="w-full h-full object-contain drop-shadow-sm"
          referrerPolicy="no-referrer"
          draggable={false}
          onDragStart={preventNativeImageDrag}
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-text-secondary/50">
          <ImageIcon className="w-6 h-6 opacity-30" strokeWidth={1} />
        </div>
      )}
    </div>
  );

  const renderUnifiedViewer = () => {
    const mainImageSrc = getTaskViewerMainImage(task, viewerMode, selectedResultIndex);
    const showResultSize = viewerMode === 'result' && activeResult?.width && activeResult?.height;
    const thumbnailItems = getTaskViewerItems(task);
    const hasThumbnailStrip = thumbnailItems.length > 0;

    return (
      <div className="overflow-hidden rounded-t-[22px] rounded-b-none bg-[#FBFAF7] p-0 transition-all duration-300 ease-out">
        <div className="relative aspect-[3/2] w-full overflow-hidden bg-[#F7F5F1]">
          {mainImageSrc ? (
            <div className="flex h-full w-full items-center justify-center">
              <img
                src={mainImageSrc}
                alt={task.title}
                className="block h-full w-full object-contain transition-transform duration-500 ease-out group-hover:scale-[1.012]"
                draggable={false}
                onDragStart={preventNativeImageDrag}
              />
            </div>
          ) : (
            <div className="flex h-full w-full items-center justify-center text-text-secondary/50">
              <ImageIcon className="h-8 w-8 opacity-30" />
            </div>
          )}

          <div className="absolute inset-x-2.5 top-2.5 flex items-start justify-between gap-3">
            <div className="flex items-center gap-2">
              <div className="drag-handle inline-flex h-8 w-8 items-center justify-center rounded-lg bg-white/72 text-black/70 shadow-sm backdrop-blur-sm transition-colors hover:bg-white" {...attributes} {...listeners}>
                <GripVertical className="h-4 w-4" />
              </div>
              <input
                type="checkbox"
                className={overlayCheckboxClass}
                checked={isSelected}
                onChange={() => toggleTaskSelection(task.id)}
                onClick={(e) => e.stopPropagation()}
              />
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-white/68 text-text-secondary backdrop-blur-sm transition-colors hover:bg-red-500/90 hover:text-white"
                onClick={(e) => {
                  e.stopPropagation();
                  removeTask(task.id);
                }}
                title="删除任务"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 bg-gradient-to-t from-black/14 via-black/0 to-transparent px-3 pb-3 pt-10">
            <div className="flex min-w-0 flex-1 items-end gap-2">
              {hasThumbnailStrip ? (
                <div className="flex min-h-[56px] max-w-[220px] items-center gap-2 rounded-[18px] border border-white/70 bg-[rgba(255,255,255,0.88)] px-2.5 py-2 shadow-[0_12px_30px_rgba(0,0,0,0.1)] backdrop-blur-md">
                  {thumbnailItems.map((item) => {
                    const isActiveThumb =
                      item.type === 'source'
                        ? viewerMode === 'source'
                        : viewerMode === 'result' && selectedResultIndex === item.resultIndex;

                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => {
                          if (item.type === 'source') {
                            setViewerMode('source');
                            return;
                          }
                          setSelectedResultIndex(item.resultIndex ?? 0);
                          setViewerMode('result');
                        }}
                        className={`group/thumb relative h-10 w-[54px] shrink-0 overflow-hidden rounded-[12px] border transition-all duration-200 ease-out ${
                          isActiveThumb
                            ? 'border-[#D97757] bg-white shadow-[0_10px_20px_rgba(217,119,87,0.22)] scale-[1.03]'
                            : 'border-black/8 bg-white/75 hover:-translate-y-[1px] hover:border-black/14 hover:bg-white'
                        }`}
                        title={item.type === 'source' ? '查看原图' : `查看结果图 ${(item.resultIndex ?? 0) + 1}`}
                      >
                        <img
                          src={item.src}
                          className={`h-full w-full object-cover transition-transform duration-200 ease-out ${
                            isActiveThumb ? 'scale-[1.02]' : 'group-hover/thumb:scale-[1.03]'
                          }`}
                          alt={item.type === 'source' ? '原图' : `${task.title}-${(item.resultIndex ?? 0) + 1}`}
                          draggable={false}
                          onDragStart={preventNativeImageDrag}
                        />
                        <div
                          className={`pointer-events-none absolute inset-0 rounded-[12px] ring-1 ring-inset transition-all duration-200 ${
                            isActiveThumb ? 'ring-[#D97757]/55' : 'ring-black/0 group-hover/thumb:ring-black/8'
                          }`}
                        />
                        {item.type === 'source' ? (
                          <span className="pointer-events-none absolute left-1 top-1 rounded-full bg-black/58 px-1 py-0.5 text-[8px] font-medium leading-none text-white/92">
                            原
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              ) : null}

              {showResultSize ? (
                <div className="rounded-full bg-white/84 px-2.5 py-1 text-[10px] font-mono text-black/45 shadow-sm backdrop-blur-sm">
                  {activeResult.width} × {activeResult.height}
                </div>
              ) : null}
            </div>

            <div className="flex shrink-0 items-center gap-2">
              {viewerMode === 'result' && activeResult?.src ? (
                <button
                  type="button"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-white/80 text-text-secondary shadow-sm backdrop-blur-sm transition-colors hover:bg-white"
                  onClick={(e) => {
                    e.stopPropagation();
                    downloadResultImage(activeResult.src, `${task.title || 'result'}-${selectedResultIndex + 1}.png`);
                  }}
                  title="下载结果图"
                >
                  <Download className="h-4 w-4" />
                </button>
              ) : null}
              {mainImageSrc ? (
                <button
                  type="button"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-white/80 text-text-secondary shadow-sm backdrop-blur-sm transition-colors hover:bg-white"
                  onClick={() => setLightboxTask(task.id, viewerMode === 'source' ? 0 : selectedResultIndex)}
                  title="查看大图"
                >
                  <Fullscreen className="h-4 w-4" />
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderInfoHeader = (compact: boolean) => (
      <div className={`${compact ? 'px-1 pt-0 pb-0' : 'px-1 pt-0.5 pb-0'}`}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-[10.5px] text-black/48">
              <span className="font-mono">#{task.index.toString().padStart(3, '0')}</span>
              {showProgressBadge ? (
              <span className="inline-flex items-center rounded-full border border-black/8 bg-black/[0.03] px-2 py-0.5 text-[10px] text-black/50">
                已返回 {resultProgress.completed}/{resultProgress.requested}
              </span>
            ) : null}
          </div>
          <div className="mt-1.5 text-[13.8px] font-serif font-medium leading-tight text-foreground">
            {task.title}
          </div>
        </div>

        <div className="shrink-0 pt-0.5">{getStatusDisplay()}</div>
      </div>

      {task.description ? (
        <div className={`${compact ? 'mt-1.5' : 'mt-2'} text-[11.55px] leading-relaxed text-text-secondary ${compact ? 'truncate' : ''}`}>
          {task.description}
        </div>
      ) : null}
    </div>
  );

  return (
    <Card
      ref={(node: any) => {
        setNodeRef(node);
        if (node) cardRef.current = node;
      }}
      style={style}
      className={`p-0 gap-0 bg-white flex overflow-hidden cursor-pointer transition-all duration-300 ease-out relative group
      ${isListMode ? 'flex-col sm:flex-row sm:items-center min-h-[140px]' : 'flex-col'}
      ${isActive ? (isListMode ? 'border-border/50 shadow-[0_8px_30px_rgb(0,0,0,0.08)] rounded-2xl h-auto items-stretch' : 'md:col-span-2 md:row-span-2 shadow-[0_12px_40px_-5px_rgba(0,0,0,0.12)] scale-[1.01] rounded-[24px] z-40 border border-transparent') : 'border border-border/40 shadow-sm hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] hover:border-border/80 rounded-2xl hover:-translate-y-0.5'}
      ${isSelected ? 'ring-2 ring-button-main ring-offset-2' : ''}
      ${isFileDropTarget ? 'ring-2 ring-button-main/70 ring-offset-2 shadow-[0_12px_40px_-5px_rgba(223,122,87,0.22)]' : ''}`}
      onClick={(e) => {
        const target = e.target as HTMLElement;
        if (
          target.closest('button') ||
          target.closest('.drag-handle') ||
          target.closest('.content-safe-zone') ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'INPUT'
        ) return;
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
      {showCollapsedHeaderMedia ? (
        <div
          className={`bg-[#FBFAF7] flex items-center justify-center relative isolate overflow-hidden min-h-0 shrink-0
          ${isListMode ? 'border-b sm:border-b-0 sm:border-r border-border/40' : 'border-b border-border/40'}
          ${isListMode ? 'w-full h-[180px] sm:w-[180px] sm:h-full' : 'flex-1 w-full aspect-[4/3] rounded-t-2xl'}`}
        >
          {(task.status === 'Rendering' || task.status === 'Prompting') && (
            <div className="absolute inset-0 z-10 bg-black/20">
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent -translate-x-full animate-[shimmer_1.5s_infinite]" />
            </div>
          )}

          {renderCollapsedMedia()}

          {isFileDropTarget && (
            <div className="absolute inset-0 z-20 bg-white/55 backdrop-blur-[1px] border-2 border-dashed border-button-main/50 flex items-center justify-center pointer-events-none">
              <div className="px-3 py-1.5 rounded-full bg-white/90 text-[12.6px] text-text-primary shadow-sm border border-button-main/15">
                松手添加为参考图
              </div>
            </div>
          )}

          <div className="absolute left-3 top-3 z-20 flex items-center gap-2">
            <div className="drag-handle inline-flex h-8 w-8 items-center justify-center rounded-lg bg-white/72 text-black/70 shadow-sm backdrop-blur-sm transition-colors hover:bg-white" {...attributes} {...listeners}>
              <GripVertical className="h-4 w-4" />
            </div>
            <input
              type="checkbox"
              className={overlayCheckboxClass}
              checked={isSelected}
              onChange={() => toggleTaskSelection(task.id)}
              onClick={(e) => e.stopPropagation()}
            />
          </div>

          <div className="absolute top-3 right-3 flex items-center gap-2 z-20">
            <button
              onClick={(e) => {
                e.stopPropagation();
                removeTask(task.id);
              }}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-white/68 text-text-secondary shadow-sm backdrop-blur-sm opacity-0 transition-all hover:bg-red-500/90 hover:text-white group-hover:opacity-100"
              title="删除任务"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>

          {primaryResult?.width && primaryResult?.height ? (
            <div className="absolute bottom-3 left-3 z-20 rounded-full bg-white/74 px-3 py-1 text-[10.5px] font-mono text-black/45 backdrop-blur-sm">
              {primaryResult.width} × {primaryResult.height}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className={`${isActive ? 'px-0 pt-0 pb-3' : 'p-3'} shrink-0 bg-white flex flex-col flex-1 ${showCollapsedHeaderMedia ? 'border-t border-transparent' : ''} relative z-10 w-full`}>
        {!isActive ? renderInfoHeader(true) : null}

        {!isActive ? (
          <div className="mt-1 flex flex-wrap items-center gap-2 min-h-[20px] px-0.5">
            {compactParamParts.length > 0 ? (
              <div className="inline-flex items-center rounded-full border border-black/8 bg-[#FCFBF8] px-2.5 py-1 text-[10.5px] text-black/55">
                {compactParamParts.join(' / ')}
              </div>
            ) : null}
          </div>
        ) : null}

        {isActive ? (
          <div className="content-safe-zone mt-0 flex flex-col gap-2 animate-in fade-in slide-in-from-top-2 duration-300 w-full min-w-0">
            {renderUnifiedViewer()}

            <div className="px-3">
              {renderInfoHeader(false)}
            </div>

            <div className="px-3">
              <div className={`grid grid-cols-1 xl:grid-cols-[1fr_auto] items-stretch gap-3 ${lowerSectionClass}`}>
              <div className="flex min-w-0 flex-wrap items-center gap-3">
                {globalReferenceImages.length > 0 ? (
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="text-[9.45px] font-bold text-black/42 uppercase tracking-wider">全局参考</span>
                    <div className="flex gap-2 opacity-80 pointer-events-none">
                      {globalReferenceImages.map((img, i) => (
                        <div key={i} className="h-10 w-10 overflow-hidden rounded-lg bg-white shadow-sm">
                          <img src={img} className="h-full w-full object-cover" alt="Global Ref" draggable={false} onDragStart={preventNativeImageDrag} />
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                <div className="flex min-w-0 items-center gap-2">
                  <span className="text-[9.45px] font-bold text-black/42 uppercase tracking-wider">参考图</span>
                  <div className="flex items-center gap-2 flex-wrap">
                    {task.referenceImages?.map((img, i) => (
                      <div key={i} className="relative h-10 w-10 overflow-hidden rounded-lg bg-white shadow-sm group/ref">
                        <img
                          src={img}
                          className="h-full w-full object-cover cursor-pointer"
                          alt="Ref"
                          draggable={false}
                          onDragStart={preventNativeImageDrag}
                          onClick={(e) => { e.stopPropagation(); window.open(img, '_blank'); }}
                        />
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
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-dashed border-black/16 bg-white/80 text-black/45 transition-colors hover:bg-white"
                      onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
                    >
                      <Upload className="h-3.5 w-3.5 opacity-70" strokeWidth={2} />
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
              </div>

              <div className="flex min-w-0 items-center gap-2 xl:justify-end">
                <span className="text-[9.45px] font-bold text-black/42 uppercase tracking-wider">参数</span>
                <GenerateParamsSelector
                  aspectRatio={task.aspectRatio || globalAspectRatio}
                  resolution={task.resolution || globalResolution}
                  batchCount={task.batchCount}
                  imageModel={imageModel}
                  onAspectRatioChange={(ar) => updateTask(task.id, { aspectRatio: ar === globalAspectRatio ? undefined : ar })}
                  onResolutionChange={(res) => updateTask(task.id, { resolution: res === globalResolution ? undefined : res })}
                  onBatchCountChange={(count) => updateTask(task.id, { batchCount: count })}
                  allowBatchInherit
                  onClearBatchCount={() => updateTask(task.id, { batchCount: undefined })}
                  inheritedBatchLabel={`跟随全局(${globalBatchCount || 'x1'})`}
                  triggerClassName="h-8 min-w-[112px] justify-between border-black/10 bg-white px-3 text-[10.5px] shadow-none hover:border-black/18"
                />
              </div>
            </div>
            </div>

            <div className="flex flex-col gap-2 px-3">
              <div ref={descriptionEditor.containerRef} className={`flex flex-col gap-1.5 ${lowerSectionClass}`}>
                <span className="text-[9.45px] font-bold text-black/42 px-0.5 uppercase tracking-wider">生成指令</span>
                {descriptionEditor.isEditing ? (
                  <div className="flex flex-col gap-2">
                    <Textarea
                      ref={descriptionEditor.textareaRef}
                      value={descriptionEditor.localValue}
                      onChange={(e) => descriptionEditor.setLocalValue(e.target.value)}
                      placeholder="输入这条任务的处理要求..."
                      className={`${textEditorClass} animate-in fade-in zoom-in-[0.99] duration-200 text-[12.6px] leading-relaxed text-text-secondary`}
                    />
                  </div>
                ) : (
                  <div
                    className={`${textDisplayClass} cursor-text line-clamp-5`}
                    onMouseDown={activateDescEditor}
                  >
                    {task.description || '暂无生成指令'}
                  </div>
                )}
              </div>

              {task.promptText ? (
                <div ref={promptEditor.containerRef} className={`flex flex-col gap-1.5 ${lowerSectionClass}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[9.45px] font-bold text-black/42 px-0.5 uppercase tracking-wider">AI 提示词</span>
                    <span className={`text-[9.45px] px-2 py-0.5 rounded-full border uppercase tracking-wider ${
                      task.promptSource === 'manual'
                        ? 'text-[#9A6700] bg-[#FFF7DB] border-[#F0D27A]'
                        : 'text-[#2D734C] bg-[#F3F9F5] border-[#B9D6C4]'
                    }`}>
                      {task.promptSource === 'manual' ? '手动' : '自动'}
                    </span>
                  </div>
                  {promptEditor.isEditing ? (
                    <Textarea
                      ref={promptEditor.textareaRef}
                      value={promptEditor.localValue}
                      onChange={(e) => promptEditor.setLocalValue(e.target.value)}
                      className={`${textEditorClass} animate-in fade-in zoom-in-[0.99] duration-200 font-mono text-[11.55px] leading-relaxed text-black/70`}
                    />
                  ) : (
                    <div
                      className={`${textDisplayClass} cursor-text font-mono text-[11.55px] text-black/70 line-clamp-7`}
                      onMouseDown={activatePromptEditor}
                    >
                      {task.promptText}
                    </div>
                  )}
                </div>
              ) : null}
            </div>

            <div className="mt-0.5 flex items-center justify-between gap-2 px-3">
              <Button variant="ghost" className="h-7 px-2.5 rounded-md text-[11.55px] font-medium hover:bg-black/5 text-text-secondary disabled:opacity-50" onClick={handlePreviewPrompt} disabled={task.status === 'Prompting'}>
                <Eye className="w-3 h-3 mr-1 opacity-70" /> 预览提示词
              </Button>
              <Button className="h-7 px-3.5 rounded-md shadow-sm bg-[#1A1A1A] hover:bg-[#2C2B29] text-white text-[11.55px] font-medium disabled:opacity-50" onClick={(e) => { e.stopPropagation(); processSingleTask(task.id); }} disabled={task.status === 'Rendering' || task.status === 'Prompting'}>
                执行此项 ({getBatchCountNumber(effectiveBatchCount)} 张)
              </Button>
            </div>

            {task.errorLog ? (
              <div className={`mx-3 mt-1 p-3 text-[12.08px] rounded-xl border flex flex-col gap-1 leading-relaxed ${
                task.status === 'Success'
                  ? 'bg-[#FFF8ED] text-[#A16207] border-[#F5D39A]'
                  : 'bg-[#FEF4F4] text-[#BE3827] border-[#BE3827]/10'
              }`}>
                <div className="font-semibold flex items-center gap-1.5 -ml-0.5">
                  <div className={`w-1.5 h-1.5 rounded-full ${task.status === 'Success' ? 'bg-[#A16207]' : 'bg-[#BE3827]'}`}></div>
                  {task.status === 'Success' ? '部分完成' : '执行失败'}
                </div>
                <span className="opacity-80 break-words font-mono text-[11.03px]">{task.errorLog.message}</span>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </Card>
  );
});
