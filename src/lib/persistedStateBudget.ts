import type { Task, TaskResultImage } from '@/types';

export const MAX_PERSISTED_STATE_LENGTH = 12 * 1024 * 1024;
const SOFT_DATA_URL_COMPACTION_LENGTH = 2 * 1024 * 1024;
const MAX_SOURCE_IMAGE_PREVIEW_LENGTH = 360_000;
export const OVERSIZED_PERSISTENCE_NOTICE =
  '检测到上次保存的项目过大，已自动清理图片数据以避免页面闪退。任务文字仍会保留。';

type PersistedStateShape = {
  tasks?: Task[];
  globalReferenceImages?: string[];
};

type PersistEnvelope = {
  state?: PersistedStateShape;
  version?: number;
};

type PersistCompactionResult = {
  value: string;
  compacted: boolean;
};

function isImageDataUrl(value?: string | null) {
  return Boolean(value?.startsWith('data:image/'));
}

function keepCompactImagePreview(value?: string) {
  if (!isImageDataUrl(value)) return value;
  return value.length <= MAX_SOURCE_IMAGE_PREVIEW_LENGTH ? value : undefined;
}

function stripResultImageBinaryPayload(image: TaskResultImage, aggressive: boolean): TaskResultImage {
  const shouldStripSrc = isImageDataUrl(image.src) && (aggressive || Boolean(image.assetId));
  const displaySrc = shouldStripSrc ? image.previewSrc || '' : image.src;
  return {
    ...image,
    src: displaySrc,
    previewSrc: image.previewSrc && (!isImageDataUrl(image.previewSrc) || !shouldStripSrc) ? image.previewSrc : displaySrc,
    originalSrc: isImageDataUrl(image.originalSrc) && (aggressive || Boolean(image.assetId)) ? undefined : image.originalSrc,
    assetSrc: isImageDataUrl(image.assetSrc) && (aggressive || Boolean(image.assetId)) ? undefined : image.assetSrc,
  };
}

function stripTaskBinaryPayload(task: Task, aggressive: boolean): Task {
  const resultImages = (task.resultImages || []).map((image) => stripResultImageBinaryPayload(image, aggressive));
  const primaryResult = resultImages[0];
  const shouldStripSource = isImageDataUrl(task.sourceImage) && (aggressive || Boolean(task.sourceImageAssetId));

  return {
    ...task,
    sourceImage: shouldStripSource ? undefined : task.sourceImage,
    sourceImagePreview: keepCompactImagePreview(task.sourceImagePreview),
    referenceImages: aggressive ? [] : task.referenceImages,
    resultImage: primaryResult?.src || undefined,
    resultImagePreview: primaryResult?.previewSrc || undefined,
    resultImageOriginal: primaryResult?.originalSrc,
    resultImageSourceType: primaryResult?.sourceType,
    resultImageWidth: primaryResult?.assetWidth || primaryResult?.width,
    resultImageHeight: primaryResult?.assetHeight || primaryResult?.height,
    resultImages,
  };
}

function compactState(state: PersistedStateShape, aggressive: boolean): PersistedStateShape {
  return {
    ...state,
    globalReferenceImages: aggressive ? [] : state.globalReferenceImages,
    tasks: Array.isArray(state.tasks) ? state.tasks.map((task) => stripTaskBinaryPayload(task, aggressive)) : state.tasks,
  };
}

export function compactPersistedStateValue(
  rawValue: string,
  maxLength = MAX_PERSISTED_STATE_LENGTH,
): PersistCompactionResult {
  const aggressive = rawValue.length > maxLength;
  const shouldSoftCompact = rawValue.length > SOFT_DATA_URL_COMPACTION_LENGTH && rawValue.includes('data:image/');

  if (!aggressive && !shouldSoftCompact) {
    return { value: rawValue, compacted: false };
  }

  try {
    const parsed = JSON.parse(rawValue) as PersistEnvelope | PersistedStateShape;
    const hasEnvelope = typeof parsed === 'object' && parsed !== null && 'state' in parsed;
    const currentState = (hasEnvelope ? (parsed as PersistEnvelope).state : parsed) as PersistedStateShape | undefined;

    if (!currentState || typeof currentState !== 'object') {
      return { value: rawValue, compacted: false };
    }

    const compactedState = compactState(currentState, aggressive);
    const nextValue = hasEnvelope
      ? JSON.stringify({ ...(parsed as PersistEnvelope), state: compactedState })
      : JSON.stringify(compactedState);

    if (nextValue.length >= rawValue.length) {
      return { value: rawValue, compacted: false };
    }

    return { value: nextValue, compacted: true };
  } catch {
    return { value: rawValue, compacted: false };
  }
}
