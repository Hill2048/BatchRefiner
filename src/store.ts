import { create } from 'zustand';
import { persist, createJSONStorage, StateStorage } from 'zustand/middleware';
import { v4 as uuidv4 } from 'uuid';
import { get, set, del } from 'idb-keyval';
import { PlatformApiConfigMap, ProjectData, Task } from './types';
import { extractProjectDataFromImport, mergeProjectSnapshotWithGlobalConfig, sanitizeProjectSnapshot } from './lib/projectSnapshot';
import {
  initialPlatformConfigs,
  initialProjectState,
  normalizeIncomingTask,
  recoverInterruptedTasks,
  migrateTask,
  withDefaultSkill,
} from './lib/taskMigration';

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
  lightboxImageIndex: number;
  maxConcurrency: number;
  exportTemplate: string;
  selectedTaskIds: string[];
  apiKey: string;
  apiBaseUrl: string;
  platformConfigs: PlatformApiConfigMap;
  setProjectFields: (fields: Partial<AppState>) => void;
  addTask: (task: Omit<Task, 'id' | 'createdAt' | 'updatedAt' | 'status'>) => void;
  updateTask: (id: string, updates: Partial<Task>) => void;
  removeTask: (id: string) => void;
  setActiveTask: (id: string | null) => void;
  setBatchRunning: (isRunning: boolean) => void;
  importTasks: (tasks: Omit<Task, 'id' | 'createdAt' | 'updatedAt' | 'status'>[]) => void;
  clearProject: () => void;
  setViewMode: (mode: 'grid' | 'list') => void;
  setLightboxTask: (id: string | null, imageIndex?: number) => void;
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

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      ...initialProjectState,
      activeTaskId: null,
      isBatchRunning: false,
      viewMode: 'grid',
      lightboxTaskId: null,
      lightboxImageIndex: 0,
      maxConcurrency: 3,
      exportTemplate: '{task_id}_{title}',
      selectedTaskIds: [],
      apiKey: '',
      apiBaseUrl: 'https://yunwu.ai',
      platformConfigs: initialPlatformConfigs,

      setProjectFields: (fields) => set((state) => ({ ...state, ...fields, updatedAt: Date.now() })),

      addTask: (taskInfo) => set((state) => ({
        tasks: [...state.tasks, normalizeIncomingTask(taskInfo)],
        updatedAt: Date.now(),
      })),

      updateTask: (id, updates) => set((state) => ({
        tasks: state.tasks.map((task) => {
          if (task.id !== id) return task;
          return migrateTask({
            ...task,
            ...updates,
            updatedAt: Date.now(),
          });
        }),
        updatedAt: Date.now(),
      })),

      removeTask: (id) => set((state) => ({
        tasks: state.tasks.filter(t => t.id !== id),
        activeTaskId: state.activeTaskId === id ? null : state.activeTaskId,
        lightboxTaskId: state.lightboxTaskId === id ? null : state.lightboxTaskId,
        lightboxImageIndex: state.lightboxTaskId === id ? 0 : state.lightboxImageIndex,
        selectedTaskIds: state.selectedTaskIds.filter(selectedId => selectedId !== id),
        updatedAt: Date.now(),
      })),

      setActiveTask: (id) => set({ activeTaskId: id }),
      setBatchRunning: (isRunning) => set({ isBatchRunning: isRunning }),

      importTasks: (tasksInfo) => set((state) => ({
        tasks: [...state.tasks, ...tasksInfo.map((task) => normalizeIncomingTask(task))],
        updatedAt: Date.now(),
      })),

      clearProject: () => set({
        ...initialProjectState,
        projectId: uuidv4(),
        selectedTaskIds: [],
        lightboxTaskId: null,
        lightboxImageIndex: 0,
      }),

      setViewMode: (mode) => set({ viewMode: mode }),
      setLightboxTask: (id, imageIndex = 0) => set({ lightboxTaskId: id, lightboxImageIndex: imageIndex }),
      setExportTemplate: (template) => set({ exportTemplate: template }),
      setMaxConcurrency: (limit) => set({ maxConcurrency: limit }),

      loadProjectFromJson: (jsonString: string) => {
        try {
          const data = extractProjectDataFromImport(JSON.parse(jsonString));
          if (data.projectId && data.tasks) {
            const sanitizedProject = withDefaultSkill(sanitizeProjectSnapshot(data));
            set((state) => ({
              ...state,
              ...mergeProjectSnapshotWithGlobalConfig(sanitizedProject, state),
              tasks: recoverInterruptedTasks((sanitizedProject.tasks || []) as Task[]),
              isBatchRunning: false,
              activeTaskId: null,
              lightboxTaskId: null,
              lightboxImageIndex: 0,
              selectedTaskIds: [],
            }));
          }
        } catch (_error) {}
      },

      toggleTaskSelection: (id) => set((state) => ({
        selectedTaskIds: state.selectedTaskIds.includes(id)
          ? state.selectedTaskIds.filter(taskId => taskId !== id)
          : [...state.selectedTaskIds, id]
      })),

      selectAllTasks: () => set((state) => ({
        selectedTaskIds: state.tasks.map(task => task.id)
      })),

      clearTaskSelection: () => set({ selectedTaskIds: [] }),
      setApiKey: (key) => set({ apiKey: key }),
      setApiBaseUrl: (url) => set({ apiBaseUrl: url }),

      reorderTasks: (startIndex, endIndex) => set((state) => {
        const newTasks = Array.from(state.tasks);
        const [removed] = newTasks.splice(startIndex, 1);
        newTasks.splice(endIndex, 0, removed);
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
          lightboxImageIndex: 0,
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
        enablePromptOptimization: state.enablePromptOptimization,
        imageModel: state.imageModel,
        textModel: state.textModel,
        globalAspectRatio: state.globalAspectRatio,
        globalResolution: state.globalResolution,
        globalBatchCount: state.globalBatchCount,
        tasks: state.tasks,
        viewMode: state.viewMode,
        maxConcurrency: state.maxConcurrency,
        exportTemplate: state.exportTemplate,
        apiKey: state.apiKey,
        apiBaseUrl: state.apiBaseUrl,
        platformConfigs: state.platformConfigs,
        createdAt: state.createdAt,
        updatedAt: state.updatedAt
      }),
    }
  )
);
