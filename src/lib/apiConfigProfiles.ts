import { v4 as uuidv4 } from 'uuid';
import type { ApiConfigProfile, PlatformApiConfigMap, PlatformPreset } from '@/types';

const DEFAULT_TEXT_TO_IMAGE_API_PATH = '/v1/images/generations';
const DEFAULT_IMAGE_TO_IMAGE_API_PATH = '/v1/images/edits';

export const DEFAULT_API_CONFIG_PROFILE_NAME = '默认配置';

const PLATFORM_PRESET_ORDER: PlatformPreset[] = [
  'yunwu',
  'comfly-chat',
  'openai-compatible',
  'gemini-native',
  'custom',
];

type LegacyApiConfigSeed = {
  platformPreset?: PlatformPreset;
  platformConfigs?: Partial<PlatformApiConfigMap> | null;
  apiBaseUrl?: string;
  textApiBaseUrl?: string;
  imageApiBaseUrl?: string;
  imageApiPath?: string;
  textToImageApiBaseUrl?: string;
  textToImageApiPath?: string;
  imageToImageApiBaseUrl?: string;
  imageToImageApiPath?: string;
  apiKey?: string;
  textApiKey?: string;
  imageApiKey?: string;
  textToImageApiKey?: string;
  imageToImageApiKey?: string;
  textModel?: string;
  imageModel?: string;
  textToImageModel?: string;
  imageToImageModel?: string;
};

function isPlatformPreset(value: unknown): value is PlatformPreset {
  return typeof value === 'string' && PLATFORM_PRESET_ORDER.includes(value as PlatformPreset);
}

export function createDefaultPlatformConfigs(): PlatformApiConfigMap {
  return {
    yunwu: {
      apiBaseUrl: '',
      textApiBaseUrl: '',
      imageApiBaseUrl: '',
      imageApiPath: '',
      textToImageApiBaseUrl: '',
      textToImageApiPath: DEFAULT_TEXT_TO_IMAGE_API_PATH,
      imageToImageApiBaseUrl: '',
      imageToImageApiPath: DEFAULT_IMAGE_TO_IMAGE_API_PATH,
      apiKey: '',
      textApiKey: '',
      imageApiKey: '',
      textToImageApiKey: '',
      imageToImageApiKey: '',
      textModel: 'gemini-3.1-flash-lite-preview',
      imageModel: 'gemini-3.1-flash-image-preview',
      textToImageModel: 'gemini-3.1-flash-image-preview',
      imageToImageModel: 'gemini-3.1-flash-image-preview',
    },
    'comfly-chat': {
      apiBaseUrl: '',
      textApiBaseUrl: '',
      imageApiBaseUrl: '',
      imageApiPath: '',
      textToImageApiBaseUrl: '',
      textToImageApiPath: DEFAULT_TEXT_TO_IMAGE_API_PATH,
      imageToImageApiBaseUrl: '',
      imageToImageApiPath: DEFAULT_IMAGE_TO_IMAGE_API_PATH,
      apiKey: '',
      textApiKey: '',
      imageApiKey: '',
      textToImageApiKey: '',
      imageToImageApiKey: '',
      textModel: 'gemini-3.1-flash-lite-preview',
      imageModel: 'gemini-3.1-flash-image-preview',
      textToImageModel: 'gemini-3.1-flash-image-preview',
      imageToImageModel: 'gemini-3.1-flash-image-preview',
    },
    'openai-compatible': {
      apiBaseUrl: '',
      textApiBaseUrl: '',
      imageApiBaseUrl: '',
      imageApiPath: '',
      textToImageApiBaseUrl: '',
      textToImageApiPath: DEFAULT_TEXT_TO_IMAGE_API_PATH,
      imageToImageApiBaseUrl: '',
      imageToImageApiPath: DEFAULT_IMAGE_TO_IMAGE_API_PATH,
      apiKey: '',
      textApiKey: '',
      imageApiKey: '',
      textToImageApiKey: '',
      imageToImageApiKey: '',
      textModel: 'gpt-4o',
      imageModel: 'gpt-image-2',
      textToImageModel: 'gpt-image-2',
      imageToImageModel: 'gpt-image-2',
    },
    'gemini-native': {
      apiBaseUrl: '',
      textApiBaseUrl: '',
      imageApiBaseUrl: '',
      imageApiPath: '',
      textToImageApiBaseUrl: '',
      textToImageApiPath: DEFAULT_TEXT_TO_IMAGE_API_PATH,
      imageToImageApiBaseUrl: '',
      imageToImageApiPath: DEFAULT_IMAGE_TO_IMAGE_API_PATH,
      apiKey: '',
      textApiKey: '',
      imageApiKey: '',
      textToImageApiKey: '',
      imageToImageApiKey: '',
      textModel: 'gemini-2.5-flash',
      imageModel: 'imagen-3.0-generate-001',
      textToImageModel: 'imagen-3.0-generate-001',
      imageToImageModel: 'imagen-3.0-generate-001',
    },
    custom: {
      apiBaseUrl: '',
      textApiBaseUrl: '',
      imageApiBaseUrl: '',
      imageApiPath: '',
      textToImageApiBaseUrl: '',
      textToImageApiPath: DEFAULT_TEXT_TO_IMAGE_API_PATH,
      imageToImageApiBaseUrl: '',
      imageToImageApiPath: DEFAULT_IMAGE_TO_IMAGE_API_PATH,
      apiKey: '',
      textApiKey: '',
      imageApiKey: '',
      textToImageApiKey: '',
      imageToImageApiKey: '',
      textModel: '',
      imageModel: '',
      textToImageModel: '',
      imageToImageModel: '',
    },
  };
}

