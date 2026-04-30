import type { Task } from '@/types';

export function buildDuplicatedTask(
  task: Task,
  nextIndex: number,
): Omit<Task, 'id' | 'createdAt' | 'updatedAt' | 'status'> {
  return {
    index: nextIndex,
    title: task.title,
    description: task.description,
    sourceImage: task.sourceImage,
    sourceImagePreview: task.sourceImagePreview,
    sourceImageAssetId: task.sourceImageAssetId,
    referenceImages: [...(task.referenceImages || [])],
    referenceImageAssetIds: task.referenceImageAssetIds ? [...task.referenceImageAssetIds] : undefined,
    promptText: task.promptText,
    promptInputSignature: task.promptInputSignature,
    imageModelOverride: task.imageModelOverride,
    promptSource: task.promptSource,
    aspectRatio: task.aspectRatio,
    resolution: task.resolution,
    imageQuality: task.imageQuality,
    batchCount: task.batchCount,
    requestedBatchCount: task.requestedBatchCount || task.batchCount,
  };
}
