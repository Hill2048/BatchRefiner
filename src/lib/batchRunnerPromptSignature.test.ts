import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPromptInputSignature } from './batchRunner';

const baseContext = {
  globalReferenceImages: ['global-a'],
  globalSkillText: 'global skill',
  enablePromptOptimization: true,
  textModel: 'gemini-3.1-flash-lite-preview',
  platformPreset: 'yunwu' as const,
  apiBaseUrl: 'https://yunwu.ai',
};

test('prompt input signature changes when description changes', () => {
  const previousSignature = buildPromptInputSignature({
    description: '旧生成指令',
    referenceImages: ['ref-a'],
  }, baseContext);

  const nextSignature = buildPromptInputSignature({
    description: '新生成指令',
    referenceImages: ['ref-a'],
  }, baseContext);

  assert.notEqual(previousSignature, nextSignature);
});

test('prompt input signature stays stable for identical logical input', () => {
  const left = buildPromptInputSignature({
    description: '  同一条生成指令  ',
    referenceImages: ['ref-a', 'ref-b'],
  }, baseContext);

  const right = buildPromptInputSignature({
    description: '同一条生成指令',
    referenceImages: ['ref-a', 'ref-b'],
  }, baseContext);

  assert.equal(left, right);
});
