export type TaskStatus = 'Idle' | 'Waiting' | 'Prompting' | 'Rendering' | 'Running' | 'Success' | 'Error';
export type AspectRatio = '1:1' | '16:9' | '9:16' | '4:3' | '3:4' | '2:3' | '3:2' | string;
export type Resolution = '1K' | '2K' | '4K' | string;
export type PlatformPreset = 'openai-compatible' | 'gemini-native' | 'comfly-chat' | 'yunwu' | 'custom';
export type BatchCount = 'x1' | 'x2' | 'x3' | 'x4';

export interface PlatformApiConfig {
  apiBaseUrl: string;
  apiKey: string;
  textModel: string;
  imageModel: string;
}

export type PlatformApiConfigMap = Record<PlatformPreset, PlatformApiConfig>;

export interface ErrorLog {
  message: string;
  time: number;
  stage?: string;
}

export interface TaskResultImage {
  id: string;
  src: string;
  previewSrc?: string;
  originalSrc?: string;
  sourceType?: 'preview' | 'original' | 'base64';
  width?: number;
  height?: number;
  createdAt: number;
}

export interface Task {
  id: string;
  index: number;
  title: string;
  description: string;
  sourceImage?: string;
  referenceImages: string[];
  promptText?: string;
  resultImage?: string;
  resultImagePreview?: string;
  resultImageOriginal?: string;
  resultImageSourceType?: 'preview' | 'original' | 'base64';
  resultImages?: TaskResultImage[];
  promptSource?: 'auto' | 'manual';
  lastUsedImageModel?: string;
  resultImageWidth?: number;
  resultImageHeight?: number;
  batchCount?: BatchCount;
  requestedBatchCount?: BatchCount;
  failedResultCount?: number;
  exportedResultIds?: string[];
  status: TaskStatus;
  errorLog?: ErrorLog;
  exported?: boolean;
  aspectRatio?: AspectRatio;
  resolution?: Resolution;
  createdAt: number;
  updatedAt: number;
}

export interface ProjectData {
  projectId: string;
  projectName: string;
  platformPreset: PlatformPreset;
  downloadDirectoryName?: string;
  globalSkillText: string;
  globalTargetText: string;
  globalReferenceImages: string[];
  skillFileName: string;
  imageModel: string;
  textModel: string;
  globalAspectRatio?: AspectRatio;
  globalResolution?: Resolution;
  globalBatchCount?: BatchCount;
  createdAt: number;
  updatedAt: number;
  tasks: Task[];
}
