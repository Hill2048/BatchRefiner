import type { Task, TaskResultImage } from '@/types';
import { getResultImageAssetDimensions } from './resultImageAsset';

function sanitizeFileName(value: string) {
  return value
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || 'untitled';
}

function formatDateForFileName(time = Date.now()) {
  const date = new Date(time);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
}

export function buildResultImageFileName(options: {
  task: Task;
  imageIndex: number;
  extension?: string;
  template?: string;
  model?: string;
  result?: TaskResultImage;
}) {
  const { task, imageIndex, result } = options;
  const normalizedExtension = (options.extension || 'jpg').replace(/^\./, '') || 'jpg';
  const dimensions = result ? getResultImageAssetDimensions(result) : null;
  const replacements: Record<string, string> = {
    task_id: String(task.index).padStart(3, '0'),
    index: String(task.index).padStart(3, '0'),
    batch: `x${imageIndex + 1}`,
    title: task.title || `task-${task.index}`,
    model: options.model || task.lastUsedImageModel || task.imageModelOverride || 'model',
    size: dimensions ? `${dimensions.width}x${dimensions.height}` : 'auto',
    ratio: task.aspectRatio || 'auto',
    status: task.status,
    time: formatDateForFileName(result?.createdAt),
  };
  const template = options.template?.trim() || '{task_id}_{title}_{batch}';
  const name = template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key: string) => replacements[key] || '');
  return `${sanitizeFileName(name)}.${normalizedExtension}`;
}

export function getTaskBatchFileName(taskIndex: number, batchIndex: number, extension = 'jpg') {
  const normalizedExtension = extension.replace(/^\./, '') || 'jpg';
  return `${String(taskIndex).padStart(3, '0')}_x${batchIndex + 1}.${normalizedExtension}`;
}
