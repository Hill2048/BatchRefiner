import { FileUp, Table, Folder, Plus, Trash2, Check } from 'lucide-react';
import { Button } from '../ui/button';
import { useAppStore } from '@/store';
import * as React from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { getProjectIndex, switchProject, createNewProject, deleteProject, saveCurrentProject, ProjectMeta } from '@/lib/projectManager';

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

  return (
    <header className="h-16 bg-background flex items-center justify-between px-6 shrink-0 z-10 transition-colors border-b border-[#E6E4DF]">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2 text-foreground font-semibold">
          <span className="font-serif text-[18px] font-medium tracking-tight">BatchRefiner</span>
        </div>
        
        <div className="flex items-center gap-2 text-text-secondary text-[14px] before:content-['/'] before:opacity-30 before:mr-2">
          
          <Popover open={isPopoverOpen} onOpenChange={handleOpenChange}>
            <PopoverTrigger render={
               <Button variant="ghost" className="h-auto p-1.5 -ml-1.5 hover:bg-black/5 text-text-primary px-2 font-serif text-[15px] italic rounded flex items-center gap-1">
                 {localProjectName} <Folder className="w-3.5 h-3.5 opacity-50 ml-1" />
               </Button>
            } />
            <PopoverContent className="w-[300px] p-2 bg-card border-border shadow-lg rounded-2xl" align="start">
               <div className="flex flex-col gap-1">
                 <div className="px-2 py-1.5 flex justify-between items-center text-[11px] font-medium text-text-secondary">
                   <span>项目空间 (Projects)</span>
                   <Button variant="ghost" size="sm" className="h-6 px-2 text-[11px] bg-button-main/10 text-button-main hover:bg-button-main/20 rounded-md" onClick={handleCreateNew}>
                     <Plus className="w-3 h-3 mr-1" /> 新建项目
                   </Button>
                 </div>
                 
                 <div className="max-h-[300px] overflow-y-auto flex flex-col gap-1 mt-1">
                   {projects.length === 0 && <div className="p-3 text-[12px] text-text-secondary/50 text-center">暂无历史项目</div>}
                   {projects.map(p => (
                     <div 
                       key={p.projectId}
                       onClick={() => handleSwitch(p.projectId)}
                       className={`flex items-center justify-between px-3 py-2 rounded-xl cursor-pointer transition-colors group
                         ${p.projectId === projectId ? 'bg-button-main/[0.04] border border-button-main/20' : 'hover:bg-black/5 border border-transparent'}
                       `}
                     >
                       <div className="flex flex-col flex-1 min-w-0 pr-2">
                         <div className="flex items-center gap-2">
                           <span className={`text-[13px] truncate ${p.projectId === projectId ? 'font-medium text-button-main' : 'text-text-primary'}`}>
                             {p.projectName}
                           </span>
                           {p.projectId === projectId && <Check className="w-3 h-3 text-button-main" />}
                         </div>
                         <span className="text-[10px] text-text-secondary mt-0.5">
                           包含 {p.taskCount} 个任务 · {new Date(p.updatedAt).toLocaleDateString()}
                         </span>
                       </div>

                       <button 
                         className={`p-1.5 hover:bg-red-500 hover:text-white rounded-lg text-text-secondary/50 transition-colors opacity-0 group-hover:opacity-100 ${p.projectId === projectId ? 'invisible' : ''}`}
                         onClick={(e) => handleDelete(e, p.projectId)}
                         title="删除项目"
                       >
                         <Trash2 className="w-3.5 h-3.5" />
                       </button>
                     </div>
                   ))}
                 </div>
               </div>
               
               <div className="mt-3 px-2 pt-2 border-t border-border flex flex-col">
                 <span className="text-[10px] text-text-secondary mb-1">重命名当前项目:</span>
                 <input 
                   className="font-serif text-[13px] text-text-primary px-2 py-1.5 bg-[#F5F4F0] border border-transparent focus:border-button-main outline-none rounded-lg w-full transition-colors" 
                   value={localProjectName}
                   onChange={(e) => setLocalProjectName(e.target.value)}
                   onBlur={() => store.setProjectFields({ projectName: localProjectName })}
                 />
               </div>
            </PopoverContent>
          </Popover>

        </div>
      </div>
    </header>
  );
}
