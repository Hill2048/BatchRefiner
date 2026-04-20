import { FileUp, Table, Folder, Plus, Trash2, Check } from 'lucide-react';
import { Button } from '../ui/button';
import { useAppStore } from '@/store';
import * as React from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { getProjectIndex, switchProject, createNewProject, deleteProject, saveCurrentProject, ProjectMeta } from '@/lib/projectManager';
import { haltBatch } from '@/lib/batchRunner';

export function Topbar() {
  const store = useAppStore();
  const projectName = store.projectName;
  const projectId = store.projectId;
  const [localProjectName, setLocalProjectName] = React.useState(projectName || '');
  const [projects, setProjects] = React.useState<ProjectMeta[]>([]);
  const [isPopoverOpen, setIsPopoverOpen] = React.useState(false);

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
       loadProjects();
    }
  };

  const handleCreateNew = async () => {
    await createNewProject();
    setIsPopoverOpen(false);
  };

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if(confirm('确定要删除此项目吗？该操作无法恢复。')) {
      await deleteProject(id);
      loadProjects();
    }
  };

  const handleSwitch = async (id: string) => {
    if (id === projectId) return;
    await switchProject(id);
    setIsPopoverOpen(false);
  };

  const handleDuplicate = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    // To duplicate, we load the project locally, copy it, assign new uuid, and save it.
    // Wait, the project doesn't have to be the current one.
    // Let's just duplicate the current one for simplicity if they click a duplicate button entirely.
    // Actually, duplicating arbitrary project:
    let data;
    if (id === projectId) {
       data = { ...store };
    } else {
       const idbData = await import('idb-keyval').then(mod => mod.get(`project_data_${id}`));
       data = idbData;
    }
    
    if (data) {
       const newId = crypto.randomUUID();
       // Generate new task IDs
       const newTasks = (data.tasks || []).map((t: any) => ({...t, id: crypto.randomUUID()}));
       const newData = {
          ...data,
          projectId: newId,
          projectName: data.projectName + ' (副本)',
          tasks: newTasks,
          updatedAt: Date.now(),
          createdAt: Date.now()
       };
       await import('idb-keyval').then(mod => mod.set(`project_data_${newId}`, newData));
       
       let index = await getProjectIndex();
       index.push({
          projectId: newId,
          projectName: newData.projectName,
          updatedAt: newData.updatedAt,
          taskCount: newData.tasks.length
       });
       await import('idb-keyval').then(mod => mod.set('batch-refiner-project-index', index));
       loadProjects();
    }
  };

  return (
    <header className="h-16 bg-background flex items-center justify-between px-6 shrink-0 z-10 transition-colors border-b border-border">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2.5 text-foreground font-semibold">
          <div className="w-2.5 h-2.5 rounded-full bg-primary shadow-whisper"></div>
          <span className="font-serif text-[18px] font-medium tracking-tight">BatchRefiner</span>
        </div>
        
        <div className="flex items-center gap-2 text-muted-foreground text-[14px] before:content-['/'] before:opacity-30 before:mr-2">
          
          <Popover open={isPopoverOpen} onOpenChange={handleOpenChange}>
            <PopoverTrigger asChild>
               <Button variant="ghost" className="h-auto p-1.5 -ml-1.5 hover:bg-black/5 text-foreground px-2 font-serif text-[15px] italic rounded flex items-center gap-1">
                 {localProjectName} <Folder className="w-3.5 h-3.5 opacity-50 ml-1" />
               </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[300px] p-2 bg-card border-border shadow-lg rounded-2xl" align="start">
               <div className="flex flex-col gap-1">
                 <div className="px-2 py-1.5 flex justify-between items-center text-[11px] font-medium text-muted-foreground">
                   <span>项目空间 (Projects)</span>
                   <Button variant="ghost" size="sm" className="h-6 px-2 text-[11px] bg-primary/10 text-primary hover:bg-primary/20 rounded-md" onClick={handleCreateNew}>
                     <Plus className="w-3 h-3 mr-1" /> 新建项目
                   </Button>
                 </div>
                 
                 <div className="max-h-[300px] overflow-y-auto flex flex-col gap-1 mt-1 custom-scrollbar">
                   {projects.length === 0 && <div className="p-3 text-[12px] text-muted-foreground/50 text-center">暂无历史项目</div>}
                   {projects.map(p => (
                     <div 
                       key={p.projectId}
                       onClick={() => handleSwitch(p.projectId)}
                       className={`flex items-center justify-between px-3 py-2 rounded-xl cursor-pointer transition-colors group
                         ${p.projectId === projectId ? 'bg-primary/[0.04] border border-primary/20' : 'hover:bg-black/5 border border-transparent'}
                       `}
                     >
                       <div className="flex flex-col flex-1 min-w-0 pr-2">
                         <div className="flex items-center gap-2">
                           <span className={`text-[13px] truncate ${p.projectId === projectId ? 'font-medium text-primary' : 'text-foreground'}`}>
                             {p.projectName}
                           </span>
                           {p.projectId === projectId && <Check className="w-3 h-3 text-primary" />}
                         </div>
                         <span className="text-[10px] text-muted-foreground mt-0.5">
                           包含 {p.taskCount} 个任务 · {new Date(p.updatedAt).toLocaleDateString()}
                         </span>
                       </div>

                       <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
                         <button 
                           className="p-1.5 hover:bg-primary/10 text-muted-foreground hover:text-primary rounded-lg transition-colors"
                           onClick={(e) => handleDuplicate(e, p.projectId)}
                           title="创建此项目副本"
                         >
                           <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
                         </button>
                         <button 
                           className={`p-1.5 hover:bg-red-500 hover:text-white rounded-lg text-muted-foreground transition-colors ${p.projectId === projectId ? 'invisible' : ''}`}
                           onClick={(e) => handleDelete(e, p.projectId)}
                           title="删除项目"
                         >
                           <Trash2 className="w-3.5 h-3.5" />
                         </button>
                       </div>
                     </div>
                   ))}
                 </div>
               </div>
               
               <div className="mt-3 px-2 pt-2 border-t border-border flex flex-col">
                 <span className="text-[10px] text-muted-foreground mb-1">重命名当前项目:</span>
                 <input 
                   className="font-serif text-[13px] text-foreground px-2 py-1.5 bg-background border border-transparent focus:border-primary outline-none rounded-lg w-full transition-colors" 
                   value={localProjectName}
                   onChange={(e) => setLocalProjectName(e.target.value)}
                   onBlur={() => store.setProjectFields({ projectName: localProjectName })}
                 />
               </div>
            </PopoverContent>
          </Popover>
          <span className="ml-2 px-2 py-0.5 rounded-full bg-secondary text-muted-foreground text-[10px] flex items-center gap-1">
             <div className="w-1 h-1 rounded-full bg-green-500"></div> 已保存
          </span>
        </div>
      </div>
      
      {/* Right side controls */}
      <div className="flex items-center gap-3">
         <Button 
           variant="outline" 
           size="sm"
           onClick={() => store.clearProject()}
           className="h-8 text-[12px] bg-background border-border text-destructive hover:bg-destructive focus-visible:ring-destructive hover:text-white rounded-lg shadow-sm font-medium hidden sm:flex"
         >
           清空项目库
         </Button>
         {store.isBatchRunning && (
           <Button 
             variant="destructive"
             size="sm"
             onClick={() => haltBatch()}
             className="h-8 text-[12px] rounded-lg shadow-[0_0_0_1px_rgba(239,68,68,1)] bg-red-500 font-medium animate-in fade-in zoom-in-95 flex items-center gap-1.5"
           >
             <div className="w-2 h-2 rounded-sm bg-white animate-pulse" /> 中止所有任务
           </Button>
         )}
      </div>
    </header>
  );
}