function normalizePlatformConfig(config: PlatformApiConfigMap[PlatformPreset]): PlatformApiConfigMap[PlatformPreset] {
  return {
    ...config,
    textApiBaseUrl: config.textApiBaseUrl ?? config.apiBaseUrl,
    imageApiBaseUrl: config.imageApiBaseUrl ?? config.apiBaseUrl,
    imageApiPath: config.imageApiPath ?? '',
    textToImageApiBaseUrl: config.textToImageApiBaseUrl ?? '',
    textToImageApiPath: config.textToImageApiPath || config.imageApiPath || DEFAULT_TEXT_TO_IMAGE_API_PATH,
    imageToImageApiBaseUrl: config.imageToImageApiBaseUrl ?? '',
    imageToImageApiPath: config.imageToImageApiPath || config.imageApiPath || DEFAULT_IMAGE_TO_IMAGE_API_PATH,
    textApiKey: config.textApiKey ?? config.apiKey,
    imageApiKey: config.imageApiKey ?? config.apiKey,
    textToImageApiKey: config.textToImageApiKey ?? '',
    imageToImageApiKey: config.imageToImageApiKey ?? '',
    textToImageModel: config.textToImageModel ?? config.imageModel,
    imageToImageModel: config.imageToImageModel ?? config.imageModel,
  };
}

export function mergePlatformConfigs(configs?: Partial<PlatformApiConfigMap> | null): PlatformApiConfigMap {
  const defaults = createDefaultPlatformConfigs();
  if (!configs) return defaults;

  return {
    yunwu: normalizePlatformConfig({ ...defaults.yunwu, ...(configs.yunwu || {}) }),
    'comfly-chat': normalizePlatformConfig({ ...defaults['comfly-chat'], ...(configs['comfly-chat'] || {}) }),
    'openai-compatible': normalizePlatformConfig({
      ...defaults['openai-compatible'],
      ...(configs['openai-compatible'] || {}),
    }),
    'gemini-native': normalizePlatformConfig({ ...defaults['gemini-native'], ...(configs['gemini-native'] || {}) }),
    custom: normalizePlatformConfig({ ...defaults.custom, ...(configs.custom || {}) }),
  };
}

