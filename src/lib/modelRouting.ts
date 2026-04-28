import type { PlatformPreset, Resolution } from '@/types';

type RouteFieldSource =
  | 'textApiBaseUrl'
  | 'imageApiBaseUrl'
  | 'apiBaseUrl'
  | 'textApiKey'
  | 'imageApiKey'
  | 'apiKey'
  | 'imageApiPath'
  | 'default'
  | 'builtin'
  | 'missing';

type RouteTransport =
  | 'gemini-gateway'
  | 'openai-chat-completions'
  | 'openai-images'
  | 'gemini-native';

export type ModelRoutingInput = {
  platformPreset: PlatformPreset;
  apiBaseUrl?: string;
  textApiBaseUrl?: string;
  imageApiBaseUrl?: string;
  imageApiPath?: string;
  apiKey?: string;
  textApiKey?: string;
  imageApiKey?: string;
  textModel?: string;
  imageModel?: string;
  resolution?: Resolution | string;
};

export type ResolvedRoute = {
  kind: 'text' | 'image';
  transport: RouteTransport;
  title: string;
  summary: string;
  requestPath: string;
  requestedModel: string;
  actualModel: string;
  modelChanged: boolean;
  hasImageInputs?: boolean;
  baseUrl?: string;
  baseUrlSource: RouteFieldSource;
  keySource: RouteFieldSource;
  pathSource: RouteFieldSource;
  usesCustomPath: boolean;
  detailLines: string[];
  notes: string[];
  warnings: string[];
};

const BUILTIN_GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const BUILTIN_GEMINI_TEXT_MODEL = 'gemini-2.0-flash';
const BUILTIN_GEMINI_IMAGE_MODEL = 'imagen-3.0-generate-001';

function trimValue(value?: string) {
  return (value || '').trim();
}

function getNormalizedModelName(model?: string) {
  return trimValue(model).toLowerCase();
}

function normalizeResolution(value?: Resolution | string) {
  return trimValue(value || '1K').toUpperCase();
}

function pickFirstValue(
  candidates: Array<{ source: RouteFieldSource; value?: string }>,
): { source: RouteFieldSource; value: string } {
  for (const candidate of candidates) {
    const value = trimValue(candidate.value);
    if (value) return { source: candidate.source, value };
  }

  return { source: 'missing', value: '' };
}

function normalizeOpenAIBaseUrl(baseUrl: string) {
  let normalized = trimValue(baseUrl).replace(/\/+$/, '');
  if (normalized.endsWith('/v1beta') || normalized.endsWith('/v1alpha')) {
    normalized = normalized.replace(/\/v1(beta|alpha)$/, '/v1');
  }
  if (!normalized.endsWith('/v1') && !normalized.includes('/v1/')) normalized += '/v1';
  return normalized;
}

function normalizeGeminiBaseUrl(baseUrl: string) {
  let normalized = trimValue(baseUrl).replace(/\/+$/, '');
  if (normalized.endsWith('/v1')) return normalized.replace(/\/v1$/, '/v1beta');
  if (normalized.endsWith('/v1beta')) return normalized;
  return `${normalized}/v1beta`;
}

