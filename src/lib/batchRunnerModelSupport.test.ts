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

test('resolveImageModel maps openai image2 alias to gpt-image-2', () => {
  const result = resolveImageModel('image2', '2K', 'openai-compatible');
  assert.equal(result.actualModel, 'gpt-image-2');
  assert.equal(result.resolutionSupport, 'hard');
});

test('resolveImageModel maps yunwu image2 alias to gpt-image-2-all', () => {
  const result = resolveImageModel('image2', '1K', 'yunwu');
  assert.equal(result.actualModel, 'gpt-image-2-all');
  assert.equal(result.resolutionSupport, 'hard');
});

test('supportsImageInput accepts yunwu gpt-image model', () => {
  const supported = supportsImageInput('gpt-image-2-all', 'https://yunwu.ai', 'key', 'yunwu');
  assert.equal(supported, true);
});

test('getRequestedImageSize returns exact custom image2 size when valid', () => {
  const size = getRequestedImageSize('gpt-image-2', '16:9', '2048x1152');
  assert.equal(size, '2048x1152');
});

test('buildComflyResolutionFields keeps explicit size for gpt-image-2', () => {
  const fields = buildComflyResolutionFields('gpt-image-2', '2K', '3:2');
  assert.equal(fields.model, 'gpt-image-2');
  assert.equal(fields.size, '1888x1248');
  assert.equal(fields.aspect_ratio, '3:2');
});

test('getRequestedImageSize keeps gpt-image-2 sizes within 3840 edge limit', () => {
  const size = getRequestedImageSize('gpt-image-2', '1:1', '4K');
  const [widthText, heightText] = size.split('x');
  const width = Number(widthText);
  const height = Number(heightText);

  assert.ok(width <= 3840);
  assert.ok(height <= 3840);
  assert.equal(width % 16, 0);
  assert.equal(height % 16, 0);
});

test('buildComflyResolutionFields maps portrait gpt-image-2 requests to documented size bucket', () => {
  const fields = buildComflyResolutionFields('gpt-image-2', '4K', '9:21');
  assert.equal(fields.size, '1632x3840');
  assert.equal(fields.aspect_ratio, '9:21');
});

test('getRequestedImageSize supports yunwu gpt-image-2-all dynamic size mapping', () => {
  const size = getRequestedImageSize('gpt-image-2-all', '4:5', '2K');
  assert.equal(size, '1376x1712');
});
