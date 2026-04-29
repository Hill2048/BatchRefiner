export type TaskStatus = 'Idle' | 'Waiting' | 'Prompting' | 'Rendering' | 'Running' | 'Success' | 'Error';
export type AspectRatio = '1:1' | '16:9' | '9:16' | '4:3' | '3:4' | '2:3' | '3:2' | string;
export type Resolution = '1K' | '2K' | '4K' | string;
export type PlatformPreset = 'openai-compatible' | 'gemini-native' | 'comfly-chat' | 'yunwu' | 'custom';
export type BatchCount = 'x1' | 'x2' | 'x3' | 'x4';
export type ImageQuality = 'auto' | 'low' | 'medium' | 'high';
export type WorkspaceViewMode = 'grid' | 'list' | 'showcase' | 'results';
export type CardDensity = 'comfortable' | 'compact' | 'minimal';

export interface PlatformApiConfig {
  apiBaseUrl: string;
  textApiBaseUrl?: string;
  imageApiBaseUrl?: string;
  imageApiPath?: string;
  textToImageApiBaseUrl?: string;
  textToImageApiPath?: string;
  imageToImageApiBaseUrl?: string;
  imageToImageApiPath?: string;
  apiKey: string;
  textApiKey?: string;
  imageApiKey?: string;
  textToImageApiKey?: string;
  imageToImageApiKey?: string;
  textModel: string;
  imageModel: string;
  textToImageModel?: string;
  imageToImageModel?: string;
}

export type PlatformApiConfigMap = Record<PlatformPreset, PlatformApiConfig>;

export interface ApiConfigProfile {
  id: string;
  name: string;
  isActive: boolean;
  selectedPlatformPreset: PlatformPreset;
  platformConfigs: PlatformApiConfigMap;
  updatedAt: number;
}

export interface ErrorLog {
  message: string;
  time: number;
  stage?: string;
}

export type GenerationLogLevel = 'debug' | 'info' | 'warn' | 'error';
export type GenerationLogStage = 'prepare' | 'prompt' | 'image' | 'download' | 'export' | 'writeback';
export type GenerationLogMode = 'prompt-preview' | 'prompt-batch' | 'image-single' | 'image-batch' | 'all-batch';
export type GenerationLogStatus = 'running' | 'success' | 'partial_success' | 'error' | 'halted';

export interface GenerationLogEvent {
  id: string;
  time: number;
  level: GenerationLogLevel;
  stage: GenerationLogStage;
  event: string;
  message: string;
  data?: Record<string, unknown>;
}

export interface GenerationLogSummary {
  promptGenerated?: boolean;
  promptLength?: number;
  resultCount?: number;
  failedCount?: number;
  requestCount?: number;
  lastStage?: string;
  errorMessage?: string;
}

export interface GenerationLogSession {
  id: string;
  triggerId?: string;
  createdAt: number;
  finishedAt?: number;
  taskId?: string;
  taskIndex?: number;
  taskTitle?: string;
  mode: GenerationLogMode;
  status: GenerationLogStatus;
  attemptCount: number;
  events: GenerationLogEvent[];
  summary?: GenerationLogSummary;
}

export interface TaskResultImage {
  id: string;
  src: string;
  previewSrc?: string;
  originalSrc?: string;
  assetId?: string;
  assetSrc?: string;
  assetStorageStatus?: 'stored' | 'skipped' | 'failed';
  sourceType?: 'preview' | 'original' | 'base64';
  downloadSourceType?: 'original' | 'src' | 'data_url' | 'asset';
  downloadCacheStatus?: 'primed' | 'miss' | 'failed';
  normalizationStatus?: 'ok' | 'invalid_source' | 'download_unreachable';
  downloadStatus?: 'ready' | 'fetch_failed' | 'cache_failed' | 'save_failed' | 'invalid_source';
  downloadFailureStage?: 'normalize' | 'fetch' | 'cache' | 'save';
  downloadFailureReason?: string;
  assetMimeType?: string;
  assetExtension?: string;
  assetSize?: number;
  sessionId?: string;
  width?: number;
  height?: number;
  assetWidth?: number;
  assetHeight?: number;
  requestedWidth?: number;
  requestedHeight?: number;
  generationTimeMs?: number;
  createdAt: number;
}

export interface Task {
  id: string;
  index: number;
  title: string;
  description: string;
  sourceImage?: string;
  sourceImagePreview?: string;
  sourceImageAssetId?: string;
  referenceImages: string[];
  referenceImageAssetIds?: string[];
  promptText?: string;
  promptInputSignature?: string;
  imageModelOverride?: string;
  resultImage?: string;
  resultImagePreview?: string;
  resultImageOriginal?: string;
  resultImageSourceType?: 'preview' | 'original' | 'base64';
  resultImages?: TaskResultImage[];
  promptSource?: 'auto' | 'manual';
  lastUsedImageModel?: string;
  resultImageWidth?: number;
  resultImageHeight?: number;
  activeResultSessionId?: string;
  batchCount?: BatchCount;
  requestedBatchCount?: BatchCount;
  failedResultCount?: number;
  exportedResultIds?: string[];
  status: TaskStatus;
  progressStage?: string;
  errorLog?: ErrorLog;
  exported?: boolean;
  aspectRatio?: AspectRatio;
  resolution?: Resolution;
  imageQuality?: ImageQuality;
  createdAt: number;
  updatedAt: number;
}

export interface ProjectData {
  projectId: string;
  projectName: string;
  platformPreset: PlatformPreset;
  apiConfigProfiles: ApiConfigProfile[];
  downloadDirectoryName?: string;
  cacheDirectoryName?: string;
  enablePromptOptimization?: boolean;
  globalSkillText: string;
  globalTargetText: string;
  globalReferenceImages: string[];
  skillFileName: string;
  imageModel: string;
  textModel: string;
  textApiBaseUrl?: string;
  imageApiBaseUrl?: string;
  imageApiPath?: string;
  textToImageApiBaseUrl?: string;
  textToImageApiPath?: string;
  imageToImageApiBaseUrl?: string;
  imageToImageApiPath?: string;
  textToImageApiKey?: string;
  imageToImageApiKey?: string;
  textToImageModel?: string;
  imageToImageModel?: string;
  globalAspectRatio?: AspectRatio;
  globalResolution?: Resolution;
  globalImageQuality?: ImageQuality;
  globalBatchCount?: BatchCount;
  cardDensity?: CardDensity;
  generationLogs: GenerationLogSession[];
  createdAt: number;
  updatedAt: number;
  tasks: Task[];
}
