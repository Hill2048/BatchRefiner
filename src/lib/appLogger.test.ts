import test from 'node:test';
import assert from 'node:assert/strict';
import { useAppStore } from '@/store';
import {
  appendGenerationLogEvent,
  clearGenerationLogs,
  createGenerationLogSession,
  getGenerationLogSession,
  sanitizeLogData,
} from './appLogger';

test.afterEach(() => {
  clearGenerationLogs();
});

test('createGenerationLogSession creates a runnable session and appendGenerationLogEvent updates it', () => {
  const sessionId = createGenerationLogSession({
    mode: 'image-single',
    task: {
      id: 'task-1',
      index: 1,
      title: '测试任务',
    },
  });

  appendGenerationLogEvent(sessionId, {
    stage: 'image',
    event: 'image.request.started',
    message: '开始请求',
    incrementAttempt: true,
    data: {
      model: 'gpt-image-2',
    },
  });

  const session = getGenerationLogSession(sessionId);
  assert.ok(session);
  assert.equal(session?.status, 'running');
  assert.equal(session?.taskId, 'task-1');
  assert.equal(session?.attemptCount, 1);
  assert.equal(session?.events.length, 1);
  assert.equal(session?.events[0].event, 'image.request.started');
});

test('sanitizeLogData redacts sensitive fields and summarizes data urls', () => {
  const sanitized = sanitizeLogData({
    apiKey: 'secret-key',
    Authorization: 'Bearer abc',
    image: 'data:image/png;base64,abcdefghijklmnopqrstuvwxyz',
  }) as Record<string, unknown>;

  assert.equal(sanitized.apiKey, '[REDACTED]');
  assert.equal(sanitized.Authorization, '[REDACTED]');
  assert.deepEqual(sanitized.image, {
    kind: 'data_url',
    mime: 'image/png',
    length: 'data:image/png;base64,abcdefghijklmnopqrstuvwxyz'.length,
    prefix: 'data:image/png;base64,abcdefghijklmnopqrstuvwxyz',
  });
});

test('generation log sessions are trimmed to the latest 500 records', () => {
  useAppStore.setState((state) => ({
    ...state,
    generationLogs: [],
  }));

  for (let index = 0; index < 505; index += 1) {
    createGenerationLogSession({
      mode: 'prompt-preview',
      task: {
        id: `task-${index}`,
        index,
        title: `任务 ${index}`,
      },
    });
  }

  const sessions = useAppStore.getState().generationLogs;
  assert.equal(sessions.length, 500);
  assert.equal(sessions[0]?.taskId, 'task-5');
  assert.equal(sessions.at(-1)?.taskId, 'task-504');
});