function buildConfiguredImageApiUrl(baseUrl: string, defaultPath: string, customPath?: string) {
  const normalizedBase = trimValue(baseUrl).replace(/\/+$/, '');
  const path = trimValue(customPath);

  if (path) {
    if (/^https?:\/\//i.test(path)) return path;
    const normalizedPath = path.replace(/^\/+/, '');
    const baseWithoutDuplicateVersion =
      normalizedPath.startsWith('v1/') || normalizedPath === 'v1'
        ? normalizedBase.replace(/\/v1$/, '')
        : normalizedBase;
    return `${baseWithoutDuplicateVersion}/${normalizedPath}`;
  }

  const openAIBaseUrl = normalizedBase.endsWith('/v1') ? normalizedBase : `${normalizedBase}/v1`;
  return `${openAIBaseUrl}/${defaultPath.replace(/^\/+/, '')}`;
}

function isGptImageModel(model?: string) {
  const normalized = getNormalizedModelName(model);
  return normalized.startsWith('gpt-image') || normalized === 'image2';
}

function isComflyResponsesImageModel(model?: string, platformPreset?: PlatformPreset) {
  if (platformPreset !== 'comfly-chat') return false;
  const normalized = getNormalizedModelName(model);
  return normalized === 'gpt-image-2' || normalized === 'image2';
}

function isYunwuGptImageModel(model?: string, platformPreset?: PlatformPreset) {
  if (platformPreset !== 'yunwu') return false;
  const normalized = getNormalizedModelName(model);
  return normalized === 'gpt-image-2' || normalized === 'gpt-image-2-all' || normalized === 'image2';
}

function normalizeComflyImageModelAlias(modelName: string) {
  const normalized = getNormalizedModelName(modelName);
  if (normalized === 'image2') return 'gpt-image-2';
  return trimValue(modelName);
}

function normalizeYunwuImageModelAlias(modelName: string) {
  const normalized = getNormalizedModelName(modelName);
  if (normalized === 'image2' || normalized === 'gpt-image-2') return 'gpt-image-2-all';
  return trimValue(modelName);
}

function normalizeOpenAIImageModelAlias(modelName: string) {
  const normalized = getNormalizedModelName(modelName);
  if (normalized === 'image2') return 'gpt-image-2';
  return trimValue(modelName);
}

function getSourceLabel(source: RouteFieldSource) {
  switch (source) {
    case 'textApiBaseUrl':
      return '文本 API 地址';
    case 'imageApiBaseUrl':
      return '生图 API 地址';
    case 'apiBaseUrl':
      return '默认 API 地址';
    case 'textApiKey':
      return '文本 API Key';
    case 'imageApiKey':
      return '生图 API Key';
    case 'apiKey':
      return '默认 API Key';
    case 'imageApiPath':
      return '自定义生图接口路径';
    case 'builtin':
      return '内置 Gemini';
    case 'default':
      return '默认接口路径';
    case 'missing':
      return '未填写';
    default:
      return source;
  }
}

function buildDetailLines(route: {
  actualModel: string;
  requestedModel: string;
  requestPath: string;
  baseUrl?: string;
  baseUrlSource: RouteFieldSource;
  keySource: RouteFieldSource;
  pathSource: RouteFieldSource;
  usesCustomPath: boolean;
}) {
  const detailLines = [
    route.actualModel === route.requestedModel
      ? `实际模型：${route.actualModel || '未填写'}`
      : `实际模型：${route.actualModel || '未填写'}（由 ${route.requestedModel || '未填写'} 自动映射）`,
    `请求：${route.requestPath}`,
    `地址来源：${route.baseUrl ? getSourceLabel(route.baseUrlSource) : '不使用自填地址'}`,
    `Key 来源：${getSourceLabel(route.keySource)}`,
  ];

  if (route.usesCustomPath) {
    detailLines.push(`接口路径来源：${getSourceLabel(route.pathSource)}`);
  }

  return detailLines;
}

function resolveRequestedImageModel(
  modelName: string,
  resolution: string,
  platformPreset: PlatformPreset,
  warnings: string[],
) {
  if (platformPreset === 'comfly-chat') {
    const canonicalModelName = normalizeComflyImageModelAlias(modelName);
    const normalized = getNormalizedModelName(canonicalModelName);

    if (normalized.startsWith('gemini-3.1-flash-image-preview')) {
      if (resolution === '2K') return 'gemini-3.1-flash-image-preview-2k';
      if (resolution === '4K') return 'gemini-3.1-flash-image-preview-4k';
      if (resolution === '512PX') return 'gemini-3.1-flash-image-preview-512px';
      return 'gemini-3.1-flash-image-preview';
    }

    if (normalized.startsWith('nano-banana-pro')) {
      if (resolution === '2K') return 'nano-banana-pro-2k';
      if (resolution === '4K') {
        warnings.push('comfly.chat 的 nano-banana-pro 不支持 4K，实际执行会直接报错。');
      }
      return 'nano-banana-pro';
    }

    return canonicalModelName;
  }

  if (platformPreset === 'yunwu') {
    return normalizeYunwuImageModelAlias(modelName);
  }

  return normalizeOpenAIImageModelAlias(modelName);
}

export function resolveTextRoute(input: ModelRoutingInput): ResolvedRoute {
  const model = trimValue(input.textModel) || BUILTIN_GEMINI_TEXT_MODEL;
  const textBase = pickFirstValue([
    { source: 'textApiBaseUrl', value: input.textApiBaseUrl },
    { source: 'apiBaseUrl', value: input.apiBaseUrl },
  ]);
  const textKey = pickFirstValue([
    { source: 'textApiKey', value: input.textApiKey },
    { source: 'apiKey', value: input.apiKey },
  ]);
  const warnings: string[] = [];
  const notes: string[] = [];

  const isYunwuPromptImage = isYunwuGptImageModel(model, input.platformPreset);
  const isGeminiGateway =
    input.platformPreset === 'yunwu' &&
    Boolean(textBase.value) &&
    Boolean(textKey.value) &&
    !isYunwuPromptImage;
  const isCustomOpenAI =
    !isGeminiGateway &&
    (input.platformPreset === 'comfly-chat' ||
      input.platformPreset === 'openai-compatible' ||
      input.platformPreset === 'custom');

  if (isGeminiGateway) {
    const requestPath = `${normalizeGeminiBaseUrl(textBase.value)}/models/${model}:generateContent`;
    notes.push('云雾只有在文本地址和文本 Key 都完整时，文本请求才会走这里。');

    return {
      kind: 'text',
      transport: 'gemini-gateway',
      title: '文本实际路由',
      summary: '当前文本会走 Gemini 网关。',
      requestPath,
      requestedModel: model,
      actualModel: model,
      modelChanged: false,
      baseUrl: textBase.value,
      baseUrlSource: textBase.source,
      keySource: textKey.source,
      pathSource: 'default',
      usesCustomPath: false,
      detailLines: buildDetailLines({
        actualModel: model,
        requestedModel: model,
        requestPath,
        baseUrl: textBase.value,
        baseUrlSource: textBase.source,
        keySource: textKey.source,
        pathSource: 'default',
        usesCustomPath: false,
      }),
      notes,
      warnings,
    };
  }

  if (isCustomOpenAI && textBase.value && textKey.value) {
    const requestPath = `${normalizeOpenAIBaseUrl(textBase.value)}/chat/completions`;
    notes.push('OpenAI 兼容预设里的文本，总是走 chat/completions。');

    return {
      kind: 'text',
      transport: 'openai-chat-completions',
      title: '文本实际路由',
      summary: '当前文本会走 OpenAI 兼容聊天接口。',
      requestPath,
      requestedModel: model,
      actualModel: model,
      modelChanged: false,
      baseUrl: textBase.value,
      baseUrlSource: textBase.source,
      keySource: textKey.source,
      pathSource: 'default',
      usesCustomPath: false,
      detailLines: buildDetailLines({
        actualModel: model,
        requestedModel: model,
        requestPath,
        baseUrl: textBase.value,
        baseUrlSource: textBase.source,
        keySource: textKey.source,
        pathSource: 'default',
        usesCustomPath: false,
      }),
      notes,
      warnings,
    };
  }

  const requestPath = `${BUILTIN_GEMINI_BASE_URL}/models/${model}:generateContent`;
  if (isCustomOpenAI && (!textBase.value || !textKey.value)) {
    warnings.push('当前文本地址或 Key 没填完整，所以不会走你填的 OpenAI 兼容接口，而会回落到内置 Gemini。');
  }
  if (isYunwuPromptImage) {
    warnings.push('云雾预设下把文本模型写成 gpt-image/image2 时，不会走云雾文本网关，也会回落到内置 Gemini。');
  }
  if (input.platformPreset === 'gemini-native') {
    notes.push('Gemini / Imagen 原生预设会直接走官方 Gemini 接口，不读取你填写的文本地址。');
  }

  return {
    kind: 'text',
    transport: 'gemini-native',
    title: '文本实际路由',
    summary: '当前文本会回落到内置 Gemini 接口。',
    requestPath,
    requestedModel: model,
    actualModel: model,
    modelChanged: false,
    baseUrlSource: 'builtin',
    keySource: 'builtin',
    pathSource: 'builtin',
    usesCustomPath: false,
    detailLines: buildDetailLines({
      actualModel: model,
      requestedModel: model,
      requestPath,
      baseUrlSource: 'builtin',
      keySource: 'builtin',
      pathSource: 'builtin',
      usesCustomPath: false,
    }),
    notes,
    warnings,
  };
}

export function resolveImageRoute(
  input: ModelRoutingInput,
  options: {
    hasImageInputs: boolean;
    resolution?: Resolution | string;
  },
): ResolvedRoute {
  const warnings: string[] = [];
  const notes: string[] = [];
  const requestedModel = trimValue(input.imageModel) || BUILTIN_GEMINI_IMAGE_MODEL;
  const resolution = normalizeResolution(options.resolution || input.resolution);
  const actualModel = resolveRequestedImageModel(
    requestedModel,
    resolution,
    input.platformPreset,
    warnings,
  );
  const imageBase = pickFirstValue([
    { source: 'imageApiBaseUrl', value: input.imageApiBaseUrl },
    { source: 'apiBaseUrl', value: input.apiBaseUrl },
    { source: 'textApiBaseUrl', value: input.textApiBaseUrl },
  ]);
  const imageKey = pickFirstValue([
    { source: 'imageApiKey', value: input.imageApiKey },
    { source: 'textApiKey', value: input.textApiKey },
    { source: 'apiKey', value: input.apiKey },
  ]);
  const imagePath = pickFirstValue([{ source: 'imageApiPath', value: input.imageApiPath }]);
  const isYunwuGptImage = isYunwuGptImageModel(actualModel, input.platformPreset);
  const isGeminiGateway =
    input.platformPreset === 'yunwu' &&
    Boolean(imageBase.value) &&
    Boolean(imageKey.value) &&
    !isYunwuGptImage;
  const isCustomOpenAI =
    !isGeminiGateway &&
    (input.platformPreset === 'comfly-chat' ||
      input.platformPreset === 'openai-compatible' ||
      input.platformPreset === 'custom');

  if (isGeminiGateway) {
    const requestPath = `${normalizeGeminiBaseUrl(imageBase.value)}/models/${actualModel}:generateContent`;
    notes.push('云雾预设下，只要不是 gpt-image/image2，生图会走 Gemini 网关。');
    if (options.hasImageInputs) {
      notes.push('带原图或参考图时，图片会和提示词一起打包到同一个 generateContent 请求。');
    }

    return {
      kind: 'image',
      transport: 'gemini-gateway',
      title: options.hasImageInputs ? '生图实际路由（有原图/参考图）' : '生图实际路由（无原图/参考图）',
      summary: options.hasImageInputs
        ? '当前带图任务会走 Gemini 网关。'
        : '当前纯生图会走 Gemini 网关。',
      requestPath,
      requestedModel,
      actualModel,
      modelChanged: actualModel !== requestedModel,
      hasImageInputs: options.hasImageInputs,
      baseUrl: imageBase.value,
      baseUrlSource: imageBase.source,
      keySource: imageKey.source,
      pathSource: 'default',
      usesCustomPath: false,
      detailLines: buildDetailLines({
        actualModel,
        requestedModel,
        requestPath,
        baseUrl: imageBase.value,
        baseUrlSource: imageBase.source,
        keySource: imageKey.source,
        pathSource: 'default',
        usesCustomPath: false,
      }),
      notes,
      warnings,
    };
  }

  if (input.platformPreset === 'yunwu' && isYunwuGptImage && imageBase.value && imageKey.value) {
    const openAIBaseUrl = normalizeOpenAIBaseUrl(imageBase.value);
    const requestPath = buildConfiguredImageApiUrl(
      openAIBaseUrl,
      options.hasImageInputs ? '/images/edits' : '/images/generations',
      imagePath.value,
    );
    notes.push('云雾预设下，gpt-image-2/image2 会改走 OpenAI 图片接口。');
    if (imagePath.value) {
      warnings.push('你填写的生图接口路径会同时覆盖有图和无图两种图片请求。');
    }

    return {
      kind: 'image',
      transport: 'openai-images',
      title: options.hasImageInputs ? '生图实际路由（有原图/参考图）' : '生图实际路由（无原图/参考图）',
      summary: options.hasImageInputs
        ? '当前带图任务会走 OpenAI 图片编辑接口。'
        : '当前纯生图会走 OpenAI 图片生成接口。',
      requestPath,
      requestedModel,
      actualModel,
      modelChanged: actualModel !== requestedModel,
      hasImageInputs: options.hasImageInputs,
      baseUrl: openAIBaseUrl,
      baseUrlSource: imageBase.source,
      keySource: imageKey.source,
      pathSource: imagePath.value ? imagePath.source : 'default',
      usesCustomPath: Boolean(imagePath.value),
      detailLines: buildDetailLines({
        actualModel,
        requestedModel,
        requestPath,
        baseUrl: openAIBaseUrl,
        baseUrlSource: imageBase.source,
        keySource: imageKey.source,
        pathSource: imagePath.value ? imagePath.source : 'default',
        usesCustomPath: Boolean(imagePath.value),
      }),
      notes,
      warnings,
    };
  }

  if (isCustomOpenAI) {
    const openAIBaseUrl = normalizeOpenAIBaseUrl(imageBase.value);
    let requestPath: string;
    let transport: RouteTransport;
    let summary: string;

    if (options.hasImageInputs) {
      if (isGptImageModel(actualModel) || actualModel.toLowerCase().startsWith('dall-e')) {
        requestPath = buildConfiguredImageApiUrl(openAIBaseUrl, '/images/edits', imagePath.value);
        transport = 'openai-images';
        summary = '当前带图任务会走 OpenAI 图片编辑接口。';
      } else if (isComflyResponsesImageModel(actualModel, input.platformPreset)) {
        requestPath = buildConfiguredImageApiUrl(openAIBaseUrl, '/images/generations', imagePath.value);
        transport = 'openai-images';
        summary = '当前带图任务会走 comfly 的图片生成接口。';
      } else {
        requestPath = `${openAIBaseUrl}/chat/completions`;
        transport = 'openai-chat-completions';
        summary = '当前带图任务会走 chat/completions。';
      }
    } else {
      requestPath = buildConfiguredImageApiUrl(openAIBaseUrl, '/images/generations', imagePath.value);
      transport = 'openai-images';
      summary = '当前纯生图会走 OpenAI 图片生成接口。';
    }

    if (!imageBase.value || !imageKey.value) {
      warnings.push('当前生图地址或 Key 没填完整，这条 OpenAI 兼容生图路由不会自动回落，实际执行会直接失败。');
    }
    if (imagePath.value && transport === 'openai-images') {
      warnings.push('你填写的生图接口路径会同时覆盖有图和无图两种图片请求。');
    }
    if (transport === 'openai-chat-completions') {
      notes.push('带图且不是 gpt-image/dall-e 时，这里会走 chat/completions，而不是 /images/edits。');
    }

    return {
      kind: 'image',
      transport,
      title: options.hasImageInputs ? '生图实际路由（有原图/参考图）' : '生图实际路由（无原图/参考图）',
      summary,
      requestPath,
      requestedModel,
      actualModel,
      modelChanged: actualModel !== requestedModel,
      hasImageInputs: options.hasImageInputs,
      baseUrl: openAIBaseUrl,
      baseUrlSource: imageBase.source,
      keySource: imageKey.source,
      pathSource:
        imagePath.value && transport === 'openai-images' ? imagePath.source : 'default',
      usesCustomPath: Boolean(imagePath.value) && transport === 'openai-images',
      detailLines: buildDetailLines({
        actualModel,
        requestedModel,
        requestPath,
        baseUrl: openAIBaseUrl,
        baseUrlSource: imageBase.source,
        keySource: imageKey.source,
        pathSource:
          imagePath.value && transport === 'openai-images' ? imagePath.source : 'default',
        usesCustomPath: Boolean(imagePath.value) && transport === 'openai-images',
      }),
      notes,
      warnings,
    };
  }

  const requestPath = options.hasImageInputs
    ? `${BUILTIN_GEMINI_BASE_URL}/models/${actualModel}:generateContent`
    : `${BUILTIN_GEMINI_BASE_URL}/models/${actualModel}:predict`;
  if (input.platformPreset === 'gemini-native') {
    notes.push('Gemini / Imagen 原生预设会直接走官方接口，不读取你填写的生图地址。');
  }
  if (input.platformPreset === 'yunwu' && isYunwuGptImage && (!imageBase.value || !imageKey.value)) {
    warnings.push('云雾的 gpt-image/image2 如果没填完整生图地址和 Key，也会回落到内置 Gemini。');
  }

  return {
    kind: 'image',
    transport: 'gemini-native',
    title: options.hasImageInputs ? '生图实际路由（有原图/参考图）' : '生图实际路由（无原图/参考图）',
    summary: options.hasImageInputs
      ? '当前带图任务会回落到内置 Gemini 接口。'
      : '当前纯生图会回落到内置 Gemini / Imagen 接口。',
    requestPath,
    requestedModel,
    actualModel,
    modelChanged: actualModel !== requestedModel,
    hasImageInputs: options.hasImageInputs,
    baseUrlSource: 'builtin',
    keySource: 'builtin',
    pathSource: 'builtin',
    usesCustomPath: false,
    detailLines: buildDetailLines({
      actualModel,
      requestedModel,
      requestPath,
      baseUrlSource: 'builtin',
      keySource: 'builtin',
      pathSource: 'builtin',
      usesCustomPath: false,
    }),
    notes,
    warnings,
  };
}
