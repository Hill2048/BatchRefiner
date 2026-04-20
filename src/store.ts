import { create } from 'zustand';
import { persist, createJSONStorage, StateStorage } from 'zustand/middleware';
import { v4 as uuidv4 } from 'uuid';
import { get, set, del } from 'idb-keyval';
import { ProjectData, Task } from './types';
import { DEFAULT_SKILL_FILE_NAME, DEFAULT_SKILL_TEXT } from './lib/defaultSkillText';

// Storage Debouncer for disk I/O perf
let persistTimeout: ReturnType<typeof setTimeout>;
let pendingState: string | null = null;

const idbStorage: StateStorage = {
  getItem: async (name: string): Promise<string | null> => {
    return (await get(name)) || null;
  },
  setItem: async (name: string, value: string): Promise<void> => {
    pendingState = value;
    if (persistTimeout) clearTimeout(persistTimeout);
    return new Promise(resolve => {
       persistTimeout = setTimeout(async () => {
          if (pendingState) {
             await set(name, pendingState);
             pendingState = null;
          }
          resolve();
       }, 500);
    });
  },
  removeItem: async (name: string): Promise<void> => {
    await del(name);
  },
};

interface AppState extends ProjectData {
  activeTaskId: string | null;
  isBatchRunning: boolean;
  viewMode: 'grid' | 'list';
  lightboxTaskId: string | null;
  maxConcurrency: number;
  exportTemplate: string;
  selectedTaskIds: string[];
  apiKey: string;
  apiBaseUrl: string;
  
  // Actions
  setProjectFields: (fields: Partial<AppState>) => void;
  addTask: (task: Omit<Task, 'id' | 'createdAt' | 'updatedAt' | 'status'>) => void;
  updateTask: (id: string, updates: Partial<Task>) => void;
  removeTask: (id: string) => void;
  setActiveTask: (id: string | null) => void;
  setBatchRunning: (isRunning: boolean) => void;
  importTasks: (tasks: Omit<Task, 'id' | 'createdAt' | 'updatedAt' | 'status'>[]) => void;
  clearProject: () => void;
  setViewMode: (mode: 'grid' | 'list') => void;
  setLightboxTask: (id: string | null) => void;
  setExportTemplate: (template: string) => void;
  setMaxConcurrency: (limit: number) => void;
  loadProjectFromJson: (jsonString: string) => void;
  toggleTaskSelection: (id: string) => void;
  selectAllTasks: () => void;
  clearTaskSelection: () => void;
  setApiKey: (key: string) => void;
  setApiBaseUrl: (url: string) => void;
  reorderTasks: (startIndex: number, endIndex: number) => void;
}

const initialState: ProjectData = {
  projectId: uuidv4(),
  projectName: '未命名项目',
  platformPreset: 'yunwu',
  downloadDirectoryName: '',
  globalSkillText: DEFAULT_SKILL_TEXT,
  globalTargetText: '',
  globalReferenceImages: [],
  skillFileName: DEFAULT_SKILL_FILE_NAME,
  imageModel: 'gemini-3.1-flash-image-preview',
  textModel: 'gemini-3.1-flash-lite-preview',
  createdAt: Date.now(),
  updatedAt: Date.now(),
  tasks: [],
};

function recoverInterruptedTasks(tasks: Task[] = []) {
  return tasks.map((task) => {
    if (task.status === 'Prompting' || task.status === 'Rendering' || task.status === 'Running' || task.status === 'Waiting') {
      return {
        ...task,
        status: 'Error' as const,
        errorLog: {
          message: '请求已中断或页面已刷新，任务已自动恢复为失败状态，请重新执行。',
          time: Date.now(),
          stage: task.status,
        },
        updatedAt: Date.now(),
      };
    }
    return task;
  });
}

