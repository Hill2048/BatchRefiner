export const DEFAULT_TASK_CONCURRENCY = 3;
export const MIN_TASK_CONCURRENCY = 1;
export const MAX_TASK_CONCURRENCY = 10;
export const DEFAULT_SINGLE_TASK_IMAGE_CONCURRENCY = 4;
export const SINGLE_TASK_IMAGE_CONCURRENCY_OPTIONS = [1, 2, 4] as const;

export function normalizeTaskConcurrency(
  value: number | null | undefined,
  fallback = DEFAULT_TASK_CONCURRENCY,
) {
  const normalizedFallback = Number.isFinite(fallback)
    ? Math.trunc(fallback)
    : DEFAULT_TASK_CONCURRENCY;
  const parsedValue = Number.isFinite(value) ? Math.trunc(value) : normalizedFallback;

  return Math.min(
    MAX_TASK_CONCURRENCY,
    Math.max(MIN_TASK_CONCURRENCY, parsedValue || normalizedFallback),
  );
}

export function normalizeSingleTaskImageConcurrency(value: number | null | undefined) {
  if (!Number.isFinite(value)) return DEFAULT_SINGLE_TASK_IMAGE_CONCURRENCY;
  const parsedValue = Math.trunc(value);
  return SINGLE_TASK_IMAGE_CONCURRENCY_OPTIONS.includes(parsedValue as 1 | 2 | 4)
    ? parsedValue
    : DEFAULT_SINGLE_TASK_IMAGE_CONCURRENCY;
}

export interface TaskExecutionQueueOptions<T> {
  items: readonly T[];
  concurrency?: number | null;
  shouldContinue?: () => boolean;
  worker: (item: T, index: number) => Promise<void>;
}

export async function runTaskExecutionQueue<T>({
  items,
  concurrency,
  shouldContinue,
  worker,
}: TaskExecutionQueueOptions<T>) {
  if (items.length === 0) return;

  const normalizedConcurrency = normalizeTaskConcurrency(concurrency);
  const workerCount = Math.min(normalizedConcurrency, items.length);
  let nextIndex = 0;

  const runWorker = async () => {
    while (true) {
      if (shouldContinue && !shouldContinue()) return;

      const currentIndex = nextIndex;
      nextIndex += 1;

      if (currentIndex >= items.length) return;
      try {
        await worker(items[currentIndex], currentIndex);
      } catch {
        // Item-level errors are written back by batchRunner; keep the pool moving.
      }
    }
  };

  await Promise.allSettled(
    Array.from({ length: workerCount }, () => runWorker()),
  );
}
