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

function areStringArraysEqual(first: string[], second: string[]) {
  if (first.length !== second.length) return false;
  return first.every((item, index) => item === second[index]);
}

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

    setActiveTask(null);
    window.dispatchEvent(new CustomEvent('batch-refiner:new-task-mode'));
  }, [setActiveTask]);

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
  }, [scrollMetrics.height, scrollMetrics.top, scrollMetrics.width, taskIds, viewMode]);

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
      className="relative mx-auto flex w-full max-w-[1600px] flex-1 flex-col overflow-y-auto p-4 outline-none custom-scrollbar md:p-6 xl:p-8"
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
