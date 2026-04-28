import * as React from 'react';
import {
  ArrowUp,
  ChevronDown,
  Download,
  FileText,
  History,
  Image as ImageIcon,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Settings,
  X,
} from 'lucide-react';
import pLimit from 'p-limit';
import { toast } from 'sonner';
import { useShallow } from 'zustand/react/shallow';
import { processBatch, processSingleTask, getTaskPromptInputSignature, generateTaskPrompt, haltBatch } from '@/lib/batchRunner';
import { useAppStore } from '@/store';
import { GenerateParamsSelector } from '../GenerateParamsSelector';
import { MarkdownEditorDialog } from '../MarkdownEditorDialog';
import { SettingsDialog } from '../SettingsDialog';
import { Button } from '../ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { Textarea } from '../ui/textarea';
import { buildReferenceImagesFromFiles } from '@/lib/taskFileImport';
import { ensureDownloadDirectoryPermission, getDownloadDirectoryHandle, writeBlobToDirectory } from '@/lib/downloadDirectory';
import { getTaskResultImages } from '@/lib/taskResults';
import { buildResultImageFileName } from '@/lib/resultImageFileName';
import { getResultImageAssetExtension } from '@/lib/resultImageAsset';
import { getResultDownloadDiagnostics, resolveResultImageDownloadBlob, ResultImageDownloadError } from '@/lib/resultImageDownload';
import { appendGenerationLogEvent, getLatestGenerationLogSessionForTask } from '@/lib/appLogger';
import { GenerationHistoryDialog } from './GenerationHistoryDialog';
import { Task, TaskResultImage } from '@/types';

type DockMode = 'global' | 'task';
type BatchMode = 'all' | 'prompts' | 'images';

const GLOBAL_REFERENCE_IMPORT_BATCH_SIZE = 4;

function hasImageFiles(dataTransfer?: DataTransfer | null) {
  if (!dataTransfer) return false;
  return Array.from(dataTransfer.items || []).some((item) => item.kind === 'file' && item.type.startsWith('image/'));
}

function waitForNextPaint() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

function getGlobalParamsLabel(imageModel?: string) {
  const normalized = (imageModel || '').trim().toLowerCase();
  if (normalized.startsWith('gpt-image') || normalized === 'image2') {
    return 'GPT';
  }
  return 'Gemini';
}

function getQuickSwitchImageModel(target: 'gemini' | 'gpt', currentModel?: string) {
  const normalized = (currentModel || '').trim().toLowerCase();

  if (target === 'gpt') {
    if (normalized.startsWith('gpt-image') || normalized === 'image2') {
      return currentModel || 'gpt-image-2';
    }
    return 'gpt-image-2';
  }

  if (normalized.includes('gemini') || normalized.includes('imagen') || normalized.includes('banana')) {
    return currentModel || 'gemini-3.1-flash-image-preview';
  }
  return 'gemini-3.1-flash-image-preview';
}

function getExportableTaskImages(task: Task) {
  return getTaskResultImages(task);
}

async function resultImageToBlob(resultImage: TaskResultImage) {
  return resolveResultImageDownloadBlob(resultImage);
}

function buildQuickTaskTitle(input: string, nextIndex: number) {
  const firstLine = input
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean);
  if (!firstLine) {
    return `任务 ${nextIndex}`;
  }
  return firstLine.slice(0, 36) + (firstLine.length > 36 ? '…' : '');
}

export function DockProgress() {
  const { tasksCount, completedTaskCount } = useAppStore(
    useShallow((state) => ({
      tasksCount: state.tasksCount,
      completedTaskCount: state.completedTaskCount,
    })),
  );

  const progressPercent = tasksCount === 0 ? 0 : Math.round((completedTaskCount / tasksCount) * 100);

  return (
    <div className="flex min-w-[180px] items-center gap-3 text-[12px] text-text-secondary">
      <span className="font-medium text-foreground/80">{completedTaskCount} / {tasksCount} 完成</span>
      <div className="h-2 w-28 overflow-hidden rounded-full bg-[#E8E1D6]">
        <div
          className="h-full rounded-full bg-button-main transition-all duration-500 ease-out"
          style={{ width: `${progressPercent}%` }}
        />
      </div>
      <span className="font-mono text-[11px]">{progressPercent}%</span>
    </div>
  );
}

function IconAction({
  title,
  onClick,
  subtle = false,
  children,
}: {
  title: string;
  onClick: () => void;
  subtle?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      className={
        subtle
          ? 'h-9 w-9 rounded-2xl border-transparent bg-transparent text-text-secondary shadow-none hover:border-black/8 hover:bg-white/70 hover:text-foreground'
          : 'h-9 w-9 rounded-2xl border-border/60 bg-[#F7F4EE] text-text-secondary shadow-none hover:bg-white hover:text-foreground'
      }
      onClick={onClick}
      title={title}
    >
      {children}
    </Button>
  );
}

function ModeSwitchButton({
  active,
  label,
  title,
  onClick,
  children,
}: {
  active: boolean;
  label: string;
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`group/mode relative z-10 flex h-9 items-center justify-center gap-1.5 overflow-hidden rounded-full text-[12px] font-semibold transition-[width,color,transform] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ${
        active
          ? 'w-[84px] px-3 text-button-main'
          : 'w-9 px-0 text-text-secondary hover:scale-[1.03] hover:text-foreground'
      }`}
    >
      {children}
      <span
        className={`whitespace-nowrap transition-all duration-300 ease-out ${
          active ? 'ml-0 max-w-[52px] opacity-100' : 'ml-[-4px] max-w-0 opacity-0'
        }`}
      >
        {label}
      </span>
    </button>
  );
}

function SingleSparkIcon({ className = 'h-3.5 w-3.5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden="true">
      <path d="M12 3.5l2.15 6.35L20.5 12l-6.35 2.15L12 20.5l-2.15-6.35L3.5 12l6.35-2.15L12 3.5z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

function MultiSparkIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden="true">
      <path d="M10.5 4l1.7 4.8L17 10.5l-4.8 1.7-1.7 4.8-1.7-4.8L4 10.5l4.8-1.7L10.5 4z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M18.2 3.7l.85 2.15 2.15.85-2.15.85-.85 2.15-.85-2.15-2.15-.85 2.15-.85.85-2.15z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" opacity=".72" />
      <path d="M17.6 15l1 2.65 2.65 1-2.65 1-1 2.65-1-2.65-2.65-1 2.65-1 1-2.65z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" opacity=".82" />
    </svg>
  );
}

