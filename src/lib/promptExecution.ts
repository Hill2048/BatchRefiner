import type { Task } from '@/types';

export function isPromptOptimizationEnabled(enablePromptOptimization?: boolean) {
  return enablePromptOptimization !== false;
}

export function getPreparedPromptText(
  task: Pick<Task, 'promptText' | 'description'>,
  enablePromptOptimization?: boolean
) {
  const promptText = task.promptText?.trim();
  if (promptText) return promptText;

  if (isPromptOptimizationEnabled(enablePromptOptimization)) {
    return null;
  }

  const description = task.description?.trim();
  if (description) return description;

  return null;
}

export function getExecutablePromptText(task: Pick<Task, 'promptText' | 'description'>) {
  const promptText = task.promptText?.trim();
  if (promptText) return promptText;

  const description = task.description?.trim();
  if (description) return description;

  return null;
}
