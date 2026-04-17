import { useAppStore } from "@/store";
import { TaskCard } from "./TaskCard";
import { useDropzone } from "react-dropzone";
import { Upload } from "lucide-react";
import * as React from "react";
import { useShallow } from 'zustand/react/shallow';
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

export function TaskList() {
  const store = useAppStore();
  // Instead of subscribing to the entire array of mutatable objects,
  // we subscribe via useShallow to just the tasks, but wait, useShallow requires 
  // us to pull just the necessary derived data if mapping directly isn't enough,
  // but since we need the `task` object to pass down it's better to:
  // 1. Pass task IDs only to TaskCard, OR
  // 2. Just let React.memo handle it since Zustand replaces only the mutated task ref.
  // Actually, wait, Zustand returns a new `tasks` array every time ANY task updates.
  // We'll safely rely on `React.memo` inside TaskCard which we just added. 
  const taskIds = useAppStore(useShallow(state => state.tasks.map(t => t.id)));
  const tasksCount = useAppStore(state => state.tasks.length);
  const viewMode = useAppStore(state => state.viewMode);
  
  // To avoid re-rendering entire list when a single task checks its selected box:
  const selectedTaskIds = useAppStore(state => state.selectedTaskIds);
  const allSelectedCount = selectedTaskIds.length;
  const importTasks = useAppStore(state => state.importTasks);
  const setProjectFields = useAppStore(state => state.setProjectFields);
  const selectAllTasks = useAppStore(state => state.selectAllTasks);
  const clearTaskSelection = useAppStore(state => state.clearTaskSelection);
  const reorderTasks = useAppStore(state => state.reorderTasks);
  
  const [activeDragId, setActiveDragId] = React.useState<string | null>(null);

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

  const onDrop = async (acceptedFiles: File[]) => {
    const images = acceptedFiles.filter((f) => f.type.startsWith("image/"));
    if (images.length === 0) return;

    let startIndex = tasksCount + 1;
    const CHUNK_SIZE = 5;

    const optimizeImage = (file: File): Promise<string> => {
      return new Promise((resolve) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
          // Shrink massive images to prevent OOM
          const MAX_SIZE = 1200;
          let w = img.width;
          let h = img.height;
          if (w > MAX_SIZE || h > MAX_SIZE) {
            const ratio = Math.min(MAX_SIZE / w, MAX_SIZE / h);
            w = w * ratio;
            h = h * ratio;
          }
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(img, 0, 0, w, h);
            const dataUrl = canvas.toDataURL('image/jpeg', 0.85); // Compress 85% as well
            resolve(dataUrl);
          } else {
            // Fallback
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target?.result as string);
            reader.readAsDataURL(file);
          }
          URL.revokeObjectURL(url);
        };
        img.onerror = () => {
          // Fallback
          const reader = new FileReader();
          reader.onload = (e) => resolve(e.target?.result as string);
          reader.readAsDataURL(file);
        }
        img.src = url;
      });
    };

    for (let i = 0; i < images.length; i += CHUNK_SIZE) {
      const chunk = images.slice(i, i + CHUNK_SIZE);
      const newTasks: any[] = [];

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
      await new Promise(r => requestAnimationFrame(r)); // Yield to paint
    }
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    noClick: true,
  } as any);

  const allSelected =
    tasksCount > 0 && selectedTaskIds.length === tasksCount;

  return (
    <div
      {...getRootProps()}
      className="flex-1 flex flex-col p-8 overflow-y-auto w-full max-w-[1600px] mx-auto relative outline-none custom-scrollbar"
    >
      <input {...getInputProps()} />

      {isDragActive && (
        <div className="absolute inset-0 z-50 bg-[#F2EFEB]/90 backdrop-blur-sm border-2 border-dashed border-[#D97757] rounded-3xl m-4 flex flex-col items-center justify-center animate-in fade-in duration-200">
          <Upload className="w-12 h-12 text-[#D97757] mb-4" strokeWidth={1.5} />
          <p className="text-[18px] font-serif font-medium text-[#D97757]">
            松开鼠标，导入图片
          </p>
          <p className="text-[13px] text-text-secondary mt-2">
            将自动为每张图片创建独立的编辑任务
          </p>
        </div>
      )}

      <div className="mb-8 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-4">
          <h2 className="text-[18px] font-serif font-medium text-foreground tracking-tight">
            当前任务{" "}
            <span className="font-sans text-[12px] text-text-secondary ml-2 font-normal">
              共 {tasksCount} 项
            </span>
          </h2>
          {tasksCount > 0 && (
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-[13px] cursor-pointer text-text-secondary">
                <input
                  type="checkbox"
                  className="w-4 h-4 rounded appearance-none border border-black/30 checked:bg-button-main checked:border-button-main flex items-center justify-center relative bg-white transition-all checked:after:content-['✓'] checked:after:absolute checked:after:text-white checked:after:text-[10px]"
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
                   onClick={() => setProjectFields({ 
                      tasks: useAppStore.getState().tasks.filter(t => !selectedTaskIds.includes(t.id)),
                      selectedTaskIds: []
                   })}
                   className="flex items-center gap-1 text-[13px] text-red-600 hover:bg-red-50 px-2 py-1 rounded-md transition-colors animate-in fade-in zoom-in"
                   title="删除选中的任务"
                 >
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>
                    删除
                 </button>
              )}
            </div>
          )}
        </div>

        <div className="flex bg-[#F2EFEB] p-1 rounded-full border border-border/60">
          <button
            onClick={() => setProjectFields({ viewMode: "grid" })}
            className={`px-3 py-1 text-[12px] font-medium rounded-full transition-colors ${viewMode === "grid" ? "bg-white shadow-sm text-foreground" : "text-text-secondary hover:text-foreground"}`}
          >
            网格
          </button>
          <button
            onClick={() => setProjectFields({ viewMode: "list" })}
            className={`px-3 py-1 text-[12px] font-medium rounded-full transition-colors ${viewMode === "list" ? "bg-white shadow-sm text-foreground" : "text-text-secondary hover:text-foreground"}`}
          >
            列表
          </button>
        </div>
      </div>

      {tasksCount === 0 ? (
        <div className="h-64 flex flex-col items-center justify-center border border-dashed border-[#D4D2CD] rounded-2xl bg-transparent text-text-secondary text-[14px]">
          <p>暂无任务，请从左侧栏导入或直接拖拽图片到此处</p>
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
                <TaskCard key={id} taskId={id} />
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
