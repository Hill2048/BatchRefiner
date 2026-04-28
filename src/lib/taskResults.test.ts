import test from 'node:test';
import assert from 'node:assert/strict';
import { compactTaskResultImagesForHotState, getBatchCountNumber, getCurrentTaskResultImages, getHistoricalTaskResultGroups, getHistoricalTaskResultImages, getTaskResultProgress, getTaskResultImages } from './taskResults';
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
    activeResultSessionId: 'session-current',
    requestedBatchCount: 'x4',
    failedResultCount: 1,
    resultImages: [
      { id: 'a', src: '1', sessionId: 'session-current', createdAt: 1 },
      { id: 'b', src: '2', sessionId: 'session-old', createdAt: 2 },
    ],
  });

  const progress = getTaskResultProgress(task, 'x1');
  assert.equal(progress.requested, 4);
  assert.equal(progress.completed, 1);
  assert.equal(progress.failed, 1);
});

test('getCurrentTaskResultImages returns only active batch results', () => {
  const task = createTask({
    activeResultSessionId: 'session-current',
    resultImages: [
      { id: 'a', src: 'current-1', sessionId: 'session-current', createdAt: 1 },
      { id: 'b', src: 'old-1', sessionId: 'session-old', createdAt: 2 },
    ],
  });

  assert.deepEqual(getCurrentTaskResultImages(task).map((image) => image.src), ['current-1']);
  assert.deepEqual(getHistoricalTaskResultImages(task).map((image) => image.src), ['old-1']);
  assert.equal(getTaskResultImages(task).length, 2);
});

test('getHistoricalTaskResultGroups groups images by session and sorts latest first', () => {
  const task = createTask({
    activeResultSessionId: 'session-current',
    resultImages: [
      { id: 'a', src: 'old-1', sessionId: 'session-old-a', createdAt: 10 },
      { id: 'b', src: 'old-2', sessionId: 'session-old-a', createdAt: 11 },
      { id: 'c', src: 'older-1', sessionId: 'session-old-b', createdAt: 5 },
      { id: 'd', src: 'current-1', sessionId: 'session-current', createdAt: 20 },
    ],
  });

  const groups = getHistoricalTaskResultGroups(task);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].sessionId, 'session-old-a');
  assert.deepEqual(groups[0].images.map((image) => image.src), ['old-1', 'old-2']);
  assert.equal(groups[1].sessionId, 'session-old-b');
});

test('compactTaskResultImagesForHotState keeps current results and caps old sessions', () => {
  const images = [
    { id: 'current', src: 'current.png', sessionId: 'session-current', createdAt: 100 },
    { id: 'old-1', src: 'old-1.png', sessionId: 'session-old-1', createdAt: 10 },
    { id: 'old-2', src: 'old-2.png', sessionId: 'session-old-2', createdAt: 20 },
    { id: 'old-3', src: 'old-3.png', sessionId: 'session-old-3', createdAt: 30 },
  ];

  const compacted = compactTaskResultImagesForHotState(images, 'session-current', {
    maxHistoricalSessions: 2,
    maxImages: 3,
  });

  assert.deepEqual(compacted.map((image) => image.id), ['current', 'old-3', 'old-2']);
});
