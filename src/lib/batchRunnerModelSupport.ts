import { AspectRatio, PlatformPreset, Resolution } from '@/types';

const GEMINI_NATIVE_IMAGE_INPUT_MODELS = [
  'gemini-2.0-flash-preview-image-generation',
  'gemini-3.1-flash-image-preview',
  'gemini-2.5-flash-image',
  'gemini-3-pro-image-preview',
];

const GEMINI_NATIVE_HARD_RESOLUTION_MODELS = [
  'imagen-3.0-generate-001',
  'imagen-3.0-generate-002',
  'imagen-4.0-generate-preview',
];

const GEMINI_SUPPORTED_ASPECT_RATIOS = new Set(['1:1', '5:4', '4:3', '3:2', '16:9', '9:16']);

export type ResolutionSupport = 'hard' | 'soft' | 'none';

export interface ResolvedModelInfo {
  requestedModel: string;
  actualModel: string;
  resolutionSupport: ResolutionSupport;
}

export function createStageError(message: string, stage: string) {
  const error = new Error(message);
  (error as Error & { stage?: string }).stage = stage;
  return error;
}

export function getNormalizedModelName(model?: string) {
  return (model || '').trim().toLowerCase();
}

export function isGptImageModel(model?: string) {
  const normalized = getNormalizedModelName(model);
  return normalized.startsWith('gpt-image') || normalized === 'image2';
}

export function isComflyResponsesImageModel(model?: string, platformPreset?: PlatformPreset) {
  if (platformPreset !== 'comfly-chat') return false;
  const normalized = getNormalizedModelName(model);
  return normalized === 'gpt-image-2' || normalized === 'image2';
}

export function normalizeComflyImageModelAlias(modelName: string) {
  const normalized = getNormalizedModelName(modelName);
  if (normalized === 'image2') return 'gpt-image-2';
  return modelName;
}

export function normalizeResolution(value?: Resolution) {
  return (value || '1K').toUpperCase();
}

export function normalizeAspectRatio(value?: AspectRatio) {
  return (value || 'auto').trim();
}

function getComflyModelResolutionSupport(modelName: string, resolution: string): ResolutionSupport {
  const normalized = getNormalizedModelName(normalizeComflyImageModelAlias(modelName));

  if (normalized.startsWith('gemini-3.1-flash-image-preview')) {
    return resolution === '1K' || resolution === '2K' || resolution === '4K' ? 'hard' : 'soft';
  }

  if (normalized.startsWith('nano-banana-pro')) {
    return resolution === '1K' || resolution === '2K' ? 'hard' : 'none';
  }

  if (normalized === 'banana2' || normalized === 'banana-pro' || normalized === 'bananapro') {
    return resolution === '1K' || resolution === '2K' || resolution === '4K' ? 'hard' : 'soft';
  }

  if (normalized === 'gpt-image-2') {
    return 'hard';
  }

  return 'soft';
}

function resolveComflyImageModel(modelName: string, resolution: string) {
  const canonicalModelName = normalizeComflyImageModelAlias(modelName);
  const normalized = getNormalizedModelName(canonicalModelName);

  if (normalized.startsWith('gemini-3.1-flash-image-preview')) {
    if (resolution === '2K') return 'gemini-3.1-flash-image-preview-2k';
    if (resolution === '4K') return 'gemini-3.1-flash-image-preview-4k';
    if (resolution === '512PX') return 'gemini-3.1-flash-image-preview-512px';
    return 'gemini-3.1-flash-image-preview';
  }

  if (normalized.startsWith('nano-banana-pro')) {
    if (resolution === '2K') return 'nano-banana-pro-2k';
    if (resolution === '4K') {
      throw createStageError(
        'comfly.chat 当前没有 nano-banana-pro 的 4K 模型，请改用 2K 或切换到 gemini-3.1-flash-image-preview 系列。',
        'Image Generation',
      );
    }
    return 'nano-banana-pro';
  }

  return canonicalModelName;
}

export function resolveImageModel(modelName: string, resolution: string, platformPreset: PlatformPreset): ResolvedModelInfo {
  if (platformPreset === 'comfly-chat') {
    const actualModel = resolveComflyImageModel(modelName, resolution);
    return {
      requestedModel: modelName,
      actualModel,
      resolutionSupport: getComflyModelResolutionSupport(actualModel, resolution),
    };
  }

  if (platformPreset === 'yunwu') {
    const normalized = getNormalizedModelName(modelName);
    if (normalized.startsWith('gemini-3.1-flash-image-preview') || normalized.startsWith('gemini-3-pro-image-preview')) {
      return { requestedModel: modelName, actualModel: modelName, resolutionSupport: 'hard' };
    }
    return { requestedModel: modelName, actualModel: modelName, resolutionSupport: 'soft' };
  }

  const normalized = getNormalizedModelName(modelName);
  if (GEMINI_NATIVE_HARD_RESOLUTION_MODELS.includes(normalized)) {
    return { requestedModel: modelName, actualModel: modelName, resolutionSupport: 'hard' };
  }

  if (isGptImageModel(normalized) || normalized.startsWith('dall-e')) {
    return { requestedModel: modelName, actualModel: modelName, resolutionSupport: 'hard' };
  }

  return { requestedModel: modelName, actualModel: modelName, resolutionSupport: 'soft' };
}

