import type { BatchCount, Task, TaskResultImage } from '@/types';

export const BATCH_COUNT_OPTIONS: BatchCount[] = ['x1', 'x2', 'x3', 'x4'];

export interface TaskResultSessionGroup {
  sessionId: string;
  images: TaskResultImage[];
  createdAt: number;
}

export function getBatchCountNumber(batchCount?: BatchCount) {
  switch (batchCount) {
    case 'x4':
      return 4;
    case 'x3':
      return 3;
    case 'x2':
      return 2;
    default:
      return 1;
  }
}

export function getEffectiveBatchCount(task: Task, globalBatchCount?: BatchCount) {
  return task.batchCount || globalBatchCount || 'x1';
}

export function getTaskResultImages(task: Task): TaskResultImage[] {
  return task.resultImages || [];
}

export function getCurrentTaskResultImages(task: Task): TaskResultImage[] {
  const activeSessionId = task.activeResultSessionId;
  if (!activeSessionId) return [];
  return getTaskResultImages(task).filter((result) => result.sessionId === activeSessionId);
}

export function getHistoricalTaskResultImages(task: Task): TaskResultImage[] {
  const activeSessionId = task.activeResultSessionId;
  if (!activeSessionId) return getTaskResultImages(task);
  return getTaskResultImages(task).filter((result) => result.sessionId !== activeSessionId);
}

export function getHistoricalTaskResultGroups(task: Task): TaskResultSessionGroup[] {
  const groups = new Map<string, TaskResultImage[]>();

  getHistoricalTaskResultImages(task).forEach((image) => {
    const sessionId = image.sessionId || `legacy-${image.id}`;
    const existing = groups.get(sessionId) || [];
    existing.push(image);
    groups.set(sessionId, existing);
  });

  return Array.from(groups.entries())
    .map(([sessionId, images]) => ({
      sessionId,
      images: [...images].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)),
      createdAt: Math.max(...images.map((image) => image.createdAt || 0), 0),
    }))
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function getPrimaryTaskResult(task: Task) {
  return getCurrentTaskResultImages(task)[0];
}

export function getTaskResultProgress(task: Task, globalBatchCount?: BatchCount) {
  const requestedBatchCount = task.requestedBatchCount || getEffectiveBatchCount(task, globalBatchCount);
  const requested = getBatchCountNumber(requestedBatchCount);
  const completed = getCurrentTaskResultImages(task).length;
  const failed = task.failedResultCount || 0;
  return { requestedBatchCount, requested, completed, failed };
}
