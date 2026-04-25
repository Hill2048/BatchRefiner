import * as React from 'react';
import { CSS } from '@dnd-kit/utilities';
import { createPortal } from 'react-dom';
import { useSortable } from '@dnd-kit/sortable';
import { ChevronRight, Download, Eye, Fullscreen, GripVertical, History, ImageIcon, Trash2, Upload, X } from 'lucide-react';
import { toast } from 'sonner';
import { Task, TaskResultImage } from '@/types';
import { useAppStore } from '@/store';
import { generateTaskPrompt, getTaskPromptInputSignature, processSingleTask } from '@/lib/batchRunner';
import { getBatchCountNumber, getCurrentTaskResultImages, getEffectiveBatchCount, getHistoricalTaskResultGroups, getHistoricalTaskResultImages, getPrimaryTaskResult, getTaskResultProgress } from '@/lib/taskResults';
import { getTaskViewerItems, getTaskViewerMainImage } from '@/lib/taskViewer';
import { Card } from '../ui/card';
import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';
import { GenerateParamsSelector } from '../GenerateParamsSelector';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { useAutoSaveTextEditor } from './useAutoSaveTextEditor';
import { getTaskBatchFileName } from '@/lib/resultImageFileName';
import {
  getResultImageAssetDimensions,
  getResultImageAssetExtension,
  getResultImageAssetSrc,
  getResultImageDownloadSourceType,
} from '@/lib/resultImageAsset';
import { primeTaskResultImageCache } from '@/lib/resultImageCache';
import { getResultDownloadDiagnostics, resolveResultImageDownloadBlob, ResultImageDownloadError } from '@/lib/resultImageDownload';
import { appendGenerationLogEvent } from '@/lib/appLogger';

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

