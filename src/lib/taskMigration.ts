import { v4 as uuidv4 } from 'uuid';
import { DEFAULT_SKILL_FILE_NAME, DEFAULT_SKILL_TEXT } from './defaultSkillText';
import { BatchCount, PlatformApiConfigMap, ProjectData, Task, TaskResultImage } from '@/types';

export const initialPlatformConfigs: PlatformApiConfigMap = {
  yunwu: {
    apiBaseUrl: 'https://yunwu.ai',
    apiKey: '',
    textModel: 'gemini-3.1-flash-lite-preview',
    imageModel: 'gemini-3.1-flash-image-preview',
  },
  'comfly-chat': {
    apiBaseUrl: 'https://ai.comfly.chat',
    apiKey: '',
    textModel: 'gemini-3.1-flash-lite-preview',
    imageModel: 'gemini-3.1-flash-image-preview',
  },
  'openai-compatible': {
    apiBaseUrl: '',
    apiKey: '',
    textModel: 'gpt-4o',
    imageModel: 'gpt-image-2',
  },
  'gemini-native': {
    apiBaseUrl: '',
    apiKey: '',
    textModel: 'gemini-2.5-flash',
    imageModel: 'imagen-3.0-generate-001',
  },
  custom: {
    apiBaseUrl: '',
    apiKey: '',
    textModel: '',
    imageModel: '',
  },
};

export const initialProjectState: ProjectData = {
  projectId: uuidv4(),
  projectName: '未命名项目',
  platformPreset: 'yunwu',
  downloadDirectoryName: '',
  enablePromptOptimization: true,
  globalSkillText: DEFAULT_SKILL_TEXT,
  globalTargetText: '',
  globalReferenceImages: [],
  skillFileName: DEFAULT_SKILL_FILE_NAME,
  imageModel: 'gemini-3.1-flash-image-preview',
  textModel: 'gemini-3.1-flash-lite-preview',
  globalImageQuality: 'auto',
  globalBatchCount: 'x1',
  createdAt: Date.now(),
  updatedAt: Date.now(),
  tasks: [],
};

export function normalizeResultImages(task: Task): TaskResultImage[] {
  if (task.resultImages?.length) {
    return task.resultImages.map((result) => ({
      ...result,
      createdAt: result.createdAt || task.updatedAt || task.createdAt || Date.now(),
    }));
  }

  if (!task.resultImage) return [];

  return [
    {
      id: uuidv4(),
      src: task.resultImage,
      previewSrc: task.resultImagePreview,
      originalSrc: task.resultImageOriginal || task.resultImage,
      sourceType: task.resultImageSourceType,
      width: task.resultImageWidth,
      height: task.resultImageHeight,
      createdAt: task.updatedAt || task.createdAt || Date.now(),
    },
  ];
}

export function migrateTask(task: Task): Task {
  const resultImages = normalizeResultImages(task);
  return {
    ...task,
    resultImages,
    requestedBatchCount: task.requestedBatchCount || task.batchCount || 'x1',
    failedResultCount: task.failedResultCount || 0,
    exportedResultIds: task.exportedResultIds || [],
    resultImage: resultImages[0]?.src,
    resultImagePreview: resultImages[0]?.previewSrc,
    resultImageOriginal: resultImages[0]?.originalSrc,
    resultImageSourceType: resultImages[0]?.sourceType,
    resultImageWidth: resultImages[0]?.width,
    resultImageHeight: resultImages[0]?.height,
  };
}

export function recoverInterruptedTasks(tasks: Task[] = []) {
  return tasks.map((task) => {
    const migratedTask = migrateTask(task);
    if (
      migratedTask.status === 'Prompting' ||
      migratedTask.status === 'Rendering' ||
      migratedTask.status === 'Running' ||
      migratedTask.status === 'Waiting'
    ) {
      return {
        ...migratedTask,
        status: 'Error' as const,
        errorLog: {
          message: '请求已中断或页面已刷新，请重新执行该任务。',
          time: Date.now(),
          stage: migratedTask.status,
        },
        updatedAt: Date.now(),
      };
    }
    return migratedTask;
  });
}

export function withDefaultSkill<T extends Partial<ProjectData>>(state: T) {
  return {
    ...state,
    enablePromptOptimization: state.enablePromptOptimization !== false,
    globalSkillText: state.globalSkillText?.trim() ? state.globalSkillText : DEFAULT_SKILL_TEXT,
    skillFileName: state.skillFileName?.trim() ? state.skillFileName : DEFAULT_SKILL_FILE_NAME,
    globalImageQuality: state.globalImageQuality || 'auto',
    globalBatchCount: (state.globalBatchCount || 'x1') as BatchCount,
  };
}

export function normalizeIncomingTask(taskInfo: Omit<Task, 'id' | 'createdAt' | 'updatedAt' | 'status'>): Task {
  const now = Date.now();
  const nextTask: Task = {
    ...taskInfo,
    id: uuidv4(),
    status: 'Idle',
    createdAt: now,
    updatedAt: now,
    resultImages: taskInfo.resultImages || [],
    requestedBatchCount: taskInfo.requestedBatchCount || taskInfo.batchCount || 'x1',
    failedResultCount: taskInfo.failedResultCount || 0,
    exportedResultIds: taskInfo.exportedResultIds || [],
  };
  return migrateTask(nextTask);
}
