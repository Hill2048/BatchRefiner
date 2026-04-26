import { create } from 'zustand';
import { createJSONStorage, persist, StateStorage } from 'zustand/middleware';
import { del, get, set } from 'idb-keyval';
import { v4 as uuidv4 } from 'uuid';
import {
  PlatformApiConfigMap,
  ProjectData,
  Task,
} from './types';
import { extractProjectDataFromImport, mergeProjectSnapshotWithGlobalConfig, sanitizeProjectSnapshot } from './lib/projectSnapshot';
import {
  initialPlatformConfigs,
  initialProjectState,
  migrateTask,
  normalizeIncomingTask,
  recoverInterruptedTasks,
  withDefaultSkill,
} from './lib/taskMigration';

let persistTimeout: ReturnType<typeof setTimeout>;
let pendingState: string | null = null;

const draftFlushers = new Map<string, () => void>();

const idbStorage: StateStorage = {
  getItem: async (name: string): Promise<string | null> => {
    try {
      return (await get(name)) || null;
    } catch {
      return null;
    }
  },
  setItem: async (name: string, value: string): Promise<void> => {
    pendingState = value;
    if (persistTimeout) clearTimeout(persistTimeout);
    return new Promise((resolve) => {
      persistTimeout = setTimeout(async () => {
        if (pendingState) {
          try {
            await set(name, pendingState);
          } catch {
            // Ignore storage failures in non-browser or restricted environments.
          }
          pendingState = null;
        }
        resolve();
      }, 500);
    });
  },
  removeItem: async (name: string): Promise<void> => {
    try {
      await del(name);
    } catch {
      // Ignore storage failures in non-browser or restricted environments.
    }
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
  textApiKey: string;
  imageApiKey: string;
  apiBaseUrl: string;
  textApiBaseUrl: string;
  imageApiBaseUrl: string;
  imageApiPath: string;
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
  setTextApiKey: (key: string) => void;
  setImageApiKey: (key: string) => void;
  setApiBaseUrl: (url: string) => void;
  setTextApiBaseUrl: (url: string) => void;
  setImageApiBaseUrl: (url: string) => void;
  setImageApiPath: (path: string) => void;
  reorderTasks: (startIndex: number, endIndex: number) => void;
  flushDrafts: () => void;
  registerDraftFlusher: (id: string, flush: () => void) => void;
  unregisterDraftFlusher: (id: string) => void;
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
      textApiKey: '',
      imageApiKey: '',
      apiBaseUrl: 'https://yunwu.ai',
      textApiBaseUrl: 'https://yunwu.ai',
      imageApiBaseUrl: 'https://yunwu.ai',
      imageApiPath: '',
      platformConfigs: initialPlatformConfigs,

      setProjectFields: (fields) => set((state) => ({ ...state, ...fields, updatedAt: Date.now() })),

      addTask: (taskInfo) => set((state) => ({
        tasks: [...state.tasks, normalizeIncomingTask(taskInfo)],
        updatedAt: Date.now(),
      })),

      updateTask: (id, updates) =>
        set((state) => ({
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
        tasks: state.tasks.filter((task) => task.id !== id),
        activeTaskId: state.activeTaskId === id ? null : state.activeTaskId,
        lightboxTaskId: state.lightboxTaskId === id ? null : state.lightboxTaskId,
        lightboxImageIndex: state.lightboxTaskId === id ? 0 : state.lightboxImageIndex,
        selectedTaskIds: state.selectedTaskIds.filter((selectedId) => selectedId !== id),
        updatedAt: Date.now(),
      })),

      setActiveTask: (id) => set({ activeTaskId: id }),
      setBatchRunning: (isRunning) => set({ isBatchRunning: isRunning }),

      importTasks: (tasksInfo) => set((state) => ({
        tasks: [...state.tasks, ...tasksInfo.map((task) => normalizeIncomingTask(task))],
        updatedAt: Date.now(),
      })),

      clearProject: () =>
        set({
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
            const recoveredTasks = recoverInterruptedTasks((sanitizedProject.tasks || []) as Task[]);

            set((state) => ({
              ...state,
              ...mergeProjectSnapshotWithGlobalConfig(sanitizedProject, state),
              tasks: recoveredTasks,
              isBatchRunning: false,
              activeTaskId: null,
              lightboxTaskId: null,
              lightboxImageIndex: 0,
              selectedTaskIds: [],
            }));
          }
        } catch (_error) {}
      },

      toggleTaskSelection: (id) =>
        set((state) => ({
          selectedTaskIds: state.selectedTaskIds.includes(id)
            ? state.selectedTaskIds.filter((taskId) => taskId !== id)
            : [...state.selectedTaskIds, id],
        })),

      selectAllTasks: () =>
        set((state) => ({
          selectedTaskIds: state.tasks.map((task) => task.id),
        })),

      clearTaskSelection: () => set({ selectedTaskIds: [] }),
      setApiKey: (key) => set({ apiKey: key, textApiKey: key, imageApiKey: key }),
      setTextApiKey: (key) => set({ textApiKey: key, apiKey: key }),
      setImageApiKey: (key) => set({ imageApiKey: key }),
      setApiBaseUrl: (url) => set({ apiBaseUrl: url }),
      setTextApiBaseUrl: (url) => set({ textApiBaseUrl: url }),
      setImageApiBaseUrl: (url) => set({ imageApiBaseUrl: url }),
      setImageApiPath: (path) => set({ imageApiPath: path }),

      reorderTasks: (startIndex, endIndex) =>
        set((state) => {
          const tasks = Array.from(state.tasks);
          const [removed] = tasks.splice(startIndex, 1);
          tasks.splice(endIndex, 0, removed);
          return {
            tasks,
            updatedAt: Date.now(),
          };
        }),

      flushDrafts: () => {
        Array.from(draftFlushers.values()).forEach((flush) => flush());
      },

      registerDraftFlusher: (id, flush) => {
        draftFlushers.set(id, flush);
      },

      unregisterDraftFlusher: (id) => {
        draftFlushers.delete(id);
      },
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
        globalImageQuality: state.globalImageQuality,
        globalBatchCount: state.globalBatchCount,
        generationLogs: state.generationLogs,
        tasks: state.tasks,
        viewMode: state.viewMode,
        maxConcurrency: state.maxConcurrency,
        exportTemplate: state.exportTemplate,
        apiKey: state.apiKey,
        textApiKey: state.textApiKey,
        imageApiKey: state.imageApiKey,
        apiBaseUrl: state.apiBaseUrl,
        textApiBaseUrl: state.textApiBaseUrl,
        imageApiBaseUrl: state.imageApiBaseUrl,
        imageApiPath: state.imageApiPath,
        platformConfigs: state.platformConfigs,
        createdAt: state.createdAt,
        updatedAt: state.updatedAt,
      }),
    },
  ),
);
