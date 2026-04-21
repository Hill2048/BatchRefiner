import type { Task } from "@/types";

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
  delete nextState.apiBaseUrl;
  return nextState;
}

export function mergeProjectSnapshotWithGlobalConfig<T extends Record<string, any>, U extends Record<string, any>>(
  projectState: T,
  globalState: U
) {
  return {
    ...projectState,
    apiKey: globalState.apiKey || "",
    apiBaseUrl: globalState.apiBaseUrl || "",
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
