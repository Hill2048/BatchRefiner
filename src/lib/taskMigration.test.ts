import test from 'node:test';
import assert from 'node:assert/strict';
import { migrateTask, normalizeIncomingTask, recoverInterruptedTasks, withDefaultSkill } from './taskMigration';
import { Task } from '@/types';

function createBaseTask(overrides: Partial<Task> = {}): Task {
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

test('migrateTask normalizes legacy result image fields', () => {
  const migrated = migrateTask(
    createBaseTask({
      resultImage: 'https://example.com/result.png',
      resultImagePreview: 'https://example.com/preview.png',
      resultImageOriginal: 'https://example.com/original.png',
      resultImageWidth: 100,
      resultImageHeight: 200,
    }),
  );

  assert.equal(migrated.resultImages?.length, 1);
  assert.equal(migrated.resultImages?.[0].src, 'https://example.com/result.png');
  assert.equal(migrated.resultImages?.[0].assetSrc, 'https://example.com/result.png');
  assert.equal(migrated.resultImages?.[0].assetWidth, 100);
  assert.equal(migrated.resultImages?.[0].assetHeight, 200);
  assert.equal(migrated.resultImages?.[0].downloadSourceType, 'src');
  assert.equal(migrated.requestedBatchCount, 'x1');
});

test('migrateTask preserves requested size without treating auto-resized output as abnormal', () => {
  const migrated = migrateTask(
    createBaseTask({
      resultImages: [{
        id: 'result-1',
        src: 'https://example.com/preview.webp',
        originalSrc: 'https://example.com/original.webp',
        width: 1023,
        height: 1537,
        requestedWidth: 832,
        requestedHeight: 1248,
        createdAt: 1,
      }],
    }),
  );

  assert.equal(migrated.resultImages?.[0].assetWidth, 1023);
  assert.equal(migrated.resultImages?.[0].assetHeight, 1537);
  assert.equal(migrated.resultImages?.[0].requestedWidth, 832);
  assert.equal(migrated.resultImages?.[0].requestedHeight, 1248);
  assert.equal(migrated.resultImages?.[0].normalizationStatus, 'ok');
  assert.equal(migrated.resultImages?.[0].downloadStatus, 'ready');
});

test('recoverInterruptedTasks converts in-flight tasks to error state', () => {
  const recovered = recoverInterruptedTasks([
    createBaseTask({ status: 'Rendering' }),
    createBaseTask({ id: 'task-2', status: 'Success' }),
  ]);

  assert.equal(recovered[0].status, 'Error');
  assert.match(recovered[0].errorLog?.message || '', /请求已中断/);
  assert.equal(recovered[1].status, 'Success');
});

test('withDefaultSkill fills empty defaults', () => {
  const result = withDefaultSkill({
    globalSkillText: '',
    skillFileName: '',
  });

  assert.equal(result.globalBatchCount, 'x1');
  assert.equal(result.globalImageQuality, 'auto');
  assert.equal(result.enablePromptOptimization, true);
  assert.ok(result.globalSkillText);
  assert.ok(result.skillFileName);
});

test('normalizeIncomingTask creates a runnable idle task', () => {
  const task = normalizeIncomingTask({
    index: 3,
    title: '导入任务',
    description: '',
    referenceImages: [],
    sourceImage: 'data:image/png;base64,abc',
  });

  assert.equal(task.status, 'Idle');
  assert.equal(task.requestedBatchCount, 'x1');
  assert.ok(task.id);
});