export function createApiConfigProfile(
  overrides: Partial<ApiConfigProfile> & {
    platformConfigs?: Partial<PlatformApiConfigMap> | PlatformApiConfigMap;
    selectedPlatformPreset?: PlatformPreset;
    name?: string;
    isActive?: boolean;
  } = {},
): ApiConfigProfile {
  return {
    id: overrides.id?.trim() || uuidv4(),
    name: overrides.name?.trim() || DEFAULT_API_CONFIG_PROFILE_NAME,
    isActive: overrides.isActive ?? true,
    selectedPlatformPreset: overrides.selectedPlatformPreset || 'yunwu',
    platformConfigs: mergePlatformConfigs(overrides.platformConfigs),
    updatedAt: overrides.updatedAt || Date.now(),
  };
}

export function createLegacyApiConfigProfile(seed: LegacyApiConfigSeed = {}): ApiConfigProfile {
  const selectedPlatformPreset = seed.platformPreset || 'yunwu';
  const nextConfigs = mergePlatformConfigs(seed.platformConfigs);
  const currentPlatformConfig = nextConfigs[selectedPlatformPreset];

  nextConfigs[selectedPlatformPreset] = normalizePlatformConfig({
    ...currentPlatformConfig,
    apiBaseUrl: seed.textApiBaseUrl || seed.apiBaseUrl || currentPlatformConfig.apiBaseUrl,
    textApiBaseUrl: seed.textApiBaseUrl || seed.apiBaseUrl || currentPlatformConfig.textApiBaseUrl,
    imageApiBaseUrl: seed.imageApiBaseUrl || seed.apiBaseUrl || currentPlatformConfig.imageApiBaseUrl,
    imageApiPath: seed.imageApiPath ?? currentPlatformConfig.imageApiPath,
    textToImageApiBaseUrl: seed.textToImageApiBaseUrl ?? currentPlatformConfig.textToImageApiBaseUrl,
    textToImageApiPath:
      seed.textToImageApiPath || seed.imageApiPath || currentPlatformConfig.textToImageApiPath,
    imageToImageApiBaseUrl: seed.imageToImageApiBaseUrl ?? currentPlatformConfig.imageToImageApiBaseUrl,
    imageToImageApiPath:
      seed.imageToImageApiPath || seed.imageApiPath || currentPlatformConfig.imageToImageApiPath,
    apiKey: seed.textApiKey || seed.apiKey || currentPlatformConfig.apiKey,
    textApiKey: seed.textApiKey || seed.apiKey || currentPlatformConfig.textApiKey,
    imageApiKey: seed.imageApiKey || seed.apiKey || currentPlatformConfig.imageApiKey,
    textToImageApiKey: seed.textToImageApiKey ?? currentPlatformConfig.textToImageApiKey,
    imageToImageApiKey: seed.imageToImageApiKey ?? currentPlatformConfig.imageToImageApiKey,
    textModel: seed.textModel || currentPlatformConfig.textModel,
    imageModel: seed.imageModel || currentPlatformConfig.imageModel,
    textToImageModel: seed.textToImageModel || seed.imageModel || currentPlatformConfig.textToImageModel,
    imageToImageModel: seed.imageToImageModel || seed.imageModel || currentPlatformConfig.imageToImageModel,
  });

  return createApiConfigProfile({
    name: DEFAULT_API_CONFIG_PROFILE_NAME,
    isActive: true,
    selectedPlatformPreset,
    platformConfigs: nextConfigs,
  });
}

export function normalizeApiConfigProfiles(
  profiles: ApiConfigProfile[] | undefined | null,
  legacySeed?: LegacyApiConfigSeed,
): ApiConfigProfile[] {
  const nextProfiles =
    profiles && profiles.length > 0
      ? profiles.map((profile, index) => {
          const selectedPlatformPreset = isPlatformPreset(profile.selectedPlatformPreset)
            ? profile.selectedPlatformPreset
            : 'yunwu';
          return createApiConfigProfile({
            ...profile,
            name: profile.name?.trim() || `配置 ${index + 1}`,
            selectedPlatformPreset,
            isActive: Boolean(profile.isActive),
            platformConfigs: profile.platformConfigs,
          });
        })
      : [createLegacyApiConfigProfile(legacySeed)];

  const firstActiveIndex = nextProfiles.findIndex((profile) => profile.isActive);

  return nextProfiles.map((profile, index) => ({
    ...profile,
    isActive: firstActiveIndex === -1 ? index === 0 : index === firstActiveIndex,
  }));
}
