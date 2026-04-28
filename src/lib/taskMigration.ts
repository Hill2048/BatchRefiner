import { v4 as uuidv4 } from 'uuid';
import { DEFAULT_SKILL_FILE_NAME, DEFAULT_SKILL_TEXT } from './defaultSkillText';
import { BatchCount, PlatformApiConfigMap, ProjectData, Task, TaskResultImage } from '@/types';
import { isValidResultImageAssetSrc } from './resultImageAsset';

export const initialPlatformConfigs: PlatformApiConfigMap = {
  yunwu: {
    apiBaseUrl: 'https://yunwu.ai',
    textApiBaseUrl: 'https://yunwu.ai',
    imageApiBaseUrl: 'https://yunwu.ai',
    imageApiPath: '',
    apiKey: '',
    textApiKey: '',
    imageApiKey: '',
    textModel: 'gemini-3.1-flash-lite-preview',
    imageModel: 'gemini-3.1-flash-image-preview',
  },
  'comfly-chat': {
    apiBaseUrl: 'https://ai.comfly.chat',
    textApiBaseUrl: 'https://ai.comfly.chat',
    imageApiBaseUrl: 'https://ai.comfly.chat',
    imageApiPath: '',
    apiKey: '',
    textApiKey: '',
    imageApiKey: '',
    textModel: 'gemini-3.1-flash-lite-preview',
    imageModel: 'gemini-3.1-flash-image-preview',
  },
  'openai-compatible': {
    apiBaseUrl: '',
    textApiBaseUrl: '',
    imageApiBaseUrl: '',
    imageApiPath: '',
    apiKey: '',
    textApiKey: '',
    imageApiKey: '',
    textModel: 'gpt-4o',
    imageModel: 'gpt-image-2',
  },
  'gemini-native': {
    apiBaseUrl: '',
    textApiBaseUrl: '',
    imageApiBaseUrl: '',
    imageApiPath: '',
    apiKey: '',
    textApiKey: '',
    imageApiKey: '',
    textModel: 'gemini-2.5-flash',
    imageModel: 'imagen-3.0-generate-001',
  },
  custom: {
    apiBaseUrl: '',
    textApiBaseUrl: '',
    imageApiBaseUrl: '',
    imageApiPath: '',
    apiKey: '',
    textApiKey: '',
    imageApiKey: '',
    textModel: '',
    imageModel: '',
  },
};

export const initialProjectState: ProjectData = {
  projectId: uuidv4(),
  projectName: '未命名项目',
  platformPreset: 'yunwu',
  downloadDirectoryName: '',
  cacheDirectoryName: '',
  enablePromptOptimization: true,
  globalSkillText: DEFAULT_SKILL_TEXT,
  globalTargetText: '',
  globalReferenceImages: [],
  skillFileName: DEFAULT_SKILL_FILE_NAME,
  imageModel: 'gemini-3.1-flash-image-preview',
  textModel: 'gemini-3.1-flash-lite-preview',
  textApiBaseUrl: 'https://yunwu.ai',
  imageApiBaseUrl: 'https://yunwu.ai',
  imageApiPath: '',
  globalImageQuality: 'auto',
  globalBatchCount: 'x1',
  generationLogs: [],
  createdAt: Date.now(),
  updatedAt: Date.now(),
  tasks: [],
};