function triggerDirectDownload(blob: Blob, fileName: string) {
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = fileName;
  link.rel = 'noopener';
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

function triggerDirectImageDownload(src: string, fileName: string) {
  const link = document.createElement('a');
  link.href = src;
  link.download = fileName;
  link.rel = 'noopener';
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function getCollapsedTextClass(text: string | undefined, shortLines: number, mediumLines: number, longLines: number) {
  const content = (text || '').trim();
  const lineCount = content ? content.split(/\r?\n/).filter(Boolean).length : 0;
  const weightedLength = content.length + lineCount * 16;

  if (weightedLength <= 36) {
    return Math.min(shortLines + 1, mediumLines);
  }

  if (weightedLength <= 140) {
    return mediumLines;
  }

  return longLines;
}

function getEditorHeightClass(text: string | undefined, shortClass: string, mediumClass: string, longClass: string) {
  const content = (text || '').trim();
  const lineCount = content ? content.split(/\r?\n/).filter(Boolean).length : 0;
  const weightedLength = content.length + lineCount * 18;

  if (weightedLength <= 48) return shortClass;
  if (weightedLength <= 180) return mediumClass;
  return longClass;
}

function formatGenerationTime(durationMs?: number) {
  if (!durationMs || durationMs < 1000) return null;
  const totalSeconds = Math.round(durationMs / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`;
}

function formatHistorySessionTime(timestamp?: number) {
  if (!timestamp) return '较早批次';
  const date = new Date(timestamp);
  return `${date.getMonth() + 1}-${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function shouldShowCollapsedFade(text: string | undefined, maxLines: number) {
  const content = (text || '').trim();
  if (!content) return false;

  const explicitLines = content.split(/\r?\n/).filter(Boolean).length;
  const estimatedWrappedLines = Math.ceil(content.length / 26);

  return Math.max(explicitLines, estimatedWrappedLines) > maxLines;
}

function getTotalGenerationTime(images: TaskResultImage[]) {
  const total = images.reduce((sum, image) => sum + (image.generationTimeMs || 0), 0);
  return total > 0 ? total : undefined;
}

type ViewerMode = 'result' | 'source';
type ThumbnailViewerItem = ReturnType<typeof getTaskViewerItems>[number] & { placeholder?: false };
type PlaceholderThumbnailItem = {
  id: string;
  type: 'placeholder';
  resultIndex: number;
  src: '';
  placeholder: true;
};

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
  const globalImageQuality = useAppStore(state => state.globalImageQuality);
  const globalBatchCount = useAppStore(state => state.globalBatchCount);
  const enablePromptOptimization = useAppStore(state => state.enablePromptOptimization !== false);
  const imageModel = useAppStore(state => state.imageModel);

  if (!task) return null;

  const resultImages = getCurrentTaskResultImages(task);
  const historicalResultImages = getHistoricalTaskResultImages(task);
  const historicalResultGroups = getHistoricalTaskResultGroups(task);
  const primaryResult = getPrimaryTaskResult(task);
  const resultProgress = getTaskResultProgress(task, globalBatchCount);
  const effectiveBatchCount = getEffectiveBatchCount(task, globalBatchCount);
  const isRenderingVisual = task.status === 'Rendering';
  const isListMode = viewMode === 'list';
  const [selectedResultIndex, setSelectedResultIndex] = React.useState(0);
  const [viewerMode, setViewerMode] = React.useState<ViewerMode>('result');
  const descriptionEditor = useAutoSaveTextEditor({
    value: task.description || '',
    draftId: `task-description-${task.id}`,
    onSave: (nextValue) => updateTask(task.id, { description: nextValue }),
  });
  const promptEditor = useAutoSaveTextEditor({
    value: task.promptText || '',
    draftId: `task-prompt-${task.id}`,
    onSave: (nextValue) => updateTask(task.id, {
      promptText: nextValue,
      promptInputSignature: getTaskPromptInputSignature(task),
      promptSource: 'manual',
    }),
  });

  React.useEffect(() => {
    if (isRenderingVisual && task.activeResultSessionId && autoFocusSessionRef.current !== task.activeResultSessionId) {
      autoFocusSessionRef.current = task.activeResultSessionId;
      setSelectedResultIndex(0);
      setViewerMode('result');
      return;
    }

    if (resultImages.length === 0) {
      setSelectedResultIndex(0);
      if (!task.sourceImage) {
        setViewerMode('result');
      } else if (!isRenderingVisual && viewerMode !== 'source') {
        setViewerMode('source');
      }
      return;
    }
    if (isRenderingVisual) {
      const latestIndex = resultImages.length - 1;
      if (selectedResultIndex !== latestIndex && viewerMode === 'result') {
        setSelectedResultIndex(latestIndex);
      }
    } else if (selectedResultIndex > resultImages.length - 1) {
      setSelectedResultIndex(0);
    }
    if (!task.sourceImage && viewerMode === 'source') {
      setViewerMode('result');
      return;
    }
    if (!isRenderingVisual && viewerMode !== 'source') {
      setViewerMode('result');
    }
  }, [resultImages.length, selectedResultIndex, viewerMode, task.sourceImage, isRenderingVisual, task.activeResultSessionId]);

  React.useEffect(() => {
    void primeTaskResultImageCache(
      resultImages.flatMap((result) => [result.assetSrc, result.src, result.previewSrc, result.originalSrc])
    );
  }, [resultImages]);

  const activeResult = resultImages[selectedResultIndex] || primaryResult;
  const coverImageSrc = primaryResult?.src || task.sourceImage;
  const showProgressBadge = resultProgress.requested > 1 && resultImages.length > 0;
  const totalResultDuration = formatGenerationTime(getTotalGenerationTime(resultImages));

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
  const referenceDragIndexRef = React.useRef<number | null>(null);
  const autoFocusSessionRef = React.useRef<string | null>(null);
  const [referenceSortMode, setReferenceSortMode] = React.useState(false);
  const [previewReferenceImage, setPreviewReferenceImage] = React.useState<{
    src: string;
    title: string;
    fileName: string;
    result?: TaskResultImage;
  } | null>(null);

  React.useEffect(() => {
    const handleScroll = (e: CustomEvent) => {
      if (e.detail?.id === task.id && cardRef.current) {
        cardRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    };
    window.addEventListener('scroll-to-task' as any, handleScroll);
    return () => window.removeEventListener('scroll-to-task' as any, handleScroll);
  }, [task.id]);

  React.useEffect(() => {
    if (!previewReferenceImage) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setPreviewReferenceImage(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [previewReferenceImage]);

  const updateReferenceImage = (index: number, value: string) => {
    const nextRefs = [...(task.referenceImages || [])];
    nextRefs[index] = value;
    updateTask(task.id, { referenceImages: nextRefs });
  };

  const appendReferenceImage = (value: string) => {
    updateTask(task.id, { referenceImages: [...(task.referenceImages || []), value] });
  };

  const beginReferenceDrag = (event: React.DragEvent<HTMLElement>, index: number) => {
    if (!referenceSortMode) {
      event.preventDefault();
      return;
    }
    referenceDragIndexRef.current = index;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', String(index));
  };

  const reorderReferenceImages = (fromIndex: number, toIndex: number) => {
    const currentImages = [...(task.referenceImages || [])];
    if (
      fromIndex < 0 ||
      toIndex < 0 ||
      fromIndex >= currentImages.length ||
      toIndex >= currentImages.length ||
      fromIndex === toIndex
    ) {
      return;
    }

    const [moved] = currentImages.splice(fromIndex, 1);
    currentImages.splice(toIndex, 0, moved);
    updateTask(task.id, { referenceImages: currentImages });
  };

  const readImageFile = (file: File, onLoad: (result: string) => void) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const result = event.target?.result;
      if (typeof result === 'string') onLoad(result);
    };
    reader.readAsDataURL(file);
  };

  const downloadResultImage = async (result: TaskResultImage, fileName: string) => {
    const latestLogSession = useAppStore
      .getState()
      .generationLogs
      .filter((session) => session.taskId === task.id)
      .sort((left, right) => right.createdAt - left.createdAt)[0];
    try {
      const { blob, cacheStatus, status } = await resolveResultImageDownloadBlob(result);
      try {
        const { saveAs } = await import('file-saver');
        saveAs(blob, fileName);
      } catch {
        try {
          triggerDirectDownload(blob, fileName);
        } catch (error) {
          throw new ResultImageDownloadError({
            message: error instanceof Error ? error.message : '保存结果图失败',
            stage: 'save',
            status: 'save_failed',
            sourceType: getResultImageDownloadSourceType(result),
            cacheStatus,
          });
        }
      }
      if (cacheStatus !== result.downloadCacheStatus || status !== result.downloadStatus) {
        updateTask(task.id, {
          resultImages: (task.resultImages || []).map((image) =>
            image.id === result.id
              ? {
                  ...image,
                  downloadCacheStatus: cacheStatus === 'miss' ? 'primed' : cacheStatus,
                  downloadStatus: status,
                  downloadFailureStage: status === 'cache_failed' ? 'cache' : undefined,
                  downloadFailureReason: status === 'cache_failed' ? '结果图缓存写入失败，但本次下载已完成' : undefined,
                }
              : image,
          ),
        });
      }
      if (latestLogSession) {
        appendGenerationLogEvent(latestLogSession.id, {
          stage: 'download',
          event: 'download.succeeded',
          message: '结果图下载完成',
          data: {
            fileName,
            resultId: result.id,
            sourceType: result.downloadSourceType || 'src',
            cacheStatus,
            status,
          },
        });
      }
    } catch (error) {
      const failure = error instanceof ResultImageDownloadError
        ? error
        : new ResultImageDownloadError({
            message: error instanceof Error ? error.message : '下载失败',
            stage: 'save',
            status: 'save_failed',
            sourceType: getResultImageDownloadSourceType(result),
            cacheStatus: result.downloadCacheStatus || 'failed',
          });
      updateTask(task.id, {
        resultImages: (task.resultImages || []).map((image) =>
          image.id === result.id
            ? {
                ...image,
                downloadStatus: failure.status,
                downloadFailureStage: failure.stage,
                downloadFailureReason: failure.message,
                downloadCacheStatus: failure.cacheStatus,
              }
            : image,
        ),
      });
      if (latestLogSession) {
        appendGenerationLogEvent(latestLogSession.id, {
          level: 'error',
          stage: 'download',
          event: 'download.failed',
          message: '结果图下载失败',
          data: {
            fileName,
            resultId: result.id,
            stage: failure.stage,
            status: failure.status,
            sourceType: failure.sourceType,
            cacheStatus: failure.cacheStatus,
            message: failure.message,
          },
        });
      }
      toast.error(`下载失败：${failure.message}｜${getResultDownloadDiagnostics(result, failure)}`);
    }
  };

  const flushPendingTextChanges = React.useCallback(() => {
    descriptionEditor.saveIfChanged();
    promptEditor.saveIfChanged();
  }, [descriptionEditor, promptEditor]);

  const handlePreviewPrompt = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    flushPendingTextChanges();
    const previewPromise = generateTaskPrompt(task.id).then((generatedPrompt) => {
      const latestTask = useAppStore.getState().tasks.find((item) => item.id === task.id);
      const hasAnyResults = Boolean(latestTask?.resultImages?.length || latestTask?.resultImage);
      updateTask(task.id, {
        promptText: generatedPrompt.promptText,
        promptInputSignature: generatedPrompt.inputSignature,
        promptSource: 'auto',
        status: hasAnyResults ? 'Success' : 'Idle',
        progressStage: undefined,
        errorLog: undefined,
      });
      return generatedPrompt.promptText;
    });

    toast.promise(previewPromise, {
      loading: '正在生成提示词...',
      success: '提示词已更新',
      error: '提示词生成失败',
    });

    await previewPromise;
  };

  const handleRunTask = React.useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    flushPendingTextChanges();
    void processSingleTask(task.id);
  }, [flushPendingTextChanges, task.id]);

  const getStatusDisplay = () => {
    const promptingLabel = task.progressStage?.trim() || '提示词中';
    const renderingLabel = task.progressStage?.trim() || '生成中';
    switch (task.status) {
      case 'Waiting':
      case 'Idle':
        return <span className="text-[10.5px] px-2.5 py-[3px] rounded-full font-medium bg-black/[0.03] text-black/58 border border-black/[0.06]">待处理</span>;
      case 'Prompting':
        return <span className="text-[10.5px] px-2.5 py-[3px] rounded-full font-medium bg-[#FDF8EB] text-[#B97512] border border-[#D9A33B]/24 shadow-[0_4px_12px_rgba(217,163,59,0.12)]">{promptingLabel}</span>;
      case 'Rendering':
        return <span className="text-[10.5px] px-2.5 py-[3px] rounded-full font-medium bg-[#FDF5F2] text-[#CC6B4C] border border-[#D97757]/24 shadow-[0_4px_12px_rgba(217,119,87,0.12)]">{renderingLabel}</span>;
      case 'Success':
        return <span className="text-[10.5px] px-2.5 py-[3px] rounded-full font-medium bg-[#F3F9F5] text-[#2D734C] border border-[#2D734C]/12 shadow-[0_4px_12px_rgba(45,115,76,0.10)]">已完成</span>;
      case 'Error':
        return <span className="text-[10.5px] px-2.5 py-[3px] rounded-full font-medium bg-[#FEF4F4] text-[#BE3827] border border-[#BE3827]/12 shadow-[0_4px_12px_rgba(190,56,39,0.10)]">失败</span>;
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
  const textSectionClass = 'flex flex-col gap-1.5 px-0.5';
  const textLabelClass = 'px-0.5 text-[9.45px] font-bold uppercase tracking-wider text-black/42';
  const textDisplayClass = 'rounded-[14px] border border-black/[0.07] bg-white px-3 py-2.5 text-[12.3px] leading-[1.75] text-black/70 transition-all duration-200 ease-out hover:border-black/[0.12] hover:bg-white';
  const textEditorClass = 'rounded-[14px] border border-black/[0.08] bg-white px-3 py-2.5 text-[12.3px] leading-[1.75] text-black/70 shadow-none transition-all duration-200 ease-out hover:border-black/[0.12] focus-visible:border-black/[0.16] focus-visible:shadow-[0_0_0_3px_rgba(0,0,0,0.04)] resize-y';
  const overlayCheckboxClass = 'h-5 w-5 shrink-0 cursor-pointer rounded-[6px] border border-black/14 bg-white/80 accent-[#D97757] shadow-sm backdrop-blur-sm transition-colors hover:border-black/24';
  const descriptionCollapsedLines = getCollapsedTextClass(task.description, 2, 3, 5);
  const promptCollapsedLines = getCollapsedTextClass(task.promptText, 3, 4, 6);
  const descriptionEditorHeightClass = getEditorHeightClass(task.description, 'min-h-[96px]', 'min-h-[156px]', 'min-h-[228px]');
  const promptEditorHeightClass = getEditorHeightClass(task.promptText, 'min-h-[112px]', 'min-h-[188px]', 'min-h-[272px]');
  const collapsedPreviewText = enablePromptOptimization
    ? (task.description || '').trim()
    : ((task.promptText || task.description || '').trim());
  const collapsedPreviewLineClamp = enablePromptOptimization ? 'line-clamp-2' : 'line-clamp-3';
  const shouldFadeCollapsedPreview = shouldShowCollapsedFade(collapsedPreviewText, enablePromptOptimization ? 2 : 3);
  const collapsedLineClassMap: Record<number, string> = {
    2: 'line-clamp-2',
    3: 'line-clamp-3',
    4: 'line-clamp-4',
    5: 'line-clamp-5',
    6: 'line-clamp-6',
  };

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
    const activeAssetDimensions = activeResult ? getResultImageAssetDimensions(activeResult) : null;
    const showResultSize = viewerMode === 'result' && Boolean(activeAssetDimensions);
    const activeResultDuration = formatGenerationTime(activeResult?.generationTimeMs);
    const thumbnailItems = getTaskViewerItems(task) as ThumbnailViewerItem[];
    const placeholderCount = isRenderingVisual
      ? Math.max(0, resultProgress.requested - resultImages.length - resultProgress.failed)
      : 0;
    const placeholderItems: PlaceholderThumbnailItem[] = Array.from({ length: placeholderCount }, (_, index) => ({
      id: `placeholder-${task.id}-${resultImages.length + resultProgress.failed + index}`,
      type: 'placeholder',
      resultIndex: resultImages.length + index,
      src: '',
      placeholder: true,
    }));
    const visibleThumbnailItems = [...thumbnailItems, ...placeholderItems];
    const hasThumbnailStrip = visibleThumbnailItems.length > 0;
    const hasResolvedActiveResult = viewerMode === 'result' && Boolean(activeResult?.src) && selectedResultIndex < resultImages.length;
    const shouldAnimateViewerImage = isRenderingVisual && viewerMode === 'result' && !hasResolvedActiveResult;

    return (
      <div className="overflow-hidden rounded-t-[22px] rounded-b-none bg-[#FBFAF7] p-0 transition-all duration-300 ease-out">
        <div
          className="relative aspect-[3/2] w-full overflow-hidden bg-[#F7F5F1]"
          style={{ contain: 'paint' }}
        >
          {shouldAnimateViewerImage ? (
            <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
              <div className="absolute inset-0 bg-white/20 backdrop-blur-[18px]" />
              <div className="absolute inset-0 animate-[mist-breathe_3.1s_ease-in-out_infinite] bg-[radial-gradient(circle_at_24%_20%,rgba(255,255,255,0.34),transparent_34%),radial-gradient(circle_at_74%_76%,rgba(255,255,255,0.24),transparent_30%)]" />
              <div
                className="absolute inset-0 animate-[dot-drift_4.8s_linear_infinite]"
                style={{
                  backgroundImage:
                    'radial-gradient(circle, rgba(255,255,255,0.88) 0 1px, transparent 1.8px), radial-gradient(circle, rgba(255,255,255,0.32) 0 1px, transparent 2px)',
                  backgroundSize: '18px 18px, 24px 24px',
                }}
              />
              <div className="absolute inset-y-[-12%] left-[-30%] w-[42%] rotate-[10deg] bg-gradient-to-r from-transparent via-white/48 to-transparent blur-[24px] animate-[shimmer_2.4s_ease-in-out_infinite]" />
              <div className="absolute left-[12%] top-[16%] h-28 w-28 rounded-full bg-white/24 blur-[58px] animate-[mist-breathe_2.6s_ease-in-out_infinite]" />
              <div className="absolute bottom-[14%] right-[16%] h-24 w-24 rounded-full bg-white/16 blur-[46px] animate-[mist-breathe_2.9s_ease-in-out_infinite]" />
            </div>
          ) : null}
          {mainImageSrc ? (
            <div className="relative z-0 flex h-full w-full items-center justify-center">
              <img
                src={mainImageSrc}
                alt={task.title}
                className={`block h-full w-full object-contain transition-transform duration-500 ease-out group-hover:scale-[1.012] ${shouldAnimateViewerImage ? 'scale-[1.018] blur-[16px] saturate-[0.88]' : isRenderingVisual ? 'scale-[1.008]' : ''}`}
                draggable={false}
                onDragStart={preventNativeImageDrag}
              />
            </div>
          ) : shouldAnimateViewerImage && task.sourceImage ? (
            <div className="relative z-0 flex h-full w-full items-center justify-center">
              <img
                src={task.sourceImage}
                alt={task.title}
                className="block h-full w-full scale-[1.08] object-cover blur-[26px] saturate-[0.82] opacity-90"
                draggable={false}
                onDragStart={preventNativeImageDrag}
              />
            </div>
          ) : (
            <div className="flex h-full w-full items-center justify-center text-text-secondary/50">
              <ImageIcon className="h-8 w-8 opacity-30" />
            </div>
          )}

          <div className="absolute left-3 right-3 top-3 z-20 flex items-start justify-between gap-3">
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

          <div className="absolute inset-x-0 bottom-0 z-20 flex items-end justify-between gap-3 bg-gradient-to-t from-black/14 via-black/0 to-transparent px-3 pb-3 pt-10">
            <div className="flex min-w-0 flex-1 items-end gap-2">
              {hasThumbnailStrip ? (
                <div className="flex min-h-[52px] w-fit max-w-full items-center gap-1.5 overflow-hidden rounded-[18px] border border-white/70 bg-[rgba(255,255,255,0.88)] px-2 py-2 shadow-[0_12px_30px_rgba(0,0,0,0.1)] backdrop-blur-md sm:min-h-[56px] sm:gap-2 sm:px-2.5">
                  {visibleThumbnailItems.map((item) => {
                    if (item.type === 'placeholder') {
                      return (
                        <div
                          key={item.id}
                          className="relative h-9 w-12 shrink-0 overflow-hidden rounded-[12px] border border-black/10 bg-[#f3efe8] sm:h-10 sm:w-[54px]"
                          aria-hidden="true"
                        >
                          {task.sourceImage ? (
                            <img
                              src={task.sourceImage}
                              alt=""
                              className="absolute inset-0 h-full w-full scale-[1.68] object-cover opacity-92 blur-[18px] saturate-[0.88] brightness-[1.03]"
                              draggable={false}
                              onDragStart={preventNativeImageDrag}
                            />
                          ) : null}
                          <div className="absolute inset-0 bg-white/20 backdrop-blur-[12px]" />
                          <div className="absolute inset-0 animate-[mist-breathe_2.6s_ease-in-out_infinite] bg-[radial-gradient(circle_at_28%_24%,rgba(255,255,255,0.52),transparent_34%),radial-gradient(circle_at_72%_72%,rgba(255,255,255,0.24),transparent_30%)]" />
                          <div
                            className="absolute inset-0 animate-[dot-drift_3.2s_linear_infinite]"
                            style={{
                              backgroundImage:
                                'radial-gradient(circle, rgba(255,255,255,0.86) 0 1px, transparent 1.8px), radial-gradient(circle, rgba(255,255,255,0.36) 0 1px, transparent 2px)',
                              backgroundSize: '18px 18px, 24px 24px',
                            }}
                          />
                          <div className="absolute inset-y-[-15%] left-[-42%] w-[48%] rotate-[12deg] bg-gradient-to-r from-transparent via-white/56 to-transparent blur-[16px] animate-[shimmer_1.9s_ease-in-out_infinite]" />
                          <div className="absolute left-[12%] top-[18%] h-6 w-6 rounded-full bg-white/22 blur-[16px] animate-[mist-breathe_2.3s_ease-in-out_infinite]" />
                          <div className="absolute bottom-[16%] right-[16%] h-5 w-5 rounded-full bg-white/16 blur-[14px] animate-[mist-breathe_2.8s_ease-in-out_infinite]" />
                        </div>
                      );
                    }
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
                        className={`group/thumb relative h-9 w-12 shrink-0 overflow-hidden rounded-[12px] border transition-all duration-200 ease-out sm:h-10 sm:w-[54px] ${
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
                <div className="rounded-full border border-black/10 bg-white px-2.5 py-1 text-[10px] font-mono font-medium text-black/78 shadow-[0_8px_20px_rgba(0,0,0,0.10)]">
                  {activeAssetDimensions?.width} × {activeAssetDimensions?.height}
                  {activeResultDuration ? ` / ${activeResultDuration}` : ''}
                </div>
              ) : null}
            </div>

            <div className="flex shrink-0 items-center gap-2">
              {historicalResultImages.length > 0 ? (
                <Popover>
                  <PopoverTrigger
                    render={
                      <button
                        type="button"
                        className="inline-flex h-8 items-center gap-1.5 rounded-full bg-white/80 px-2.5 text-[10.5px] text-text-secondary shadow-sm backdrop-blur-sm transition-colors hover:bg-white"
                        onClick={(e) => e.stopPropagation()}
                        title="查看历史结果"
                      >
                        <History className="h-3.5 w-3.5" />
                        <span>历史 {historicalResultImages.length}</span>
                        <ChevronRight className="h-3 w-3 opacity-60" />
                      </button>
                    }
                  />
                  <PopoverContent className="w-[min(360px,calc(100vw-2rem))] rounded-2xl border-border bg-card p-3 shadow-lg" align="end">
                    <div className="flex flex-col gap-2">
                      <div className="text-[12px] font-medium text-text-primary">历史结果</div>
                      <div className="max-h-[360px] space-y-3 overflow-y-auto pr-1">
                        {historicalResultGroups.map((group, groupIndex) => (
                          <div key={group.sessionId} className="rounded-xl border border-black/6 bg-[#FCFBF8] p-2.5">
                            <div className="mb-2 flex items-center justify-between gap-2">
                              <div className="text-[11px] font-medium text-black/72">
                                批次 {historicalResultGroups.length - groupIndex}
                              </div>
                              <div className="text-[10px] text-black/45">
                                {formatHistorySessionTime(group.createdAt)} / {group.images.length} 张
                              </div>
                            </div>
                            <div className="grid grid-cols-4 gap-2">
                              {group.images.map((image, index) => (
                                <div
                                  key={image.id}
                                  className="group/history relative aspect-[4/3] overflow-hidden rounded-xl border border-black/8 bg-white"
                                >
                                  <button
                                    type="button"
                                    className="block h-full w-full"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setPreviewReferenceImage({
                                        src: getResultImageAssetSrc(image),
                                        title: `历史结果预览`,
                                        fileName: getTaskBatchFileName(task.index, index, getResultImageAssetExtension(image)),
                                        result: image,
                                      });
                                    }}
                                    title={`查看历史结果 ${index + 1}`}
                                  >
                                    <img
                                      src={image.previewSrc || image.src}
                                      alt={`历史结果 ${index + 1}`}
                                      className="h-full w-full object-cover transition-transform duration-200 group-hover/history:scale-[1.03]"
                                      draggable={false}
                                      onDragStart={preventNativeImageDrag}
                                    />
                                  </button>
                                  <button
                                    type="button"
                                    className="absolute bottom-1 right-1 inline-flex h-6 w-6 items-center justify-center rounded-full bg-black/62 text-white opacity-0 transition-all hover:bg-black/76 group-hover/history:opacity-100"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      downloadResultImage(image, getTaskBatchFileName(task.index, index, getResultImageAssetExtension(image)));
                                    }}
                                    title="下载历史结果"
                                  >
                                    <Download className="h-3 w-3" />
                                  </button>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </PopoverContent>
                </Popover>
              ) : null}
              {viewerMode === 'result' && activeResult?.src ? (
                <button
                  type="button"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-white/80 text-text-secondary shadow-sm backdrop-blur-sm transition-colors hover:bg-white"
                  onClick={(e) => {
                    e.stopPropagation();
                    downloadResultImage(activeResult, getTaskBatchFileName(task.index, selectedResultIndex, getResultImageAssetExtension(activeResult)));
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
          </div>
          <div className="mt-1.5 text-[13.8px] font-serif font-medium leading-tight text-foreground">
            {task.title}
          </div>
        </div>

        <div className="shrink-0 pt-0.5">{getStatusDisplay()}</div>
      </div>
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
      ${isActive ? (isListMode ? 'border border-black/8 shadow-[0_8px_30px_rgb(0,0,0,0.08)] rounded-2xl h-auto items-stretch' : 'md:col-span-2 md:row-span-2 shadow-[0_12px_40px_-5px_rgba(0,0,0,0.12)] scale-[1.01] rounded-[24px] z-40 border border-black/8') : 'border border-black/8 shadow-sm hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] hover:border-black/14 rounded-2xl hover:-translate-y-0.5'}
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
          style={{ contain: 'paint' }}
        >
          {isRenderingVisual && !primaryResult?.src && (
            <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
              <div className={`absolute inset-0 ${primaryResult?.src ? 'bg-white/[0.05] backdrop-blur-[1.5px]' : 'bg-white/14 backdrop-blur-[10px]'}`} />
              <div className={`absolute inset-0 animate-[mist-breathe_3s_ease-in-out_infinite] ${primaryResult?.src ? 'bg-[radial-gradient(circle_at_24%_20%,rgba(255,255,255,0.18),transparent_24%),radial-gradient(circle_at_74%_76%,rgba(255,255,255,0.12),transparent_24%)]' : 'bg-[radial-gradient(circle_at_24%_20%,rgba(255,255,255,0.34),transparent_30%),radial-gradient(circle_at_74%_76%,rgba(255,255,255,0.24),transparent_28%)]'}`} />
              <div
                className="absolute inset-0 animate-[dot-drift_4.2s_linear_infinite]"
                style={{
                  backgroundImage:
                    primaryResult?.src
                      ? 'radial-gradient(circle, rgba(255,255,255,0.8) 0 1px, transparent 1.6px), radial-gradient(circle, rgba(255,255,255,0.28) 0 1px, transparent 1.85px)'
                      : 'radial-gradient(circle, rgba(255,255,255,0.9) 0 1px, transparent 1.7px), radial-gradient(circle, rgba(255,255,255,0.36) 0 1px, transparent 1.9px)',
                  backgroundSize: '18px 18px, 24px 24px',
                }}
              />
              <div className={`absolute inset-y-[-12%] left-[-30%] w-[42%] rotate-[10deg] bg-gradient-to-r from-transparent ${primaryResult?.src ? 'via-white/22' : 'via-white/58'} to-transparent blur-[18px] animate-[shimmer_2.2s_ease-in-out_infinite]`} />
              <div className={`absolute left-[15%] top-[18%] rounded-full ${primaryResult?.src ? 'h-14 w-14 bg-white/12 blur-[30px]' : 'h-16 w-16 bg-white/26 blur-[36px]'} animate-[mist-breathe_2.4s_ease-in-out_infinite]`} />
              <div className={`absolute right-[18%] top-[58%] rounded-full ${primaryResult?.src ? 'h-12 w-12 bg-white/10 blur-[24px]' : 'h-14 w-14 bg-white/18 blur-[28px]'} animate-[mist-breathe_2.8s_ease-in-out_infinite]`} />
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

          {primaryResult && getResultImageAssetDimensions(primaryResult) ? (
            <div className="absolute bottom-3 left-3 z-20 rounded-full border border-black/10 bg-white px-3 py-1 text-[10.5px] font-mono font-medium text-black/78 shadow-[0_8px_20px_rgba(0,0,0,0.10)]">
              {getResultImageAssetDimensions(primaryResult)?.width} × {getResultImageAssetDimensions(primaryResult)?.height}
              {totalResultDuration ? ` / ${totalResultDuration}` : ''}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className={`${isActive ? 'px-0 pt-0 pb-3' : 'p-3'} shrink-0 bg-white flex flex-col flex-1 ${showCollapsedHeaderMedia ? 'border-t border-transparent' : ''} relative z-10 w-full`}>
        {!isActive ? renderInfoHeader(true) : null}

        {!isActive ? (
          <div className="mt-1 flex min-h-[20px] flex-col gap-2 px-0.5">
            <div className="flex flex-wrap items-center gap-2">
              {showProgressBadge ? (
                <div className="inline-flex items-center rounded-full border border-black/8 bg-black/[0.03] px-2.5 py-1 text-[10.5px] text-black/55">
                  已返回 {resultProgress.completed}/{resultProgress.requested}
                </div>
              ) : null}
              {compactParamParts.length > 0 ? (
                <div className="inline-flex items-center rounded-full border border-black/8 bg-[#FCFBF8] px-2.5 py-1 text-[10.5px] text-black/55">
                  {compactParamParts.join(' / ')}
                </div>
              ) : null}
            </div>
            {collapsedPreviewText ? (
              <div className="relative overflow-hidden rounded-[12px] bg-transparent pr-1">
                <div className={`text-[11.55px] leading-[1.65] text-black/58 ${collapsedPreviewLineClamp}`}>
                  {collapsedPreviewText}
                </div>
                {shouldFadeCollapsedPreview ? (
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-white via-white/82 via-45% to-transparent" />
                ) : null}
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
                      <div
                        key={i}
                        className={`relative h-14 w-14 overflow-hidden rounded-[14px] bg-white shadow-sm ring-1 transition-all duration-200 group/ref ${
                          referenceSortMode
                            ? 'cursor-grab ring-[#D97757]/45 hover:-translate-y-[1px] hover:shadow-[0_8px_18px_rgba(217,119,87,0.18)]'
                            : 'ring-black/6'
                        }`}
                        draggable={referenceSortMode}
                        onDragStart={(e) => beginReferenceDrag(e, i)}
                        onDragOver={(e) => {
                          if (!referenceSortMode) return;
                          e.preventDefault();
                          e.dataTransfer.dropEffect = 'move';
                        }}
                        onDrop={(e) => {
                          if (!referenceSortMode) return;
                          e.preventDefault();
                          const fromIndex = referenceDragIndexRef.current;
                          if (fromIndex == null) return;
                          reorderReferenceImages(fromIndex, i);
                          referenceDragIndexRef.current = null;
                        }}
                        onDragEnd={() => {
                          referenceDragIndexRef.current = null;
                        }}
                      >
                        <img
                          src={img}
                          className="h-full w-full object-cover transition-transform duration-200 group-hover/ref:scale-[1.04]"
                          alt="Ref"
                          draggable={referenceSortMode}
                          onDragStart={(e) => {
                            if (!referenceSortMode) {
                              preventNativeImageDrag(e);
                              return;
                            }
                            beginReferenceDrag(e as React.DragEvent<HTMLElement>, i);
                          }}
                        />
                        <div className={`absolute inset-0 transition-all duration-200 ${referenceSortMode ? 'opacity-100' : 'opacity-0 group-hover/ref:opacity-100'}`}>
                          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(19,18,17,0.05),rgba(19,18,17,0.16))]" />
                          <div className="absolute left-1/2 top-1/2 grid w-[46px] -translate-x-1/2 -translate-y-1/2 grid-cols-2 gap-1.5 rounded-[12px] bg-[rgba(48,44,40,0.78)] p-1.5 shadow-[0_10px_22px_rgba(0,0,0,0.18)] backdrop-blur-sm">
                            <button
                              type="button"
                              className="inline-flex h-4.5 w-4.5 items-center justify-center rounded-[8px] bg-[rgba(33,31,29,0.9)] text-white transition-colors hover:bg-[rgba(33,31,29,0.98)]"
                              title="替换参考图"
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
                              <Upload className="h-2.5 w-2.5" strokeWidth={2.2} />
                            </button>
                            <button
                              type="button"
                              className="inline-flex h-4.5 w-4.5 items-center justify-center rounded-[8px] bg-[linear-gradient(180deg,rgba(237,105,90,0.98),rgba(215,84,69,0.98))] text-white transition-colors hover:brightness-[0.96]"
                              title="删除参考图"
                              onClick={(e) => {
                                e.stopPropagation();
                                updateTask(task.id, { referenceImages: task.referenceImages.filter((_, idx) => idx !== i) });
                              }}
                            >
                              <Trash2 className="h-2.5 w-2.5" strokeWidth={2.2} />
                            </button>
                            <button
                              type="button"
                              className="inline-flex h-4.5 w-4.5 items-center justify-center rounded-[8px] bg-[rgba(33,31,29,0.9)] text-white transition-colors hover:bg-[rgba(33,31,29,0.98)]"
                              title="预览参考图"
                              onClick={(e) => {
                                e.stopPropagation();
                                setPreviewReferenceImage({
                                  src: img,
                                  title: '参考图预览',
                                  fileName: `reference-${task.index}-${i + 1}.png`,
                                });
                              }}
                            >
                              <Eye className="h-2.5 w-2.5" strokeWidth={2.2} />
                            </button>
                            <button
                              type="button"
                              className={`inline-flex h-4.5 w-4.5 items-center justify-center rounded-[8px] text-white transition-colors ${
                                referenceSortMode
                                  ? 'bg-[rgba(217,119,87,0.94)] hover:bg-[rgba(217,119,87,1)]'
                                  : 'bg-[rgba(255,255,255,0.16)] hover:bg-[rgba(255,255,255,0.24)]'
                              }`}
                              title={referenceSortMode ? '结束拖拽排序' : '拖拽排序参考图'}
                              onClick={(e) => {
                                e.stopPropagation();
                                setReferenceSortMode((value) => !value);
                              }}
                            >
                              <GripVertical className="h-2.5 w-2.5" strokeWidth={2.2} />
                            </button>
                          </div>
                        </div>
                        {referenceSortMode ? (
                          <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-[rgba(217,119,87,0.9)] px-1 py-[1px] text-center text-[7px] font-medium leading-none text-white">
                            拖拽排序
                          </div>
                        ) : null}
                      </div>
                    ))}
                    <button
                      type="button"
                      className="flex h-14 w-14 shrink-0 items-center justify-center rounded-[14px] border border-dashed border-black/16 bg-white/80 text-black/45 transition-colors hover:bg-white"
                      onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
                    >
                      <Upload className="h-4 w-4 opacity-70" strokeWidth={2} />
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
                  imageQuality={task.imageQuality || globalImageQuality || 'auto'}
                  batchCount={task.batchCount}
                  imageModel={imageModel}
                  onAspectRatioChange={(ar) => updateTask(task.id, { aspectRatio: ar === globalAspectRatio ? undefined : ar })}
                  onResolutionChange={(res) => updateTask(task.id, { resolution: res === globalResolution ? undefined : res })}
                  onImageQualityChange={(quality) => updateTask(task.id, {
                    imageQuality: quality === (globalImageQuality || 'auto') ? undefined : quality,
                  })}
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
              {enablePromptOptimization ? (
                <div ref={descriptionEditor.containerRef} className={textSectionClass}>
                  <span className={textLabelClass}>生成指令</span>
                  {descriptionEditor.isEditing ? (
                    <div className="flex flex-col gap-2">
                      <Textarea
                        ref={descriptionEditor.textareaRef}
                        value={descriptionEditor.localValue}
                        onChange={(e) => descriptionEditor.setLocalValue(e.target.value)}
                        placeholder="输入这条任务的处理要求..."
                        className={`${textEditorClass} ${descriptionEditorHeightClass} animate-in fade-in zoom-in-[0.99] duration-200`}
                      />
                    </div>
                  ) : (
                    <div
                      className={`${textDisplayClass} cursor-text overflow-hidden ${collapsedLineClassMap[descriptionCollapsedLines]} ${
                        descriptionCollapsedLines === 3
                          ? 'max-h-[82px]'
                          : descriptionCollapsedLines === 5
                            ? 'max-h-[126px]'
                            : 'max-h-[64px]'
                      }`}
                      onMouseDown={activateDescEditor}
                    >
                      {task.description || '暂无生成指令'}
                    </div>
                  )}
                </div>
              ) : null}

              {task.promptText ? (
                <div ref={promptEditor.containerRef} className={textSectionClass}>
                  <div className="flex items-center justify-between gap-2">
                    <span className={textLabelClass}>AI 提示词</span>
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
                      className={`${textEditorClass} ${promptEditorHeightClass} animate-in fade-in zoom-in-[0.99] duration-200`}
                    />
                  ) : (
                    <div
                      className={`${textDisplayClass} cursor-text overflow-hidden ${collapsedLineClassMap[promptCollapsedLines]} ${
                        promptCollapsedLines === 4
                          ? 'max-h-[98px]'
                          : promptCollapsedLines === 6
                            ? 'max-h-[144px]'
                            : 'max-h-[74px]'
                      }`}
                      onMouseDown={activatePromptEditor}
                    >
                      {task.promptText}
                    </div>
                  )}
                </div>
              ) : null}
            </div>

            <div className="mt-0.5 flex items-center justify-between gap-2 px-3">
              <div className="flex items-center gap-1.5">
                {enablePromptOptimization ? (
                  <Button type="button" variant="ghost" className="h-7 px-2.5 rounded-md text-[11.55px] font-medium hover:bg-black/5 text-text-secondary disabled:opacity-50" onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }} onClick={handlePreviewPrompt} disabled={task.status === 'Prompting'}>
                    <Eye className="w-3 h-3 mr-1 opacity-70" /> 预览提示词
                  </Button>
                ) : null}
              </div>
              <Button type="button" className="h-7 px-3.5 rounded-md shadow-sm bg-[#1A1A1A] hover:bg-[#2C2B29] text-white text-[11.55px] font-medium disabled:opacity-50" onClick={handleRunTask} disabled={task.status === 'Rendering' || task.status === 'Prompting'}>
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
      {previewReferenceImage ? createPortal(
        <div className="fixed inset-0 z-[999] bg-[rgba(20,19,17,0.78)] backdrop-blur-sm animate-in fade-in duration-200">
          <div className="flex h-full w-full items-center justify-center p-3 md:p-4">
            <div className="relative flex h-full max-h-[960px] min-h-0 w-full max-w-[1440px] flex-col overflow-hidden rounded-[28px] border border-white/12 bg-[rgba(24,23,21,0.82)] shadow-[0_20px_80px_rgba(0,0,0,0.28)]">
              <div className="flex items-center justify-between gap-4 border-b border-white/8 px-5 py-4 md:px-6">
                <div className="min-w-0">
                  <div className="truncate font-serif text-[18.9px] tracking-tight text-[#F2EFEB]">{previewReferenceImage.title}</div>
                  <div className="mt-1 text-[11.55px] text-white/55">{task.title}</div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/6 text-white/70 transition-colors hover:bg-white/10 hover:text-white"
                    onClick={() => {
                      if (previewReferenceImage.result) {
                        void downloadResultImage(previewReferenceImage.result, previewReferenceImage.fileName);
                        return;
                      }
                      triggerDirectImageDownload(previewReferenceImage.src, previewReferenceImage.fileName);
                    }}
                    title="下载图片"
                  >
                    <Download className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/6 text-white/70 transition-colors hover:bg-white/10 hover:text-white"
                    onClick={() => setPreviewReferenceImage(null)}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className="flex min-h-0 flex-1 items-center justify-center px-3 py-3 md:px-4 md:py-4">
                <div className="relative flex min-h-0 h-full w-full items-center justify-center overflow-hidden rounded-[24px] border border-white/8 bg-transparent">
                  <img
                    src={previewReferenceImage.src}
                    alt={previewReferenceImage.title}
                    className="max-h-full max-w-full select-none object-contain"
                    draggable={false}
                    onDragStart={preventNativeImageDrag}
                  />
                </div>
              </div>

              <div className="flex items-center justify-between border-t border-white/8 px-5 py-3 text-[11.55px] text-white/50 md:px-6">
                <span>查看单张参考图</span>
                <span>ESC 关闭</span>
              </div>
            </div>
          </div>
        </div>,
        document.body
      ) : null}
    </Card>
  );
});
