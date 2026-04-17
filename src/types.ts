export type TaskStatus = 'Idle' | 'Waiting' | 'Prompting' | 'Rendering' | 'Success' | 'Error';

export type Resolution = '1K' | '2K' | '4K';
export type AspectRatio = 'auto' | '1:1' | '9:16' | '16:9' | '3:4' | '4:3' | '3:2' | '2:3' | '4:5' | '5:4' | '8:1' | '1:8' | '4:1' | '1:4' | '21:9';

export interface ErrorLog {
  stage: string;
  message: string;
  detail?: string;
  createdAt: number;
  retryCount: number;
}

export interface Task {
  id: string;
  index: number;
  title: string;
  description: string;
  sourceImage?: string;
  referenceImages: string[];
  promptText?: string;
  promptSource?: 'auto' | 'manual';
  status: TaskStatus;
  resultImage?: string;
  errorLog?: ErrorLog;
  aspectRatio?: AspectRatio;
  resolution?: Resolution;
  exported?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface ProjectData {
  projectId: string;
  projectName: string;
  globalSkillText: string;
  globalTargetText: string;
  globalReferenceImages: string[];
  globalAspectRatio?: AspectRatio;
  globalResolution?: Resolution;
  skillFileName?: string;
  imageModel: string;
  textModel: string;
  createdAt: number;
  updatedAt: number;
  tasks: Task[];
}