export function supportsImageInput(modelName: string, apiBaseUrl: string, apiKey: string, platformPreset: PlatformPreset) {
  const normalizedModel = getNormalizedModelName(modelName);

  if (platformPreset === 'comfly-chat') {
    return normalizedModel.includes('gemini') || normalizedModel.includes('banana') || normalizedModel.includes('gpt-image') || normalizedModel === 'image2';
  }

  if (platformPreset === 'yunwu') {
    return normalizedModel.includes('gemini');
  }

  const isCustomOpenAI = Boolean(apiBaseUrl && apiKey);
  if (isCustomOpenAI) {
    return isGptImageModel(normalizedModel) || normalizedModel.includes('banana') || normalizedModel.includes('gemini');
  }

  return GEMINI_NATIVE_IMAGE_INPUT_MODELS.includes(normalizedModel);
}

export function getGeminiAspectRatio(aspectRatio: string) {
  return GEMINI_SUPPORTED_ASPECT_RATIOS.has(aspectRatio) ? aspectRatio : undefined;
}

export function getGeminiImageSize(resolution: string) {
  switch (resolution) {
    case '4K':
      return '4K';
    case '2K':
      return '2K';
    default:
      return '1K';
  }
}

function getOpenAIImageSize(aspectRatio: string) {
  if (aspectRatio === '9:16' || aspectRatio === '3:4' || aspectRatio === '2:3' || aspectRatio === '1:4' || aspectRatio === '1:8') {
    return '1024x1536';
  }
  if (aspectRatio === '16:9' || aspectRatio === '4:3' || aspectRatio === '3:2' || aspectRatio === '4:1' || aspectRatio === '8:1' || aspectRatio === '21:9') {
    return '1536x1024';
  }
  return '1024x1024';
}

function parseAspectRatioValue(aspectRatio: string) {
  if (!aspectRatio || aspectRatio === 'auto') return 1;
  const parts = aspectRatio.split(':');
  if (parts.length !== 2) return 1;
  const width = Number(parts[0]);
  const height = Number(parts[1]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return 1;
  return width / height;
}

function clampImage2AspectRatio(aspectRatio: string) {
  const ratio = parseAspectRatioValue(aspectRatio);
  return Math.min(3, Math.max(1 / 3, ratio));
}

function roundToMultipleOf16(value: number) {
  return Math.max(16, Math.round(value / 16) * 16);
}

function floorToMultipleOf16(value: number) {
  return Math.max(16, Math.floor(value / 16) * 16);
}

function getImage2TargetPixels(resolution: string) {
  switch (resolution) {
    case '4K':
      return 8_294_400;
    case '2K':
      return 2_359_296;
    default:
      return 1_048_576;
  }
}

function getImage2ImageSize(aspectRatio: string, resolution: string) {
  const targetPixels = getImage2TargetPixels(resolution);
  const ratio = clampImage2AspectRatio(aspectRatio);
  let width = Math.sqrt(targetPixels * ratio);
  let height = width / ratio;

  width = roundToMultipleOf16(width);
  height = roundToMultipleOf16(height);

  const longestEdge = Math.max(width, height);
  if (longestEdge > 4000) {
    const scale = 4000 / longestEdge;
    width = floorToMultipleOf16(width * scale);
    height = floorToMultipleOf16(height * scale);
  }

  let pixels = width * height;
  if (pixels < 655_360) {
    const scale = Math.sqrt(655_360 / pixels);
    width = roundToMultipleOf16(width * scale);
    height = roundToMultipleOf16(height * scale);
    if (Math.max(width, height) > 4000) {
      const retryScale = 4000 / Math.max(width, height);
      width = floorToMultipleOf16(width * retryScale);
      height = floorToMultipleOf16(height * retryScale);
    }
    pixels = width * height;
  }

  if (pixels > 8_294_400) {
    const scale = Math.sqrt(8_294_400 / pixels);
    width = floorToMultipleOf16(width * scale);
    height = floorToMultipleOf16(height * scale);
  }

  return `${width}x${height}`;
}

function parseCustomImageSize(resolution: string) {
  const match = String(resolution || '').trim().match(/^(\d+)x(\d+)$/i);
  if (!match) return null;

  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isInteger(width) || !Number.isInteger(height)) return null;
  if (width <= 0 || height <= 0) return null;
  if (width % 16 !== 0 || height % 16 !== 0) return null;
  if (width > 4000 || height > 4000) return null;

  const ratio = Math.max(width / height, height / width);
  if (ratio > 3) return null;

  const pixels = width * height;
  if (pixels < 655_360 || pixels > 8_294_400) return null;

  return `${width}x${height}`;
}

function isExactImage2Size(resolution: string) {
  return Boolean(parseCustomImageSize(resolution));
}

export function getRequestedImageSize(modelName: string, aspectRatio: string, resolution: string) {
  if (isComflyResponsesImageModel(modelName, 'comfly-chat') || getNormalizedModelName(modelName) === 'gpt-image-2') {
    return parseCustomImageSize(resolution) || getImage2ImageSize(aspectRatio, resolution);
  }

  return getOpenAIImageSize(aspectRatio);
}

export function buildComflyResolutionFields(modelName: string, resolution: string, aspectRatio: string) {
  const payload: Record<string, string> = { model: modelName };

  if (isComflyResponsesImageModel(modelName, 'comfly-chat')) {
    payload.size = getRequestedImageSize(modelName, aspectRatio, resolution);
    return payload;
  }

  if (modelName.includes('banana')) {
    payload.resolution = resolution;
    payload.size = resolution;
  }

  if (aspectRatio !== 'auto') {
    payload.aspect_ratio = aspectRatio;
  }

  return payload;
}

export function normalizeGeminiBaseUrl(baseUrl: string) {
  const normalized = baseUrl.replace(/\/+$/, '');
  if (normalized.endsWith('/v1')) return normalized.replace(/\/v1$/, '/v1beta');
  if (normalized.endsWith('/v1beta')) return normalized;
  return `${normalized}/v1beta`;
}

export function buildGeminiGatewayHeaders(apiKey: string) {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  };
}