export function normalizeResultImages(task: Task): TaskResultImage[] {
  if (task.resultImages?.length) {
    return task.resultImages.map((result) => ({
      ...result,
      assetSrc: result.assetSrc || result.src,
      assetWidth: result.assetWidth || result.width,
      assetHeight: result.assetHeight || result.height,
      downloadSourceType:
        result.downloadSourceType ||
        (
          (result.src || result.assetSrc || result.originalSrc)?.startsWith('data:')
            ? 'data_url'
            : 'src'
        ),
      normalizationStatus: result.normalizationStatus || (isValidResultImageAssetSrc(result.src || result.assetSrc || result.originalSrc) ? 'ok' : 'invalid_source'),
      downloadStatus: result.downloadStatus || (isValidResultImageAssetSrc(result.src || result.assetSrc || result.originalSrc) ? 'ready' : 'invalid_source'),
      downloadFailureStage: result.downloadFailureStage || (isValidResultImageAssetSrc(result.src || result.assetSrc || result.originalSrc) ? undefined : 'normalize'),
      downloadFailureReason: result.downloadFailureReason || (isValidResultImageAssetSrc(result.src || result.assetSrc || result.originalSrc) ? undefined : '结果图源无效'),
      sessionId: result.sessionId,
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
      assetSrc: task.resultImage,
      sourceType: task.resultImageSourceType,
      downloadSourceType: task.resultImage?.startsWith('data:') ? 'data_url' : 'src',
      sessionId: undefined,
      width: task.resultImageWidth,
      height: task.resultImageHeight,
      assetWidth: task.resultImageWidth,
      assetHeight: task.resultImageHeight,
      normalizationStatus: isValidResultImageAssetSrc(task.resultImageOriginal || task.resultImage) ? 'ok' : 'invalid_source',
      downloadStatus: isValidResultImageAssetSrc(task.resultImageOriginal || task.resultImage) ? 'ready' : 'invalid_source',
      downloadFailureStage: isValidResultImageAssetSrc(task.resultImageOriginal || task.resultImage) ? undefined : 'normalize',
      downloadFailureReason: isValidResultImageAssetSrc(task.resultImageOriginal || task.resultImage) ? undefined : '结果图源无效',
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
    activeResultSessionId: task.activeResultSessionId,
    progressStage: task.progressStage,
    resultImage: resultImages[0]?.src,
    resultImagePreview: resultImages[0]?.previewSrc,
    resultImageOriginal: resultImages[0]?.originalSrc || resultImages[0]?.src,
    resultImageSourceType: resultImages[0]?.sourceType,
    resultImageWidth: resultImages[0]?.assetWidth || resultImages[0]?.width,
    resultImageHeight: resultImages[0]?.assetHeight || resultImages[0]?.height,
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
        progressStage: undefined,
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

export function withDefaultSkill<T extends Partial<ProjectData> & { apiBaseUrl?: string }>(state: T) {
  const legacyApiKey = (state as T & { apiKey?: string }).apiKey || '';
  return {
    ...state,
    enablePromptOptimization: state.enablePromptOptimization !== false,
    cacheDirectoryName: state.cacheDirectoryName || '',
    globalSkillText: state.globalSkillText?.trim() ? state.globalSkillText : DEFAULT_SKILL_TEXT,
    skillFileName: state.skillFileName?.trim() ? state.skillFileName : DEFAULT_SKILL_FILE_NAME,
    globalImageQuality: state.globalImageQuality || 'auto',
    globalBatchCount: (state.globalBatchCount || 'x1') as BatchCount,
    generationLogs: state.generationLogs || [],
    textApiBaseUrl: state.textApiBaseUrl || state.apiBaseUrl,
    imageApiBaseUrl: state.imageApiBaseUrl || state.apiBaseUrl,
    imageApiPath: (state as T & { imageApiPath?: string }).imageApiPath || '',
    textApiKey: (state as T & { textApiKey?: string }).textApiKey || legacyApiKey,
    imageApiKey: (state as T & { imageApiKey?: string }).imageApiKey || legacyApiKey,
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
    activeResultSessionId: taskInfo.activeResultSessionId,
    progressStage: taskInfo.progressStage,
    requestedBatchCount: taskInfo.requestedBatchCount || taskInfo.batchCount || 'x1',
    failedResultCount: taskInfo.failedResultCount || 0,
    exportedResultIds: taskInfo.exportedResultIds || [],
  };
  return migrateTask(nextTask);
}
