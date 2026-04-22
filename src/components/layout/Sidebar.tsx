import * as React from "react";
import {
  Play,
  Pause,
  Upload,
  Settings,
  Save,
  FolderOpen,
  Download,
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
import { processBatch, generateTaskPrompt, haltBatch } from "@/lib/batchRunner";
import { toast } from "sonner";
import pLimit from "p-limit";
import { SettingsDialog } from "../SettingsDialog";
import { GenerateParamsSelector } from "../GenerateParamsSelector";
import { MarkdownEditorDialog } from "../MarkdownEditorDialog";
import { AspectRatio, Resolution, Task } from "@/types";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { ensureDownloadDirectoryPermission, getDownloadDirectoryHandle, writeBlobToDirectory } from "@/lib/downloadDirectory";
import { buildProjectExportPayload } from "@/lib/projectSnapshot";
import { getTaskResultImages } from "@/lib/taskResults";
import {
  clearProjectFileHandle,
  ensureProjectFilePermission,
  getProjectFileHandle,
  pickProjectSaveFile,
  supportsProjectFileSave,
  writeProjectFile,
} from "@/lib/projectFileSave";
import { getResultImageBlob } from "@/lib/resultImageCache";
import { getTaskBatchFileName } from "@/lib/resultImageFileName";

function SidebarProgress() {
  const tasksCount = useAppStore(state => state.tasks.length);
  const completedCount = useAppStore(state => state.tasks.filter(t => t.status === "Success").length);
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

async function resultImageToBlob(resultImage: string) {
  return getResultImageBlob(resultImage);
}

function getExportableTaskImages(task: Task) {
  return getTaskResultImages(task);
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
export function Sidebar({
  className = "",
  style,
  compact = false,
}: {
  className?: string,
  style?: React.CSSProperties,
  compact?: boolean,
  onRequestClose?: () => void,
}) {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [chatInput, setChatInput] = useState("");

  const [isSkillEditing, setIsSkillEditing] = useState(false);
  const [isMarkdownEditorOpen, setIsMarkdownEditorOpen] = useState(false);
  
  const store = useAppStore();
  const globalSkillText = useAppStore((state) => state.globalSkillText);
  const skillFileName = useAppStore((state) => state.skillFileName);
  const globalTargetText = useAppStore((state) => state.globalTargetText);
  const globalReferenceImages = useAppStore((state) => state.globalReferenceImages);
  const globalAspectRatio = useAppStore((state) => state.globalAspectRatio);
  const globalResolution = useAppStore((state) => state.globalResolution);
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
  const projectId = useAppStore((state) => state.projectId);
  const exportTemplate = useAppStore((state) => state.exportTemplate);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const mdInputRef = useRef<HTMLInputElement>(null);
  const chatFileRef = useRef<HTMLInputElement>(null);

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
    if (currentTasks.length === 0) {
       toast.info('没有可操作的任务');
       return;
    }

    const useSelected = selectedTaskIds.length > 0;
    const tasksToUpdate = useSelected 
        ? currentTasks.filter(t => selectedTaskIds.includes(t.id))
        : currentTasks;

    if (tasksToUpdate.length === 0) {
      toast.info('未找到符合条件的任务');
      return;
    }

    const newTasks = currentTasks.map(t => {
       if (tasksToUpdate.some(tu => tu.id === t.id)) {
          return {
            ...t, 
            description: globalTargetText || t.description,
            promptText: undefined, // Clear old prompt cache
            resultImage: undefined, // Clear old image results
            resultImages: [],
            failedResultCount: 0,
            requestedBatchCount: t.batchCount || globalBatchCount || 'x1',
            promptSource: 'auto' as const,
            status: 'Idle' as const, // Reset to idle
            errorLog: undefined
          };
       }
       return t;
    });

    useAppStore.getState().setProjectFields({ tasks: newTasks });
    toast.success(`已强行覆写至 ${tasksToUpdate.length} 个任务并重置状态`);
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
          const reader = new FileReader();
          const dataUrl = await new Promise<string>((resolve) => {
            reader.onload = (e) => resolve(e.target?.result as string);
            reader.readAsDataURL(file);
          });
          
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
    const matchingTasks = currentTasks.filter((task) => {
      if (useSelected && !selectedTaskIds.includes(task.id)) return false;
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

    const getFilename = (task: (typeof tasksToExport)[number], imageIndex: number) => {
      return getTaskBatchFileName(task.index, imageIndex, 'jpg');
    };

    const exportJobs = finalTasksToExport.flatMap((task) =>
      getExportableTaskImages(task).map((result, imageIndex) => ({
        task,
        result,
        imageIndex,
        filename: `${getFilename(task, imageIndex)}.jpg`,
      }))
    );
    const exportConcurrency = pLimit(4);
    const exportedIdsByTask = new Map<string, Set<string>>(
      finalTasksToExport.map((task) => [task.id, new Set(task.exportedResultIds || [])])
    );
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
              const blob = await resultImageToBlob(job.result.originalSrc || job.result.src);
              await writeBlobToDirectory(downloadDirectoryHandle, job.filename, blob);
              exportedIdsByTask.get(job.task.id)?.add(job.result.id);
              successCount += 1;
              progressCount += 1;
              updateProgressToast('正在写入结果图');
            })
          )
        );

        for (const task of finalTasksToExport) {
          store.updateTask(task.id, {
            exported: true,
            exportedResultIds: Array.from(exportedIdsByTask.get(task.id) || []),
          });
        }

        toast.success(
          useSelected
            ? `${isReExport ? "已重新导出" : "已导出"}所选任务中的 ${successCount} 张结果图到指定目录`
            : `${isReExport ? "已重新导出" : "已写入"} ${successCount} 张结果图到指定目录`
          , { id: progressToastId }
        );
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
            const blob = await resultImageToBlob(job.result.originalSrc || job.result.src);
            progressCount += 1;
            updateProgressToast('正在读取结果图');
            return { ...job, blob };
          } catch (error) {
            console.error("Export image error", error);
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
      store.updateTask(task.id, {
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
    toast.success(
      useSelected
        ? `${isReExport ? "已重新导出" : "成功导出"}所选任务中的 ${exportedCount} 张结果图`
        : `${isReExport ? "已重新导出" : "成功导出"} ${exportedCount} 张结果图`
      , { id: progressToastId }
    );
  };

  const handleExportProject = async () => {
    const payload = buildProjectExportPayload(store);
    const data = JSON.stringify(payload, null, 2);
    const filename = `Project_${projectName}.json`;
    const successfulPromptCount = payload.successfulPrompts.length;

    if (supportsProjectFileSave()) {
      try {
        let handle = await getProjectFileHandle(projectId);
        let reusedExistingFile = true;

        if (!handle) {
          handle = await pickProjectSaveFile(projectId, filename);
          reusedExistingFile = false;
        } else {
          const hasPermission = await ensureProjectFilePermission(handle);
          if (!hasPermission) {
            await clearProjectFileHandle(projectId);
            handle = await pickProjectSaveFile(projectId, filename);
            reusedExistingFile = false;
          }
        }

        await writeProjectFile(handle, data);
        toast.success(
          reusedExistingFile
            ? `项目空间已覆盖保存，并写入 ${successfulPromptCount} 条成功提示词`
            : `项目空间已保存，并写入 ${successfulPromptCount} 条成功提示词`
        );
        return;
      } catch (error) {
        console.error("Project save error", error);
      }
    }

    const { saveAs } = await import('file-saver');
    const blob = new Blob([data], { type: "application/json;charset=utf-8" });
    saveAs(blob, filename);
    toast.success(`项目空间已导出，并写入 ${successfulPromptCount} 条成功提示词`);
  };

  const handleImportProject = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = (e: any) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (event) => {
        if (event.target?.result) {
          store.loadProjectFromJson(event.target.result as string);
          toast.success("成功加载项目空间");
        }
      };
      reader.readAsText(file);
    };
    input.click();
  };

  const handleGlobalImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      const reader = new FileReader();
      reader.onload = (event) => {
        if (event.target?.result) {
          setProjectFields({
            globalReferenceImages: [
              ...globalReferenceImages,
              event.target.result as string,
            ],
          });
        }
      };
      reader.readAsDataURL(file);
    }
  };

  return (
    <div className={`flex min-h-0 flex-col gap-5 ${compact ? 'py-2' : 'py-4'} ${className}`} style={style}>
      
      {/* 1. Quick Add (Moved to top) */}
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
              全局目标指令
            </h3>
            <div className="relative group">
              <Textarea
                placeholder="例如：将背景替换为纯白色的摄影布板..."
                className={`bg-card border border-border rounded-2xl p-4 pb-10 text-[13.65px] leading-relaxed text-foreground resize-none shadow-none focus-visible:ring-1 focus-visible:ring-button-main focus-visible:border-button-main transition-colors outline-none ${compact ? 'min-h-[72px]' : 'min-h-[80px]'}`}
                value={localTargetText}
                onChange={(e) => setLocalTargetText(e.target.value)}
                onBlur={() => setProjectFields({ globalTargetText: localTargetText })}
              />
              <button 
                  onClick={handleGlobalTargetSend}
                  title="应用指令并为任务生成提示词"
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
              batchCount={globalBatchCount || 'x1'}
              imageModel={imageModel}
              onAspectRatioChange={(ar) => setProjectFields({ globalAspectRatio: ar })}
              onResolutionChange={(res) => setProjectFields({ globalResolution: res })}
              onBatchCountChange={(count) => setProjectFields({ globalBatchCount: count })}
              triggerClassName="w-full justify-start py-4 h-auto bg-[#F5F4F0] border-transparent"
            />
          </div>
          
          <div className="flex flex-col">
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
                className="aspect-square flex items-center justify-center border border-dashed border-[#D4D2CD] rounded-xl text-text-secondary cursor-pointer hover:bg-black/5 bg-transparent transition-colors"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="w-4 h-4 opacity-70" strokeWidth={1.5} />
              </div>
              <input
                type="file"
                className="hidden"
                accept="image/*"
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
        <div className="grid grid-cols-4 gap-2">
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
            onClick={handleExportProject}
            title="存储当前项目空间"
          >
            <Save className="w-4 h-4" strokeWidth={1.5} />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="h-10 w-full shadow-none bg-[#F5F4F0] border-transparent hover:border-border text-text-secondary hover:text-foreground rounded-2xl"
            onClick={handleImportProject}
            title="读取历史项目配置"
          >
            <FolderOpen className="w-4 h-4" strokeWidth={1.5} />
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
            disabled={useAppStore.getState().tasks.length === 0}
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
                      disabled={useAppStore.getState().tasks.length === 0}
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

      <SettingsDialog open={isSettingsOpen} onOpenChange={setIsSettingsOpen} />
      <MarkdownEditorDialog
        open={isMarkdownEditorOpen}
        fileName={skillFileName}
        value={localSkillText}
        onOpenChange={setIsMarkdownEditorOpen}
        onSave={handleSaveSkillText}
      />
    </div>
  );
}


