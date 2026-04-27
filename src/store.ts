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
import { compactPersistedStateValue, OVERSIZED_PERSISTENCE_NOTICE } from './lib/persistedStateBudget';
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
let pendingPersistNotice: string | null = null;

const draftFlushers = new Map<string, () => void>();

function queuePersistNotice() {
  pendingPersistNotice = OVERSIZED_PERSISTENCE_NOTICE;
}

function flushPersistNotice() {
  if (!pendingPersistNotice || typeof window === 'undefined') return;
  const message = pendingPersistNotice;
  pendingPersistNotice = null;
  window.setTimeout(() => {
    window.dispatchEvent(
      new CustomEvent('batch-refiner:persist-warning', {
        detail: { message },
      }),
    );
  }, 0);
}

function buildTaskLookup(tasks: Task[]) {
  return Object.fromEntries(tasks.map((task) => [task.id, task])) as Record<string, Task>;
}

function hasTaskUpdates(existingTask: Task, updates: Partial<Task>) {
  const updateKeys = Object.keys(updates) as Array<keyof Task>;
  return updateKeys.some((key) => !Object.is(existingTask[key], updates[key]));
}

const idbStorage: StateStorage = {
  getItem: async (name: string): Promise<string | null> => {
    try {
      const storedValue = (await get(name)) || null;
      if (typeof storedValue !== 'string') return null;

      const compacted = compactPersistedStateValue(storedValue);
      if (compacted.compacted) {
        queuePersistNotice();
        try {
          await set(name, compacted.value);
        } catch {
          // Ignore storage failures in non-browser or restricted environments.
        }
      }

      return compacted.value;
    } catch {
      return null;
    }
  },
  setItem: async (name: string, value: string): Promise<void> => {
    const compacted = compactPersistedStateValue(value);
    pendingState = compacted.value;
    if (compacted.compacted) {
      queuePersistNotice();
    }
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
  taskLookup: Record<string, Task>;
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
      taskLookup: buildTaskLookup(initialProjectState.tasks),
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

      setProjectFields: (fields) =>
        set((state) => {
          const nextTasks = fields.tasks ?? state.tasks;
          return {
            ...state,
            ...fields,
            tasks: nextTasks,
            taskLookup: buildTaskLookup(nextTasks),
            updatedAt: Date.now(),
          };
        }),

      addTask: (taskInfo) =>
        set((state) => {
          const nextTasks = [...state.tasks, normalizeIncomingTask(taskInfo)];
          return {
            tasks: nextTasks,
            taskLookup: buildTaskLookup(nextTasks),
            updatedAt: Date.now(),
          };
        }),

      updateTask: (id, updates) =>
        set((state) => {
          const existingTask = state.taskLookup[id];
          if (!existingTask || !hasTaskUpdates(existingTask, updates)) return state;

          const taskIndex = state.tasks.findIndex((task) => task.id === id);
          if (taskIndex === -1) return state;

          const updatedAt = Date.now();
          const nextTask = migrateTask({
            ...existingTask,
            ...updates,
            updatedAt,
          });
          const nextTasks = [...state.tasks];
          nextTasks[taskIndex] = nextTask;
          return {
            tasks: nextTasks,
            taskLookup: {
              ...state.taskLookup,
              [id]: nextTask,
            },
            updatedAt,
          };
        }),

      removeTask: (id) =>
        set((state) => {
          const nextTasks = state.tasks.filter((task) => task.id !== id);
          const nextTaskLookup = { ...state.taskLookup };
          delete nextTaskLookup[id];
          return {
            tasks: nextTasks,
            taskLookup: nextTaskLookup,
            activeTaskId: state.activeTaskId === id ? null : state.activeTaskId,
            lightboxTaskId: state.lightboxTaskId === id ? null : state.lightboxTaskId,
            lightboxImageIndex: state.lightboxTaskId === id ? 0 : state.lightboxImageIndex,
            selectedTaskIds: state.selectedTaskIds.filter((selectedId) => selectedId !== id),
            updatedAt: Date.now(),
          };
        }),

      setActiveTask: (id) => set({ activeTaskId: id }),
      setBatchRunning: (isRunning) => set({ isBatchRunning: isRunning }),

      importTasks: (tasksInfo) =>
        set((state) => {
          const nextTasks = [...state.tasks, ...tasksInfo.map((task) => normalizeIncomingTask(task))];
          return {
            tasks: nextTasks,
            taskLookup: buildTaskLookup(nextTasks),
            updatedAt: Date.now(),
          };
        }),

      clearProject: () =>
        set({
          ...initialProjectState,
          taskLookup: buildTaskLookup(initialProjectState.tasks),
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
              taskLookup: buildTaskLookup(recoveredTasks),
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
            taskLookup: buildTaskLookup(tasks),
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
        flushPersistNotice();
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
