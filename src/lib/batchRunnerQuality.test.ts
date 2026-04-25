import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOpenAIImageRequestFields, getOpenAIImageQuality } from './batchRunner';

test('getOpenAIImageQuality omits auto and maps UI quality to compatible API values', () => {
  assert.equal(getOpenAIImageQuality({ imageQuality: 'auto' }), undefined);
  assert.equal(getOpenAIImageQuality({ imageQuality: 'low' }), 'standard');
  assert.equal(getOpenAIImageQuality({ imageQuality: 'medium' }), 'standard');
  assert.equal(getOpenAIImageQuality({ imageQuality: 'high' }), 'hd');
});

test('getOpenAIImageQuality keeps low medium high for all image2-family models', () => {
  const context = { model: 'gpt-image-2', endpoint: 'edits' as const, platformPreset: 'comfly-chat' as const };
  assert.equal(getOpenAIImageQuality({ imageQuality: 'auto' }, context), undefined);
  assert.equal(getOpenAIImageQuality({ imageQuality: 'low' }, context), 'low');
  assert.equal(getOpenAIImageQuality({ imageQuality: 'medium' }, context), 'medium');
  assert.equal(getOpenAIImageQuality({ imageQuality: 'high' }, context), 'high');

  const yunwuContext = { model: 'gpt-image-2-all', endpoint: 'generations' as const, platformPreset: 'yunwu' as const };
  assert.equal(getOpenAIImageQuality({ imageQuality: 'medium' }, yunwuContext), 'medium');
});

test('buildOpenAIImageRequestFields uses documented image2 size quality and response_format', () => {
  const fields = buildOpenAIImageRequestFields(
    { imageQuality: 'medium' },
    {
      model: 'gpt-image-2-all',
      endpoint: 'edits',
      platformPreset: 'yunwu',
      aspectRatio: '9:21',
      resolution: '4K',
    },
  );

  assert.equal(fields.size, '1632x3840');
  assert.equal(fields.quality, 'medium');
  assert.equal(fields.response_format, 'b64_json');
});

test('buildOpenAIImageRequestFields keeps legacy mapping for non-image2 models', () => {
  const fields = buildOpenAIImageRequestFields(
    { imageQuality: 'high' },
    {
      model: 'gpt-image-1',
      endpoint: 'generations',
      platformPreset: 'openai-compatible',
      aspectRatio: '16:9',
      resolution: '1K',
    },
  );

  assert.equal(fields.size, '1536x1024');
  assert.equal(fields.quality, 'hd');
  assert.equal(fields.response_format, undefined);
});
