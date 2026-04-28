import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveImageRoute, resolveTextRoute } from './modelRouting';

test('云雾文本在地址和 Key 完整时走 Gemini 网关', () => {
  const route = resolveTextRoute({
    platformPreset: 'yunwu',
    textApiBaseUrl: 'https://yunwu.ai',
    textApiKey: 'text-key',
    textModel: 'gemini-3.1-flash-lite-preview',
  });

  assert.equal(route.transport, 'gemini-gateway');
  assert.equal(
    route.requestPath,
    'https://yunwu.ai/v1beta/models/gemini-3.1-flash-lite-preview:generateContent',
  );
  assert.equal(route.warnings.length, 0);
});

test('OpenAI 兼容文本缺少配置时回落到内置 Gemini', () => {
  const route = resolveTextRoute({
    platformPreset: 'openai-compatible',
    textModel: 'gpt-4o',
  });

  assert.equal(route.transport, 'gemini-native');
  assert.match(route.requestPath, /generativelanguage\.googleapis\.com\/v1beta\/models\/gpt-4o:generateContent$/);
  assert.ok(route.warnings.some((warning) => warning.includes('回落到内置 Gemini')));
});

test('云雾 image2 会映射到 OpenAI 图片接口', () => {
  const route = resolveImageRoute(
    {
      platformPreset: 'yunwu',
      imageToImageApiBaseUrl: 'https://yunwu.ai',
      imageToImageApiKey: 'image-key',
      imageToImageApiPath: '/v1/images/edits',
      imageModel: 'image2',
    },
    { hasImageInputs: true },
  );

  assert.equal(route.transport, 'openai-images');
  assert.equal(route.actualModel, 'gpt-image-2-all');
  assert.equal(route.requestPath, 'https://yunwu.ai/v1/images/edits');
  assert.equal(route.warnings.length, 0);
});

test('文生图和图生图可以使用不同图片接口路径', () => {
  const input = {
    platformPreset: 'openai-compatible' as const,
    textToImageApiBaseUrl: 'https://image.example.com',
    textToImageApiKey: 'txt2img-key',
    textToImageApiPath: '/v1/images/generations',
    textToImageModel: 'gpt-image-2',
    imageToImageApiBaseUrl: 'https://edit.example.com',
    imageToImageApiKey: 'img2img-key',
    imageToImageApiPath: '/v1/images/edits',
    imageToImageModel: 'gpt-image-2',
  };

  const textToImageRoute = resolveImageRoute(input, { hasImageInputs: false });
  const imageToImageRoute = resolveImageRoute(input, { hasImageInputs: true });

  assert.equal(textToImageRoute.requestPath, 'https://image.example.com/v1/images/generations');
  assert.equal(textToImageRoute.baseUrlSource, 'textToImageApiBaseUrl');
  assert.equal(textToImageRoute.keySource, 'textToImageApiKey');
  assert.equal(imageToImageRoute.requestPath, 'https://edit.example.com/v1/images/edits');
  assert.equal(imageToImageRoute.baseUrlSource, 'imageToImageApiBaseUrl');
  assert.equal(imageToImageRoute.keySource, 'imageToImageApiKey');
});

test('comfly 带参考图且非 gpt-image 时走 chat/completions', () => {
  const route = resolveImageRoute(
    {
      platformPreset: 'comfly-chat',
      imageToImageApiBaseUrl: 'https://ai.comfly.chat',
      imageToImageApiKey: 'image-key',
      imageModel: 'gemini-3.1-flash-image-preview',
      resolution: '2K',
    },
    { hasImageInputs: true },
  );

  assert.equal(route.transport, 'openai-chat-completions');
  assert.equal(route.actualModel, 'gemini-3.1-flash-image-preview-2k');
  assert.equal(route.requestPath, 'https://ai.comfly.chat/v1/chat/completions');
});

test('OpenAI 兼容生图缺少配置不会自动回落', () => {
  const route = resolveImageRoute(
    {
      platformPreset: 'openai-compatible',
      imageModel: 'gpt-image-2',
    },
    { hasImageInputs: false },
  );

  assert.equal(route.transport, 'openai-images');
  assert.equal(route.requestPath, '/v1/images/generations');
  assert.ok(route.warnings.some((warning) => warning.includes('不会自动回落')));
});
