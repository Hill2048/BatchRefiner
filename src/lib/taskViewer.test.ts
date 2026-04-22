import test from 'node:test';
import assert from 'node:assert/strict';
import { getTaskViewerItems, getTaskViewerMainImage } from './taskViewer';
import type { Task } from '@/types';

const baseTask: Task = {
  id: 'task-1',
  index: 1,
  title: '查看器测试',
  description: '',
  sourceImage: 'source.png',
  referenceImages: [],
  status: 'Success',
  createdAt: 1,
  updatedAt: 2,
  activeResultSessionId: 'session-current',
  resultImages: [
    { id: 'r1', src: 'result-1.png', sessionId: 'session-current', createdAt: 2 },
    { id: 'r2', src: 'result-2.png', sessionId: 'session-old', createdAt: 3 },
  ],
};

test('getTaskViewerItems includes source and result images in one sequence', () => {
  const items = getTaskViewerItems(baseTask);

  assert.equal(items.length, 2);
  assert.equal(items[0].type, 'source');
  assert.equal(items[1].type, 'result');
  assert.equal(items[1].resultIndex, 0);
});

test('getTaskViewerMainImage returns selected result or source image', () => {
  assert.equal(getTaskViewerMainImage(baseTask, 'source', 0), 'source.png');
  assert.equal(getTaskViewerMainImage(baseTask, 'result', 1), 'result-1.png');
});
