import * as React from 'react';
import { Upload } from 'lucide-react';
import { useAppStore } from '@/store';
import { TaskCard } from './TaskCard';
import { buildImportedTasksFromFiles, buildReferenceImagesFromFiles } from '@/lib/taskFileImport';
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
} from '@dnd-kit/sortable';

function hasImageFiles(dataTransfer?: DataTransfer | null) {
  if (!dataTransfer) return false;
  return Array.from(dataTransfer.items || []).some(
    (item) => item.kind === 'file' && item.type.startsWith('image/'),
  );
}

const GRID_PLACEHOLDER_HEIGHT = 320;
const LIST_PLACEHOLDER_HEIGHT = 180;
const GRID_ITEM_HEIGHT = 360;
const LIST_ITEM_HEIGHT = 206;
const WINDOW_OVERSCAN_ROWS = 3;
const GRID_MIN_COLUMN_WIDTH = 240;
const GRID_GAP = 24;

type DeferredTaskCardProps = {
  taskId: string;
  viewMode: 'grid' | 'list';
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
        <TaskCard
          taskId={taskId}
          isFileDropTarget={isFileDropTarget}
          onFileDragEnter={onFileDragEnter}
          onFileDragLeave={onFileDragLeave}
          onFileDrop={onFileDrop}
        />
      ) : (
        <div
          className={`overflow-hidden rounded-2xl border border-black/8 bg-white shadow-sm ${
            viewMode === 'list' ? 'min-h-[180px]' : 'min-h-[320px]'
          }`}
          style={{
            contentVisibility: 'auto',
            containIntrinsicSize: `${viewMode === 'list' ? LIST_PLACEHOLDER_HEIGHT : GRID_PLACEHOLDER_HEIGHT}px`,
          }}
          aria-hidden="true"
        >
          <div className="h-full w-full bg-[linear-gradient(180deg,#fbfaf7_0%,#f4f0e8_100%)]" />
        </div>
      )}
    </div>
  );
});

export function TaskList() {
  const scrollContainerRef = React.useRef<HTMLDivElement | null>(null);
  const taskIds = useAppStore((state) => state.taskIds);
  const tasksCount = useAppStore((state) => state.tasksCount);
  const viewMode = useAppStore((state) => state.viewMode);
  const selectedTaskIds = useAppStore((state) => state.selectedTaskIds);
  const importTasks = useAppStore((state) => state.importTasks);
  const setProjectFields = useAppStore((state) => state.setProjectFields);
  const selectAllTasks = useAppStore((state) => state.selectAllTasks);
  const clearTaskSelection = useAppStore((state) => state.clearTaskSelection);
  const reorderTasks = useAppStore((state) => state.reorderTasks);

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
      const rowHeight = viewMode === 'grid' ? GRID_ITEM_HEIGHT : LIST_ITEM_HEIGHT;
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
  const shouldRenderFullList = Boolean(activeDragId) || dragMode !== 'idle';
  const virtualWindow = React.useMemo(() => {
    if (shouldRenderFullList || taskIds.length === 0) {
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
    const rowHeight = viewMode === 'grid' ? GRID_ITEM_HEIGHT : LIST_ITEM_HEIGHT;
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
  }, [dragMode, activeDragId, scrollMetrics.height, scrollMetrics.top, scrollMetrics.width, shouldRenderFullList, taskIds, viewMode]);

  return (
    <div
      ref={scrollContainerRef}
      onScroll={handleScroll}
      onDragEnter={handleWorkspaceDragEnter}
      onDragOver={handleWorkspaceDragOver}
      onDragLeave={handleWorkspaceDragLeave}
      onDrop={handleWorkspaceDrop}
      className="relative mx-auto flex w-full max-w-[1600px] flex-1 flex-col overflow-y-auto p-4 outline-none custom-scrollbar md:p-6 xl:p-8"
    >
      {dragMode === 'workspace-drop' && (
        <div className="pointer-events-none absolute inset-0 z-50 m-4 flex flex-col items-center justify-center rounded-3xl border-2 border-dashed border-button-main/40 bg-white/70 shadow-[0_8px_30px_rgb(0,0,0,0.04)] backdrop-blur-md animate-in fade-in duration-200">
          <Upload className="mb-4 h-12 w-12 text-button-main/60" strokeWidth={1.5} />
          <p className="text-[18.9px] font-serif font-medium text-text-primary">松开鼠标，新建任务</p>
          <p className="mt-2 text-[13.65px] font-medium text-text-secondary">
            每张图片会创建一条任务，并作为原图导入
          </p>
        </div>
      )}

      <div className="mb-6 flex shrink-0 flex-col gap-4 md:mb-8 lg:flex-row lg:items-center lg:justify-between">
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

        <div className="flex self-start rounded-full border border-border/60 bg-background p-1 shadow-sm lg:self-auto">
          <button
            onClick={() => setProjectFields({ viewMode: 'grid' })}
            className={`rounded-full px-3.5 py-1 text-[12.6px] font-medium transition-all duration-300 ${
              viewMode === 'grid'
                ? 'bg-white text-foreground shadow-[0_2px_8px_rgba(0,0,0,0.06)]'
                : 'text-text-secondary hover:text-foreground'
            }`}
          >
            网格
          </button>
          <button
            onClick={() => setProjectFields({ viewMode: 'list' })}
            className={`rounded-full px-3.5 py-1 text-[12.6px] font-medium transition-all duration-300 ${
              viewMode === 'list'
                ? 'bg-white text-foreground shadow-[0_2px_8px_rgba(0,0,0,0.06)]'
                : 'text-text-secondary hover:text-foreground'
            }`}
          >
            列表
          </button>
        </div>
      </div>

      {tasksCount === 0 ? (
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
            items={shouldRenderFullList ? taskIds : virtualWindow.ids}
            strategy={viewMode === 'grid' ? rectSortingStrategy : verticalListSortingStrategy}
          >
            <div
              className="grid gap-4 pb-12 transition-all duration-300 md:gap-6"
              style={{
                gridTemplateColumns:
                  viewMode === 'grid'
                    ? 'repeat(auto-fill, minmax(min(100%, 240px), 1fr))'
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
                  forceRender={shouldRenderFullList}
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