function withDefaultSkill<T extends Partial<ProjectData>>(state: T) {
  return {
    ...state,
    globalSkillText: state.globalSkillText?.trim() ? state.globalSkillText : DEFAULT_SKILL_TEXT,
    skillFileName: state.skillFileName?.trim() ? state.skillFileName : DEFAULT_SKILL_FILE_NAME,
  };
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      ...initialState,
      activeTaskId: null,
      isBatchRunning: false,
      viewMode: 'grid',
      lightboxTaskId: null,
      maxConcurrency: 3,
      exportTemplate: '{task_id}_{title}',
      selectedTaskIds: [],
      apiKey: '',
      apiBaseUrl: 'https://yunwu.ai',

      setProjectFields: (fields) => set((state) => ({ ...state, ...fields, updatedAt: Date.now() })),
      
      addTask: (taskInfo) => set((state) => {
        const newTask: Task = {
          ...taskInfo,
          id: uuidv4(),
          status: 'Idle',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        return { tasks: [...state.tasks, newTask], updatedAt: Date.now() };
      }),

      updateTask: (id, updates) => set((state) => ({
        tasks: state.tasks.map(t => t.id === id ? { ...t, ...updates, updatedAt: Date.now() } : t),
        updatedAt: Date.now(),
      })),

      removeTask: (id) => set((state) => ({
        tasks: state.tasks.filter(t => t.id !== id),
        activeTaskId: state.activeTaskId === id ? null : state.activeTaskId,
        selectedTaskIds: state.selectedTaskIds.filter(selectedId => selectedId !== id),
        updatedAt: Date.now(),
      })),

      setActiveTask: (id) => set({ activeTaskId: id }),
      
      setBatchRunning: (isRunning) => set({ isBatchRunning: isRunning }),

      importTasks: (tasksInfo) => set((state) => {
        const newTasks: Task[] = tasksInfo.map(info => ({
          ...info,
          id: uuidv4(),
          status: 'Idle',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }));
        return { tasks: [...state.tasks, ...newTasks], updatedAt: Date.now() };
      }),

      clearProject: () => set({ ...initialState, projectId: uuidv4(), selectedTaskIds: [] }),
      
      setViewMode: (mode) => set({ viewMode: mode }),
      setLightboxTask: (id) => set({ lightboxTaskId: id }),
      setExportTemplate: (template) => set({ exportTemplate: template }),
      setMaxConcurrency: (limit) => set({ maxConcurrency: limit }),
      
      loadProjectFromJson: (jsonString: string) => {
         try {
             const data = JSON.parse(jsonString);
             if (data.projectId && data.tasks) {
                 set((state) => ({ ...state, ...withDefaultSkill(data), isBatchRunning: false, activeTaskId: null, lightboxTaskId: null, selectedTaskIds: [] }));
             }
         } catch(e) {}
      },

      toggleTaskSelection: (id) => set((state) => ({
        selectedTaskIds: state.selectedTaskIds.includes(id) 
          ? state.selectedTaskIds.filter(tId => tId !== id)
          : [...state.selectedTaskIds, id]
      })),

      selectAllTasks: () => set((state) => ({
        selectedTaskIds: state.tasks.map(t => t.id)
      })),

      clearTaskSelection: () => set({ selectedTaskIds: [] }),

      setApiKey: (key) => set({ apiKey: key }),
      setApiBaseUrl: (url) => set({ apiBaseUrl: url }),

      reorderTasks: (startIndex, endIndex) => set((state) => {
        const newTasks = Array.from(state.tasks);
        const [removed] = newTasks.splice(startIndex, 1);
        newTasks.splice(endIndex, 0, removed);
        // Ensure index order is maintained for display if needed, but here we just re-arrange the array
        return { tasks: newTasks, updatedAt: Date.now() };
      }),
    }),
    {
      name: 'batch-refiner-idb',
      storage: createJSONStorage(() => idbStorage),
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        state.setBatchRunning(false);
        state.setProjectFields({
          ...withDefaultSkill(state),
          tasks: recoverInterruptedTasks(state.tasks),
          activeTaskId: null,
          lightboxTaskId: null,
        });
      },
      partialize: (state) => ({ 
         projectId: state.projectId,
         projectName: state.projectName,
         platformPreset: state.platformPreset,
         downloadDirectoryName: state.downloadDirectoryName,
         globalSkillText: state.globalSkillText,
         globalTargetText: state.globalTargetText,
         globalReferenceImages: state.globalReferenceImages,
         skillFileName: state.skillFileName,
         imageModel: state.imageModel,
         textModel: state.textModel,
         tasks: state.tasks, // Safely stored in IndexedDB regardless of size
         viewMode: state.viewMode,
         maxConcurrency: state.maxConcurrency,
         exportTemplate: state.exportTemplate,
         apiKey: state.apiKey,
         apiBaseUrl: state.apiBaseUrl,
         createdAt: state.createdAt,
         updatedAt: state.updatedAt
      }),
    }
  )
);
