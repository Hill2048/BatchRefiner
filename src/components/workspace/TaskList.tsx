import * as React from 'react';
import { Download, Fullscreen, Image as ImageIcon, GripVertical, Plus, Trash2, Upload } from 'lucide-react';
import { CSS } from '@dnd-kit/utilities';
import { toast } from 'sonner';
import { useAppStore } from '@/store';
import { TaskCard } from './TaskCard';
import type { CardDensity, Task, TaskResultImage, WorkspaceViewMode } from '@/types';
import { buildImportedTasksFromFiles, buildReferenceImagesFromFiles } from '@/lib/taskFileImport';
import { getBatchCountNumber, getTaskResultImages } from '@/lib/taskResults';
import { getResultImageAssetDimensions, getResultImageAssetExtension } from '@/lib/resultImageAsset';
import { buildResultImageFileName } from '@/lib/resultImageFileName';
import { resolveResultImageDownloadBlob } from '@/lib/resultImageDownload';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragStartEvent,
  DragOverlay,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  rectSortingStrategy,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';

function hasImageFiles(dataTransfer?: DataTransfer | null) {
  if (!dataTransfer) return false;
  return Array.from(dataTransfer.items || []).some(
    (item) => item.kind === 'file' && item.type.startsWith('image/'),
  );
}

const GRID_PLACEHOLDER_HEIGHT = 320;
const LIST_PLACEHOLDER_HEIGHT = 180;
const GRID_ITEM_HEIGHT = 410;
const LIST_ITEM_HEIGHT = 206;
const WINDOW_OVERSCAN_ROWS = 3;
const GRID_MIN_COLUMN_WIDTH = 300;
const GRID_GAP = 24;
const MARQUEE_SELECT_THRESHOLD = 6;

type MarqueeRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type MarqueeCandidateRect = {
  id: string;
  left: number;
  right: number;
  top: number;
  bottom: number;
};

type MarqueeSelectionState = {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  currentClientX: number;
  currentClientY: number;
  additive: boolean;
  baseSelectedIds: string[];
  candidateRects: MarqueeCandidateRect[];
  lastSelectedIds: string[];
  hasMoved: boolean;
};

type DeferredTaskCardProps = {
  taskId: string;
  viewMode: Exclude<WorkspaceViewMode, 'results'>;
  scrollRoot: HTMLDivElement | null;
  forceRender: boolean;
  isFileDropTarget: boolean;
  onFileDragEnter: (taskId: string) => void;
  onFileDragLeave: (taskId: string) => void;
  onFileDrop: (taskId: string, files: File[]) => void;
};

const DeferredTaskCard = React.memo(function DeferredTaskCard({
  taskId,
  viewMode,
  scrollRoot,
  forceRender,
  isFileDropTarget,
  onFileDragEnter,
  onFileDragLeave,
  onFileDrop,
}: DeferredTaskCardProps) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const [shouldRender, setShouldRender] = React.useState(false);
  const cardDensity = useAppStore((state) => state.cardDensity);

  React.useEffect(() => {
    if (forceRender) return;
    if (shouldRender || isFileDropTarget) {
      setShouldRender(true);
      return;
    }

    const node = containerRef.current;
    if (!node) return;

    if (typeof IntersectionObserver === 'undefined') {
      setShouldRender(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setShouldRender(true);
          observer.disconnect();
        }
      },
      {
        root: scrollRoot,
        rootMargin: '900px 0px',
        threshold: 0.01,
      },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [forceRender, isFileDropTarget, scrollRoot, shouldRender]);

  return (
    <div ref={containerRef} className="min-h-0">
      {forceRender || shouldRender ? (
        viewMode === 'list' || viewMode === 'showcase' ? (
          <TaskShowcaseRow
            taskId={taskId}
            isFileDropTarget={isFileDropTarget}
            onFileDragEnter={onFileDragEnter}
            onFileDragLeave={onFileDragLeave}
            onFileDrop={onFileDrop}
          />
        ) : (
          <TaskCard
            taskId={taskId}
            isFileDropTarget={isFileDropTarget}
            onFileDragEnter={onFileDragEnter}
            onFileDragLeave={onFileDragLeave}
            onFileDrop={onFileDrop}
          />
        )
      ) : (
        <div
          className={`overflow-hidden rounded-2xl border border-black/8 bg-white shadow-sm ${
            viewMode === 'grid'
              ? 'min-h-[320px]'
              : viewMode === 'list' || viewMode === 'showcase'
                ? 'min-h-[296px]'
                : 'min-h-[180px]'
          }`}
          style={{
            contentVisibility: 'auto',
            containIntrinsicSize: `${
              viewMode === 'grid'
                ? GRID_PLACEHOLDER_HEIGHT
                : viewMode === 'list' || viewMode === 'showcase'
                  ? getShowcaseItemHeight(cardDensity)
                  : LIST_PLACEHOLDER_HEIGHT
            }px`,
          }}
          aria-hidden="true"
        >
          <div className="h-full w-full bg-[linear-gradient(180deg,#fbfaf7_0%,#f4f0e8_100%)]" />
        </div>
      )}
    </div>
  );
});

