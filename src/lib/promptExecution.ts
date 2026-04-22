import type { Task } from '@/types';

export function isPromptOptimizationEnabled(enablePromptOptimization?: boolean) {
  return enablePromptOptimization !== false;
}

export function getExecutablePromptText(task: Pick<Task, 'promptText' | 'description'>) {
  const promptText = task.promptText?.trim();
  if (promptText) return promptText;

  const description = task.description?.trim();
  if (description) return description;

  return null;
}
