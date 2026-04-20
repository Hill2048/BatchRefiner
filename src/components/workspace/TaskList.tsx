import { useAppStore } from "@/store";
import { TaskCard } from "./TaskCard";
import { Upload } from "lucide-react";
import * as React from "react";
import { useShallow } from "zustand/react/shallow";
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
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  rectSortingStrategy,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";

function hasImageFiles(dataTransfer?: DataTransfer | null) {
  if (!dataTransfer) return false;
  return Array.from(dataTransfer.items || []).some(
    (item) => item.kind === "file" && item.type.startsWith("image/")
  );
}

export function TaskList() {
  const store = useAppStore();
  const taskIds = useAppStore(useShallow(state => state.tasks.map(t => t.id)));
  const tasksCount = useAppStore(state => state.tasks.length);
  const viewMode = useAppStore(state => state.viewMode);
  const selectedTaskIds = useAppStore(state => state.selectedTaskIds);
  const importTasks = useAppStore(state => state.importTasks);
  const setProjectFields = useAppStore(state => state.setProjectFields);
  const selectAllTasks = useAppStore(state => state.selectAllTasks);
  const clearTaskSelection = useAppStore(state => state.clearTaskSelection);
  const reorderTasks = useAppStore(state => state.reorderTasks);

  const [activeDragId, setActiveDragId] = React.useState<string | null>(null);
  const [dragMode, setDragMode] = React.useState<"idle" | "workspace-drop" | "task-drop">("idle");
  const [hoverTaskId, setHoverTaskId] = React.useState<string | null>(null);
  const workspaceDragDepthRef = React.useRef(0);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
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

  const optimizeImage = React.useCallback((file: File): Promise<string> => {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const MAX_SIZE = 1200;
        let w = img.width;
        let h = img.height;
        if (w > MAX_SIZE || h > MAX_SIZE) {
          const ratio = Math.min(MAX_SIZE / w, MAX_SIZE / h);
          w = w * ratio;
          h = h * ratio;
        }

        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL("image/jpeg", 0.85));
        } else {
          const reader = new FileReader();
          reader.onload = (e) => resolve(e.target?.result as string);
          reader.readAsDataURL(file);
        }
        URL.revokeObjectURL(url);
      };
      img.onerror = () => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target?.result as string);
        reader.readAsDataURL(file);
        URL.revokeObjectURL(url);
      };
      img.src = url;
    });
  }, []);

  const clearFileDragState = React.useCallback(() => {
    workspaceDragDepthRef.current = 0;
    setDragMode("idle");
    setHoverTaskId(null);
  }, []);

  const createTasksFromFiles = React.useCallback(async (files: File[]) => {
    const images = files.filter((file) => file.type.startsWith("image/"));
    if (images.length === 0) return;

    let startIndex = useAppStore.getState().tasks.length + 1;
    const CHUNK_SIZE = 5;

    for (let i = 0; i < images.length; i += CHUNK_SIZE) {
      const chunk = images.slice(i, i + CHUNK_SIZE);
      const newTasks: Array<{
        index: number;
        title: string;
        description: string;
        sourceImage: string;
        referenceImages: string[];
      }> = [];

      for (const file of chunk) {
        const dataUrl = await optimizeImage(file);
        newTasks.push({
          index: startIndex++,
          title: file.name,
          description: "",
          sourceImage: dataUrl,
          referenceImages: [],
        });
      }

      importTasks(newTasks);
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    }
  }, [importTasks, optimizeImage]);

  const appendReferencesToTask = React.useCallback(async (taskId: string, files: File[]) => {
    const images = files.filter((file) => file.type.startsWith("image/"));
    if (images.length === 0) return;

    const encodedImages = await Promise.all(images.map((file) => optimizeImage(file)));
    const task = useAppStore.getState().tasks.find((item) => item.id === taskId);
    if (!task) return;

    useAppStore.getState().updateTask(taskId, {
      referenceImages: [...(task.referenceImages || []), ...encodedImages],
    });
  }, [optimizeImage]);

  const handleWorkspaceDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
    if (!hasImageFiles(e.dataTransfer)) return;
    e.preventDefault();
    workspaceDragDepthRef.current += 1;
    if (!hoverTaskId) setDragMode("workspace-drop");
  };

  const handleWorkspaceDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    if (!hasImageFiles(e.dataTransfer)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    if (!hoverTaskId && dragMode !== "workspace-drop") {
      setDragMode("workspace-drop");
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
      file.type.startsWith("image/")
    );
    clearFileDragState();
    await createTasksFromFiles(files);
  };

  const handleTaskFileDragEnter = React.useCallback((taskId: string) => {
    setHoverTaskId((current) => (current === taskId ? current : taskId));
    setDragMode("task-drop");
  }, []);

  const handleTaskFileDragLeave = React.useCallback((taskId: string) => {
    setHoverTaskId((current) => (current === taskId ? null : current));
    setDragMode(workspaceDragDepthRef.current > 0 ? "workspace-drop" : "idle");
  }, []);

  const handleTaskFileDrop = React.useCallback(async (taskId: string, files: File[]) => {
    clearFileDragState();
    await appendReferencesToTask(taskId, files);
  }, [appendReferencesToTask, clearFileDragState]);

  const allSelected =
    tasksCount > 0 && selectedTaskIds.length === tasksCount;

  return (
    <div
      onDragEnter={handleWorkspaceDragEnter}
      onDragOver={handleWorkspaceDragOver}
      onDragLeave={handleWorkspaceDragLeave}
      onDrop={handleWorkspaceDrop}
      className="flex-1 flex flex-col p-8 overflow-y-auto w-full max-w-[1600px] mx-auto relative outline-none custom-scrollbar"
    >
      {dragMode === "workspace-drop" && (
        <div className="absolute inset-0 z-50 bg-white/70 backdrop-blur-md border-2 border-dashed border-button-main/40 rounded-3xl m-4 flex flex-col items-center justify-center animate-in fade-in duration-200 shadow-[0_8px_30px_rgb(0,0,0,0.04)] pointer-events-none">
          <Upload className="w-12 h-12 text-button-main/60 mb-4" strokeWidth={1.5} />
          <p className="text-[18.9px] font-serif font-medium text-text-primary">
            松开鼠标，新建任务
          </p>
          <p className="text-[13.65px] text-text-secondary mt-2 font-medium">
            每张图片会创建一条任务，并作为原图导入
          </p>
        </div>
      )}

      <div className="mb-8 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-4">
          <h2 className="text-[18.9px] font-serif font-medium text-foreground tracking-tight">
            当前任务{" "}
            <span className="font-sans text-[12.6px] text-text-secondary ml-2 font-normal">
              共 {tasksCount} 项
            </span>
          </h2>
          {tasksCount > 0 && (
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-[13.65px] cursor-pointer text-text-secondary">
                <input
                  type="checkbox"
                  className="w-4 h-4 rounded appearance-none border border-black/30 checked:bg-button-main checked:border-button-main flex items-center justify-center relative bg-white transition-all checked:after:content-['✓'] checked:after:absolute checked:after:text-white checked:after:text-[10.5px]"
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
                      tasks: useAppStore.getState().tasks.filter(
                        (t) => !selectedTaskIds.includes(t.id)
                      ),
                      selectedTaskIds: [],
                    })
                  }
                  className="flex items-center gap-1 text-[13.65px] text-red-600 hover:bg-red-50 px-2 py-1 rounded-md transition-colors animate-in fade-in zoom-in"
                  title="删除选中的任务"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>
                  删除
                </button>
              )}
            </div>
          )}
        </div>

        <div className="flex bg-background p-1 rounded-full border border-border/60 shadow-sm">
          <button
            onClick={() => setProjectFields({ viewMode: "grid" })}
            className={`px-3.5 py-1 text-[12.6px] font-medium rounded-full transition-all duration-300 ${viewMode === "grid" ? "bg-white shadow-[0_2px_8px_rgba(0,0,0,0.06)] text-foreground" : "text-text-secondary hover:text-foreground"}`}
          >
            网格
          </button>
          <button
            onClick={() => setProjectFields({ viewMode: "list" })}
            className={`px-3.5 py-1 text-[12.6px] font-medium rounded-full transition-all duration-300 ${viewMode === "list" ? "bg-white shadow-[0_2px_8px_rgba(0,0,0,0.06)] text-foreground" : "text-text-secondary hover:text-foreground"}`}
          >
            列表
          </button>
        </div>
      </div>

      {tasksCount === 0 ? (
        <div className="h-64 flex flex-col items-center justify-center border-2 border-dashed border-border/60 rounded-3xl bg-transparent text-text-secondary text-[14.7px]">
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
            strategy={
              viewMode === "grid"
                ? rectSortingStrategy
                : verticalListSortingStrategy
            }
          >
            <div
              className="grid gap-6 pb-12 transition-all duration-300"
              style={{
                gridTemplateColumns:
                  viewMode === "grid"
                    ? "repeat(auto-fill, minmax(260px, 1fr))"
                    : "1fr",
                gridAutoRows: "max-content",
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
          <DragOverlay>
            {activeDragId ? (
              <TaskCard taskId={activeDragId} />
            ) : null}
          </DragOverlay>
        </DndContext>
      )}
    </div>
  );
}
