import type { Task } from "@/types";

const DEFAULT_TEXT_TO_IMAGE_API_PATH = "/v1/images/generations";
const DEFAULT_IMAGE_TO_IMAGE_API_PATH = "/v1/images/edits";

export interface SuccessfulPromptRecord {
  index: number;
  title: string;
  promptText: string;
  imageModel?: string;
  updatedAt: number;
}

export interface ProjectExportPayload<T extends Record<string, any>> {
  format: "batch-refiner-project-export";
  version: 1;
  exportedAt: string;
  project: T;
  successfulPrompts: SuccessfulPromptRecord[];
}

export function sanitizeProjectSnapshot<T extends Record<string, any>>(state: T) {
  const nextState = { ...state };
  delete nextState.apiKey;
  delete nextState.textApiKey;
  delete nextState.imageApiKey;
  delete nextState.textToImageApiKey;
  delete nextState.imageToImageApiKey;
  delete nextState.apiBaseUrl;
  delete nextState.textApiBaseUrl;
  delete nextState.imageApiBaseUrl;
  delete nextState.imageApiPath;
  delete nextState.textToImageApiBaseUrl;
  delete nextState.textToImageApiPath;
  delete nextState.imageToImageApiBaseUrl;
  delete nextState.imageToImageApiPath;
  return nextState;
}

export function mergeProjectSnapshotWithGlobalConfig<T extends Record<string, any>, U extends Record<string, any>>(
  projectState: T,
  globalState: U
) {
  return {
    ...projectState,
    apiKey: globalState.apiKey || "",
    textApiKey: globalState.textApiKey || globalState.apiKey || "",
    imageApiKey: globalState.imageApiKey || globalState.apiKey || "",
    textToImageApiKey: globalState.textToImageApiKey || "",
    imageToImageApiKey: globalState.imageToImageApiKey || "",
    apiBaseUrl: globalState.apiBaseUrl || "",
    textApiBaseUrl: globalState.textApiBaseUrl || globalState.apiBaseUrl || "",
    imageApiBaseUrl: globalState.imageApiBaseUrl || globalState.apiBaseUrl || "",
    imageApiPath: globalState.imageApiPath || "",
    textToImageApiBaseUrl: globalState.textToImageApiBaseUrl || "",
    textToImageApiPath: globalState.textToImageApiPath || globalState.imageApiPath || DEFAULT_TEXT_TO_IMAGE_API_PATH,
    imageToImageApiBaseUrl: globalState.imageToImageApiBaseUrl || "",
    imageToImageApiPath: globalState.imageToImageApiPath || globalState.imageApiPath || DEFAULT_IMAGE_TO_IMAGE_API_PATH,
  };
}

export function collectSuccessfulPrompts(tasks: Task[]): SuccessfulPromptRecord[] {
  return tasks
    .filter((task) => task.status === "Success" && task.promptText?.trim())
    .map((task) => ({
      index: task.index,
      title: task.title,
      promptText: task.promptText!.trim(),
      imageModel: task.lastUsedImageModel,
      updatedAt: task.updatedAt,
    }));
}

export function buildProjectExportPayload<T extends Record<string, any>>(state: T): ProjectExportPayload<T> {
  const sanitizedProject = sanitizeProjectSnapshot(state);
  return {
    format: "batch-refiner-project-export",
    version: 1,
    exportedAt: new Date().toISOString(),
    project: sanitizedProject,
    successfulPrompts: collectSuccessfulPrompts((sanitizedProject.tasks || []) as Task[]),
  };
}

export function extractProjectDataFromImport(input: Record<string, any>) {
  if (input?.format === "batch-refiner-project-export" && input?.project) {
    return input.project as Record<string, any>;
  }
  return input;
}