function ModelSwitch({
  value,
  inheritedValue,
  onChange,
  onClear,
}: {
  value?: string;
  inheritedValue?: string;
  onChange: (model: string) => void;
  onClear?: () => void;
}) {
  const effectiveValue = value || inheritedValue || '';
  const activeFamily = getGlobalParamsLabel(effectiveValue);
  const isInherited = !value && Boolean(onClear);
  const buttonClass = 'h-9 rounded-full border-transparent bg-transparent px-3 text-[12px] text-text-secondary shadow-none hover:border-black/8 hover:bg-white/70 hover:text-foreground';

  return (
    <div className="flex items-center rounded-full bg-transparent">
      {onClear ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={`${buttonClass} ${isInherited ? 'text-button-main' : ''}`}
          onClick={onClear}
          title="跟随全局模型"
        >
          跟随
        </Button>
      ) : null}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className={`${buttonClass} ${activeFamily === 'Gemini' && !isInherited ? 'text-button-main' : ''}`}
        onClick={() => onChange(getQuickSwitchImageModel('gemini', effectiveValue))}
      >
        Gemini
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className={`${buttonClass} ${activeFamily === 'GPT' && !isInherited ? 'text-button-main' : ''}`}
        onClick={() => onChange(getQuickSwitchImageModel('gpt', effectiveValue))}
      >
        GPT
      </Button>
    </div>
  );
}

function FloatingReferenceStack({
  images,
  isDragging,
  importing,
  disabled,
  onAdd,
  onRemove,
}: {
  images: string[];
  isDragging: boolean;
  importing: boolean;
  disabled?: boolean;
  onAdd: () => void;
  onRemove: (index: number) => void;
}) {
  const previewImages = images.slice(0, 5);
  const hasImages = previewImages.length > 0;
  const expandedWidth = hasImages ? Math.max(174, 184 + (previewImages.length - 1) * 108) : 174;

  return (
    <div
      className={`group/reference flex h-[210px] w-[174px] shrink-0 flex-col rounded-[26px] p-4 transition-[width,background-color,box-shadow,ring-color] duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] hover:w-[var(--expanded-reference-width)] ${
        isDragging
          ? 'w-[var(--expanded-reference-width)] bg-button-main/[0.06] ring-1 ring-button-main/30'
          : 'bg-transparent hover:bg-black/[0.018]'
      }`}
      style={{ '--expanded-reference-width': `${expandedWidth}px` } as React.CSSProperties}
    >
      <div className="relative h-full">
        {hasImages ? (
          previewImages.map((image, index) => {
            const stackOffset = Math.min(index, 3);
            const stackTransform = `translateX(${stackOffset * 13}px) rotate(${[-12, -4, 5, 12][stackOffset]}deg)`;
            const spreadTransform = `translateX(${index * 108}px) rotate(${[-8, -4, 2, 7, -5][index] || 0}deg)`;
            return (
              <div
                key={`${image.slice(0, 32)}-${index}`}
                className="group/card absolute left-4 top-6 h-[142px] w-[104px] overflow-hidden rounded-[20px] border border-white/90 bg-[#EEE6D7] shadow-[0_14px_34px_rgba(31,24,18,0.16)] transition-[transform,box-shadow] duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] [transform:var(--stack-transform)] hover:shadow-[0_18px_38px_rgba(31,24,18,0.18)] group-hover/reference:[transform:var(--spread-transform)]"
                style={{
                  '--stack-transform': stackTransform,
                  '--spread-transform': spreadTransform,
                  transitionDelay: `${index * 38}ms`,
                  zIndex: 10 + index,
                } as React.CSSProperties}
              >
                <img src={image} alt="" className="h-full w-full object-cover" />
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onRemove(index);
                  }}
                  className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/50 text-white opacity-0 transition-opacity hover:bg-black/65 group-hover/card:opacity-100"
                  title="删除参考图"
                >
                  <X className="h-3 w-3" strokeWidth={2} />
                </button>
              </div>
            );
          })
        ) : (
          <button
            type="button"
            disabled={disabled}
            onClick={onAdd}
            className="absolute left-8 top-6 flex h-[142px] w-[104px] rotate-[-6deg] items-center justify-center rounded-[20px] border border-dashed border-black/14 bg-transparent text-black/32 transition-all hover:rotate-[-2deg] hover:border-black/22 hover:bg-white/45 disabled:cursor-not-allowed disabled:opacity-60"
            title="添加参考图"
          >
            <ImageIcon className="h-6 w-6" strokeWidth={1.8} />
          </button>
        )}

        <div className="hidden">
          {previewImages.map((image, index) => (
            <div
              key={`expanded-${image.slice(0, 32)}-${index}`}
              className="group/card relative h-[142px] w-[104px] translate-y-2 overflow-hidden rounded-[20px] border border-white/90 bg-[#EEE6D7] shadow-[0_14px_34px_rgba(31,24,18,0.16)] transition-all duration-300 ease-out hover:-translate-y-1 group-hover/reference:translate-y-0"
              style={{ transitionDelay: `${index * 35}ms` }}
            >
              <img src={image} alt="" className="h-full w-full object-cover" />
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onRemove(index);
                }}
                className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/50 text-white opacity-0 transition-opacity hover:bg-black/65 group-hover/card:opacity-100"
                title="删除参考图"
              >
                <X className="h-3 w-3" strokeWidth={2} />
              </button>
            </div>
          ))}
        </div>

        <button
          type="button"
          disabled={disabled}
          onClick={onAdd}
          className="absolute bottom-4 left-4 z-50 flex h-9 w-9 items-center justify-center rounded-full border border-black/8 bg-white/82 text-foreground shadow-[0_10px_22px_rgba(35,29,20,0.14)] transition-transform hover:scale-105 hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
          title="添加参考图"
        >
          {importing ? (
            <span className="text-[10px] font-semibold">{images.length}</span>
          ) : (
            <Plus className="h-4 w-4" strokeWidth={2} />
          )}
        </button>
      </div>
    </div>
  );
}

