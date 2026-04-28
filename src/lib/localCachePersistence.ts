import { useAppStore } from '@/store';
import type { ProjectData, Task, TaskResultImage } from '@/types';
import { buildProjectExportPayload } from './projectSnapshot';
import { writeCacheText, writeCacheTextWithPermission } from './cacheDirectory';
import { markProjectCacheSaved } from './projectSafetyStatus';

const LOCAL_CACHE_AUTOSAVE_INTERVAL_MS = 5 * 60 * 1000;
const LARGE_DATA_URL_LENGTH = 240_000;

let autoSaveTimer: number | null = null;
let isSavingSnapshot = false;

function isLargeDataUrl(value?: string | null) {
  return Boolean(value?.startsWith('data:image/') && value.length > LARGE_DATA_URL_LENGTH);
}

function compactResultImageForLocalCache(result: TaskResultImage): TaskResultImage {
  if (!result.assetId) return result;

  const displaySrc = isLargeDataUrl(result.src) ? result.previewSrc || '' : result.src;
  return {
    ...result,
    src: displaySrc,
    previewSrc: result.previewSrc && !isLargeDataUrl(result.previewSrc) ? result.previewSrc : displaySrc,
    originalSrc: undefined,
    assetSrc: undefined,
  };
}

function compactTaskForLocalCache(task: Task): Task {
  const nextTask: Task = {
    ...task,
    resultImages: task.resultImages?.map(compactResultImageForLocalCache) || [],
  };

  const primaryResult = nextTask.resultImages?.[0];
  nextTask.resultImage = primaryResult?.src;
  nextTask.resultImagePreview = primaryResult?.previewSrc;
  nextTask.resultImageOriginal = undefined;
  return nextTask;
}

function buildLocalCacheProjectSnapshot(): ProjectData {
  const state = useAppStore.getState();
  return {
    projectId: state.projectId,
    projectName: state.projectName,
    platformPreset: state.platformPreset,
    downloadDirectoryName: state.downloadDirectoryName,
    cacheDirectoryName: state.cacheDirectoryName,
    enablePromptOptimization: state.enablePromptOptimization,
    globalSkillText: state.globalSkillText,
    globalTargetText: state.globalTargetText,
    globalReferenceImages: state.globalReferenceImages,
    skillFileName: state.skillFileName,
    imageModel: state.imageModel,
    textModel: state.textModel,
    textApiBaseUrl: state.textApiBaseUrl,
    imageApiBaseUrl: state.imageApiBaseUrl,
    imageApiPath: state.imageApiPath,
    globalAspectRatio: state.globalAspectRatio,
    globalResolution: state.globalResolution,
    globalImageQuality: state.globalImageQuality,
    globalBatchCount: state.globalBatchCount,
    generationLogs: state.generationLogs,
    createdAt: state.createdAt,
    updatedAt: state.updatedAt,
    tasks: state.tasks.map(compactTaskForLocalCache),
  };
}

export async function saveLocalCacheSnapshot(options: { requestPermission?: boolean } = {}) {
  if (isSavingSnapshot) return false;
  isSavingSnapshot = true;

  try {
    const payload = buildProjectExportPayload(buildLocalCacheProjectSnapshot());
    const content = JSON.stringify(payload, null, 2);
    const saved = options.requestPermission
      ? await writeCacheTextWithPermission('project-autosave.json', content)
      : await writeCacheText('project-autosave.json', content);
    if (saved) {
      const state = useAppStore.getState();
      markProjectCacheSaved(state.projectId, state.updatedAt);
    }
    return saved;
  } catch {
    return false;
  } finally {
    isSavingSnapshot = false;
  }
}

export function startLocalCacheAutoSave() {
  if (autoSaveTimer || typeof window === 'undefined') {
    return () => {};
  }

  autoSaveTimer = window.setInterval(() => {
    void saveLocalCacheSnapshot();
  }, LOCAL_CACHE_AUTOSAVE_INTERVAL_MS);

  return () => {
    if (!autoSaveTimer) return;
    window.clearInterval(autoSaveTimer);
    autoSaveTimer = null;
  };
}
