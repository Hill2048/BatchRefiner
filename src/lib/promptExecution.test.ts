import test from 'node:test';
import assert from 'node:assert/strict';
import { getExecutablePromptText, isPromptOptimizationEnabled } from './promptExecution';

test('prompt optimization defaults to enabled', () => {
  assert.equal(isPromptOptimizationEnabled(undefined), true);
  assert.equal(isPromptOptimizationEnabled(true), true);
  assert.equal(isPromptOptimizationEnabled(false), false);
});

test('executable prompt prefers promptText over description', () => {
  const promptText = getExecutablePromptText({
    promptText: '  最终提示词  ',
    description: '生成指令',
  });

  assert.equal(promptText, '最终提示词');
});

test('executable prompt falls back to description when promptText is empty', () => {
  const promptText = getExecutablePromptText({
    promptText: '   ',
    description: '  直接使用当前文本出图  ',
  });

  assert.equal(promptText, '直接使用当前文本出图');
});

test('executable prompt returns null when no usable text exists', () => {
  const promptText = getExecutablePromptText({
    promptText: ' ',
    description: '\n',
  });

  assert.equal(promptText, null);
});