export function FloatingTaskDock() {
  const {
    tasks,
    taskLookup,
    tasksCount,
    selectedTaskIds,
    activeTaskId,
    globalSkillText,
    globalTargetText,
    globalReferenceImages,
    skillFileName,
    globalAspectRatio,
    globalResolution,
    globalImageQuality,
    globalBatchCount,
    imageModel,
    exportTemplate,
    enablePromptOptimization,
    projectName,
    updateTask,
    addTask,
    setActiveTask,
    setProjectFields,
    isBatchRunning,
  } = useAppStore(
    useShallow((state) => ({
      tasks: state.tasks,
      taskLookup: state.taskLookup,
      tasksCount: state.tasksCount,
      selectedTaskIds: state.selectedTaskIds,
      activeTaskId: state.activeTaskId,
      globalSkillText: state.globalSkillText,
      globalTargetText: state.globalTargetText,
      globalReferenceImages: state.globalReferenceImages,
      skillFileName: state.skillFileName,
      globalAspectRatio: state.globalAspectRatio,
      globalResolution: state.globalResolution,
      globalImageQuality: state.globalImageQuality,
      globalBatchCount: state.globalBatchCount,
      imageModel: state.imageModel,
      exportTemplate: state.exportTemplate,
      enablePromptOptimization: state.enablePromptOptimization !== false,
      projectName: state.projectName,
      updateTask: state.updateTask,
      addTask: state.addTask,
      setActiveTask: state.setActiveTask,
      setProjectFields: state.setProjectFields,
      isBatchRunning: state.isBatchRunning,
    })),
  );

  const activeTask = activeTaskId ? taskLookup[activeTaskId] || null : null;
  const effectiveImageModel = activeTask?.imageModelOverride || imageModel;

  const [mode, setMode] = React.useState<DockMode>(activeTask ? 'task' : 'global');
  const [isSettingsOpen, setIsSettingsOpen] = React.useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = React.useState(false);
  const [isMarkdownEditorOpen, setIsMarkdownEditorOpen] = React.useState(false);
  const [isPreviewingPrompt, setIsPreviewingPrompt] = React.useState(false);
  const [quickTaskInput, setQuickTaskInput] = React.useState('');
  const [quickTaskReferenceImages, setQuickTaskReferenceImages] = React.useState<string[]>([]);
  const [isGlobalReferenceDragging, setIsGlobalReferenceDragging] = React.useState(false);
  const [isTaskReferenceDragging, setIsTaskReferenceDragging] = React.useState(false);
  const [globalReferenceImportProgress, setGlobalReferenceImportProgress] = React.useState<{
    done: number;
    total: number;
  } | null>(null);

  const globalReferenceInputRef = React.useRef<HTMLInputElement>(null);
  const taskReferenceInputRef = React.useRef<HTMLInputElement>(null);
  const markdownInputRef = React.useRef<HTMLInputElement>(null);
  const globalReferenceDragDepthRef = React.useRef(0);
  const taskReferenceDragDepthRef = React.useRef(0);
  const lastAutoTaskIdRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (!activeTaskId) return;
    if (lastAutoTaskIdRef.current === activeTaskId) return;
    lastAutoTaskIdRef.current = activeTaskId;
    setMode('task');
  }, [activeTaskId]);

  React.useEffect(() => {
    const handleNewTaskMode = () => setMode('task');
    window.addEventListener('batch-refiner:new-task-mode', handleNewTaskMode);
    return () => window.removeEventListener('batch-refiner:new-task-mode', handleNewTaskMode);
  }, []);

  const handleRunBatch = React.useCallback((batchMode: BatchMode = 'all') => {
    if (isBatchRunning) {
      haltBatch();
      return;
    }
    processBatch(batchMode);
  }, [isBatchRunning]);

  const handleRetryFailedTasks = React.useCallback(() => {
    const failedTaskIds = useAppStore.getState().tasks
      .filter((task) => task.status === 'Error' || (task.failedResultCount || 0) > 0)
      .map((task) => task.id);
    if (failedTaskIds.length === 0) {
      toast.info('没有需要重试的失败任务');
      return;
    }
    setProjectFields({ selectedTaskIds: failedTaskIds });
    processBatch('all');
  }, [setProjectFields]);

  const handleRestoreGlobalParams = React.useCallback(() => {
    const currentTasks = useAppStore.getState().tasks;
    const targetIds = selectedTaskIds.length > 0
      ? selectedTaskIds
      : currentTasks.map((task) => task.id);
    if (targetIds.length === 0) {
      toast.info('没有可恢复的任务');
      return;
    }
    const targetSet = new Set(targetIds);
    setProjectFields({
      tasks: currentTasks.map((task) =>
        targetSet.has(task.id)
          ? {
              ...task,
              imageModelOverride: undefined,
              aspectRatio: undefined,
              resolution: undefined,
              imageQuality: undefined,
              batchCount: undefined,
            }
          : task,
      ),
    });
    toast.success(`已恢复 ${targetIds.length} 个任务的全局参数`);
  }, [selectedTaskIds, setProjectFields]);

  const handleRunActiveTask = React.useCallback(() => {
    if (!activeTask) {
      toast.info('请先选中一张任务卡');
      return;
    }
    void processSingleTask(activeTask.id);
  }, [activeTask]);

  const handlePreviewActiveTaskPrompt = React.useCallback(async () => {
    if (!activeTask) {
      toast.info('请先选中一张任务卡');
      return;
    }

    setIsPreviewingPrompt(true);
    try {
      const generatedPrompt = await generateTaskPrompt(activeTask.id, { mode: 'prompt-preview' });
      updateTask(activeTask.id, {
        promptText: generatedPrompt.promptText,
        promptInputSignature: generatedPrompt.inputSignature,
        promptSource: 'auto',
        errorLog: undefined,
        progressStage: undefined,
      });
      toast.success(`已预览任务 #${activeTask.index} 的提示词`);
    } catch (error) {
      const message = error instanceof Error ? error.message : '提示词预览失败';
      toast.error(message);
    } finally {
      setIsPreviewingPrompt(false);
    }
  }, [activeTask, updateTask]);

  const handleGlobalTargetApply = React.useCallback(() => {
    const currentTasks = useAppStore.getState().tasks;
    const appliedTargetText = globalTargetText.trim();

    if (currentTasks.length === 0) {
      toast.info('没有可操作的任务');
      return;
    }

    const useSelected = selectedTaskIds.length > 0;
    const selectedTaskIdSet = new Set(selectedTaskIds);
    const tasksToUpdate = useSelected ? currentTasks.filter((task) => selectedTaskIdSet.has(task.id)) : currentTasks;

    if (tasksToUpdate.length === 0) {
      toast.info('未找到符合条件的任务');
      return;
    }

    const newTasks = currentTasks.map((task) => {
      if (!tasksToUpdate.some((targetTask) => targetTask.id === task.id)) {
        return task;
      }

      const nextPromptFields = enablePromptOptimization
        ? {
            description: appliedTargetText || task.description,
            promptText: undefined,
            promptInputSignature: undefined,
            promptSource: 'auto' as const,
          }
        : {
            description: task.description,
            promptText: appliedTargetText || task.promptText,
            promptInputSignature: getTaskPromptInputSignature(task),
            promptSource: 'manual' as const,
          };

      return {
        ...task,
        ...nextPromptFields,
      };
    });

    setProjectFields({ tasks: newTasks });
    toast.success(
      enablePromptOptimization
        ? `已写入 ${tasksToUpdate.length} 个任务的目标指令`
        : `已写入 ${tasksToUpdate.length} 个任务的提示词`,
    );
  }, [enablePromptOptimization, globalTargetText, selectedTaskIds, setProjectFields]);

  const handleMarkdownUpload = React.useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files.length > 0) {
      const file = event.target.files[0];
      const reader = new FileReader();
      reader.onload = (loadEvent) => {
        if (typeof loadEvent.target?.result !== 'string') return;
        setProjectFields({
          globalSkillText: loadEvent.target.result,
          skillFileName: file.name,
        });
        toast.success(`成功应用 Skills：${file.name}`);
      };
      reader.readAsText(file);
    }
    event.target.value = '';
  }, [setProjectFields]);

  const importGlobalReferenceFiles = React.useCallback(async (files: File[]) => {
    const imageFiles = files.filter((file) => file.type.startsWith('image/'));
    if (imageFiles.length === 0) {
      toast.info('没有找到可导入的图片');
      return;
    }

    if (globalReferenceImportProgress) {
      toast.info('参考图正在导入中，请稍等当前批次完成');
      return;
    }

    let importedCount = 0;
    let failedCount = 0;
    const totalCount = imageFiles.length;
    const progressToastId = toast.loading(`正在分批导入参考图 0/${totalCount}`);
    setGlobalReferenceImportProgress({ done: 0, total: totalCount });

    try {
      for (let index = 0; index < imageFiles.length; index += GLOBAL_REFERENCE_IMPORT_BATCH_SIZE) {
        const batch = imageFiles.slice(index, index + GLOBAL_REFERENCE_IMPORT_BATCH_SIZE);

        try {
          const importedImages = await buildReferenceImagesFromFiles(batch);
          if (importedImages.length > 0) {
            importedCount += importedImages.length;
            setProjectFields({
              globalReferenceImages: [...useAppStore.getState().globalReferenceImages, ...importedImages],
            });
          }
          failedCount += batch.length - importedImages.length;
        } catch {
          failedCount += batch.length;
        }

        const doneCount = Math.min(index + batch.length, totalCount);
        setGlobalReferenceImportProgress({ done: doneCount, total: totalCount });
        toast.loading(`正在分批导入参考图 ${doneCount}/${totalCount}，已加入 ${importedCount} 张`, {
          id: progressToastId,
        });
        await waitForNextPaint();
      }

      if (importedCount === 0) {
        toast.info('没有成功导入图片', { id: progressToastId });
        return;
      }

      if (failedCount > 0) {
        toast.warning(`已导入 ${importedCount} 张全局参考图，失败 ${failedCount} 张`, {
          id: progressToastId,
        });
      } else {
        toast.success(`已导入 ${importedCount} 张全局参考图`, { id: progressToastId });
      }
    } finally {
      setGlobalReferenceImportProgress(null);
    }
  }, [globalReferenceImportProgress, setProjectFields]);

  const handleGlobalReferenceUpload = React.useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files ? Array.from(event.target.files) as File[] : [];
    event.target.value = '';
    if (files.length === 0) return;
    void importGlobalReferenceFiles(files);
  }, [importGlobalReferenceFiles]);

  const appendTaskReferences = React.useCallback(async (files: File[]) => {
    const imageFiles = files.filter((file) => file.type.startsWith('image/'));
    if (imageFiles.length === 0) {
      toast.info('没有找到可导入的图片');
      return;
    }

    const importedImages = await buildReferenceImagesFromFiles(imageFiles);
    if (importedImages.length === 0) {
      toast.info('没有成功导入图片');
      return;
    }

    if (!activeTask) {
      setQuickTaskReferenceImages((current) => [...current, ...importedImages]);
      toast.success(`已为新任务添加 ${importedImages.length} 张图片`);
      return;
    }

    const latestTask = useAppStore.getState().taskLookup[activeTask.id];
    if (!latestTask) return;

    const hasSourceImage = Boolean(latestTask.sourceImage || latestTask.sourceImagePreview || latestTask.sourceImageAssetId);
    const nextSourceImage = hasSourceImage ? undefined : importedImages[0];
    const nextReferenceImages = hasSourceImage ? importedImages : importedImages.slice(1);

    updateTask(activeTask.id, {
      ...(nextSourceImage
        ? {
            sourceImage: nextSourceImage,
            sourceImagePreview: nextSourceImage,
          }
        : {}),
      referenceImages: [...(latestTask.referenceImages || []), ...nextReferenceImages],
    });
    toast.success(`已为任务 #${latestTask.index} 添加 ${importedImages.length} 张参考图`);
  }, [activeTask, updateTask]);

  const handleTaskReferenceUpload = React.useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files ? Array.from(event.target.files) as File[] : [];
    event.target.value = '';
    if (files.length === 0) return;
    void appendTaskReferences(files);
  }, [appendTaskReferences]);

  const handleExportResults = React.useCallback(async () => {
    const currentTasks = useAppStore.getState().tasks;
    const useSelected = selectedTaskIds.length > 0;
    const selectedTaskIdSet = new Set(selectedTaskIds);
    const matchingTasks = currentTasks.filter((task) => {
      if (useSelected && !selectedTaskIdSet.has(task.id)) return false;
      return getExportableTaskImages(task).length > 0;
    });

    if (matchingTasks.length === 0) {
      toast.info(useSelected ? '所选任务中没有可导出的结果图。' : '当前没有可导出的结果图。');
      return;
    }

    const tasksToExport = matchingTasks.filter((task) => {
      const exportedIds = task.exportedResultIds || [];
      return getExportableTaskImages(task).some((image) => !exportedIds.includes(image.id));
    });
    const finalTasksToExport = tasksToExport.length > 0 ? tasksToExport : matchingTasks;
    const isReExport = tasksToExport.length === 0;

    const getFilename = (task: Task, imageIndex: number, extension: string, result: TaskResultImage) => {
      return buildResultImageFileName({
        task,
        imageIndex,
        extension,
        result,
        template: exportTemplate,
        model: task.imageModelOverride || imageModel,
      });
    };

    const exportJobs = finalTasksToExport.flatMap((task) =>
      getExportableTaskImages(task).map((result, imageIndex) => ({
        task,
        result,
        imageIndex,
        filename: getFilename(task, imageIndex, getResultImageAssetExtension(result), result),
      })),
    );

    const exportConcurrency = pLimit(4);
    const exportedIdsByTask = new Map<string, Set<string>>(
      finalTasksToExport.map((task) => [task.id, new Set(task.exportedResultIds || [])]),
    );
    const exportFailures: string[] = [];
    let progressCount = 0;
    const progressToastId = toast.loading(
      useSelected ? `正在准备所选结果图 0/${exportJobs.length}` : `正在准备结果图 0/${exportJobs.length}`,
    );
    const getLatestTaskLogSessionId = (taskId: string) => getLatestGenerationLogSessionForTask(taskId)?.id;
    const updateProgressToast = (prefix: string) => {
      toast.loading(`${prefix} ${progressCount}/${exportJobs.length}`, { id: progressToastId });
    };

    const downloadDirectoryHandle = await getDownloadDirectoryHandle();
    if (downloadDirectoryHandle) {
      try {
        const hasPermission = await ensureDownloadDirectoryPermission(downloadDirectoryHandle);
        if (!hasPermission) {
          throw new Error('下载目录权限已失效，请重新选择目录。');
        }

        let successCount = 0;
        await Promise.all(
          exportJobs.map((job) =>
            exportConcurrency(async () => {
              try {
                const { blob } = await resultImageToBlob(job.result);
                await writeBlobToDirectory(downloadDirectoryHandle, job.filename, blob);
                exportedIdsByTask.get(job.task.id)?.add(job.result.id);
                successCount += 1;
                const logSessionId = getLatestTaskLogSessionId(job.task.id);
                if (logSessionId) {
                  appendGenerationLogEvent(logSessionId, {
                    stage: 'export',
                    event: 'export.directory.succeeded',
                    message: '结果图已写入目录',
                    data: {
                      fileName: job.filename,
                      resultId: job.result.id,
                    },
                  });
                }
              } catch (error) {
                const failure = error instanceof ResultImageDownloadError
                  ? error
                  : new ResultImageDownloadError({
                      message: error instanceof Error ? error.message : '写入结果图失败',
                      stage: 'save',
                      status: 'save_failed',
                      sourceType: job.result.downloadSourceType || 'src',
                      cacheStatus: job.result.downloadCacheStatus || 'failed',
                    });

                exportFailures.push(`${job.filename}: ${getResultDownloadDiagnostics(job.result, failure)} / ${failure.message}`);
                const logSessionId = getLatestTaskLogSessionId(job.task.id);
                if (logSessionId) {
                  appendGenerationLogEvent(logSessionId, {
                    level: 'error',
                    stage: 'export',
                    event: 'export.directory.failed',
                    message: '结果图写入目录失败',
                    data: {
                      fileName: job.filename,
                      resultId: job.result.id,
                      stage: failure.stage,
                      status: failure.status,
                      message: failure.message,
                    },
                  });
                }
              }
              progressCount += 1;
              updateProgressToast('正在写入结果图');
            }),
          ),
        );

        for (const task of finalTasksToExport) {
          updateTask(task.id, {
            exported: true,
            exportedResultIds: Array.from(exportedIdsByTask.get(task.id) || []),
          });
        }

        const baseMessage = useSelected
          ? `${isReExport ? '已重新导出' : '已导出'}所选任务中的 ${successCount} 张结果图到指定目录`
          : `${isReExport ? '已重新导出' : '已写入'} ${successCount} 张结果图到指定目录`;

        if (exportFailures.length > 0) {
          toast.error(`${baseMessage}，失败 ${exportFailures.length} 张：${exportFailures.slice(0, 3).join('；')}`, {
            id: progressToastId,
          });
        } else {
          toast.success(baseMessage, { id: progressToastId });
        }
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : '写入指定目录失败，已回退为 ZIP 下载。';
        toast.error(message, { id: progressToastId });
      }
    }

    const JSZip = (await import('jszip')).default;
    const { saveAs } = await import('file-saver');
    const zip = new JSZip();

    let exportedCount = 0;
    const preparedFiles = await Promise.all(
      exportJobs.map((job) =>
        exportConcurrency(async () => {
          try {
            const { blob } = await resultImageToBlob(job.result);
            progressCount += 1;
            updateProgressToast('正在读取结果图');
            const logSessionId = getLatestTaskLogSessionId(job.task.id);
            if (logSessionId) {
              appendGenerationLogEvent(logSessionId, {
                stage: 'export',
                event: 'export.zip.read_succeeded',
                message: '结果图已加入导出队列',
                data: {
                  fileName: job.filename,
                  resultId: job.result.id,
                },
              });
            }
            return { ...job, blob };
          } catch (error) {
            const failure = error instanceof ResultImageDownloadError
              ? error
              : new ResultImageDownloadError({
                  message: error instanceof Error ? error.message : '读取结果图失败',
                  stage: 'fetch',
                  status: 'fetch_failed',
                  sourceType: job.result.downloadSourceType || 'src',
                  cacheStatus: job.result.downloadCacheStatus || 'failed',
                });

            exportFailures.push(`${job.filename}: ${getResultDownloadDiagnostics(job.result, failure)} / ${failure.message}`);
            const logSessionId = getLatestTaskLogSessionId(job.task.id);
            if (logSessionId) {
              appendGenerationLogEvent(logSessionId, {
                level: 'error',
                stage: 'export',
                event: 'export.zip.read_failed',
                message: '结果图导出读取失败',
                data: {
                  fileName: job.filename,
                  resultId: job.result.id,
                  stage: failure.stage,
                  status: failure.status,
                  message: failure.message,
                },
              });
            }
            return null;
          }
        }),
      ),
    );

    for (const preparedFile of preparedFiles) {
      if (!preparedFile) continue;
      zip.file(preparedFile.filename, preparedFile.blob);
      exportedIdsByTask.get(preparedFile.task.id)?.add(preparedFile.result.id);
      exportedCount += 1;
    }

    for (const task of finalTasksToExport) {
      updateTask(task.id, {
        exported: true,
        exportedResultIds: Array.from(exportedIdsByTask.get(task.id) || []),
      });
    }

    toast.loading(useSelected ? '正在打包所选结果图…' : '正在打包结果图…', { id: progressToastId });
    const blob = await zip.generateAsync({ type: 'blob' });
    saveAs(blob, `Batch_${projectName}_Results.zip`);

    const zipMessage = useSelected
      ? `${isReExport ? '已重新导出' : '成功导出'}所选任务中的 ${exportedCount} 张结果图`
      : `${isReExport ? '已重新导出' : '成功导出'} ${exportedCount} 张结果图`;

    if (exportFailures.length > 0) {
      toast.error(`${zipMessage}，失败 ${exportFailures.length} 张：${exportFailures.slice(0, 3).join('；')}`, {
        id: progressToastId,
      });
    } else {
      toast.success(zipMessage, { id: progressToastId });
    }
  }, [exportTemplate, imageModel, projectName, selectedTaskIds, updateTask]);

  React.useEffect(() => {
    const openHistory = () => setIsHistoryOpen(true);
    const openSettings = () => setIsSettingsOpen(true);
    const exportResults = () => {
      void handleExportResults();
    };

    window.addEventListener('batch-refiner:open-history', openHistory);
    window.addEventListener('batch-refiner:open-settings', openSettings);
    window.addEventListener('batch-refiner:export-results', exportResults);
    return () => {
      window.removeEventListener('batch-refiner:open-history', openHistory);
      window.removeEventListener('batch-refiner:open-settings', openSettings);
      window.removeEventListener('batch-refiner:export-results', exportResults);
    };
  }, [handleExportResults]);

  const handleCreateTask = React.useCallback(() => {
    const text = quickTaskInput.trim();
    if (!text) {
      toast.info('先写一句任务内容');
      return;
    }

    const nextIndex = useAppStore.getState().tasks.length + 1;
    const title = buildQuickTaskTitle(text, nextIndex);
    const sourceImage = quickTaskReferenceImages[0];
    const referenceImages = sourceImage ? quickTaskReferenceImages.slice(1) : [];

    addTask({
      index: nextIndex,
      title,
      description: enablePromptOptimization ? text : '',
      promptText: enablePromptOptimization ? undefined : text,
      promptInputSignature: enablePromptOptimization
        ? undefined
        : getTaskPromptInputSignature({
            description: '',
            referenceImages,
          }),
      promptSource: enablePromptOptimization ? 'auto' : 'manual',
      sourceImage,
      sourceImagePreview: sourceImage,
      referenceImages,
    });

    const latestTasks = useAppStore.getState().tasks;
    const newestTask = latestTasks[latestTasks.length - 1];
    if (newestTask) {
      setActiveTask(newestTask.id);
      setProjectFields({ selectedTaskIds: [newestTask.id] });
      setMode('task');
      window.dispatchEvent(new CustomEvent('scroll-to-task', { detail: { id: newestTask.id } }));
    }
    setQuickTaskInput('');
    setQuickTaskReferenceImages([]);
    toast.success(`已新建任务 #${nextIndex}`);
  }, [addTask, enablePromptOptimization, quickTaskInput, quickTaskReferenceImages, setActiveTask, setProjectFields]);

  const handleActiveTaskPromptChange = React.useCallback((nextPromptText: string) => {
    if (!activeTask) return;
    const latestTask = useAppStore.getState().taskLookup[activeTask.id];
    if (!latestTask) return;
    updateTask(activeTask.id, {
      promptText: nextPromptText,
      promptInputSignature: getTaskPromptInputSignature(latestTask),
      promptSource: 'manual',
    });
  }, [activeTask, updateTask]);

  const handleGlobalModelChange = React.useCallback((nextModel: string) => {
    setProjectFields({
      imageModel: nextModel,
      textToImageModel: nextModel,
      imageToImageModel: nextModel,
    });
  }, [setProjectFields]);

  const handleTaskModelChange = React.useCallback((nextModel: string) => {
    if (!activeTask) return;
    updateTask(activeTask.id, { imageModelOverride: nextModel });
  }, [activeTask, updateTask]);

  const handleGlobalReferenceDragEnter = React.useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (!hasImageFiles(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    globalReferenceDragDepthRef.current += 1;
    setIsGlobalReferenceDragging(true);
  }, []);

  const handleGlobalReferenceDragOver = React.useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (!hasImageFiles(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'copy';
  }, []);

  const handleGlobalReferenceDragLeave = React.useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (!hasImageFiles(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    globalReferenceDragDepthRef.current = Math.max(0, globalReferenceDragDepthRef.current - 1);
    if (globalReferenceDragDepthRef.current === 0) {
      setIsGlobalReferenceDragging(false);
    }
  }, []);

  const handleGlobalReferenceDrop = React.useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (!hasImageFiles(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    globalReferenceDragDepthRef.current = 0;
    setIsGlobalReferenceDragging(false);
    void importGlobalReferenceFiles(Array.from(event.dataTransfer.files) as File[]);
  }, [importGlobalReferenceFiles]);

  const handleTaskReferenceDragEnter = React.useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (!hasImageFiles(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    taskReferenceDragDepthRef.current += 1;
    setIsTaskReferenceDragging(true);
  }, []);

  const handleTaskReferenceDragOver = React.useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (!hasImageFiles(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'copy';
  }, []);

  const handleTaskReferenceDragLeave = React.useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (!hasImageFiles(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    taskReferenceDragDepthRef.current = Math.max(0, taskReferenceDragDepthRef.current - 1);
    if (taskReferenceDragDepthRef.current === 0) {
      setIsTaskReferenceDragging(false);
    }
  }, []);

  const handleTaskReferenceDrop = React.useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (!hasImageFiles(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    taskReferenceDragDepthRef.current = 0;
    setIsTaskReferenceDragging(false);
    void appendTaskReferences(Array.from(event.dataTransfer.files) as File[]);
  }, [appendTaskReferences]);

  const activeTaskSourceImage = activeTask?.sourceImagePreview || activeTask?.sourceImage || '';
  const currentReferenceImages = mode === 'global'
    ? globalReferenceImages
    : activeTask
      ? [activeTaskSourceImage, ...(activeTask.referenceImages || [])].filter(Boolean)
      : quickTaskReferenceImages;
  const currentReferenceDragging = mode === 'global' ? isGlobalReferenceDragging : isTaskReferenceDragging;
  const isGlobalMode = mode === 'global';
  const canRunQueue = tasksCount > 0;
  const modelSwitchValue = isGlobalMode ? imageModel : activeTask?.imageModelOverride;
  const modelSwitchInheritedValue = isGlobalMode ? undefined : imageModel;
  const toolbarButtonClass =
    'h-9 rounded-full border-transparent bg-transparent px-3 text-[12px] text-text-secondary shadow-none hover:border-black/8 hover:bg-white/70 hover:text-foreground';

  return (
    <>
      <div className="hidden">
        <div className="pointer-events-auto flex rounded-full border border-white/80 bg-white/84 p-1.5 shadow-[0_12px_32px_rgba(23,18,14,0.10)] backdrop-blur-xl">
          <IconAction title="历史生图" onClick={() => setIsHistoryOpen(true)} subtle>
            <History className="h-4 w-4" strokeWidth={1.8} />
          </IconAction>
          <IconAction title="导出结果图" onClick={() => void handleExportResults()} subtle>
            <Download className="h-4 w-4" strokeWidth={1.8} />
          </IconAction>
          <IconAction title="设置" onClick={() => setIsSettingsOpen(true)} subtle>
            <Settings className="h-4 w-4" strokeWidth={1.8} />
          </IconAction>
        </div>
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-5 z-20 flex justify-center px-4">
        <div
          className="pointer-events-auto w-full max-w-[952px]"
          onDragEnter={mode === 'global' ? handleGlobalReferenceDragEnter : handleTaskReferenceDragEnter}
          onDragOver={mode === 'global' ? handleGlobalReferenceDragOver : handleTaskReferenceDragOver}
          onDragLeave={mode === 'global' ? handleGlobalReferenceDragLeave : handleTaskReferenceDragLeave}
          onDrop={mode === 'global' ? handleGlobalReferenceDrop : handleTaskReferenceDrop}
        >
          <div className="min-h-[306px] animate-in fade-in slide-in-from-bottom-2 rounded-[40px] border border-black/[0.07] bg-white/92 p-4 shadow-[0_18px_50px_rgba(31,24,18,0.13)] backdrop-blur-xl duration-300">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="relative flex w-[128px] rounded-full bg-[#F4EFE7] p-1">
                <span
                  className={`pointer-events-none absolute top-1 h-9 w-[84px] rounded-full bg-white shadow-sm transition-transform duration-[350ms] ease-[cubic-bezier(0.22,1,0.36,1)] ${
                    isGlobalMode ? 'translate-x-0' : 'translate-x-9'
                  }`}
                />
                <ModeSwitchButton
                  active={isGlobalMode}
                  label="全局"
                  title="全局页"
                  onClick={() => setMode('global')}
                >
                  <MultiSparkIcon />
                </ModeSwitchButton>
                <ModeSwitchButton
                  active={!isGlobalMode}
                  label="单任务"
                  title="单任务页"
                  onClick={() => setMode('task')}
                >
                  <SingleSparkIcon />
                </ModeSwitchButton>
              </div>
            </div>

            <div key={mode} className="animate-in fade-in duration-200">
              <div className="flex min-h-[187px] gap-4">
                <FloatingReferenceStack
                  images={currentReferenceImages}
                  isDragging={currentReferenceDragging}
                  importing={isGlobalMode ? Boolean(globalReferenceImportProgress) : false}
                  disabled={isGlobalMode ? Boolean(globalReferenceImportProgress) : false}
                  onAdd={() => (isGlobalMode ? globalReferenceInputRef.current?.click() : taskReferenceInputRef.current?.click())}
                  onRemove={(index) => {
                    if (isGlobalMode) {
                      setProjectFields({
                        globalReferenceImages: globalReferenceImages.filter((_, imageIndex) => imageIndex !== index),
                      });
                      return;
                    }
                    if (!activeTask) {
                      setQuickTaskReferenceImages((current) => current.filter((_, imageIndex) => imageIndex !== index));
                      return;
                    }
                    if (index === 0 && activeTaskSourceImage) {
                      updateTask(activeTask.id, {
                        sourceImage: undefined,
                        sourceImagePreview: undefined,
                        sourceImageAssetId: undefined,
                      });
                      return;
                    }
                    const referenceIndex = activeTaskSourceImage ? index - 1 : index;
                    updateTask(activeTask.id, {
                      referenceImages: activeTask.referenceImages.filter((_, imageIndex) => imageIndex !== referenceIndex),
                    });
                  }}
                />

                <div className="min-w-0 flex-1 rounded-[24px] border border-black/[0.04] bg-[#FFFDF9]/80 px-4 py-3">
                  <div className="mb-1 flex items-center justify-between gap-3 px-1 text-[11px] text-text-secondary">
                    <span className="font-medium text-foreground/70">
                      {isGlobalMode ? (enablePromptOptimization ? '全局指令' : '全局提示词') : activeTask ? `任务 #${activeTask.index}` : '新建任务'}
                    </span>
                  </div>
                  {isGlobalMode ? (
                    <Textarea
                      value={globalTargetText}
                      onChange={(event) => setProjectFields({ globalTargetText: event.target.value })}
                      placeholder={enablePromptOptimization ? '写全局指令：例如统一风格、构图、质感或品牌要求。' : '写可直接执行的全局提示词…'}
                      className="h-[172px] resize-none border-transparent bg-transparent px-1 py-1 text-[15px] leading-7 text-foreground shadow-none placeholder:text-text-secondary/72 focus-visible:ring-0"
                    />
                  ) : activeTask ? (
                    enablePromptOptimization ? (
                      <div className="grid h-[172px] grid-cols-2 gap-4">
                        <Textarea
                          value={activeTask.description}
                          onChange={(event) => updateTask(activeTask.id, { description: event.target.value })}
                          placeholder="目标指令…"
                          className="h-full resize-none border-transparent bg-transparent px-1 py-1 text-[15px] leading-7 text-foreground shadow-none placeholder:text-text-secondary/72 focus-visible:ring-0"
                        />
                        <Textarea
                          value={activeTask.promptText || ''}
                          onChange={(event) => handleActiveTaskPromptChange(event.target.value)}
                          placeholder="提示词预览…"
                          className="h-full resize-none border-transparent bg-transparent px-1 py-1 text-[15px] leading-7 text-foreground shadow-none placeholder:text-text-secondary/72 focus-visible:ring-0"
                        />
                      </div>
                    ) : (
                      <Textarea
                        value={activeTask.promptText || ''}
                        onChange={(event) => handleActiveTaskPromptChange(event.target.value)}
                        placeholder="提示词…"
                        className="h-[172px] resize-none border-transparent bg-transparent px-1 py-1 text-[15px] leading-7 text-foreground shadow-none placeholder:text-text-secondary/72 focus-visible:ring-0"
                      />
                    )
                  ) : (
                    <Textarea
                      value={quickTaskInput}
                      onChange={(event) => setQuickTaskInput(event.target.value)}
                      placeholder="写一句可直接执行的新任务内容…"
                      className="h-[172px] resize-none border-transparent bg-transparent px-1 py-1 text-[15px] leading-7 text-foreground shadow-none placeholder:text-text-secondary/72 focus-visible:ring-0"
                    />
                  )}
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                <ModelSwitch
                  value={modelSwitchValue}
                  inheritedValue={modelSwitchInheritedValue}
                  onChange={isGlobalMode ? handleGlobalModelChange : handleTaskModelChange}
                  onClear={!isGlobalMode && activeTask ? () => updateTask(activeTask.id, { imageModelOverride: undefined }) : undefined}
                />
                <GenerateParamsSelector
                  aspectRatio={!isGlobalMode && activeTask ? activeTask.aspectRatio || globalAspectRatio : globalAspectRatio}
                  resolution={!isGlobalMode && activeTask ? activeTask.resolution || globalResolution : globalResolution}
                  imageQuality={!isGlobalMode && activeTask ? activeTask.imageQuality || globalImageQuality || 'auto' : globalImageQuality || 'auto'}
                  batchCount={!isGlobalMode && activeTask ? activeTask.batchCount : globalBatchCount || 'x1'}
                  imageModel={effectiveImageModel}
                  onAspectRatioChange={(value) =>
                    !isGlobalMode && activeTask
                      ? updateTask(activeTask.id, { aspectRatio: value === globalAspectRatio ? undefined : value })
                      : setProjectFields({ globalAspectRatio: value })
                  }
                  onResolutionChange={(value) =>
                    !isGlobalMode && activeTask
                      ? updateTask(activeTask.id, { resolution: value === globalResolution ? undefined : value })
                      : setProjectFields({ globalResolution: value })
                  }
                  onImageQualityChange={(value) =>
                    !isGlobalMode && activeTask
                      ? updateTask(activeTask.id, { imageQuality: value === (globalImageQuality || 'auto') ? undefined : value })
                      : setProjectFields({ globalImageQuality: value })
                  }
                  onBatchCountChange={(value) =>
                    !isGlobalMode && activeTask ? updateTask(activeTask.id, { batchCount: value }) : setProjectFields({ globalBatchCount: value })
                  }
                  allowBatchInherit={!isGlobalMode}
                  onClearBatchCount={() => activeTask && updateTask(activeTask.id, { batchCount: undefined })}
                  inheritedBatchLabel={`跟随全局(${globalBatchCount || 'x1'})`}
                  triggerClassName={toolbarButtonClass}
                />
                {isGlobalMode ? (
                  <Popover>
                    <PopoverTrigger
                      render={
                        <Button type="button" variant="outline" size="sm" className={toolbarButtonClass}>
                          <FileText className="mr-1.5 h-3.5 w-3.5" />
                          Skills
                        </Button>
                      }
                    />
                    <PopoverContent className="w-[280px] rounded-[20px] border-border/80 bg-card p-3 shadow-xl" align="start">
                      <button
                        type="button"
                        onDoubleClick={() => setIsMarkdownEditorOpen(true)}
                        className="mb-3 flex aspect-[1/1.414] w-[104px] rotate-[-3deg] flex-col rounded-[16px] border border-black/10 bg-[#FFFDF8] p-3 text-left shadow-sm transition-all duration-300 hover:-translate-y-1 hover:rotate-[-1deg] hover:shadow-[0_14px_32px_rgba(31,24,18,0.12)]"
                        title="双击打开编辑器"
                      >
                        <span className="text-[9px] uppercase tracking-[0.18em] text-text-secondary/75">A4 Skills</span>
                        <FileText className="mt-3 h-5 w-5 text-button-main" />
                        <span className="mt-auto truncate text-[11px] font-semibold">{skillFileName?.trim() || '提示词优化.md'}</span>
                      </button>
                      <div className="flex gap-2">
                        <Button type="button" variant="outline" size="sm" className="rounded-full bg-[#F7F4EE] shadow-none" onClick={() => setIsMarkdownEditorOpen(true)}>
                          编辑
                        </Button>
                        <Button type="button" variant="outline" size="sm" className="rounded-full bg-[#F7F4EE] shadow-none" onClick={() => markdownInputRef.current?.click()}>
                          上传
                        </Button>
                        <Button type="button" variant="ghost" size="sm" className="rounded-full text-text-secondary" onClick={() => setProjectFields({ skillFileName: '', globalSkillText: '' })}>
                          清空
                        </Button>
                      </div>
                    </PopoverContent>
                  </Popover>
                ) : null}
                {isGlobalMode ? (
                  <button
                    type="button"
                    onClick={() => setProjectFields({ enablePromptOptimization: !enablePromptOptimization })}
                    className={`${toolbarButtonClass} flex items-center gap-2`}
                  >
                    优化
                    <span className={`h-2.5 w-2.5 rounded-full ${enablePromptOptimization ? 'bg-button-main' : 'bg-black/20'}`} />
                  </button>
                ) : null}
                {isGlobalMode ? (
                  <Button type="button" variant="outline" size="sm" className={toolbarButtonClass} onClick={handleRestoreGlobalParams}>
                    <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                    恢复全局
                  </Button>
                ) : null}
                {!isGlobalMode && activeTask && enablePromptOptimization ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className={toolbarButtonClass}
                    disabled={isPreviewingPrompt}
                    onClick={() => void handlePreviewActiveTaskPrompt()}
                  >
                    预览提示词
                  </Button>
                ) : null}
              </div>

              <div className="flex items-center gap-2">
                  <div className="flex items-center rounded-full bg-[#F1EEE8] p-1">
                    <Button
                      type="button"
                      onClick={() => handleRunBatch('all')}
                      disabled={!canRunQueue}
                      className={`h-8 rounded-full px-3 text-[12px] shadow-none ${
                        isBatchRunning ? 'bg-red-600 text-white hover:bg-red-500' : 'bg-transparent text-foreground hover:bg-white'
                      }`}
                    >
                      {isBatchRunning ? <Pause className="mr-1 h-3.5 w-3.5" /> : <Play className="mr-1 h-3.5 w-3.5" />}
                      {isBatchRunning ? '暂停' : '队列'}
                    </Button>
                    {!isBatchRunning ? (
                      <Popover>
                        <PopoverTrigger
                          render={
                            <Button type="button" disabled={!canRunQueue} className="h-8 w-8 rounded-full bg-transparent px-0 text-text-secondary shadow-none hover:bg-white">
                              <ChevronDown className="h-4 w-4 opacity-70" />
                            </Button>
                          }
                        />
                        <PopoverContent align="end" sideOffset={12} className="w-[184px] rounded-[16px] border border-border/80 bg-card p-2 shadow-xl">
                          <div className="flex flex-col gap-1">
                            {enablePromptOptimization ? (
                              <button type="button" className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-left text-[12px] text-text-primary hover:bg-black/5" onClick={() => handleRunBatch('prompts')}>
                                <FileText className="h-3.5 w-3.5 opacity-70" />
                                仅生成提示词
                              </button>
                            ) : null}
                            <button type="button" className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-left text-[12px] text-text-primary hover:bg-black/5" onClick={() => handleRunBatch('images')}>
                              <ImageIcon className="h-3.5 w-3.5 opacity-70" />
                              仅执行生图
                            </button>
                            <button type="button" className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-left text-[12px] text-text-primary hover:bg-black/5" onClick={handleRetryFailedTasks}>
                              <RotateCcw className="h-3.5 w-3.5 opacity-70" />
                              重试失败任务
                            </button>
                          </div>
                        </PopoverContent>
                      </Popover>
                    ) : null}
                  </div>
                  {isGlobalMode ? (
                    <Button type="button" className="h-12 rounded-full bg-[#1F1D1A] px-5 text-[13px] text-white hover:bg-[#2B2925]" onClick={handleGlobalTargetApply} title="应用全局指令">
                      应用
                      <ArrowUp className="ml-2 h-[18px] w-[18px]" />
                    </Button>
                  ) : activeTask ? (
                    <Button type="button" className="h-12 rounded-full bg-[#1F1D1A] px-5 text-[13px] text-white hover:bg-[#2B2925]" onClick={handleRunActiveTask} disabled={isBatchRunning} title="执行生图">
                      生图
                      <ArrowUp className="ml-2 h-[18px] w-[18px]" />
                    </Button>
                  ) : (
                    <Button type="button" className="h-12 rounded-full bg-[#1F1D1A] px-5 text-[13px] text-white hover:bg-[#2B2925]" onClick={handleCreateTask} title="新建任务">
                      新建任务
                      <ArrowUp className="ml-2 h-[18px] w-[18px]" />
                    </Button>
                  )}
                </div>
              </div>
            </div>
            </div>
          <input
            ref={globalReferenceInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={handleGlobalReferenceUpload}
          />
          <input
            ref={taskReferenceInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={handleTaskReferenceUpload}
          />
          <input
            ref={markdownInputRef}
            type="file"
            accept=".md"
            className="hidden"
            onChange={handleMarkdownUpload}
          />
        </div>
      </div>

      {isSettingsOpen ? <SettingsDialog open={isSettingsOpen} onOpenChange={setIsSettingsOpen} /> : null}
      <GenerationHistoryDialog open={isHistoryOpen} onOpenChange={setIsHistoryOpen} />
      {isMarkdownEditorOpen ? (
        <MarkdownEditorDialog
          open={isMarkdownEditorOpen}
          fileName={skillFileName}
          value={globalSkillText}
          onOpenChange={setIsMarkdownEditorOpen}
          onSave={(value) => setProjectFields({ globalSkillText: value })}
        />
      ) : null}
    </>
  );
}
