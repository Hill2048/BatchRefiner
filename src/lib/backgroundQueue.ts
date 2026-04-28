export function yieldToMainThread(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined') {
      resolve();
      return;
    }

    window.setTimeout(resolve, 0);
  });
}

export function waitForIdle(timeout = 120): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined') {
      globalThis.setTimeout(resolve, 0);
      return;
    }

    if (!('requestIdleCallback' in window)) {
      globalThis.setTimeout(resolve, 0);
      return;
    }

    window.requestIdleCallback(() => resolve(), { timeout });
  });
}

export interface BackgroundQueueOptions {
  yieldEvery?: number;
  idleTimeout?: number;
}

export async function runWithBackgroundYields<T>(
  items: T[],
  worker: (item: T, index: number) => Promise<void>,
  options: BackgroundQueueOptions = {},
) {
  const yieldEvery = Math.max(1, options.yieldEvery || 1);

  for (let index = 0; index < items.length; index += 1) {
    if (index > 0 && index % yieldEvery === 0) {
      await waitForIdle(options.idleTimeout);
    }

    await worker(items[index], index);
    await yieldToMainThread();
  }
}
