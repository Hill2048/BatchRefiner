import * as React from 'react';
import { Upload } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '@/store';
import { TaskCard } from './TaskCard';
import { buildImportedTasksFromFiles, buildReferenceImagesFromFiles, optimizeDataUrlForUpload } from '@/lib/taskFileImport';
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

export function TaskList() {
  const taskIds = useAppStore(useShallow((state) => state.tasks.map((task) => task.id)));
  const tasksCount = useAppStore((state) => state.tasks.length);
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
  const workspaceDragDepthRef = React.useRef(0);

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
        const chunkStartIndex = startIndex;
        startIndex += newTasks.length;
        importTasks(newTasks);

        void (async () => {
          await new Promise((resolve) => setTimeout(resolve, 0));
          for (let offset = 0; offset < newTasks.length; offset += 1) {
            const taskIndex = chunkStartIndex + offset;
            const optimizedSourceImage = await optimizeDataUrlForUpload(newTasks[offset].sourceImage || '');
            const latestTask = useAppStore.getState().tasks.find((item) => item.index === taskIndex && item.title === newTasks[offset].title);
            if (!latestTask || !optimizedSourceImage || latestTask.sourceImage === optimizedSourceImage) continue;
            useAppStore.getState().updateTask(latestTask.id, { sourceImage: optimizedSourceImage });
          }
        })();

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

    void (async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      const optimizedImages = await Promise.all(encodedImages.map((image) => optimizeDataUrlForUpload(image)));
      const latestTask = useAppStore.getState().tasks.find((item) => item.id === taskId);
      if (!latestTask) return;
      const currentReferences = [...(latestTask.referenceImages || [])];
      const startOffset = currentReferences.length - encodedImages.length;
      if (startOffset < 0) return;
      let changed = false;
      optimizedImages.forEach((image, index) => {
        const targetIndex = startOffset + index;
        if (currentReferences[targetIndex] !== image) {
          currentReferences[targetIndex] = image;
          changed = true;
        }
      });
      if (changed) {
        useAppStore.getState().updateTask(taskId, { referenceImages: currentReferences });
      }
    })();
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

  return (
    <div
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
                      tasks: useAppStore.getState().tasks.filter((task) => !selectedTaskIds.includes(task.id)),
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
            items={taskIds}
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
              {taskIds.map((id) => (
                <TaskCard
                  key={id}
                  taskId={id}
                  isFileDropTarget={hoverTaskId === id}
                  onFileDragEnter={handleTaskFileDragEnter}
                  onFileDragLeave={handleTaskFileDragLeave}
                  onFileDrop={handleTaskFileDrop}
                />
              ))}
            </div>
          </SortableContext>

          <DragOverlay>{activeDragId ? <TaskCard taskId={activeDragId} /> : null}</DragOverlay>
        </DndContext>
      )}
    </div>
  );
}