function getShowcaseSourceImage(task: Task) {
  return task.sourceImagePreview || task.sourceImage || task.referenceImages[0] || '';
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

function getShowcaseResultImage(result?: TaskResultImage | null) {
  return result?.previewSrc || result?.src || result?.assetSrc || result?.originalSrc || '';
}

function getShowcaseStatusTone(status: Task['status']) {
  switch (status) {
    case 'Success':
      return 'border-[#CFE6D7] bg-[#F3FAF6] text-[#2C6A4C]';
    case 'Error':
      return 'border-[#F1C7C0] bg-[#FFF4F1] text-[#B04A37]';
    case 'Rendering':
    case 'Running':
      return 'border-[#F0D7BF] bg-[#FFF8EE] text-[#A56A35]';
    case 'Prompting':
    case 'Waiting':
      return 'border-[#DDD7CD] bg-[#F7F3EC] text-[#756B5C]';
    default:
      return 'border-black/8 bg-[#F7F4EE] text-text-secondary';
  }
}

function getShowcaseStatusLabel(status: Task['status']) {
  switch (status) {
    case 'Waiting':
    case 'Idle':
      return '待处理';
    case 'Prompting':
      return '提示词中';
    case 'Rendering':
    case 'Running':
      return '生成中';
    case 'Success':
      return '已完成';
    case 'Error':
      return '失败';
    default:
      return status;
  }
}

function getShowcaseItemHeight(cardDensity: CardDensity) {
  if (cardDensity === 'minimal') return 168;
  if (cardDensity === 'compact') return 348;
  return 456;
}

type TaskShowcaseRowProps = {
  taskId: string;
  isFileDropTarget?: boolean;
  onFileDragEnter?: (taskId: string) => void;
  onFileDragLeave?: (taskId: string) => void;
  onFileDrop?: (taskId: string, files: File[]) => void;
};

const TaskShowcaseRow = React.memo(function TaskShowcaseRow({
  taskId,
  isFileDropTarget = false,
  onFileDragEnter,
  onFileDragLeave,
  onFileDrop,
}: TaskShowcaseRowProps) {
  const task = useAppStore((state) => state.taskLookup[taskId]);
  const isActive = useAppStore((state) => state.activeTaskId === taskId);
  const isSelected = useAppStore((state) => Boolean(state.selectedTaskIdLookup[taskId]));
  const setActiveTask = useAppStore((state) => state.setActiveTask);
  const toggleTaskSelection = useAppStore((state) => state.toggleTaskSelection);
  const removeTask = useAppStore((state) => state.removeTask);
  const cardDensity = useAppStore((state) => state.cardDensity);
  const imageModel = useAppStore((state) => state.imageModel);
  const exportTemplate = useAppStore((state) => state.exportTemplate);
  const [hoveredResultId, setHoveredResultId] = React.useState<string | null>(null);

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: taskId });

  const resultImages = React.useMemo(() => {
    if (!task) return [];
    const images = getTaskResultImages(task);
    if (!task.activeResultSessionId) return images;
    const currentSessionImages = images.filter((result) => result.sessionId === task.activeResultSessionId);
    return currentSessionImages.length > 0 ? currentSessionImages : images;
  }, [task]);

  if (!task) return null;

  const sourceImage = getShowcaseSourceImage(task);
  const coverImageSrc = getShowcaseResultImage(resultImages[0]) || sourceImage;
  const referenceImages = task.referenceImages || [];
  const requestedCount = getBatchCountNumber(task.requestedBatchCount || task.batchCount || 'x1');
  const placeholderCount =
    task.status === 'Rendering' || task.status === 'Running'
      ? Math.max(0, requestedCount - resultImages.length - (task.failedResultCount || 0))
      : 0;
  const paramChips = [
    task.aspectRatio,
    task.resolution,
    task.batchCount || task.requestedBatchCount,
  ].filter(Boolean) as string[];
  const paramSummary = paramChips.join(' / ');
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const isExpanded = isActive || isSelected;
  const isCollapsed = cardDensity === 'minimal' || !isExpanded;
  const isCompact = cardDensity === 'compact';
  const showcaseItemHeight = getShowcaseItemHeight(cardDensity);
  const rowGridClass = isCollapsed
    ? 'md:grid-cols-[188px_minmax(0,1fr)] xl:grid-cols-[204px_minmax(0,1fr)]'
    : isCompact
      ? 'md:grid-cols-[292px_minmax(0,1fr)] xl:grid-cols-[308px_minmax(0,1fr)]'
      : 'md:grid-cols-[320px_minmax(0,1fr)] xl:grid-cols-[336px_minmax(0,1fr)]';
  const mediaHeightClass = isCollapsed
    ? 'h-[52px]'
    : isCompact
      ? 'aspect-[16/10]'
      : 'aspect-[4/3]';
  const resultCardWidthClass = isCollapsed
    ? 'w-[82px] md:w-[92px] xl:w-[100px]'
    : isCompact
      ? 'w-[170px] md:w-[188px] xl:w-[204px]'
      : 'w-[220px] md:w-[240px] xl:w-[258px]';

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.42 : 1,
    zIndex: isDragging ? 50 : 1,
    contentVisibility: 'auto',
    containIntrinsicSize: `${showcaseItemHeight}px`,
  };

  const handleActivate = () => {
    setActiveTask(task.id);
  };

  const handleOpenResult = (result: TaskResultImage, fallbackIndex: number) => {
    const resultIndex = getTaskResultImages(task).findIndex((item) => item.id === result.id);
    setActiveTask(task.id);
    useAppStore.getState().setLightboxTask(task.id, resultIndex >= 0 ? resultIndex : fallbackIndex);
  };

  const handleDownloadResult = async (
    event: React.MouseEvent<HTMLButtonElement>,
    result: TaskResultImage,
    resultIndex: number,
  ) => {
    event.stopPropagation();
    try {
      const { blob } = await resolveResultImageDownloadBlob(result);
      const fileName = buildResultImageFileName({
        task,
        imageIndex: resultIndex,
        extension: getResultImageAssetExtension(result),
        result,
        template: exportTemplate,
        model: task.imageModelOverride || imageModel,
      });
      try {
        const saveAsModule = await import('file-saver');
        saveAsModule.saveAs(blob, fileName);
      } catch {
        triggerDirectDownload(blob, fileName);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '下载失败';
      toast.error(`下载失败：${message}`);
    }
  };

  const handleDownloadAllResults = async (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (resultImages.length === 0) return;

    try {
      const saveAsModule = await import('file-saver');
      for (let index = 0; index < resultImages.length; index += 1) {
        const result = resultImages[index];
        const { blob } = await resolveResultImageDownloadBlob(result);
        const fileName = buildResultImageFileName({
          task,
          imageIndex: index,
          extension: getResultImageAssetExtension(result),
          result,
          template: exportTemplate,
          model: task.imageModelOverride || imageModel,
        });
        saveAsModule.saveAs(blob, fileName);
      }
      toast.success('已开始下载全部结果图');
    } catch (error) {
      const message = error instanceof Error ? error.message : '下载全部失败';
      try {
        for (let index = 0; index < resultImages.length; index += 1) {
          const result = resultImages[index];
          const { blob } = await resolveResultImageDownloadBlob(result);
          const fileName = buildResultImageFileName({
            task,
            imageIndex: index,
            extension: getResultImageAssetExtension(result),
            result,
            template: exportTemplate,
            model: task.imageModelOverride || imageModel,
          });
          triggerDirectDownload(blob, fileName);
        }
        toast.success('已开始下载全部结果图');
      } catch {
        toast.error(`下载全部失败：${message}`);
      }
    }
  };

  const handleRowDragEnter = (event: React.DragEvent<HTMLDivElement>) => {
    if (!hasImageFiles(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    onFileDragEnter?.(task.id);
  };

  const handleRowDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    if (!hasImageFiles(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'copy';
  };

  const handleRowDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    if (!hasImageFiles(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    onFileDragLeave?.(task.id);
  };

  const handleRowDrop = async (event: React.DragEvent<HTMLDivElement>) => {
    if (!hasImageFiles(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    const files = (Array.from(event.dataTransfer.files || []) as File[]).filter((file) =>
      file.type.startsWith('image/'),
    );
    await onFileDrop?.(task.id, files);
  };

  const handlePickReferenceImages = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files ? (Array.from(event.target.files) as File[]) : [];
    event.target.value = '';
    if (files.length === 0) return;
    await onFileDrop?.(task.id, files);
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-task-card
      data-task-id={task.id}
      onClick={handleActivate}
      onDragEnter={handleRowDragEnter}
      onDragOver={handleRowDragOver}
      onDragLeave={handleRowDragLeave}
      onDrop={handleRowDrop}
      className={`task-showcase-row group relative grid gap-0 md:p-1 ${rowGridClass}`}
    >
      {isFileDropTarget ? (
        <div className="pointer-events-none absolute inset-0 z-20 rounded-[30px] border-2 border-dashed border-button-main/45 bg-white/72 backdrop-blur-[1px]" />
      ) : null}

      <section
        className={`task-showcase-card relative flex flex-col overflow-hidden rounded-[22px] border-[1.5px] bg-white md:rounded-r-none md:border-r-0 ${
          isActive
            ? 'border-black/16'
            : 'border-black/12'
        }`}
      >
        <div className="task-showcase-media relative flex min-h-0 w-full flex-col overflow-hidden bg-[#FBFAF7]">
          <div className={`relative flex w-full flex-1 items-center justify-center overflow-hidden border-b border-black/6 ${mediaHeightClass}`}>
            {coverImageSrc ? (
              <img
                src={coverImageSrc}
                alt={task.title}
                loading="lazy"
                decoding="async"
                draggable={false}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-text-secondary/50">
                <ImageIcon className="h-5 w-5 opacity-25" strokeWidth={1} />
              </div>
            )}
          </div>

          <div className={`flex items-center justify-between gap-2 bg-white ${isCollapsed ? 'px-2.5 py-1' : 'px-4 py-3'}`}>
            <div className="min-w-0">
              <div className="text-[10.5px] text-black/48">#{task.index.toString().padStart(3, '0')}</div>
              {!isCollapsed ? (
                <div className="mt-1 truncate text-[13.6px] font-serif font-medium leading-tight text-foreground">
                  {task.title}
                </div>
              ) : null}
            </div>
            <div className={`shrink-0 rounded-full border font-medium ${isCollapsed ? 'px-1.5 py-0.5 text-[9.5px]' : 'px-2.5 py-1 text-[10.5px]'} ${getShowcaseStatusTone(task.status)}`}>
              {getShowcaseStatusLabel(task.status)}
            </div>
          </div>
        </div>

        <div className="absolute left-3 top-3 z-20 flex items-center gap-2">
          <button
            type="button"
            className="task-showcase-action inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/78 text-text-secondary backdrop-blur-sm transition-colors hover:bg-white"
            onClick={(event) => event.stopPropagation()}
            {...attributes}
            {...listeners}
            aria-label="拖拽排序"
          >
            <GripVertical className="h-4 w-4" />
          </button>
          <input
            type="checkbox"
            className="task-showcase-action h-5 w-5 rounded-[6px] border border-black/14 bg-white/80 accent-[#D97757] backdrop-blur-sm"
            checked={isSelected}
            onClick={(event) => event.stopPropagation()}
            onChange={() => toggleTaskSelection(task.id)}
            aria-label={`选择任务 ${task.title}`}
          />
        </div>

        <div className="absolute right-3 top-3 z-20">
          <button
            type="button"
            className="task-showcase-action inline-flex h-8 w-8 items-center justify-center rounded-full bg-white/72 text-text-secondary backdrop-blur-sm opacity-0 transition-all hover:bg-red-500/90 hover:text-white group-hover:opacity-100"
            onClick={(event) => {
              event.stopPropagation();
              removeTask(task.id);
            }}
            title="删除任务"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>

        {!isCollapsed ? (
        <div className={`flex flex-col gap-3 bg-white ${isCompact ? 'px-3 py-2.5' : 'px-4 py-3'}`}>
          {isCompact ? (
            <div className="flex min-w-0 items-center justify-between gap-3 text-[10.5px] text-black/58">
              <span className="truncate font-medium text-black/70">{task.title}</span>
              <span className="shrink-0 text-black/45">{paramSummary || '默认参数'}</span>
            </div>
          ) : (
          <>
          <div className="rounded-[18px] border border-black/6 bg-[#FCFBF8] px-3.5 py-3">
            <div className="flex min-w-0 items-center gap-2">
              <span className="text-[9.45px] font-bold uppercase tracking-wider text-black/42">参考图</span>
              <div className="flex min-w-0 items-center gap-2">
                {referenceImages.slice(0, 3).map((image, index) => (
                  <div key={`${task.id}-reference-${index}`} className="h-10 w-10 overflow-hidden rounded-[12px] bg-white ring-1 ring-black/6">
                    <img src={image} alt={`参考图 ${index + 1}`} draggable={false} className="h-full w-full object-cover" />
                  </div>
                ))}
                {referenceImages.length > 3 ? (
                  <div className="flex h-10 min-w-[40px] items-center justify-center rounded-[12px] border border-dashed border-black/12 bg-white px-2 text-[11px] text-text-secondary">
                    +{referenceImages.length - 3}
                  </div>
                ) : null}
                <button
                  type="button"
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] border border-dashed border-black/16 bg-white/80 text-black/45 transition-colors hover:bg-white"
                  onClick={(event) => {
                    event.stopPropagation();
                    fileInputRef.current?.click();
                  }}
                  title="添加参考图"
                >
                  <Upload className="h-3.5 w-3.5 opacity-70" strokeWidth={2} />
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={handlePickReferenceImages}
                />
              </div>
            </div>
          </div>

          <div className="flex min-w-0 items-center gap-2 rounded-[16px] border border-black/8 bg-white px-3 py-2 text-[10.5px] text-black/58">
            <span className="text-[9.45px] font-bold uppercase tracking-wider text-black/42">参数</span>
            <span className="truncate font-medium text-black/70">{paramSummary || '跟随默认设置'}</span>
          </div>
          </>
          )}
        </div>
        ) : null}
      </section>

      <section
        className={`task-showcase-card min-w-0 overflow-hidden rounded-[22px] border bg-white md:rounded-l-none ${
          isActive ? 'border-black/12' : 'border-black/8'
        } ${isCollapsed ? 'bg-[#fdfdfc] px-2 pb-2 pt-2.5' : isCompact ? 'bg-[#fdfdfc] p-3' : 'bg-[#fdfdfc] p-3 md:p-4'}`}
      >
        <div className={`flex items-center justify-between gap-3 ${isCollapsed ? 'mb-1.5' : 'mb-3'}`}>
          <div>
            <div className={`font-medium text-foreground ${isCollapsed ? 'text-[11.5px]' : 'text-[13px]'}`}>结果图</div>
          </div>
          {resultImages.length > 0 ? (
            <button
              type="button"
              className="task-showcase-action shrink-0 rounded-full border border-black/8 bg-[#F8F6F1] px-3 py-1.5 text-[11px] font-medium text-text-secondary transition-colors hover:bg-[#F1EADF] hover:text-foreground"
              onClick={handleDownloadAllResults}
            >
              下载全部
            </button>
          ) : null}
        </div>

        <div className={`flex overflow-x-auto pb-1 ${isCollapsed ? 'gap-2' : 'gap-3'}`}>
          {resultImages.length > 0
            ? resultImages.map((result, resultIndex) => {
                const src = getShowcaseResultImage(result);
                const dimensions = getResultImageAssetDimensions(result);
                const resultAspectRatio = dimensions ? `${dimensions.width} / ${dimensions.height}` : '3 / 4';
                const isResultHovered = hoveredResultId === result.id;
                return (
                  <div
                    key={result.id}
                    onMouseEnter={() => setHoveredResultId(result.id)}
                    onMouseMove={() => setHoveredResultId(result.id)}
                    onPointerEnter={() => setHoveredResultId(result.id)}
                    onPointerMove={() => setHoveredResultId(result.id)}
                    onPointerDown={(event) => {
                      event.stopPropagation();
                      setHoveredResultId(result.id);
                    }}
                    onPointerLeave={() => {
                      setHoveredResultId((currentResultId) => (currentResultId === result.id ? null : currentResultId));
                    }}
                    onMouseLeave={() => {
                      setHoveredResultId((currentResultId) => (currentResultId === result.id ? null : currentResultId));
                    }}
                    onPointerCancel={() => {
                      setHoveredResultId((currentResultId) => (currentResultId === result.id ? null : currentResultId));
                    }}
                    onDoubleClick={(event) => {
                      event.stopPropagation();
                      handleOpenResult(result, resultIndex);
                    }}
                    onClick={(event) => {
                      event.stopPropagation();
                      setActiveTask(task.id);
                      setHoveredResultId(result.id);
                    }}
                    className={`task-showcase-result-card group/result relative isolate shrink-0 cursor-zoom-in overflow-hidden rounded-[18px] border border-black/8 bg-white ${resultCardWidthClass}`}
                    style={{ aspectRatio: resultAspectRatio }}
                    title="双击查看大图"
                  >
                    {src ? (
                      <img
                        src={src}
                        alt={`${task.title} 结果图 ${resultIndex + 1}`}
                        draggable={false}
                        className="pointer-events-none h-full w-full object-cover"
                        onDoubleClick={(event) => {
                          event.stopPropagation();
                          handleOpenResult(result, resultIndex);
                        }}
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-[12px] text-text-secondary/70">加载中</div>
                    )}
                    <div
                      className={`task-showcase-result-tint pointer-events-none absolute inset-0 transition-colors duration-200 ${
                        isResultHovered ? 'bg-black/14' : 'bg-black/0'
                      }`}
                    />
                    <button
                      type="button"
                      className={`task-showcase-action absolute right-2 top-2 z-20 inline-flex h-8 w-8 items-center justify-center rounded-full bg-[rgba(255,255,255,0.82)] text-black/62 backdrop-blur-sm transition-all duration-200 hover:bg-white hover:text-foreground ${
                        isResultHovered ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'
                      }`}
                      onClick={(event) => void handleDownloadResult(event, result, resultIndex)}
                      title="下载此图"
                    >
                      <Download className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      className={`task-showcase-action absolute left-1/2 top-1/2 z-20 inline-flex h-10 w-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-[rgba(24,22,19,0.72)] text-white backdrop-blur-sm transition-all duration-200 ${
                        isResultHovered ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'
                      }`}
                      onClick={(event) => {
                        event.stopPropagation();
                        handleOpenResult(result, resultIndex);
                      }}
                      title="查看大图"
                    >
                      <Fullscreen className="h-4.5 w-4.5" />
                    </button>
                    <div className={`absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 bg-gradient-to-t from-black/50 via-black/12 to-transparent px-3 pb-3 pt-8 text-white ${isCollapsed ? 'hidden' : ''}`}>
                      <div className="text-[12px] font-medium">第 {resultIndex + 1} 张</div>
                      <div className="text-[10px] text-white/80">
                        {dimensions ? `${dimensions.width} × ${dimensions.height}` : ''}
                      </div>
                    </div>
                  </div>
                );
              })
            : Array.from({ length: placeholderCount }).map((_, index) => (
                <div
                  key={`${task.id}-placeholder-${index}`}
                  className={`task-showcase-placeholder relative flex shrink-0 flex-col items-center justify-center overflow-hidden rounded-[18px] border border-black/8 bg-[linear-gradient(180deg,#FFFFFF_0%,#F7F3EC_100%)] px-5 text-center ${resultCardWidthClass}`}
                  style={{ aspectRatio: '3 / 4' }}
                >
                  <div className="flex h-12 w-12 items-center justify-center rounded-full border border-black/8 bg-white">
                    <ImageIcon className="h-4.5 w-4.5 text-black/45" />
                  </div>
                  {!isCollapsed ? (
                    <>
                      <div className="mt-4 text-[13px] font-medium text-foreground">正在生成第 {index + 1} 张</div>
                      <div className="mt-1 text-[11px] text-text-secondary">生成完成后会显示在这里</div>
                    </>
                  ) : null}
                </div>
              ))}
        </div>
      </section>
    </div>
  );
});

function areStringArraysEqual(first: string[], second: string[]) {
  if (first.length !== second.length) return false;
  return first.every((item, index) => item === second[index]);
}

export function TaskList() {
  const scrollContainerRef = React.useRef<HTMLDivElement | null>(null);
  const taskIds = useAppStore((state) => state.taskIds);
  const tasksCount = useAppStore((state) => state.tasksCount);
  const viewMode = useAppStore((state) => state.viewMode);
  const cardDensity = useAppStore((state) => state.cardDensity);
  const tasks = useAppStore((state) => state.tasks);
  const selectedTaskIds = useAppStore((state) => state.selectedTaskIds);
  const activeTaskId = useAppStore((state) => state.activeTaskId);
  const addTask = useAppStore((state) => state.addTask);
  const updateTask = useAppStore((state) => state.updateTask);
  const importTasks = useAppStore((state) => state.importTasks);
  const setProjectFields = useAppStore((state) => state.setProjectFields);
  const selectAllTasks = useAppStore((state) => state.selectAllTasks);
  const clearTaskSelection = useAppStore((state) => state.clearTaskSelection);
  const reorderTasks = useAppStore((state) => state.reorderTasks);
  const setActiveTask = useAppStore((state) => state.setActiveTask);

  const [activeDragId, setActiveDragId] = React.useState<string | null>(null);
  const [dragMode, setDragMode] = React.useState<'idle' | 'workspace-drop' | 'task-drop'>('idle');
  const [hoverTaskId, setHoverTaskId] = React.useState<string | null>(null);
  const [scrollMetrics, setScrollMetrics] = React.useState({
    top: 0,
    height: 900,
    width: 1200,
  });
  const workspaceDragDepthRef = React.useRef(0);
  const scrollFrameRef = React.useRef<number | null>(null);
  const marqueeStateRef = React.useRef<MarqueeSelectionState | null>(null);
  const marqueeFrameRef = React.useRef<number | null>(null);
  const suppressNextClickRef = React.useRef(false);
  const [marqueeRect, setMarqueeRect] = React.useState<MarqueeRect | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleDragStart = (event: DragStartEvent) => {
    setActiveDragId(event.active.id as string);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveDragId(null);
    const { active, over } = event;

    if (active.id !== over?.id && over) {
      const oldIndex = taskIds.indexOf(active.id as string);
      const newIndex = taskIds.indexOf(over.id as string);
      reorderTasks(oldIndex, newIndex);
    }
  };

  const updateScrollMetrics = React.useCallback(() => {
    const node = scrollContainerRef.current;
    if (!node) return;
    setScrollMetrics((current) => {
      const next = {
        top: node.scrollTop,
        height: node.clientHeight || current.height,
        width: node.clientWidth || current.width,
      };
      if (
        Math.abs(current.top - next.top) < 1 &&
        current.height === next.height &&
        current.width === next.width
      ) {
        return current;
      }
      return next;
    });
  }, []);

  const handleScroll = React.useCallback(() => {
    if (scrollFrameRef.current != null) return;
    scrollFrameRef.current = window.requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      updateScrollMetrics();
    });
  }, [updateScrollMetrics]);

  const handleWorkspaceClick = React.useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false;
      return;
    }

    const target = event.target as HTMLElement;
    if (
      target.closest('[data-task-card]') ||
      target.closest('[data-task-toolbar]') ||
      target.closest('button') ||
      target.closest('input') ||
      target.closest('textarea') ||
      target.closest('[role="button"]')
    ) {
      return;
    }

    if (selectedTaskIds.length > 0) {
      clearTaskSelection();
    }

    setActiveTask(null);
    window.dispatchEvent(new CustomEvent('batch-refiner:new-task-mode'));
  }, [clearTaskSelection, selectedTaskIds.length, setActiveTask]);

  const updateMarqueeSelection = React.useCallback((state: MarqueeSelectionState) => {
    const left = Math.min(state.startClientX, state.currentClientX);
    const right = Math.max(state.startClientX, state.currentClientX);
    const top = Math.min(state.startClientY, state.currentClientY);
    const bottom = Math.max(state.startClientY, state.currentClientY);
    const hitIds = state.candidateRects
      .filter((rect) => rect.left <= right && rect.right >= left && rect.top <= bottom && rect.bottom >= top)
      .map((rect) => rect.id);

    const selectedIds = state.additive
      ? Array.from(new Set([...state.baseSelectedIds, ...hitIds]))
      : hitIds;

    if (areStringArraysEqual(state.lastSelectedIds, selectedIds)) return;
    state.lastSelectedIds = selectedIds;
    setProjectFields({ selectedTaskIds: selectedIds });
  }, [setProjectFields]);

  const updateMarqueeRect = React.useCallback((state: MarqueeSelectionState) => {
    const node = scrollContainerRef.current;
    if (!node) return;

    const bounds = node.getBoundingClientRect();
    setMarqueeRect({
      left: Math.min(state.startClientX, state.currentClientX) - bounds.left + node.scrollLeft,
      top: Math.min(state.startClientY, state.currentClientY) - bounds.top + node.scrollTop,
      width: Math.abs(state.currentClientX - state.startClientX),
      height: Math.abs(state.currentClientY - state.startClientY),
    });
  }, []);

  const flushMarqueeFrame = React.useCallback(() => {
    marqueeFrameRef.current = null;
    const state = marqueeStateRef.current;
    if (!state?.hasMoved) return;

    updateMarqueeRect(state);
    updateMarqueeSelection(state);
  }, [updateMarqueeRect, updateMarqueeSelection]);

  const scheduleMarqueeFrame = React.useCallback(() => {
    if (marqueeFrameRef.current != null) return;
    marqueeFrameRef.current = window.requestAnimationFrame(flushMarqueeFrame);
  }, [flushMarqueeFrame]);

  const handleWorkspacePointerDown = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || event.pointerType === 'touch') return;

    const target = event.target as HTMLElement;
    if (
      target.closest('[data-task-card]') ||
      target.closest('[data-task-toolbar]') ||
      target.closest('button') ||
      target.closest('input') ||
      target.closest('textarea') ||
      target.closest('[role="button"]')
    ) {
      return;
    }

    event.preventDefault();
    const node = scrollContainerRef.current;
    if (!node) return;

    const cards = node.querySelectorAll('[data-task-card][data-task-id]') as NodeListOf<HTMLElement>;
    const candidateRects = Array.from(cards)
      .map((card) => {
        const rect = card.getBoundingClientRect();
        const id = card.dataset.taskId;
        if (!id) return null;
        return {
          id,
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
        };
      })
      .filter((rect): rect is MarqueeCandidateRect => rect !== null);

    marqueeStateRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      currentClientX: event.clientX,
      currentClientY: event.clientY,
      additive: event.shiftKey || event.ctrlKey || event.metaKey,
      baseSelectedIds: selectedTaskIds,
      candidateRects,
      lastSelectedIds: selectedTaskIds,
      hasMoved: false,
    };
    node.setPointerCapture(event.pointerId);
  }, [selectedTaskIds]);

  const handleWorkspacePointerMove = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const state = marqueeStateRef.current;
    if (!state || state.pointerId !== event.pointerId) return;

    state.currentClientX = event.clientX;
    state.currentClientY = event.clientY;

    const distance = Math.hypot(state.currentClientX - state.startClientX, state.currentClientY - state.startClientY);
    if (!state.hasMoved && distance < MARQUEE_SELECT_THRESHOLD) return;

    state.hasMoved = true;
    event.preventDefault();
    scheduleMarqueeFrame();
  }, [scheduleMarqueeFrame]);

  const finishMarqueeSelection = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const state = marqueeStateRef.current;
    if (!state || state.pointerId !== event.pointerId) return;

    const node = scrollContainerRef.current;
    if (node?.hasPointerCapture(event.pointerId)) {
      node.releasePointerCapture(event.pointerId);
    }

    if (state.hasMoved) {
      suppressNextClickRef.current = true;
    }
    if (marqueeFrameRef.current != null) {
      window.cancelAnimationFrame(marqueeFrameRef.current);
      marqueeFrameRef.current = null;
      updateMarqueeRect(state);
      updateMarqueeSelection(state);
    }
    marqueeStateRef.current = null;
    setMarqueeRect(null);
  }, [updateMarqueeRect, updateMarqueeSelection]);

  React.useLayoutEffect(() => {
    updateScrollMetrics();
    const node = scrollContainerRef.current;
    if (!node || typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver(updateScrollMetrics);
    observer.observe(node);
    return () => {
      observer.disconnect();
      if (scrollFrameRef.current != null) {
        window.cancelAnimationFrame(scrollFrameRef.current);
        scrollFrameRef.current = null;
      }
      if (marqueeFrameRef.current != null) {
        window.cancelAnimationFrame(marqueeFrameRef.current);
        marqueeFrameRef.current = null;
      }
    };
  }, [updateScrollMetrics]);

  React.useEffect(() => {
    const handleScrollToTask = (event: Event) => {
      const taskId = (event as CustomEvent).detail?.id;
      if (!taskId) return;
      const index = taskIds.indexOf(taskId);
      const node = scrollContainerRef.current;
      if (index < 0 || !node) return;

      const columnCount =
        viewMode === 'grid'
          ? Math.max(1, Math.floor((scrollMetrics.width + GRID_GAP) / (GRID_MIN_COLUMN_WIDTH + GRID_GAP)))
          : 1;
      const rowHeight =
        viewMode === 'grid'
          ? GRID_ITEM_HEIGHT
          : viewMode === 'list' || viewMode === 'showcase'
            ? getShowcaseItemHeight(cardDensity)
            : LIST_ITEM_HEIGHT;
      const targetRow = Math.floor(index / columnCount);
      node.scrollTo({
        top: Math.max(0, targetRow * rowHeight - rowHeight),
        behavior: 'smooth',
      });
    };

    window.addEventListener('scroll-to-task', handleScrollToTask);
    return () => window.removeEventListener('scroll-to-task', handleScrollToTask);
  }, [scrollMetrics.width, taskIds, viewMode]);

  const clearFileDragState = React.useCallback(() => {
    workspaceDragDepthRef.current = 0;
    setDragMode('idle');
    setHoverTaskId(null);
  }, []);

  const createTasksFromFiles = React.useCallback(
    async (files: File[]) => {
      const images = files.filter((file) => file.type.startsWith('image/'));
      if (images.length === 0) return;

      let startIndex = useAppStore.getState().tasks.length + 1;
      const chunkSize = 5;

      for (let index = 0; index < images.length; index += chunkSize) {
        const chunk = images.slice(index, index + chunkSize);
        const newTasks = await buildImportedTasksFromFiles(chunk, startIndex);
        startIndex += newTasks.length;
        importTasks(newTasks);

        await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
      }
    },
    [importTasks],
  );

  const appendReferencesToTask = React.useCallback(async (taskId: string, files: File[]) => {
    const images = files.filter((file) => file.type.startsWith('image/'));
    if (images.length === 0) return;

    const encodedImages = await buildReferenceImagesFromFiles(images);
    const task = useAppStore.getState().tasks.find((item) => item.id === taskId);
    if (!task) return;

    useAppStore.getState().updateTask(taskId, {
      referenceImages: [...(task.referenceImages || []), ...encodedImages],
    });
  }, []);

  const handleWorkspaceDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
    if (!hasImageFiles(e.dataTransfer)) return;
    e.preventDefault();
    workspaceDragDepthRef.current += 1;
    if (!hoverTaskId) setDragMode('workspace-drop');
  };

  const handleWorkspaceDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    if (!hasImageFiles(e.dataTransfer)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    if (!hoverTaskId && dragMode !== 'workspace-drop') {
      setDragMode('workspace-drop');
    }
  };

  const handleWorkspaceDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    if (!hasImageFiles(e.dataTransfer)) return;
    e.preventDefault();
    workspaceDragDepthRef.current = Math.max(0, workspaceDragDepthRef.current - 1);
    if (workspaceDragDepthRef.current === 0 && !hoverTaskId) {
      clearFileDragState();
    }
  };

  const handleWorkspaceDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    if (!hasImageFiles(e.dataTransfer)) return;
    e.preventDefault();

    if (hoverTaskId) return;

    const files = (Array.from(e.dataTransfer.files || []) as File[]).filter((file) =>
      file.type.startsWith('image/'),
    );
    clearFileDragState();
    await createTasksFromFiles(files);
  };

  const handleTaskFileDragEnter = React.useCallback((taskId: string) => {
    setHoverTaskId((current) => (current === taskId ? current : taskId));
    setDragMode('task-drop');
  }, []);

  const handleTaskFileDragLeave = React.useCallback((taskId: string) => {
    setHoverTaskId((current) => (current === taskId ? null : current));
    setDragMode(workspaceDragDepthRef.current > 0 ? 'workspace-drop' : 'idle');
  }, []);

  const handleTaskFileDrop = React.useCallback(
    async (taskId: string, files: File[]) => {
      clearFileDragState();
      await appendReferencesToTask(taskId, files);
    },
    [appendReferencesToTask, clearFileDragState],
  );

  const allSelected = tasksCount > 0 && selectedTaskIds.length === tasksCount;
  const selectedTaskIdSet = React.useMemo(() => new Set(selectedTaskIds), [selectedTaskIds]);
  const virtualWindow = React.useMemo(() => {
    if (taskIds.length === 0) {
      return {
        ids: taskIds,
        topSpacer: 0,
        bottomSpacer: 0,
      };
    }

    const columnCount =
      viewMode === 'grid'
        ? Math.max(1, Math.floor((scrollMetrics.width + GRID_GAP) / (GRID_MIN_COLUMN_WIDTH + GRID_GAP)))
        : 1;
    const densityScale = cardDensity === 'minimal' ? 0.72 : cardDensity === 'compact' ? 0.84 : 1;
    const rowHeight =
      viewMode === 'grid'
        ? GRID_ITEM_HEIGHT * densityScale
        : viewMode === 'list' || viewMode === 'showcase'
          ? getShowcaseItemHeight(cardDensity)
          : LIST_ITEM_HEIGHT * densityScale;
    const rowCount = Math.ceil(taskIds.length / columnCount);
    const firstRow = Math.max(0, Math.floor(scrollMetrics.top / rowHeight) - WINDOW_OVERSCAN_ROWS);
    const visibleRows = Math.ceil(scrollMetrics.height / rowHeight) + WINDOW_OVERSCAN_ROWS * 2;
    const lastRow = Math.min(rowCount, firstRow + visibleRows);
    const startIndex = firstRow * columnCount;
    const endIndex = Math.min(taskIds.length, lastRow * columnCount);

    return {
      ids: taskIds.slice(startIndex, endIndex),
      topSpacer: firstRow * rowHeight,
      bottomSpacer: Math.max(0, (rowCount - lastRow) * rowHeight),
    };
  }, [cardDensity, scrollMetrics.height, scrollMetrics.top, scrollMetrics.width, taskIds, viewMode]);

  const resultItems = React.useMemo(() => tasks.flatMap((task) =>
    getTaskResultImages(task).map((result, resultIndex) => ({ task, result, resultIndex })),
  ), [tasks]);

  const addResultAsNewTask = React.useCallback((src: string, title: string) => {
    const nextIndex = useAppStore.getState().tasks.length + 1;
    addTask({
      index: nextIndex,
      title: `${title} 复用`,
      description: '',
      sourceImage: src,
      sourceImagePreview: src,
      referenceImages: [],
    });
    const newestTask = useAppStore.getState().tasks.at(-1);
    if (newestTask) {
      setActiveTask(newestTask.id);
      setProjectFields({ selectedTaskIds: [newestTask.id], viewMode: 'grid' });
      window.dispatchEvent(new CustomEvent('scroll-to-task', { detail: { id: newestTask.id } }));
    }
  }, [addTask, setActiveTask, setProjectFields]);

  const addResultToSelectedTasks = React.useCallback((src: string) => {
    const targetIds = selectedTaskIds.length > 0 ? selectedTaskIds : activeTaskId ? [activeTaskId] : [];
    if (targetIds.length === 0) return;
    targetIds.forEach((id) => {
      const task = useAppStore.getState().taskLookup[id];
      if (!task) return;
      updateTask(id, { referenceImages: [...(task.referenceImages || []), src] });
    });
  }, [activeTaskId, selectedTaskIds, updateTask]);

  return (
    <div
      ref={scrollContainerRef}
      onScroll={handleScroll}
      onDragEnter={handleWorkspaceDragEnter}
      onDragOver={handleWorkspaceDragOver}
      onDragLeave={handleWorkspaceDragLeave}
      onDrop={handleWorkspaceDrop}
      onClick={handleWorkspaceClick}
      onPointerDown={handleWorkspacePointerDown}
      onPointerMove={handleWorkspacePointerMove}
      onPointerUp={finishMarqueeSelection}
      onPointerCancel={finishMarqueeSelection}
      className="relative mx-auto flex w-full max-w-[1600px] flex-1 select-none flex-col overflow-y-auto p-4 outline-none custom-scrollbar md:p-6 xl:p-8"
    >
      {marqueeRect ? (
        <div
          className="pointer-events-none absolute z-[60] rounded-[18px] border border-button-main/45 bg-button-main/10 shadow-[0_10px_28px_rgba(217,119,87,0.12)] backdrop-blur-[1px]"
          style={{
            left: marqueeRect.left,
            top: marqueeRect.top,
            width: marqueeRect.width,
            height: marqueeRect.height,
          }}
        />
      ) : null}

      {dragMode === 'workspace-drop' && (
        <div className="pointer-events-none absolute inset-0 z-50 m-4 flex flex-col items-center justify-center rounded-3xl border-2 border-dashed border-button-main/40 bg-white/70 shadow-[0_8px_30px_rgb(0,0,0,0.04)] backdrop-blur-md animate-in fade-in duration-200">
          <Upload className="mb-4 h-12 w-12 text-button-main/60" strokeWidth={1.5} />
          <p className="text-[18.9px] font-serif font-medium text-text-primary">松开鼠标，新建任务</p>
          <p className="mt-2 text-[13.65px] font-medium text-text-secondary">
            每张图片会创建一条任务，并作为原图导入
          </p>
        </div>
      )}

      <div data-task-toolbar className="mb-6 flex shrink-0 flex-col gap-4 md:mb-8 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
          <h2 className="text-[18.9px] font-serif font-medium tracking-tight text-foreground">
            当前任务
            <span className="ml-2 font-sans text-[12.6px] font-normal text-text-secondary">共 {tasksCount} 项</span>
          </h2>
          {tasksCount > 0 && (
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex cursor-pointer items-center gap-2 text-[13.65px] text-text-secondary">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded appearance-auto accent-[#D97757]"
                  checked={allSelected}
                  onChange={() => {
                    if (allSelected) clearTaskSelection();
                    else selectAllTasks();
                  }}
                />
                全选
              </label>

              {selectedTaskIds.length > 0 && (
                <button
                  onClick={() =>
                    setProjectFields({
                      tasks: useAppStore.getState().tasks.filter((task) => !selectedTaskIdSet.has(task.id)),
                      selectedTaskIds: [],
                    })
                  }
                  className="flex items-center gap-1 rounded-md px-2 py-1 text-[13.65px] text-red-600 transition-colors animate-in fade-in zoom-in hover:bg-red-50"
                  title="删除选中的任务"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 6h18" />
                    <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                    <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                    <line x1="10" x2="10" y1="11" y2="17" />
                    <line x1="14" x2="14" y1="11" y2="17" />
                  </svg>
                  删除
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {viewMode === 'results' ? (
        resultItems.length === 0 ? (
          <div className="flex h-52 flex-col items-center justify-center rounded-3xl border-2 border-dashed border-border/60 bg-transparent px-6 text-center text-[14.7px] text-text-secondary md:h-64">
            <ImageIcon className="mb-3 h-8 w-8 opacity-40" />
            <p className="font-medium opacity-80">暂无结果图，生成后会在这里集中挑选</p>
          </div>
        ) : (
          <div className="columns-2 gap-4 pb-[420px] sm:columns-3 lg:columns-4 2xl:columns-5">
            {resultItems.map(({ task, result, resultIndex }) => {
              const src = result.previewSrc || result.src || result.assetSrc || result.originalSrc || '';
              const dimensions = getResultImageAssetDimensions(result);
              return (
                <div key={`${task.id}-${result.id}`} className="task-result-gallery-card group/result mb-4 break-inside-avoid overflow-hidden rounded-[22px] border border-black/8 bg-white shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_16px_34px_rgba(31,24,18,0.12)]">
                  <button
                    type="button"
                    className="block w-full bg-[#F7F4EE]"
                    onClick={() => {
                      setActiveTask(task.id);
                      useAppStore.getState().setLightboxTask(task.id, resultIndex);
                    }}
                  >
                    {src ? (
                      <img src={src} loading="lazy" decoding="async" className="w-full object-cover" alt={task.title} draggable={false} />
                    ) : (
                      <div className="flex aspect-square items-center justify-center text-text-secondary">无预览</div>
                    )}
                  </button>
                  <div className="space-y-2 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-[12px] font-medium text-foreground">#{String(task.index).padStart(3, '0')} {task.title}</div>
                        <div className="mt-0.5 text-[10px] text-text-secondary">
                          {dimensions ? `${dimensions.width} × ${dimensions.height}` : '尺寸未知'} / 第 {resultIndex + 1} 张
                        </div>
                      </div>
                      <button
                        type="button"
                        className="task-result-gallery-action pointer-events-none inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#1F1D1A] text-white opacity-0 transition-opacity group-hover/result:pointer-events-auto group-hover/result:opacity-100"
                        title="作为新任务原图"
                        onClick={(event) => {
                          event.stopPropagation();
                          addResultAsNewTask(result.src || src, task.title);
                        }}
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <div className="flex gap-1.5">
                      <button
                        type="button"
                        className="rounded-full bg-[#F4EFE7] px-2.5 py-1 text-[10px] text-text-secondary hover:bg-white"
                        onClick={(event) => {
                          event.stopPropagation();
                          addResultToSelectedTasks(result.src || src);
                        }}
                      >
                        加到选中
                      </button>
                      <button
                        type="button"
                        className="rounded-full bg-[#F4EFE7] px-2.5 py-1 text-[10px] text-text-secondary hover:bg-white"
                        onClick={(event) => {
                          event.stopPropagation();
                          setProjectFields({ globalReferenceImages: [...useAppStore.getState().globalReferenceImages, result.src || src] });
                        }}
                      >
                        全局参考
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )
      ) : tasksCount === 0 ? (
        <div className="flex h-52 flex-col items-center justify-center rounded-3xl border-2 border-dashed border-border/60 bg-transparent px-6 text-center text-[14.7px] text-text-secondary md:h-64">
          <p className="font-medium opacity-80">暂无任务，请从左侧栏导入或直接拖拽图片到此处</p>
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={virtualWindow.ids}
            strategy={viewMode === 'grid' ? rectSortingStrategy : verticalListSortingStrategy}
          >
            <div
              className="grid gap-4 pb-[420px] transition-all duration-300 md:gap-6"
              style={{
                gridTemplateColumns:
                  viewMode === 'grid'
                    ? 'repeat(auto-fill, minmax(min(100%, 300px), 1fr))'
                    : '1fr',
                gridAutoRows: 'max-content',
              }}
            >
              {virtualWindow.topSpacer > 0 ? (
                <div
                  aria-hidden="true"
                  style={{
                    height: virtualWindow.topSpacer,
                    gridColumn: '1 / -1',
                  }}
                />
              ) : null}
              {virtualWindow.ids.map((id) => (
                <DeferredTaskCard
                  key={id}
                  taskId={id}
                  viewMode={viewMode}
                  scrollRoot={scrollContainerRef.current}
                  forceRender={activeDragId === id || hoverTaskId === id}
                  isFileDropTarget={hoverTaskId === id}
                  onFileDragEnter={handleTaskFileDragEnter}
                  onFileDragLeave={handleTaskFileDragLeave}
                  onFileDrop={handleTaskFileDrop}
                />
              ))}
              {virtualWindow.bottomSpacer > 0 ? (
                <div
                  aria-hidden="true"
                  style={{
                    height: virtualWindow.bottomSpacer,
                    gridColumn: '1 / -1',
                  }}
                />
              ) : null}
            </div>
          </SortableContext>

          <DragOverlay>{activeDragId ? <TaskCard taskId={activeDragId} /> : null}</DragOverlay>
        </DndContext>
      )}
    </div>
  );
}
