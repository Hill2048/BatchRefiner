import type { BatchCount, Task, TaskResultImage } from '@/types';

export const BATCH_COUNT_OPTIONS: BatchCount[] = ['x1', 'x2', 'x3', 'x4'];

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

export function getPrimaryTaskResult(task: Task) {
  return getTaskResultImages(task)[0];
}

export function getTaskResultProgress(task: Task, globalBatchCount?: BatchCount) {
  const requestedBatchCount = task.requestedBatchCount || getEffectiveBatchCount(task, globalBatchCount);
  const requested = getBatchCountNumber(requestedBatchCount);
  const completed = getTaskResultImages(task).length;
  const failed = task.failedResultCount || 0;
  return { requestedBatchCount, requested, completed, failed };
}
