import test from 'node:test';
import assert from 'node:assert/strict';
import { getBatchCountNumber, getTaskResultProgress, getTaskResultImages } from './taskResults';
import { Task } from '@/types';

function createTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    index: 1,
    title: '测试任务',
    description: '',
    referenceImages: [],
    status: 'Idle',
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  };
}

test('getBatchCountNumber returns numeric count', () => {
  assert.equal(getBatchCountNumber('x1'), 1);
  assert.equal(getBatchCountNumber('x4'), 4);
});

test('getTaskResultImages prefers resultImages array', () => {
  const task = createTask({
    resultImage: 'legacy',
    resultImages: [{ id: 'result-1', src: 'modern', createdAt: 1 }],
  });

  assert.equal(getTaskResultImages(task)[0].src, 'modern');
});

test('getTaskResultProgress includes failed results', () => {
  const task = createTask({
    requestedBatchCount: 'x4',
    failedResultCount: 1,
    resultImages: [
      { id: 'a', src: '1', createdAt: 1 },
      { id: 'b', src: '2', createdAt: 2 },
    ],
  });

  const progress = getTaskResultProgress(task, 'x1');
  assert.equal(progress.requested, 4);
  assert.equal(progress.completed, 2);
  assert.equal(progress.failed, 1);
});
