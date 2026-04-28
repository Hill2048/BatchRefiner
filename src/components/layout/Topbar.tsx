import * as React from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Check, Download, Folder, FolderOpen, LayoutGrid, List, Plus, Save, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { buildImportedTasksFromFiles } from '@/lib/taskFileImport';
import { exportCurrentProjectFile, importProjectFile } from '@/lib/projectFileActions';
import {
  createNewProject,
  deleteProject,
  getProjectIndex,
  ProjectMeta,
  saveCurrentProject,
  switchProject,
} from '@/lib/projectManager';
import { useAppStore } from '@/store';
import { Button } from '../ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';

type TopbarProps = {
  isCompactLayout?: boolean;
};

type ImageImportProgress = {
  done: number;
  total: number;
};

export function Topbar({ isCompactLayout = false }: TopbarProps) {
  const { importTasks, projectId, projectName, setProjectFields, viewMode } = useAppStore(
    useShallow((state) => ({
      importTasks: state.importTasks,
      projectId: state.projectId,
      projectName: state.projectName,
      setProjectFields: state.setProjectFields,
      viewMode: state.viewMode,
    })),
  );

  const imageInputRef = React.useRef<HTMLInputElement>(null);
  const [localProjectName, setLocalProjectName] = React.useState(projectName || '');
  const [projects, setProjects] = React.useState<ProjectMeta[]>([]);
  const [isPopoverOpen, setIsPopoverOpen] = React.useState(false);
  const [installPromptEvent, setInstallPromptEvent] = React.useState<BeforeInstallPromptEvent | null>(null);
  const [imageImportProgress, setImageImportProgress] = React.useState<ImageImportProgress | null>(null);

  React.useEffect(() => {
    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPromptEvent(event as BeforeInstallPromptEvent);
    };

    const handleAppInstalled = () => {
      setInstallPromptEvent(null);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  React.useEffect(() => {
    setLocalProjectName(projectName || '');
  }, [projectName]);

  const loadProjects = async () => {
    await saveCurrentProject();
    const list = await getProjectIndex();
    setProjects(list);
  };

  const handleOpenChange = (open: boolean) => {
    setIsPopoverOpen(open);
    if (open) {
      void loadProjects();
    }
  };

  const handleCreateNew = async () => {
    await createNewProject();
    setIsPopoverOpen(false);
  };

  const handleExportProject = () => {
    void exportCurrentProjectFile();
  };

  const handleImportProject = () => {
    void importProjectFile();
  };

  const handleDelete = async (event: React.MouseEvent, id: string) => {
    event.stopPropagation();
    if (confirm('确定要删除这个项目吗？此操作无法恢复。')) {
      await deleteProject(id);
      await loadProjects();
    }
  };

  const handleSwitch = async (id: string) => {
    if (id === projectId) return;
    await switchProject(id);
    setIsPopoverOpen(false);
  };

  const handleInstallApp = async () => {
    if (!installPromptEvent) return;
    await installPromptEvent.prompt();
    await installPromptEvent.userChoice;
    setInstallPromptEvent(null);
  };

  const handleImportImages = async (files: File[]) => {
    const imageFiles = files.filter((file) => file.type.startsWith('image/'));
    if (imageFiles.length === 0) {
      toast.info('没有找到可导入的图片');
      return;
    }

    if (imageImportProgress) {
      toast.info('图片正在导入中，请等待当前批次完成');
      return;
    }

    const total = imageFiles.length;
    const chunkSize = 5;
    const progressToastId = toast.loading(`正在导入图片 0/${total}`);
    let importedCount = 0;
    let startIndex = useAppStore.getState().tasks.length + 1;

    setImageImportProgress({ done: 0, total });

    try {
      for (let index = 0; index < imageFiles.length; index += chunkSize) {
        const chunk = imageFiles.slice(index, index + chunkSize);
        const newTasks = await buildImportedTasksFromFiles(chunk, startIndex);

        startIndex += newTasks.length;
        importTasks(newTasks);
        importedCount += newTasks.length;

        const done = Math.min(index + chunk.length, total);
        setImageImportProgress({ done, total });
        toast.loading(`正在导入图片 ${done}/${total}`, { id: progressToastId });

        await new Promise((resolve) => window.requestAnimationFrame(() => resolve(null)));
      }

      toast.success(`已导入 ${importedCount} 个图片任务`, { id: progressToastId });
    } catch (error) {
      console.error(error);
      toast.error('导入图片失败，请重试', { id: progressToastId });
    } finally {
      setImageImportProgress(null);
    }
  };

  const handleImageInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files ? (Array.from(event.target.files) as File[]) : [];
    event.target.value = '';
    void handleImportImages(files);
  };

  const importButtonLabel = imageImportProgress
    ? `${imageImportProgress.done}/${imageImportProgress.total}`
    : '导入图片';

  return (
    <header
      className={`z-10 flex shrink-0 items-center justify-between bg-background transition-colors ${
        isCompactLayout ? 'min-h-16 gap-3 px-3 py-3' : 'h-16 px-6'
      }`}
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div className="shrink-0 font-semibold text-foreground">
          <span className={`font-serif font-medium tracking-tight ${isCompactLayout ? 'text-[17px]' : 'text-[18.9px]'}`}>
            BatchRefiner
          </span>
        </div>

        <div
          className={`flex min-w-0 items-center gap-1.5 text-text-secondary ${
            isCompactLayout
              ? 'flex-1 text-[13px] before:content-none'
              : "text-[14.7px] before:mr-2 before:opacity-30 before:content-['/']"
          }`}
        >
          <Popover open={isPopoverOpen} onOpenChange={handleOpenChange}>
            <PopoverTrigger
              render={
                <Button
                  variant="ghost"
                  className={`h-auto min-w-0 items-center gap-1 rounded-lg text-text-primary hover:bg-black/5 ${
                    isCompactLayout ? 'flex-1 justify-start px-2 py-1.5' : '-ml-1.5 px-2 py-1.5 text-[15.75px]'
                  }`}
                >
                  <span className="truncate">{localProjectName}</span>
                  <Folder className="ml-1 h-3.5 w-3.5 shrink-0 opacity-50" />
                </Button>
              }
            />
            <PopoverContent className="w-[300px] rounded-2xl border-border bg-card p-2 shadow-lg" align="start">
              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between px-2 py-1.5 text-[11.55px] font-medium text-text-secondary">
                  <span>项目空间 (Projects)</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 rounded-md bg-button-main/10 px-2 text-[11.55px] text-button-main hover:bg-button-main/20"
                    onClick={handleCreateNew}
                  >
                    <Plus className="mr-1 h-3 w-3" />
                    新建项目
                  </Button>
                </div>

                <div className="grid grid-cols-2 gap-2 px-2 pb-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 justify-center gap-1.5 rounded-lg border-transparent bg-[#F5F4F0] px-2 text-[11.55px] text-text-secondary shadow-none hover:border-border hover:bg-white hover:text-foreground"
                    onClick={handleExportProject}
                  >
                    <Save className="h-3.5 w-3.5" />
                    保存项目
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 justify-center gap-1.5 rounded-lg border-transparent bg-[#F5F4F0] px-2 text-[11.55px] text-text-secondary shadow-none hover:border-border hover:bg-white hover:text-foreground"
                    onClick={handleImportProject}
                  >
                    <FolderOpen className="h-3.5 w-3.5" />
                    打开项目
                  </Button>
                </div>

                <div className="mt-1 flex max-h-[300px] flex-col gap-1 overflow-y-auto">
                  {projects.length === 0 && (
                    <div className="p-3 text-center text-[12.6px] text-text-secondary/50">暂无历史项目</div>
                  )}

                  {projects.map((project) => (
                    <div
                      key={project.projectId}
                      onClick={() => void handleSwitch(project.projectId)}
                      className={`group flex cursor-pointer items-center justify-between rounded-xl border px-3 py-2 transition-colors ${
                        project.projectId === projectId
                          ? 'border-button-main/20 bg-button-main/[0.04]'
                          : 'border-transparent hover:bg-black/5'
                      }`}
                    >
                      <div className="flex min-w-0 flex-1 flex-col pr-2">
                        <div className="flex items-center gap-2">
                          <span
                            className={`truncate text-[13.65px] ${
                              project.projectId === projectId ? 'font-medium text-button-main' : 'text-text-primary'
                            }`}
                          >
                            {project.projectName}
                          </span>
                          {project.projectId === projectId && <Check className="h-3 w-3 text-button-main" />}
                        </div>
                        <span className="mt-0.5 text-[10.5px] text-text-secondary">
                          包含 {project.taskCount} 个任务 · {new Date(project.updatedAt).toLocaleDateString()}
                        </span>
                      </div>

                      <button
                        className={`rounded-lg p-1.5 text-text-secondary/50 opacity-0 transition-colors group-hover:opacity-100 hover:bg-red-500 hover:text-white ${
                          project.projectId === projectId ? 'invisible' : ''
                        }`}
                        onClick={(event) => void handleDelete(event, project.projectId)}
                        title="删除项目"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-3 flex flex-col border-t border-border px-2 pt-2">
                <span className="mb-1 text-[10.5px] text-text-secondary">重命名当前项目</span>
                <input
                  className="w-full rounded-lg border border-transparent bg-[#F5F4F0] px-2 py-1.5 font-serif text-[13.65px] text-text-primary outline-none transition-colors focus:border-button-main"
                  value={localProjectName}
                  onChange={(event) => setLocalProjectName(event.target.value)}
                  onBlur={() => setProjectFields({ projectName: localProjectName })}
                />
              </div>
            </PopoverContent>
          </Popover>

          <Button
            type="button"
            variant="ghost"
            className={`h-auto shrink-0 rounded-lg px-2 py-1.5 text-[12.6px] font-normal text-text-secondary/70 hover:bg-black/5 hover:text-foreground ${
              imageImportProgress ? 'text-button-main hover:text-button-main' : ''
            }`}
            disabled={Boolean(imageImportProgress)}
            onClick={() => imageInputRef.current?.click()}
            title={imageImportProgress ? '图片正在导入中' : '选择图片并批量导入为任务'}
          >
            <Upload className="mr-1 h-3.5 w-3.5" />
            <span>{importButtonLabel}</span>
          </Button>
          <input
            ref={imageInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={handleImageInputChange}
          />
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <div className="flex items-center rounded-full bg-[#F4EFE7] p-1">
          <button
            type="button"
            onClick={() => setProjectFields({ viewMode: 'grid' })}
            className={`flex h-8 items-center gap-1.5 rounded-full px-3 text-[12px] font-medium transition-all duration-300 ${
              viewMode === 'grid'
                ? 'bg-white text-foreground shadow-[0_2px_8px_rgba(0,0,0,0.06)]'
                : 'text-text-secondary hover:bg-white/55 hover:text-foreground'
            }`}
            title="网格视图"
          >
            <LayoutGrid className="h-3.5 w-3.5" strokeWidth={1.8} />
            {!isCompactLayout && <span>网格</span>}
          </button>
          <button
            type="button"
            onClick={() => setProjectFields({ viewMode: 'list' })}
            className={`flex h-8 items-center gap-1.5 rounded-full px-3 text-[12px] font-medium transition-all duration-300 ${
              viewMode === 'list'
                ? 'bg-white text-foreground shadow-[0_2px_8px_rgba(0,0,0,0.06)]'
                : 'text-text-secondary hover:bg-white/55 hover:text-foreground'
            }`}
            title="列表视图"
          >
            <List className="h-3.5 w-3.5" strokeWidth={1.8} />
            {!isCompactLayout && <span>列表</span>}
          </button>
        </div>
        {installPromptEvent && (
          <Button
            variant="outline"
            size="sm"
            className="rounded-xl bg-white/70 px-3"
            onClick={handleInstallApp}
          >
            <Download className="h-3.5 w-3.5" />
            {!isCompactLayout && <span className="ml-1">安装应用</span>}
          </Button>
        )}
      </div>
    </header>
  );
}
