import * as React from "react";
import {
  Play,
  Pause,
  Upload,
  Settings,
  FolderOpen,
  Download,
  History,
  Paperclip,
  ArrowUp,
  FileText,
  X,
  ChevronDown,
  MessageSquare,
  Image as ImageIcon
} from "lucide-react";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import { ScrollArea } from "../ui/scroll-area";
import { useAppStore } from "@/store";
import { useState, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import { processBatch, generateTaskPrompt, getTaskPromptInputSignature, haltBatch } from "@/lib/batchRunner";
import { toast } from "sonner";
import pLimit from "p-limit";
import { SettingsDialog } from "../SettingsDialog";
import { GenerateParamsSelector } from "../GenerateParamsSelector";
import { MarkdownEditorDialog } from "../MarkdownEditorDialog";
import { AspectRatio, Resolution, Task, TaskResultImage } from "@/types";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { buildReferenceImagesFromFiles, optimizeImageToDataUrl } from "@/lib/taskFileImport";
import { ensureDownloadDirectoryPermission, getDownloadDirectoryHandle, writeBlobToDirectory } from "@/lib/downloadDirectory";
import { getTaskResultImages } from "@/lib/taskResults";
import { getTaskBatchFileName } from "@/lib/resultImageFileName";
import { getResultImageAssetExtension } from "@/lib/resultImageAsset";
import { getResultDownloadDiagnostics, resolveResultImageDownloadBlob, ResultImageDownloadError } from "@/lib/resultImageDownload";
import { appendGenerationLogEvent, getLatestGenerationLogSessionForTask } from "@/lib/appLogger";
import { GenerationHistoryDialog } from "../workspace/GenerationHistoryDialog";

function SidebarProgress() {
  const { tasksCount, completedCount } = useAppStore(
    useShallow((state) => ({
      tasksCount: state.tasksCount,
      completedCount: state.completedTaskCount,
    })),
  );
  const progressPercent = tasksCount === 0 ? 0 : Math.round((completedCount / tasksCount) * 100);

  return (
    <div className="flex flex-col gap-2 mb-1">
      <div className="flex justify-between items-center text-[12.6px] font-medium text-foreground">
        <span>处理进度</span>
        <span className="font-serif italic text-text-primary">
          {progressPercent}%
        </span>
      </div>
      <div className="h-1.5 bg-[#E8E5DF] rounded-full overflow-hidden">
        <div
          className="h-full bg-button-main transition-all duration-500 ease-out rounded-full"
          style={{ width: `${progressPercent}%` }}
        ></div>
      </div>
      <span className="text-[11.55px] text-text-secondary">
        {completedCount} / {tasksCount} 已完成
      </span>
    </div>
  );
}

async function resultImageToBlob(resultImage: TaskResultImage) {
  return resolveResultImageDownloadBlob(resultImage);
}

function getExportableTaskImages(task: Task) {
  return getTaskResultImages(task);
}

function hasImageFiles(dataTransfer?: DataTransfer | null) {
  if (!dataTransfer) return false;
  return Array.from(dataTransfer.items || []).some((item) => item.kind === 'file' && item.type.startsWith('image/'));
}

function getGlobalParamsLabel(imageModel?: string) {
  const normalized = (imageModel || "").trim().toLowerCase();
  if (normalized.startsWith("gpt-image") || normalized === "image2") {
    return "GPT";
  }
  return "Gemini";
}

function getQuickSwitchImageModel(target: "gemini" | "gpt", currentModel?: string) {
  const normalized = (currentModel || "").trim().toLowerCase();

  if (target === "gpt") {
    if (normalized.startsWith("gpt-image") || normalized === "image2") {
      return currentModel || "gpt-image-2";
    }
    return "gpt-image-2";
  }

  if (normalized.includes("gemini") || normalized.includes("imagen") || normalized.includes("banana")) {
    return currentModel || "gemini-3.1-flash-image-preview";
  }
  return "gemini-3.1-flash-image-preview";
}

const GLOBAL_REFERENCE_IMPORT_BATCH_SIZE = 4;

function waitForNextPaint() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

export function Sidebar({
  className = "",
  style,
  compact = false,
  showQuickAdd = true,
}: {
  className?: string,
  style?: React.CSSProperties,
  compact?: boolean,
  showQuickAdd?: boolean,
  onRequestClose?: () => void,
}) {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [isGlobalReferenceDragging, setIsGlobalReferenceDragging] = useState(false);
  const [globalReferenceImportProgress, setGlobalReferenceImportProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);

  const [isSkillEditing, setIsSkillEditing] = useState(false);
  const [isMarkdownEditorOpen, setIsMarkdownEditorOpen] = useState(false);
  
  const { updateTask } = useAppStore(
    useShallow((state) => ({
      updateTask: state.updateTask,
    })),
  );
  const globalSkillText = useAppStore((state) => state.globalSkillText);
  const skillFileName = useAppStore((state) => state.skillFileName);
  const globalTargetText = useAppStore((state) => state.globalTargetText);
  const globalReferenceImages = useAppStore((state) => state.globalReferenceImages);
  const globalAspectRatio = useAppStore((state) => state.globalAspectRatio);
  const globalResolution = useAppStore((state) => state.globalResolution);
  const globalImageQuality = useAppStore((state) => state.globalImageQuality);
  const globalBatchCount = useAppStore((state) => state.globalBatchCount);
  const enablePromptOptimization = useAppStore((state) => state.enablePromptOptimization !== false);
  const imageModel = useAppStore((state) => state.imageModel);
  const globalParamsLabel = getGlobalParamsLabel(imageModel);
  const textModel = useAppStore((state) => state.textModel);
  const setProjectFields = useAppStore((state) => state.setProjectFields);
  const importTasks = useAppStore((state) => state.importTasks);
  // remove 'tasks' subscription to prevent full sidebar rerenders
  const isBatchRunning = useAppStore((state) => state.isBatchRunning);
  const setBatchRunning = useAppStore((state) => state.setBatchRunning);
  const selectedTaskIds = useAppStore((state) => state.selectedTaskIds);
  const projectName = useAppStore((state) => state.projectName);
  const tasksCount = useAppStore((state) => state.tasksCount);
  const exportTemplate = useAppStore((state) => state.exportTemplate);
  const getLatestTaskLogSessionId = React.useCallback(
    (taskId: string) => getLatestGenerationLogSessionForTask(taskId)?.id,
    [],
  );

  const fileInputRef = useRef<HTMLInputElement>(null);
  const mdInputRef = useRef<HTMLInputElement>(null);
  const chatFileRef = useRef<HTMLInputElement>(null);
  const globalReferenceDragDepthRef = useRef(0);

  const [localSkillText, setLocalSkillText] = useState(globalSkillText || '');
  const [localTargetText, setLocalTargetText] = useState(globalTargetText || '');

  React.useEffect(() => {
     setLocalSkillText(globalSkillText || '');
  }, [globalSkillText]);

  React.useEffect(() => {
     setLocalTargetText(globalTargetText || '');
  }, [globalTargetText]);

  const handleRunBatch = (mode: 'all' | 'prompts' | 'images' = 'all') => {
    if (isBatchRunning) {
      haltBatch();
    } else {
      processBatch(mode);
    }
  };

  const handleGlobalTargetSend = () => {
    const currentTasks = useAppStore.getState().tasks;
    const appliedTargetText = localTargetText.trim();
    if (currentTasks.length === 0) {
       toast.info('没有可操作的任务');
       return;
    }

    const useSelected = selectedTaskIds.length > 0;
    const selectedTaskIdSet = new Set(selectedTaskIds);
    const tasksToUpdate = useSelected 
        ? currentTasks.filter(t => selectedTaskIdSet.has(t.id))
        : currentTasks;

    if (tasksToUpdate.length === 0) {
      toast.info('未找到符合条件的任务');
      return;
    }

    const newTasks = currentTasks.map(t => {
       if (tasksToUpdate.some(tu => tu.id === t.id)) {
          const nextPromptFields = enablePromptOptimization
            ? {
                description: appliedTargetText || t.description,
                promptText: undefined,
                promptInputSignature: undefined,
                promptSource: 'auto' as const,
              }
            : {
                description: t.description,
                promptText: appliedTargetText || t.promptText,
                promptInputSignature: getTaskPromptInputSignature(t),
                promptSource: 'manual' as const,
              };

          return {
            ...t, 
            ...nextPromptFields,
            resultImage: undefined, // Clear old image results
            resultImages: [],
            failedResultCount: 0,
            requestedBatchCount: t.batchCount || globalBatchCount || 'x1',
            status: 'Idle' as const, // Reset to idle
            errorLog: undefined
          };
       }
       return t;
    });

    useAppStore.getState().setProjectFields({ globalTargetText: localTargetText, tasks: newTasks });
    toast.success(
      enablePromptOptimization
        ? `已覆写 ${tasksToUpdate.length} 个任务的生成指令并重置状态`
        : `已写入 ${tasksToUpdate.length} 个任务的提示词框并重置状态`
    );
  };

  const handleMdUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      const reader = new FileReader();
      reader.onload = (event) => {
        if (event.target?.result) {
          setProjectFields({
            globalSkillText: event.target.result as string,
            skillFileName: file.name
          });
          toast.success(`成功应用风格预设：${file.name}`);
        }
      };
      reader.readAsText(file);
    }
    e.target.value = '';
  };

  const handleSaveSkillText = (nextValue: string) => {
    setLocalSkillText(nextValue);
    setProjectFields({ globalSkillText: nextValue });
    toast.success("提示词 Skills 已保存");
  };

  const handleChatFileAdd = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const files = Array.from(e.target.files) as File[];
      await importFilesAsTasks(files);
    }
    e.target.value = '';
  };

  const importFilesAsTasks = async (files: File[]) => {
    const images = files.filter(f => f.type.startsWith("image/"));
    const texts = files.filter(f => f.name.endsWith('.csv') || f.name.endsWith('.txt'));
    let addedCount = 0;

    // Read all text contents beforehand for pairing
    const textContents: Record<string, string> = {};
    for (const file of texts) {
      if (file.name.endsWith('.txt')) {
         const baseName = file.name.substring(0, file.name.lastIndexOf('.'));
         textContents[baseName] = await file.text();
      }
    }

    // Handle Images paired with TXT if any
    if (images.length > 0) {
      toast.info(`开始分批加载 ${images.length} 张图片...`);
      let startIndex = useAppStore.getState().tasks.length + 1;
      const CHUNK_SIZE = 5;

      for (let i = 0; i < images.length; i += CHUNK_SIZE) {
        const chunk = images.slice(i, i + CHUNK_SIZE);
        const newTasks: any[] = [];
        
        for (const file of chunk) {
          const baseName = file.name.substring(0, file.name.lastIndexOf('.'));
          const dataUrl = await optimizeImageToDataUrl(file);
          
          let initialDesc = "";
          if (textContents[baseName]) {
             initialDesc = textContents[baseName].trim();
             // Remove from textContents so it doesn't get double processed if we had intended to parse it as a list
             delete textContents[baseName];
          }

          newTasks.push({
            index: startIndex++,
            title: file.name,
            description: initialDesc,
            sourceImage: dataUrl,
            referenceImages: [],
          });
        }
        importTasks(newTasks);
        await new Promise(r => requestAnimationFrame(r)); // Yield to paint
      }
      addedCount += images.length;
      toast.success('导入完毕');
    }

    // Handle remaining standalone Texts/CSVs
    for (const file of texts) {
      if (file.name.endsWith('.csv')) {
         const content = await file.text();
         addedCount += await parseCsv(content);
      } else {
         const baseName = file.name.substring(0, file.name.lastIndexOf('.'));
         if (textContents[baseName] !== undefined) {
             const content = textContents[baseName];
             addedCount += parseList(content);
         }
      }
    }

    if (addedCount > 0) {
       toast.success(`成功导入 ${addedCount} 个任务`);
    }
  };

  const handleChatPaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    // Check if there are files in the clipboard
    if (e.clipboardData.files && e.clipboardData.files.length > 0) {
      e.preventDefault();
      const files = Array.from(e.clipboardData.files) as File[];
      await importFilesAsTasks(files);
    }
  };

  const handleChatSubmit = async () => {
    if (!chatInput.trim()) return;
    const addedCount = parseList(chatInput);
    if (addedCount > 0) {
       toast.success(`成功从文本添加 ${addedCount} 个任务`);
       setChatInput("");
    } else {
       // Maybe it's a CSV?
       const csvCount = await parseCsv(chatInput);
       if(csvCount > 0) {
         toast.success(`成功从表格数据添加 ${csvCount} 个任务`);
         setChatInput("");
       }
    }
  };

  const parseCsv = async (input: string) => {
    const Papa = (await import('papaparse')).default;
    const results = Papa.parse(input, { header: true, skipEmptyLines: true });
    if (results.errors.length > 0 || !results.data || results.data.length === 0) return 0;
    const firstRow = results.data[0] as any;
    const cols = Object.keys(firstRow);
    const titleCol = cols.find((c) => c.toLowerCase().includes("name") || c.toLowerCase().includes("title") || c.includes("名称") || c.includes("标题")) || cols[0];
    const descCol = cols.find((c) => c.toLowerCase().includes("desc") || c.includes("描述") || c.includes("提示词") || c.includes("prompt")) || cols[1] || cols[0];
    const currentTasksLength = useAppStore.getState().tasks.length;
    const tasksToImport = results.data.map((row: any, i: number) => ({
      index: currentTasksLength + i + 1,
      title: row[titleCol] || `任务 ${currentTasksLength + i + 1}`,
      description: row[descCol] || "",
      referenceImages: [],
    }));
    importTasks(tasksToImport);
    return tasksToImport.length;
  };

  const parseList = (input: string) => {
    // Split, trim, remove empty lines
    const lines = input.split("\n").filter((l) => l.trim().length > 0);
    if(lines.length === 0) return 0;
    
    // Clean up prefix numbering/bullets (e.g. "1. ", "- ", "* ")
    const cleanLines = lines.map(l => l.replace(/^(\d+[\.\)\]]\s*|[-*+]\s+)/, '').trim());

    // Attempt basic block check - if they pasted something very long and only 1 line, don't just dump 1 task
    if (cleanLines.length === 1 && cleanLines[0].length > 100) return 0; 

    // Find a unique name or fallback to index
    const currentTasksLength = useAppStore.getState().tasks.length;
    const tasksToImport = cleanLines.map((line, i) => ({
      index: currentTasksLength + i + 1,
      title: line.substring(0, 50) + (line.length > 50 ? "..." : ""),
      description: line,
      referenceImages: [],
    }));
    importTasks(tasksToImport);
    return tasksToImport.length;
  };

  const handleExportZip = async () => {
    const currentTasks = useAppStore.getState().tasks;
    const useSelected = selectedTaskIds.length > 0;
    const selectedTaskIdSet = new Set(selectedTaskIds);
    const matchingTasks = currentTasks.filter((task) => {
      if (useSelected && !selectedTaskIdSet.has(task.id)) return false;
      return getExportableTaskImages(task).length > 0;
    });

    if (matchingTasks.length === 0) {
      toast.info(useSelected ? "所选任务中没有可导出的结果图。" : "当前没有可导出的结果图。");
      return;
    }

    const tasksToExport = matchingTasks.filter((task) => {
      const exportedIds = task.exportedResultIds || [];
      return getExportableTaskImages(task).some((image) => !exportedIds.includes(image.id));
    });
    const finalTasksToExport = tasksToExport.length > 0 ? tasksToExport : matchingTasks;
    const isReExport = tasksToExport.length === 0;

    const getFilename = (task: (typeof tasksToExport)[number], imageIndex: number, extension: string) => {
      return getTaskBatchFileName(task.index, imageIndex, extension);
    };

    const exportJobs = finalTasksToExport.flatMap((task) =>
      getExportableTaskImages(task).map((result, imageIndex) => ({
        task,
        result,
        imageIndex,
        filename: getFilename(task, imageIndex, getResultImageAssetExtension(result)),
      }))
    );
    const exportConcurrency = pLimit(4);
    const exportedIdsByTask = new Map<string, Set<string>>(
      finalTasksToExport.map((task) => [task.id, new Set(task.exportedResultIds || [])])
    );
    const exportFailures: string[] = [];
    let progressCount = 0;
    const progressToastId = toast.loading(
      useSelected
        ? `正在准备所选结果图 0/${exportJobs.length}`
        : `正在准备结果图 0/${exportJobs.length}`
    );
    const updateProgressToast = (prefix: string) => {
      toast.loading(`${prefix} ${progressCount}/${exportJobs.length}`, {
        id: progressToastId,
      });
    };

    const downloadDirectoryHandle = await getDownloadDirectoryHandle();
    if (downloadDirectoryHandle) {
      try {
        const hasPermission = await ensureDownloadDirectoryPermission(downloadDirectoryHandle);
        if (!hasPermission) {
          throw new Error("下载目录权限已失效，请重新选择目录。");
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
            })
          )
        );

        for (const task of finalTasksToExport) {
          updateTask(task.id, {
            exported: true,
            exportedResultIds: Array.from(exportedIdsByTask.get(task.id) || []),
          });
        }

        const baseMessage = useSelected
          ? `${isReExport ? "已重新导出" : "已导出"}所选任务中的 ${successCount} 张结果图到指定目录`
          : `${isReExport ? "已重新导出" : "已写入"} ${successCount} 张结果图到指定目录`;
        if (exportFailures.length > 0) {
          toast.error(`${baseMessage}，失败 ${exportFailures.length} 张：${exportFailures.slice(0, 3).join('；')}`, { id: progressToastId });
        } else {
          toast.success(baseMessage, { id: progressToastId });
        }
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : "写入指定目录失败，已回退为 ZIP 下载。";
        toast.error(message, { id: progressToastId });
      }
    }

    const JSZip = (await import("jszip")).default;
    const { saveAs } = await import("file-saver");
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
        })
      )
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

    toast.loading(
      useSelected ? '正在打包所选结果图…' : '正在打包结果图…',
      { id: progressToastId }
    );
    const blob = await zip.generateAsync({ type: "blob" });
    saveAs(blob, `Batch_${projectName}_Results.zip`);
    const zipMessage = useSelected
      ? `${isReExport ? "已重新导出" : "成功导出"}所选任务中的 ${exportedCount} 张结果图`
      : `${isReExport ? "已重新导出" : "成功导出"} ${exportedCount} 张结果图`;
    if (exportFailures.length > 0) {
      toast.error(`${zipMessage}，失败 ${exportFailures.length} 张：${exportFailures.slice(0, 3).join('；')}`, { id: progressToastId });
    } else {
      toast.success(zipMessage, { id: progressToastId });
    }
  };

  const importGlobalReferenceFiles = async (files: File[]) => {
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
              globalReferenceImages: [
                ...useAppStore.getState().globalReferenceImages,
                ...importedImages,
              ],
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
  };

  const handleGlobalImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? (Array.from(e.target.files) as File[]) : [];
    e.target.value = '';
    if (files.length === 0) return;
    void importGlobalReferenceFiles(files);
  };

  const handleGlobalReferenceDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
    if (!hasImageFiles(e.dataTransfer)) return;
    e.preventDefault();
    e.stopPropagation();
    globalReferenceDragDepthRef.current += 1;
    setIsGlobalReferenceDragging(true);
  };

  const handleGlobalReferenceDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    if (!hasImageFiles(e.dataTransfer)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
  };

  const handleGlobalReferenceDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    if (!hasImageFiles(e.dataTransfer)) return;
    e.preventDefault();
    e.stopPropagation();
    globalReferenceDragDepthRef.current = Math.max(0, globalReferenceDragDepthRef.current - 1);
    if (globalReferenceDragDepthRef.current === 0) {
      setIsGlobalReferenceDragging(false);
    }
  };

  const handleGlobalReferenceDrop = (e: React.DragEvent<HTMLDivElement>) => {
    if (!hasImageFiles(e.dataTransfer)) return;
    e.preventDefault();
    e.stopPropagation();
    globalReferenceDragDepthRef.current = 0;
    setIsGlobalReferenceDragging(false);
    const files = Array.from(e.dataTransfer.files) as File[];
    void importGlobalReferenceFiles(files);
  };

  return (
    <div className={`flex min-h-0 flex-col gap-5 ${compact ? 'py-2' : 'py-4'} ${className}`} style={style}>
      
      {/* 1. Quick Add (Moved to top) */}
      {showQuickAdd ? (
      <div className="shrink-0 flex flex-col gap-2">
         <h3 className="text-[12.6px] font-medium text-text-secondary px-2">任务快捷导入</h3>
         <div className="relative flex items-end bg-card rounded-2xl border border-transparent focus-within:border-button-main/20 transition-all p-2 gap-1 shadow-[0_2px_12px_rgba(0,0,0,0.04)]">
             <button 
               className="p-1.5 hover:bg-black/5 rounded-xl text-text-secondary mb-0.5 transition-colors" 
               onClick={() => chatFileRef.current?.click()}
               title="上传文件 (图片、文档或表格)"
            >
               <Paperclip className="w-4 h-4" strokeWidth={2} />
            </button>
            <input type="file" ref={chatFileRef} multiple accept="image/*,.csv,.txt" className="hidden" onChange={handleChatFileAdd} />
            
            <button 
               className="p-1.5 hover:bg-black/5 rounded-lg text-text-secondary mb-0.5" 
               onClick={() => {
                  const input = document.createElement('input');
                  input.type = 'file';
                  input.multiple = true;
                  input.webkitdirectory = true;
                  input.onchange = (e: any) => {
                     if (e.target.files) {
                        importFilesAsTasks(Array.from(e.target.files) as File[]);
                     }
                  };
                  input.click();
               }}
               title="导入整个文件夹"
            >
               <FolderOpen className="w-4 h-4" strokeWidth={2} />
            </button>
            
            <Textarea 
               value={chatInput}
               onChange={(e) => setChatInput(e.target.value)}
               onPaste={handleChatPaste}
               onKeyDown={(e) => {
                 if (e.key === 'Enter' && !e.shiftKey) {
                   e.preventDefault();
                   handleChatSubmit();
                 }
               }}
               placeholder="输入任务描述或粘贴截图..."
               className="min-h-[48px] max-h-[300px] bg-transparent border-none p-2 text-[13.65px] shadow-none focus-visible:ring-0 resize-y font-medium text-foreground pt-2.5 pb-2 m-0 flex-1 leading-normal"
            />
            
            <button 
               onClick={handleChatSubmit}
               disabled={!chatInput.trim()}
               className={`p-1.5 rounded-lg mb-0.5 transition-colors ${chatInput.trim() ? 'bg-button-main text-white' : 'bg-[#E8E5DF] text-text-secondary cursor-not-allowed'}`}
               title="发送并解析任务"
            >
               <ArrowUp className="w-4 h-4" strokeWidth={2.5} />
            </button>
         </div>
      </div>
      ) : null}

      {/* 2. Scrollable Body */}
      <ScrollArea className={`${compact ? '-mx-4 px-4' : '-mx-6 px-6'} flex-1 min-h-0`}>
        <div className={`flex flex-col gap-6 ${compact ? 'pt-2 pb-5' : 'pt-3 pb-6'} px-1`}>
          {/* Global Skill / Style */}
          <div className="flex flex-col perspective-1000 relative">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="text-[12.6px] font-medium text-text-secondary">提示词Skills</h3>
              <button
                type="button"
                onClick={() => setProjectFields({ enablePromptOptimization: !enablePromptOptimization })}
                className="inline-flex shrink-0 items-center gap-2 rounded-full border border-black/8 bg-[#FCFBF8] px-2.5 py-1 transition-colors hover:border-black/14"
                title={enablePromptOptimization ? '先优化提示词再出图' : '直接使用当前文本出图'}
              >
                <span className="text-[10.5px] font-medium text-text-secondary">优化</span>
                <div
                  className={`relative h-5 w-9 rounded-full transition-colors ${
                    enablePromptOptimization ? 'bg-button-main' : 'bg-black/10'
                  }`}
                >
                  <div
                    className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
                      enablePromptOptimization ? 'translate-x-[18px]' : 'translate-x-0.5'
                    }`}
                  />
                </div>
              </button>
            </div>
            
            {!enablePromptOptimization ? null : skillFileName && !isSkillEditing ? (
               <div 
                 className="flex flex-col items-center justify-center gap-2 p-6 border border-border/60 rounded-2xl bg-[#F5F4F0] relative group cursor-pointer hover:border-button-main transition-all duration-500 ease-out transform-gpu animate-in fade-in"
                 onDoubleClick={() => setIsMarkdownEditorOpen(true)}
                 title="双击打开大编辑器"
               >
                  <FileText className="w-10 h-10 text-button-main" strokeWidth={1.5} />
                  <span className="text-[13.65px] font-medium text-foreground truncate max-w-full px-4">{skillFileName}</span>
                  <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                     <button className="p-1 hover:bg-black/5 rounded-full" onClick={(e) => { e.stopPropagation(); setProjectFields({ skillFileName: '', globalSkillText: '' }); }} title="移除预设"><X className="w-4 h-4 text-text-secondary" /></button>
                  </div>
                  <div className="text-[10.5px] text-text-secondary absolute bottom-2">双击打开大编辑器</div>
               </div>
            ) : enablePromptOptimization ? (
               <div className="relative transition-all duration-500 ease-out transform-gpu animate-in fade-in zoom-in-95">
                  <Textarea
                    placeholder="例如：保持极简风格，使用清新的色调，4K高清摄影机..."
                    className={`bg-card border border-border outline-none rounded-2xl p-4 pb-10 text-[13.65px] leading-relaxed text-foreground resize-none shadow-none focus-visible:ring-1 focus-visible:border-button-main focus-visible:ring-button-main transition-colors ${compact ? 'h-[108px]' : 'h-[120px]'} ${skillFileName ? 'ring-2 ring-button-main' : ''}`}
                    value={localSkillText}
                    onChange={(e) => setLocalSkillText(e.target.value)}
                    onBlur={() => setProjectFields({ globalSkillText: localSkillText })}
                  />
                  {skillFileName && isSkillEditing ? (
                    <div className="absolute bottom-2 right-2 flex gap-2">
                       <Button size="sm" variant="ghost" className="h-6 text-[11.55px] px-2 rounded-md hover:bg-black/5" onClick={() => setIsSkillEditing(false)}>取消</Button>
                       <Button size="sm" className="h-6 text-[11.55px] px-2 rounded-md bg-button-main text-white" onClick={() => { setProjectFields({ globalSkillText: localSkillText }); setIsSkillEditing(false) }}>完成</Button>
                    </div>
                  ) : (
                    <div 
                      className="absolute bottom-2 right-2 flex items-center gap-1 text-[11.55px] text-text-secondary cursor-pointer hover:bg-black/5 px-2 py-1 rounded-md transition-colors"
                      onClick={() => mdInputRef.current?.click()}
                    >
                       <Upload className="w-3.5 h-3.5" /> 上传 .md 技能预设
                    </div>
                  )}
                  <input type="file" ref={mdInputRef} accept=".md" className="hidden" onChange={(e) => {
                     handleMdUpload(e);
                     setIsSkillEditing(false); // Reset to card view when new file uploaded
                  }} />
               </div>
            ) : null}
          </div>

          <div className="flex flex-col">
            <h3 className="text-[12.6px] font-medium text-text-secondary mb-3">
              {enablePromptOptimization ? '全局目标指令' : '全局提示词指令'}
            </h3>
            <div className="relative group">
              <Textarea
                placeholder={enablePromptOptimization ? '例如：将背景替换为纯白色的摄影布板...' : '例如：保留产品主体，直接输出可执行的完整提示词...'}
                className={`bg-card border border-border rounded-2xl p-4 pb-10 text-[13.65px] leading-relaxed text-foreground resize-none shadow-none focus-visible:ring-1 focus-visible:ring-button-main focus-visible:border-button-main transition-colors outline-none ${compact ? 'min-h-[72px]' : 'min-h-[80px]'}`}
                value={localTargetText}
                onChange={(e) => setLocalTargetText(e.target.value)}
                onBlur={() => setProjectFields({ globalTargetText: localTargetText })}
              />
              <button 
                  onClick={handleGlobalTargetSend}
                  title={enablePromptOptimization ? '应用目标指令并为任务生成提示词' : '应用全局提示词到任务提示词框'}
                  className="absolute bottom-2 right-2 bg-[#E8E5DF] hover:bg-button-main hover:text-white text-text-secondary p-1.5 rounded-lg transition-colors group"
                >
                  <ArrowUp className="w-4 h-4" strokeWidth={2} />
              </button>
            </div>
          </div>

          <div className="flex flex-col">
            <h3 className="text-[12.6px] font-medium text-text-secondary mb-3 flex items-center justify-between gap-3">
              <span>全局参数 <span>({globalParamsLabel})</span></span>
              <div className="inline-flex items-center rounded-full border border-border/70 bg-white p-1 shrink-0">
                <button
                  type="button"
                  onClick={() => setProjectFields({ imageModel: getQuickSwitchImageModel("gemini", imageModel) })}
                  className={`rounded-full px-3 py-1 text-[11px] transition-colors ${
                    globalParamsLabel === "Gemini"
                      ? "bg-button-main text-white"
                      : "text-text-secondary hover:bg-black/5"
                  }`}
                >
                  Gemini
                </button>
                <button
                  type="button"
                  onClick={() => setProjectFields({ imageModel: getQuickSwitchImageModel("gpt", imageModel) })}
                  className={`rounded-full px-3 py-1 text-[11px] transition-colors ${
                    globalParamsLabel === "GPT"
                      ? "bg-button-main text-white"
                      : "text-text-secondary hover:bg-black/5"
                  }`}
                >
                  GPT
                </button>
              </div>
            </h3>
            <GenerateParamsSelector 
              aspectRatio={globalAspectRatio}
              resolution={globalResolution}
              imageQuality={globalImageQuality || 'auto'}
              batchCount={globalBatchCount || 'x1'}
              imageModel={imageModel}
              onAspectRatioChange={(ar) => setProjectFields({ globalAspectRatio: ar })}
              onResolutionChange={(res) => setProjectFields({ globalResolution: res })}
              onImageQualityChange={(quality) => setProjectFields({ globalImageQuality: quality })}
              onBatchCountChange={(count) => setProjectFields({ globalBatchCount: count })}
              triggerClassName="w-full justify-start py-4 h-auto bg-[#F5F4F0] border-transparent"
            />
          </div>
          
          <div
            className={`flex flex-col rounded-2xl transition-colors ${
              isGlobalReferenceDragging ? 'bg-button-main/[0.05] ring-1 ring-button-main/35' : ''
            }`}
            onDragEnter={handleGlobalReferenceDragEnter}
            onDragOver={handleGlobalReferenceDragOver}
            onDragLeave={handleGlobalReferenceDragLeave}
            onDrop={handleGlobalReferenceDrop}
          >
            <h3 className="text-[12.6px] font-medium text-text-secondary mb-3">
              全局参考图
            </h3>
            <div className="grid grid-cols-3 gap-2">
              {globalReferenceImages.map((img, i) => (
                <div
                  key={i}
                  className="aspect-square rounded-xl overflow-hidden border border-border/50 relative group"
                >
                  <img
                    src={img}
                    className="w-full h-full object-cover"
                    alt="Reference"
                  />
                  <div
                    className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity cursor-pointer text-white"
                    onClick={() =>
                      setProjectFields({
                        globalReferenceImages: globalReferenceImages.filter(
                          (_, idx) => idx !== i,
                        ),
                      })
                    }
                  >
                    删除
                  </div>
                </div>
              ))}
              <div
                className={`aspect-square flex flex-col items-center justify-center gap-1 border border-dashed rounded-xl text-text-secondary cursor-pointer bg-transparent px-2 text-center transition-colors ${
                  globalReferenceImportProgress
                    ? 'border-button-main/40 bg-button-main/[0.06] text-button-main'
                    : isGlobalReferenceDragging
                    ? 'border-button-main bg-button-main/[0.08] text-button-main'
                    : 'border-[#D4D2CD] hover:bg-black/5'
                }`}
                onClick={() => {
                  if (!globalReferenceImportProgress) fileInputRef.current?.click();
                }}
                title={globalReferenceImportProgress ? '参考图正在分批导入' : '点击选择，或拖入多张图片'}
              >
                <Upload className="w-4 h-4 opacity-70" strokeWidth={1.5} />
                <span className="text-[9.45px] leading-tight">
                  {globalReferenceImportProgress
                    ? `${globalReferenceImportProgress.done}/${globalReferenceImportProgress.total}`
                    : '拖入多张'}
                </span>
              </div>
              <input
                type="file"
                className="hidden"
                accept="image/*"
                multiple
                ref={fileInputRef}
                onChange={handleGlobalImageUpload}
              />
            </div>
          </div>
        </div>
      </ScrollArea>

      <div className={`mt-auto bg-card p-4 rounded-3xl shrink-0 border border-transparent shadow-[0_4px_24px_rgba(0,0,0,0.04)] flex flex-col gap-3 mb-2 mx-1 ${compact ? 'sticky bottom-0' : ''}`}>
        <SidebarProgress />

        {/* Global Controls */}
        <div className="grid grid-cols-3 gap-2">
          <Button
            variant="outline"
            size="icon"
            className="h-10 w-full shadow-none bg-[#F5F4F0] border-transparent hover:border-border text-text-secondary hover:text-foreground rounded-2xl"
            onClick={() => setIsSettingsOpen(true)}
            title="系统设置与API配置"
          >
            <Settings className="w-4 h-4" strokeWidth={1.5} />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="h-10 w-full shadow-none bg-[#F5F4F0] border-transparent hover:border-border text-text-secondary hover:text-foreground rounded-2xl"
            onClick={() => setIsHistoryOpen(true)}
            title="历史生图"
          >
            <History className="w-4 h-4" strokeWidth={1.5} />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="h-10 w-full shadow-none bg-[#F5F4F0] border-transparent hover:border-border text-text-secondary hover:text-foreground rounded-2xl"
            onClick={handleExportZip}
            title="导出结果图">
            <Download className="w-4 h-4" strokeWidth={1.5} />
          </Button>
        </div>

        <div className="flex w-full group relative p-[3px] rounded-2xl bg-[#2C2B29] shadow-md border border-black/10 items-center transition-all mt-1">
          <Button
            onClick={() => handleRunBatch('all')}
            disabled={tasksCount === 0}
            className={`flex-1 h-9 px-4 text-[13.65px] font-medium shadow-none text-white rounded-[14px] transition-all border-none ${isBatchRunning ? "bg-red-600 hover:bg-red-500" : "bg-transparent hover:bg-white/10"}`}
          >
            {isBatchRunning ? (
              <Pause className="w-4 h-4 mr-1.5 opacity-90" strokeWidth={2} />
            ) : (
              <Play className="w-4 h-4 mr-1.5 opacity-90" strokeWidth={2} />
            )}
            {isBatchRunning
              ? "暂停"
              : selectedTaskIds.length > 0
                ? `执行已选项 (${selectedTaskIds.length})`
                : "执行队列中的任务"}
          </Button>
          
          {!isBatchRunning && (
             <div className="flex items-center">
                <div className="w-px h-4 bg-white/10 mx-0.5" />
                <Popover>
                  <PopoverTrigger render={
                    <Button
                      disabled={tasksCount === 0}
                      className="h-9 w-8 px-0 flex items-center shadow-none justify-center bg-transparent hover:bg-white/10 text-white rounded-[10px] border-none transition-colors"
                    >
                      <ChevronDown className="w-4 h-4 opacity-60 group-hover:opacity-100" />
                    </Button>
                  } />
                  <PopoverContent align="end" sideOffset={12} className="w-[180px] p-2 flex flex-col gap-1 rounded-[14px] bg-card border border-border/80 shadow-xl">
                     {enablePromptOptimization ? (
                       <div 
                          className="flex items-center gap-2.5 px-3 py-2.5 text-[13.65px] font-medium text-text-primary hover:bg-black/5 rounded-lg cursor-pointer transition-colors"
                          onClick={() => handleRunBatch('prompts')}
                       >
                         <MessageSquare className="w-3.5 h-3.5 opacity-70" /> 仅生成提示词
                       </div>
                     ) : null}
                     <div 
                        className="flex items-center gap-2.5 px-3 py-2.5 text-[13.65px] font-medium text-text-primary hover:bg-black/5 rounded-lg cursor-pointer transition-colors"
                        onClick={() => handleRunBatch('images')}
                     >
                       <ImageIcon className="w-3.5 h-3.5 opacity-70" /> 仅执行生图
                     </div>
                  </PopoverContent>
                </Popover>
             </div>
          )}
        </div>
      </div>

      {isSettingsOpen ? <SettingsDialog open={isSettingsOpen} onOpenChange={setIsSettingsOpen} /> : null}
      <GenerationHistoryDialog open={isHistoryOpen} onOpenChange={setIsHistoryOpen} />
      {isMarkdownEditorOpen ? (
        <MarkdownEditorDialog
          open={isMarkdownEditorOpen}
          fileName={skillFileName}
          value={localSkillText}
          onOpenChange={setIsMarkdownEditorOpen}
          onSave={handleSaveSkillText}
        />
      ) : null}
    </div>
  );
}


