import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildComflyResolutionFields,
  getRequestedImageSize,
  resolveImageModel,
  supportsImageInput,
} from './batchRunnerModelSupport';

test('resolveImageModel maps comfly 2K gemini model alias', () => {
  const result = resolveImageModel('gemini-3.1-flash-image-preview', '2K', 'comfly-chat');

  assert.equal(result.actualModel, 'gemini-3.1-flash-image-preview-2k');
  assert.equal(result.resolutionSupport, 'hard');
});

test('supportsImageInput accepts custom OpenAI gpt-image model', () => {
  const supported = supportsImageInput('gpt-image-1', 'https://example.com', 'key', 'custom');
  assert.equal(supported, true);
});

test('getRequestedImageSize returns exact custom image2 size when valid', () => {
  const size = getRequestedImageSize('gpt-image-2', '16:9', '2048x1152');
  assert.equal(size, '2048x1152');
});

test('buildComflyResolutionFields keeps explicit size for gpt-image-2', () => {
  const fields = buildComflyResolutionFields('gpt-image-2', '2K', '3:2');
  assert.equal(fields.model, 'gpt-image-2');
  assert.ok(fields.size);
});
