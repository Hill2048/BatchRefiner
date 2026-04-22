import type { Task } from '@/types';
import { getCurrentTaskResultImages, getPrimaryTaskResult } from './taskResults';

export type TaskViewerMode = 'result' | 'source';

export interface TaskViewerItem {
  id: string;
  src: string;
  type: 'source' | 'result';
  resultIndex?: number;
}

export function getTaskViewerItems(task: Task): TaskViewerItem[] {
  return [
    ...(task.sourceImage ? [{ id: 'source', src: task.sourceImage, type: 'source' as const }] : []),
    ...getCurrentTaskResultImages(task).map((result, index) => ({
      id: result.id,
      src: result.src,
      type: 'result' as const,
      resultIndex: index,
    })),
  ];
}

export function getTaskViewerMainImage(task: Task, viewerMode: TaskViewerMode, selectedResultIndex: number) {
  if (viewerMode === 'source') {
    return task.sourceImage;
  }
  return getCurrentTaskResultImages(task)[selectedResultIndex]?.src || getPrimaryTaskResult(task)?.src;
}
