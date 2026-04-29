import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeSingleTaskImageConcurrency, normalizeTaskConcurrency, runTaskExecutionQueue } from './taskExecutionQueue';

test('normalizeTaskConcurrency clamps invalid values to the task pool range', () => {
  assert.equal(normalizeTaskConcurrency(undefined), 3);
  assert.equal(normalizeTaskConcurrency(0), 3);
  assert.equal(normalizeTaskConcurrency(-2), 1);
  assert.equal(normalizeTaskConcurrency(99), 10);
  assert.equal(normalizeTaskConcurrency(4.8), 4);
});

test('normalizeSingleTaskImageConcurrency only allows supported image pool sizes', () => {
  assert.equal(normalizeSingleTaskImageConcurrency(undefined), 4);
  assert.equal(normalizeSingleTaskImageConcurrency(1), 1);
  assert.equal(normalizeSingleTaskImageConcurrency(2), 2);
  assert.equal(normalizeSingleTaskImageConcurrency(4), 4);
  assert.equal(normalizeSingleTaskImageConcurrency(3), 4);
  assert.equal(normalizeSingleTaskImageConcurrency(99), 4);
});

test('runTaskExecutionQueue respects the normalized concurrency limit', async () => {
  let active = 0;
  let maxActive = 0;

  await runTaskExecutionQueue({
    items: [1, 2, 3, 4, 5],
    concurrency: 2,
    worker: async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
    },
  });

  assert.equal(maxActive, 2);
});

test('runTaskExecutionQueue keeps processing after an item fails', async () => {
  const processed: number[] = [];

  await runTaskExecutionQueue({
    items: [1, 2, 3],
    concurrency: 1,
    worker: async (item) => {
      processed.push(item);
      if (item === 2) throw new Error('boom');
    },
  });

  assert.deepEqual(processed, [1, 2, 3]);
});

test('runTaskExecutionQueue stops taking new work when shouldContinue turns false', async () => {
  const processed: number[] = [];

  await runTaskExecutionQueue({
    items: [1, 2, 3, 4],
    concurrency: 1,
    shouldContinue: () => processed.length < 2,
    worker: async (item) => {
      processed.push(item);
    },
  });

  assert.deepEqual(processed, [1, 2]);
});
