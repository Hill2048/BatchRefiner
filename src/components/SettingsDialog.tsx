import * as React from 'react';
import { toast } from 'sonner';
import { useAppStore } from '@/store';
import { useShallow } from 'zustand/react/shallow';
import { PlatformApiConfigMap, PlatformPreset } from '@/types';
import { clearDownloadDirectory, pickDownloadDirectory, supportsDirectoryDownload } from '@/lib/downloadDirectory';
import {
  clearCacheDirectoryHandle,
  getCacheDirectoryHandle,
  pickCacheDirectory,
  supportsCacheDirectory,
} from '@/lib/cacheDirectory';
import { clearResultImageCache } from '@/lib/resultImageCache';
import { saveLocalCacheSnapshot } from '@/lib/localCachePersistence';
import { normalizeTaskConcurrency } from '@/lib/taskExecutionQueue';
import {
  ApiConfigPayload,
  decryptApiConfig,
  encryptApiConfig,
  isEncryptedApiConfig,
  MultiPlatformApiConfigPayload,
} from '@/lib/secureConfig';
import { fetchPlatformQuota, type PlatformQuotaSnapshot } from '@/lib/platformQuota';
import { resolveImageRoute, resolveTextRoute, type ResolvedRoute } from '@/lib/modelRouting';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog';
import { Input } from './ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { GenerationLogDialog } from './logs/GenerationLogDialog';

type ResultState = {
  status: 'idle' | 'success' | 'error';
  msg: string;
};

type ModelItem = {
  id?: unknown;
  name?: unknown;
  supported_endpoint_types?: unknown;
  supportedGenerationMethods?: unknown;
};

const PLATFORM_PRESETS: Array<{
  value: PlatformPreset;
  label: string;
  defaultBaseUrl: string;
  defaultTextModel: string;
  defaultImageModel: string;
}> = [
  {
    value: 'yunwu',
    label: '云雾',
    defaultBaseUrl: 'https://yunwu.ai',
    defaultTextModel: 'gemini-3.1-flash-lite-preview',
    defaultImageModel: 'gemini-3.1-flash-image-preview',
  },
  {
    value: 'comfly-chat',
    label: 'comfly.chat',
    defaultBaseUrl: 'https://ai.comfly.chat',
    defaultTextModel: 'gemini-3.1-flash-lite-preview',
    defaultImageModel: 'gemini-3.1-flash-image-preview',
  },
  {
    value: 'openai-compatible',
    label: '通用 OpenAI 兼容',
    defaultBaseUrl: '',
    defaultTextModel: 'gpt-4o',
    defaultImageModel: 'gpt-image-2',
  },
  {
    value: 'gemini-native',
    label: 'Gemini / Imagen 原生',
    defaultBaseUrl: '',
    defaultTextModel: 'gemini-2.5-flash',
    defaultImageModel: 'imagen-3.0-generate-001',
  },
  {
    value: 'custom',
    label: '自定义',
    defaultBaseUrl: '',
    defaultTextModel: '',
    defaultImageModel: '',
  },
];

const BUILT_IN_TEXT_MODELS = [
  'gemini-3.1-flash-lite-preview',
  'gemini-3.1-pro',
  'gemini-2.5-flash',
  'gemini-2.5-pro',
  'gpt-4o',
  'claude-3-5-sonnet-20241022',
];

const BUILT_IN_IMAGE_MODELS = [
  'gemini-3.1-flash-image-preview',
  'gemini-3.1-flash-image-preview-2k',
  'gemini-3.1-flash-image-preview-4k',
  'gemini-2.5-flash-image',
  'gemini-3-pro-image-preview',
  'nano-banana-pro',
  'nano-banana-pro-2k',
  'gpt-image-2',
  'image2',
  'gpt-image-1',
  'imagen-3.0-generate-001',
];

function uniqSorted(values: string[]) {
  return Array.from(new Set(values.filter(Boolean))).sort();
}

function getPresetConfig(preset: PlatformPreset) {
  return PLATFORM_PRESETS.find((item) => item.value === preset) || PLATFORM_PRESETS[0];
}

function createDefaultPlatformConfigs(): PlatformApiConfigMap {
  return {
    'yunwu': {
      apiBaseUrl: 'https://yunwu.ai',
      textApiBaseUrl: 'https://yunwu.ai',
      imageApiBaseUrl: 'https://yunwu.ai',
      imageApiPath: '',
      apiKey: '',
      textApiKey: '',
      imageApiKey: '',
      textModel: 'gemini-3.1-flash-lite-preview',
      imageModel: 'gemini-3.1-flash-image-preview',
    },
    'comfly-chat': {
      apiBaseUrl: 'https://ai.comfly.chat',
      textApiBaseUrl: 'https://ai.comfly.chat',
      imageApiBaseUrl: 'https://ai.comfly.chat',
      imageApiPath: '',
      apiKey: '',
      textApiKey: '',
      imageApiKey: '',
      textModel: 'gemini-3.1-flash-lite-preview',
      imageModel: 'gemini-3.1-flash-image-preview',
    },
    'openai-compatible': {
      apiBaseUrl: '',
      textApiBaseUrl: '',
      imageApiBaseUrl: '',
      imageApiPath: '',
      apiKey: '',
      textApiKey: '',
      imageApiKey: '',
      textModel: 'gpt-4o',
      imageModel: 'gpt-image-2',
    },
    'gemini-native': {
      apiBaseUrl: '',
      textApiBaseUrl: '',
      imageApiBaseUrl: '',
      imageApiPath: '',
      apiKey: '',
      textApiKey: '',
      imageApiKey: '',
      textModel: 'gemini-2.5-flash',
      imageModel: 'imagen-3.0-generate-001',
    },
    'custom': {
      apiBaseUrl: '',
      textApiBaseUrl: '',
      imageApiBaseUrl: '',
      imageApiPath: '',
      apiKey: '',
      textApiKey: '',
      imageApiKey: '',
      textModel: '',
      imageModel: '',
    },
  };
}

function mergePlatformConfigs(configs?: Partial<PlatformApiConfigMap> | null): PlatformApiConfigMap {
  const defaults = createDefaultPlatformConfigs();
  if (!configs) return defaults;

  return {
    'yunwu': normalizePlatformConfig({ ...defaults['yunwu'], ...(configs['yunwu'] || {}) }),
    'comfly-chat': normalizePlatformConfig({ ...defaults['comfly-chat'], ...(configs['comfly-chat'] || {}) }),
    'openai-compatible': normalizePlatformConfig({ ...defaults['openai-compatible'], ...(configs['openai-compatible'] || {}) }),
    'gemini-native': normalizePlatformConfig({ ...defaults['gemini-native'], ...(configs['gemini-native'] || {}) }),
    'custom': normalizePlatformConfig({ ...defaults['custom'], ...(configs['custom'] || {}) }),
  };
}

function normalizePlatformConfig(config: PlatformApiConfigMap[PlatformPreset]): PlatformApiConfigMap[PlatformPreset] {
  return {
    ...config,
    textApiBaseUrl: config.textApiBaseUrl ?? config.apiBaseUrl,
    imageApiBaseUrl: config.imageApiBaseUrl ?? config.apiBaseUrl,
    imageApiPath: config.imageApiPath ?? '',
    textApiKey: config.textApiKey ?? config.apiKey,
    imageApiKey: config.imageApiKey ?? config.apiKey,
  };
}

function normalizeOpenAIBaseUrl(baseUrl: string) {
  let normalized = baseUrl.trim().replace(/\/+$/, '');
  if (normalized.endsWith('/v1beta') || normalized.endsWith('/v1alpha')) {
    normalized = normalized.replace(/\/v1(beta|alpha)$/, '/v1');
  }
  if (!normalized.endsWith('/v1') && !normalized.includes('/v1/')) normalized += '/v1';
  return normalized;
}

function normalizeComflyBaseUrl(baseUrl: string) {
  let normalized = baseUrl.trim().replace(/\/+$/, '');
  if (!normalized) normalized = 'https://ai.comfly.chat';
  return normalizeOpenAIBaseUrl(normalized);
}

function looksLikeImageModel(modelId: string, endpointTypes: string[] = []) {
  const normalizedId = modelId.toLowerCase();
  if (endpointTypes.some((item) => item.toLowerCase().includes('image'))) return true;
  return (
    normalizedId.includes('image') ||
    normalizedId.includes('imagen') ||
    normalizedId.includes('dall-e') ||
    normalizedId.includes('banana') ||
    normalizedId.includes('flux')
  );
}

function splitModelOptions(items: ModelItem[]) {
  const textModels: string[] = [];
  const imageModels: string[] = [];

  items.forEach((item) => {
    const id = typeof item?.id === 'string'
      ? item.id.trim()
      : typeof item?.name === 'string'
        ? item.name.trim().replace(/^models\//, '')
        : '';
    if (!id) return;

    const endpointTypes = Array.isArray(item?.supported_endpoint_types)
      ? item.supported_endpoint_types.filter((value): value is string => typeof value === 'string')
      : [];
    const generationMethods = Array.isArray(item?.supportedGenerationMethods)
      ? item.supportedGenerationMethods.filter((value): value is string => typeof value === 'string')
      : [];

    if (looksLikeImageModel(id, [...endpointTypes, ...generationMethods])) {
      imageModels.push(id);
    } else {
      textModels.push(id);
    }
  });

  return {
    textModels: uniqSorted(textModels),
    imageModels: uniqSorted(imageModels),
  };
}

function formatQuotaSummary(snapshot: PlatformQuotaSnapshot) {
  if (snapshot.platform === 'comfly-chat') {
    const accountName = snapshot.accountName ? `账户：${snapshot.accountName}` : '';
    const quotaText = `额度：${snapshot.quota}`;
    return [accountName, quotaText].filter(Boolean).join('，');
  }

  const remainingText = `剩余额度：$${snapshot.balanceUsd.toFixed(snapshot.balanceUsd >= 100 ? 0 : 2)}`;
  const usageText = `本月已用：$${snapshot.usageUsd.toFixed(snapshot.usageUsd >= 100 ? 0 : 2)}`;
  return [remainingText, usageText].join('，');
}

function Section({
  title,
  children,
  bordered = true,
}: {
  title?: string;
  children: React.ReactNode;
  bordered?: boolean;
}) {
  return (
    <div className={`flex flex-col gap-2 ${bordered ? 'border-t border-border/80 pt-5' : ''}`}>
      {title ? <h4 className="text-[15.44px] font-medium text-text-primary">{title}</h4> : null}
      {children}
    </div>
  );
}

function StatusBox({ tone, message }: { tone: 'success' | 'error'; message: string }) {
  const className =
    tone === 'success'
      ? 'rounded-xl border border-emerald-100 bg-emerald-50/60 p-2 text-[11.55px] break-all text-emerald-700'
      : 'max-h-24 overflow-y-auto rounded-xl border border-red-100 bg-red-50/50 p-2 font-mono text-[11.55px] break-all text-red-600';

  return <div className={className}>{message}</div>;
}

function getRouteTransportLabel(transport: ResolvedRoute['transport']) {
  switch (transport) {
    case 'gemini-gateway':
      return 'Gemini 网关';
    case 'openai-chat-completions':
      return 'Chat Completions';
    case 'openai-images':
      return 'Images API';
    case 'gemini-native':
      return 'Gemini 原生';
    default:
      return transport;
  }
}

function getRouteTransportClassName(transport: ResolvedRoute['transport']) {
  switch (transport) {
    case 'gemini-gateway':
      return 'border-emerald-200/70 bg-emerald-50/70 text-emerald-700';
    case 'openai-chat-completions':
      return 'border-sky-200/80 bg-sky-50/75 text-sky-700';
    case 'openai-images':
      return 'border-amber-200/80 bg-amber-50/75 text-amber-700';
    case 'gemini-native':
      return 'border-stone-200/80 bg-stone-100/80 text-stone-700';
    default:
      return 'border-border/80 bg-white text-text-secondary';
  }
}

function RouteSummaryCard({ route }: { route: ResolvedRoute }) {
  return (
    <div className="rounded-2xl border border-border/70 bg-white/85 px-4 py-3 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[12.6px] font-medium text-text-primary">{route.title}</div>
          <p className="mt-1 text-[11.55px] leading-5 text-text-secondary">{route.summary}</p>
        </div>
        <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[10.5px] font-medium ${getRouteTransportClassName(route.transport)}`}>
          {getRouteTransportLabel(route.transport)}
        </span>
      </div>

      <div className="mt-2 space-y-1">
        {route.detailLines.map((line, index) => (
          <div
            key={`${route.title}-${index}`}
            className={`text-[11.55px] leading-5 text-text-secondary ${line.startsWith('请求：') ? 'break-all font-mono text-[11.1px]' : ''}`}
          >
            {line}
          </div>
        ))}
      </div>

      {route.notes.length ? (
        <div className="mt-2 rounded-xl border border-black/5 bg-[#F5F1E8]/80 px-3 py-2 text-[11.55px] leading-5 text-text-secondary">
          {route.notes.map((note, index) => (
            <div key={`${route.title}-note-${index}`}>{note}</div>
          ))}
        </div>
      ) : null}

      {route.warnings.length ? (
        <div className="mt-2 rounded-xl border border-amber-200/80 bg-amber-50/85 px-3 py-2 text-[11.55px] leading-5 text-amber-700">
          {route.warnings.map((warning, index) => (
            <div key={`${route.title}-warning-${index}`}>{warning}</div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

const mergedInputClassName = "h-11 border-0 bg-transparent px-3 text-[13.65px] shadow-none focus-visible:ring-0";

function ModelInput({
  value,
  onChange,
  options,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  options: string[];
  placeholder: string;
}) {
  const [isOpen, setIsOpen] = React.useState(false);
  const filteredOptions = React.useMemo(() => {
    const keyword = value.trim().toLowerCase();
    const filtered = keyword
      ? options.filter((option) => option.toLowerCase().includes(keyword))
      : options;
    return filtered.slice(0, 12);
  }, [options, value]);

  return (
    <div className="relative">
      <Input
        type="text"
        value={value}
        onFocus={() => setIsOpen(true)}
        onBlur={() => window.setTimeout(() => setIsOpen(false), 120)}
        onChange={(e) => {
          onChange(e.target.value);
          setIsOpen(true);
        }}
        className={`${mergedInputClassName} pr-8`}
        placeholder={placeholder}
      />
      <button
        type="button"
        aria-label="展开模型列表"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setIsOpen((current) => !current)}
        className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg text-[10px] text-text-secondary transition-colors hover:bg-black/5"
      >
        ▼
      </button>
      {isOpen && filteredOptions.length > 0 ? (
        <div className="absolute left-2 right-2 top-[calc(100%-2px)] z-50 max-h-48 overflow-y-auto rounded-xl border border-border/80 bg-white p-1 shadow-[0_18px_44px_-12px_rgba(0,0,0,0.18)]">
          {filteredOptions.map((option) => (
            <button
              key={option}
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                onChange(option);
                setIsOpen(false);
              }}
              className="block w-full rounded-lg px-3 py-2 text-left text-[13.65px] text-text-primary transition-colors hover:bg-[#F5F4F0]"
            >
              {option}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function SettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const {
    apiBaseUrl: savedApiBaseUrl,
    apiKey: savedApiKey,
    cacheDirectoryName: savedCacheDirectoryName,
    downloadDirectoryName: savedDownloadDirectoryName,
    imageApiBaseUrl: savedImageApiBaseUrl,
    imageApiKey: savedImageApiKey,
    imageApiPath: savedImageApiPath,
    imageModel: savedImageModel,
    maxConcurrency: savedMaxConcurrency,
    platformConfigs,
    platformPreset: savedPlatformPreset,
    setApiBaseUrl,
    setImageApiBaseUrl,
    setImageApiKey,
    setImageApiPath,
    setMaxConcurrency,
    setProjectFields,
    setTextApiBaseUrl,
    setTextApiKey,
    textApiBaseUrl: savedTextApiBaseUrl,
    textApiKey: savedTextApiKey,
    textModel: savedTextModel,
  } = useAppStore(
    useShallow((state) => ({
      apiBaseUrl: state.apiBaseUrl,
      apiKey: state.apiKey,
      cacheDirectoryName: state.cacheDirectoryName,
      downloadDirectoryName: state.downloadDirectoryName,
      imageApiBaseUrl: state.imageApiBaseUrl,
      imageApiKey: state.imageApiKey,
      imageApiPath: state.imageApiPath,
      imageModel: state.imageModel,
      maxConcurrency: state.maxConcurrency,
      platformConfigs: state.platformConfigs,
      platformPreset: state.platformPreset,
      setApiBaseUrl: state.setApiBaseUrl,
      setImageApiBaseUrl: state.setImageApiBaseUrl,
      setImageApiKey: state.setImageApiKey,
      setImageApiPath: state.setImageApiPath,
      setMaxConcurrency: state.setMaxConcurrency,
      setProjectFields: state.setProjectFields,
      setTextApiBaseUrl: state.setTextApiBaseUrl,
      setTextApiKey: state.setTextApiKey,
      textApiBaseUrl: state.textApiBaseUrl,
      textApiKey: state.textApiKey,
      textModel: state.textModel,
    })),
  );
  const generationLogs = useAppStore((state) => state.generationLogs);
  const mergedPlatformConfigs = React.useMemo(
    () => mergePlatformConfigs(platformConfigs),
    [platformConfigs],
  );

  const [platformPreset, setPlatformPreset] = React.useState<PlatformPreset>(savedPlatformPreset || 'yunwu');
  const [textApiKey, setTextApiKeyValue] = React.useState(savedTextApiKey || savedApiKey);
  const [imageApiKey, setImageApiKeyValue] = React.useState(savedImageApiKey || savedApiKey);
  const [apiBaseUrl, setApiBaseUrlValue] = React.useState(savedApiBaseUrl);
  const [textApiBaseUrl, setTextApiBaseUrlValue] = React.useState(savedTextApiBaseUrl || savedApiBaseUrl);
  const [imageApiBaseUrl, setImageApiBaseUrlValue] = React.useState(savedImageApiBaseUrl || savedApiBaseUrl);
  const [imageApiPath, setImageApiPathValue] = React.useState(savedImageApiPath || '');
  const [maxConcurrency, setMaxConcurrencyValue] = React.useState(String(savedMaxConcurrency));
  const [localTextModel, setLocalTextModel] = React.useState(savedTextModel || 'gemini-3.1-flash-lite-preview');
  const [localImageModel, setLocalImageModel] = React.useState(savedImageModel || 'gemini-3.1-flash-image-preview');
  const [downloadDirectoryName, setDownloadDirectoryName] = React.useState(savedDownloadDirectoryName || '');
  const [cacheDirectoryName, setCacheDirectoryName] = React.useState(savedCacheDirectoryName || '');
  const [allPlatformConfigs, setAllPlatformConfigs] = React.useState<PlatformApiConfigMap>(mergedPlatformConfigs);
  const [remoteTextModels, setRemoteTextModels] = React.useState<string[]>([]);
  const [remoteImageModels, setRemoteImageModels] = React.useState<string[]>([]);
  const [isPickingDirectory, setIsPickingDirectory] = React.useState(false);
  const [isPickingCacheDirectory, setIsPickingCacheDirectory] = React.useState(false);
  const [isClearingCache, setIsClearingCache] = React.useState(false);
  const [isTesting, setIsTesting] = React.useState(false);
  const [isCheckingQuota, setIsCheckingQuota] = React.useState(false);
  const [isLoadingModels, setIsLoadingModels] = React.useState(false);
  const [testResult, setTestResult] = React.useState<ResultState>({ status: 'idle', msg: '' });
  const [quotaResult, setQuotaResult] = React.useState<ResultState>({ status: 'idle', msg: '' });
  const [isLogDialogOpen, setIsLogDialogOpen] = React.useState(false);

  const applyPlatformConfigToForm = React.useCallback((preset: PlatformPreset, configs: PlatformApiConfigMap) => {
    const next = configs[preset];
    setPlatformPreset(preset);
    setTextApiKeyValue(next.textApiKey || next.apiKey);
    setImageApiKeyValue(next.imageApiKey || next.apiKey);
    setApiBaseUrlValue(next.apiBaseUrl);
    setTextApiBaseUrlValue(next.textApiBaseUrl || next.apiBaseUrl);
    setImageApiBaseUrlValue(next.imageApiBaseUrl || next.apiBaseUrl);
    setImageApiPathValue(next.imageApiPath || '');
    setLocalTextModel(next.textModel);
    setLocalImageModel(next.imageModel);
  }, []);

  const syncCurrentFormToConfigs = React.useCallback((configs: PlatformApiConfigMap): PlatformApiConfigMap => {
    return {
      ...configs,
      [platformPreset]: {
        apiBaseUrl: textApiBaseUrl || apiBaseUrl,
        textApiBaseUrl,
        imageApiBaseUrl,
        imageApiPath,
        apiKey: textApiKey,
        textApiKey,
        imageApiKey,
        textModel: localTextModel,
        imageModel: localImageModel,
      },
    };
  }, [apiBaseUrl, imageApiBaseUrl, imageApiKey, imageApiPath, localImageModel, localTextModel, platformPreset, textApiBaseUrl, textApiKey]);

  React.useEffect(() => {
    const nextConfigs = mergePlatformConfigs(platformConfigs);
    setAllPlatformConfigs(nextConfigs);
    applyPlatformConfigToForm(savedPlatformPreset || 'yunwu', nextConfigs);
    setMaxConcurrencyValue(String(savedMaxConcurrency));
    setDownloadDirectoryName(savedDownloadDirectoryName || '');
    setCacheDirectoryName(savedCacheDirectoryName || '');
    setRemoteTextModels([]);
    setRemoteImageModels([]);
    setTestResult({ status: 'idle', msg: '' });
    setQuotaResult({ status: 'idle', msg: '' });
    setIsPickingDirectory(false);
  }, [
    applyPlatformConfigToForm,
    open,
    platformConfigs,
    savedDownloadDirectoryName,
    savedCacheDirectoryName,
    savedMaxConcurrency,
    savedPlatformPreset,
  ]);

  React.useEffect(() => {
    if (!open || cacheDirectoryName) return;

    let cancelled = false;
    getCacheDirectoryHandle().then((handle) => {
      if (cancelled || !handle?.name) return;
      setCacheDirectoryName(handle.name);
      setProjectFields({ cacheDirectoryName: handle.name });
    });

    return () => {
      cancelled = true;
    };
  }, [cacheDirectoryName, open, setProjectFields]);

  const textModelOptions = uniqSorted([...BUILT_IN_TEXT_MODELS, ...remoteTextModels]);
  const imageModelOptions = uniqSorted([...BUILT_IN_IMAGE_MODELS, ...remoteImageModels]);
  const supportsQuota = platformPreset === 'yunwu' || platformPreset === 'comfly-chat';
  const isComfly = platformPreset === 'comfly-chat';
  const routingInput = React.useMemo(
    () => ({
      platformPreset,
      apiBaseUrl,
      textApiBaseUrl,
      imageApiBaseUrl,
      imageApiPath,
      apiKey: textApiKey,
      textApiKey,
      imageApiKey,
      textModel: localTextModel,
      imageModel: localImageModel,
    }),
    [
      apiBaseUrl,
      imageApiBaseUrl,
      imageApiKey,
      imageApiPath,
      localImageModel,
      localTextModel,
      platformPreset,
      textApiBaseUrl,
      textApiKey,
    ],
  );
  const textRoute = React.useMemo(() => resolveTextRoute(routingInput), [routingInput]);
  const imageRouteWithoutInput = React.useMemo(
    () => resolveImageRoute(routingInput, { hasImageInputs: false }),
    [routingInput],
  );
  const imageRouteWithInput = React.useMemo(
    () => resolveImageRoute(routingInput, { hasImageInputs: true }),
    [routingInput],
  );

  const handlePresetChange = (preset: PlatformPreset) => {
    const syncedConfigs = syncCurrentFormToConfigs(allPlatformConfigs);
    setAllPlatformConfigs(syncedConfigs);
    applyPlatformConfigToForm(preset, syncedConfigs);
    setRemoteTextModels([]);
    setRemoteImageModels([]);
    setTestResult({ status: 'idle', msg: '' });
    setQuotaResult({ status: 'idle', msg: '' });
  };

  const applyImportedConfig = (data: ApiConfigPayload | MultiPlatformApiConfigPayload) => {
    if (data.version === 2) {
      const nextConfigs = mergePlatformConfigs(data.platformConfigs);
      setAllPlatformConfigs(nextConfigs);
      applyPlatformConfigToForm(data.selectedPlatformPreset, nextConfigs);
      return;
    }

    const nextConfigs = mergePlatformConfigs({
      ...allPlatformConfigs,
      [data.platformPreset]: {
        apiBaseUrl: data.apiBaseUrl,
        textApiBaseUrl: data.textApiBaseUrl || data.apiBaseUrl,
        imageApiBaseUrl: data.imageApiBaseUrl || data.apiBaseUrl,
        imageApiPath: data.imageApiPath || '',
        apiKey: data.apiKey,
        textApiKey: data.textApiKey || data.apiKey,
        imageApiKey: data.imageApiKey || data.apiKey,
        textModel: data.textModel,
        imageModel: data.imageModel,
      },
    });

    setAllPlatformConfigs(nextConfigs);
    applyPlatformConfigToForm(data.platformPreset, nextConfigs);
  };

  const setRemoteModels = React.useCallback((items: ModelItem[]) => {
    const next = splitModelOptions(items);
    setRemoteTextModels(next.textModels);
    setRemoteImageModels(next.imageModels);
  }, []);

  const fetchRemoteModels = React.useCallback(async () => {
    const baseUrlEntries = [
      { baseUrl: textApiBaseUrl || apiBaseUrl, apiKey: textApiKey },
      { baseUrl: imageApiBaseUrl || textApiBaseUrl || apiBaseUrl, apiKey: imageApiKey || textApiKey },
    ].filter((entry) => entry.baseUrl && entry.apiKey);

    if (platformPreset === 'gemini-native') {
      const apiKey = textApiKey || imageApiKey;
      if (!apiKey.trim()) {
        throw new Error('请先填写 API Key');
      }

      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey.trim())}`, {
        method: 'GET',
      });

      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.error?.message || data?.message || '模型列表获取失败');
      }

      return Array.isArray(data?.models) ? (data.models as ModelItem[]) : [];
    }

    if (!baseUrlEntries.length) {
      throw new Error('请先填写 API 地址和 API Key');
    }

    const uniqueEntries = Array.from(
      new Map(baseUrlEntries.map((entry) => [`${entry.baseUrl}\n${entry.apiKey}`, entry])).values(),
    );
    const results = await Promise.all(
      uniqueEntries.map(async ({ baseUrl, apiKey }) => {
    const response = await fetch(`${normalizeOpenAIBaseUrl(baseUrl)}/models`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey.trim()}`,
      },
    });

    const data = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(data?.error?.message || data?.message || '模型列表获取失败');
    }

    return Array.isArray(data?.data) ? (data.data as ModelItem[]) : [];
      }),
    );

    const byId = new Map<string, ModelItem>();
    results.flat().forEach((item) => {
      if (typeof item.id === 'string' && item.id.trim()) {
        byId.set(item.id, item);
      }
    });
    return Array.from(byId.values());
  }, [apiBaseUrl, imageApiBaseUrl, imageApiKey, platformPreset, textApiBaseUrl, textApiKey]);

  const loadRemoteModels = async () => {
    setIsLoadingModels(true);
    try {
      const items = await fetchRemoteModels();
      setRemoteModels(items);
      toast.success(`已拉取 ${items.length} 个模型`);
    } catch (error: any) {
      toast.error(error?.message || '模型列表获取失败');
    } finally {
      setIsLoadingModels(false);
    }
  };

  const testConnection = async () => {
    setIsTesting(true);
    setTestResult({ status: 'idle', msg: '正在测试...' });

    try {
      const modelToTest = localTextModel || 'gemini-2.5-flash';

      if (isComfly) {
        const items = await fetchRemoteModels();
        setRemoteModels(items);

        const hasConfiguredModel = items.some((item) => item?.id === modelToTest);
        const msg = hasConfiguredModel
          ? `API Key 正常，已获取 ${items.length} 个模型`
          : `API Key 正常，已获取 ${items.length} 个模型，但当前文本模型 ${modelToTest} 不在列表中`;

        setTestResult({ status: 'success', msg });
        toast.success(msg);
        return;
      }

      let apiEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelToTest}:generateContent?key=${textApiKey}`;
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      let body = JSON.stringify({ contents: [{ parts: [{ text: 'Say hello' }] }] });

      const textBaseUrl = textApiBaseUrl || apiBaseUrl;
      if (platformPreset === 'yunwu' && textBaseUrl.trim()) {
        let baseUrl = textBaseUrl.trim().replace(/\/+$/, '');
        if (baseUrl.endsWith('/v1')) baseUrl = baseUrl.replace(/\/v1$/, '/v1beta');
        if (!baseUrl.endsWith('/v1beta') && !baseUrl.includes('/v1beta/')) baseUrl += '/v1beta';
        apiEndpoint = `${baseUrl}/models/${modelToTest}:generateContent`;
        headers.Authorization = `Bearer ${textApiKey}`;
      } else if (textBaseUrl.trim()) {
        apiEndpoint = `${normalizeOpenAIBaseUrl(textBaseUrl)}/chat/completions`;
        headers.Authorization = `Bearer ${textApiKey}`;
        body = JSON.stringify({
          model: modelToTest,
          messages: [{ role: 'user', content: 'Say hello' }],
        });
      }

      const response = await fetch(apiEndpoint, { method: 'POST', headers, body });
      const data = await response.json().catch(() => null);

      if (!response.ok || data?.error) {
        throw new Error(data?.error?.message || '连接测试失败');
      }

      setTestResult({ status: 'success', msg: '连接正常' });
      toast.success('API 连接正常');
    } catch (error: any) {
      const msg = error?.message || '连接失败';
      setTestResult({ status: 'error', msg });
      toast.error('API 连接失败，请检查地址、密钥或网络');
    } finally {
      setIsTesting(false);
    }
  };

  const checkQuota = async () => {
    setIsCheckingQuota(true);
    setQuotaResult({ status: 'idle', msg: '正在查询...' });

    try {
      const snapshot = await fetchPlatformQuota(platformPreset, textApiBaseUrl || apiBaseUrl, textApiKey);
      const msg = formatQuotaSummary(snapshot);
      setQuotaResult({ status: 'success', msg });
      toast.success(msg);
    } catch (error: any) {
      const msg = error?.message || '额度查询失败';
      setQuotaResult({ status: 'error', msg });
      toast.error(msg);
    } finally {
      setIsCheckingQuota(false);
    }
  };

  const handleImportConfig = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,.txt,.brcfg';
    input.onchange = (event: Event) => {
      const file = (event.target as HTMLInputElement).files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = async (loadEvent) => {
        if (!loadEvent.target?.result) return;

        try {
          const raw = String(loadEvent.target.result);
          const parsed = JSON.parse(raw);

          if (!isEncryptedApiConfig(parsed)) {
            throw new Error('这不是当前版本的 BatchRefiner 配置文件');
          }

          const decrypted = await decryptApiConfig(raw);
          applyImportedConfig(decrypted);
          toast.success(decrypted.version === 2 ? '已导入全部平台配置' : '已导入单个平台配置');
        } catch (error: any) {
          toast.error(error?.message || '配置文件解析失败');
        }
      };

      reader.readAsText(file);
    };

    input.click();
  };

const handleExportCurrentConfig = async () => {
    try {
      const { saveAs } = await import('file-saver');
      const syncedConfigs = syncCurrentFormToConfigs(allPlatformConfigs);
      const currentConfig = syncedConfigs[platformPreset];
      const payload: ApiConfigPayload = {
        version: 1,
        platformPreset,
        apiBaseUrl: currentConfig.apiBaseUrl,
        textApiBaseUrl: currentConfig.textApiBaseUrl,
        imageApiBaseUrl: currentConfig.imageApiBaseUrl,
        imageApiPath: currentConfig.imageApiPath,
        apiKey: currentConfig.apiKey,
        textApiKey: currentConfig.textApiKey,
        imageApiKey: currentConfig.imageApiKey,
        textModel: currentConfig.textModel,
        imageModel: currentConfig.imageModel,
        exportedAt: new Date().toISOString(),
      };

      const encryptedConfig = await encryptApiConfig(payload);
      const blob = new Blob([encryptedConfig], { type: 'application/json;charset=utf-8' });
      saveAs(blob, `BatchRefiner_API_Config_${platformPreset}_${new Date().toISOString().slice(0, 10)}.json`);
      toast.success('已导出当前平台配置');
    } catch (error: any) {
      toast.error(error?.message || '导出失败');
    }
  };

  const handleExportAllConfigs = async () => {
    try {
      const { saveAs } = await import('file-saver');
      const payload: MultiPlatformApiConfigPayload = {
        version: 2,
        selectedPlatformPreset: platformPreset,
        platformConfigs: syncCurrentFormToConfigs(allPlatformConfigs),
        exportedAt: new Date().toISOString(),
      };

      const encryptedConfig = await encryptApiConfig(payload);
      const blob = new Blob([encryptedConfig], { type: 'application/json;charset=utf-8' });
      saveAs(blob, `BatchRefiner_API_Configs_${new Date().toISOString().slice(0, 10)}.json`);
      toast.success('已导出全部平台配置');
    } catch (error: any) {
      toast.error(error?.message || '导出失败');
    }
  };

  const handlePickDownloadDirectory = async () => {
    if (isPickingDirectory) return;
    setIsPickingDirectory(true);

    try {
      const { name } = await pickDownloadDirectory();
      setDownloadDirectoryName(name);
      setProjectFields({ downloadDirectoryName: name });
      toast.success(`已设置结果图下载目录：${name}`);
    } catch (error: any) {
      if (error?.name !== 'AbortError') {
        toast.error(error?.message || '选择下载目录失败');
      }
    } finally {
      setIsPickingDirectory(false);
    }
  };

  const handleClearDownloadDirectory = async () => {
    try {
      await clearDownloadDirectory();
      setDownloadDirectoryName('');
      setProjectFields({ downloadDirectoryName: '' });
      toast.success('已清除结果图下载目录');
    } catch {
      toast.error('清除下载目录失败');
    }
  };

  const handlePickCacheDirectory = async () => {
    if (isPickingCacheDirectory) return;
    setIsPickingCacheDirectory(true);

    try {
      const { name } = await pickCacheDirectory();
      setCacheDirectoryName(name);
      setProjectFields({ cacheDirectoryName: name });
      await saveLocalCacheSnapshot();
      toast.success(`已设置缓存目录：${name}`);
    } catch (error: any) {
      if (error?.name !== 'AbortError') {
        toast.error(error?.message || '选择缓存目录失败');
      }
    } finally {
      setIsPickingCacheDirectory(false);
    }
  };

  const handleClearCache = async () => {
    if (isClearingCache) return;
    setIsClearingCache(true);

    try {
      await clearResultImageCache();
      toast.success('已清理临时缓存，已生成图片原图会保留');
    } catch (error: any) {
      toast.error(error?.message || '清理缓存失败');
    } finally {
      setIsClearingCache(false);
    }
  };

  const handleForgetCacheDirectory = async () => {
    try {
      await clearCacheDirectoryHandle();
      setCacheDirectoryName('');
      setProjectFields({ cacheDirectoryName: '' });
      toast.success('已清除缓存目录设置');
    } catch {
      toast.error('清除缓存目录失败');
    }
  };

  const handleSave = () => {
    const parsedConcurrency = parseInt(maxConcurrency, 10);
    const nextPlatformConfigs = syncCurrentFormToConfigs(allPlatformConfigs);

    setTextApiKey(textApiKey);
    setImageApiKey(imageApiKey);
    setApiBaseUrl(textApiBaseUrl || apiBaseUrl);
    setTextApiBaseUrl(textApiBaseUrl);
    setImageApiBaseUrl(imageApiBaseUrl);
    setImageApiPath(imageApiPath);

    const normalizedConcurrency = normalizeTaskConcurrency(parsedConcurrency);
    setMaxConcurrency(normalizedConcurrency);
    setMaxConcurrencyValue(String(normalizedConcurrency));

    setProjectFields({
      platformPreset,
      downloadDirectoryName,
      cacheDirectoryName,
      textModel: localTextModel,
      imageModel: localImageModel,
      textApiBaseUrl,
      imageApiBaseUrl,
      imageApiPath,
      platformConfigs: nextPlatformConfigs,
    });

    toast.success('设置已保存');
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px] rounded-[24px] border-border/40 bg-[#F9F8F6] shadow-[0_12px_40px_-5px_rgba(0,0,0,0.12)]">
        <DialogHeader>
          <div className="mt-1 mb-2 flex items-center justify-between">
            <DialogTitle className="font-serif text-[18.9px] tracking-tight">系统设置</DialogTitle>
<div className="flex items-center gap-1.5 pr-6">
              <Button variant="ghost" size="sm" onClick={handleImportConfig} className="h-7 rounded-lg px-3 text-[12.6px] font-medium text-button-main transition-colors hover:bg-black/5">
                导入
              </Button>
              <div className="h-3 w-px bg-border" />
              <Button variant="ghost" size="sm" onClick={handleExportCurrentConfig} className="h-7 rounded-lg px-3 text-[12.6px] font-medium text-button-main transition-colors hover:bg-black/5">
                导出当前
              </Button>
              <div className="h-3 w-px bg-border" />
              <Button variant="ghost" size="sm" onClick={handleExportAllConfigs} className="h-7 rounded-lg px-3 text-[12.6px] font-medium text-button-main transition-colors hover:bg-black/5">
                导出全部
              </Button>
            </div>
          </div>
          <DialogDescription className="text-[13.65px] text-text-secondary">
            每个平台的 API 地址、Key 和模型会分别保存。支持导出当前平台配置，也支持一键导出全部平台配置。
          </DialogDescription>
        </DialogHeader>

        <div className="grid max-h-[70vh] gap-6 overflow-y-auto py-4 pr-2 -mr-2">
          <Section bordered={false} title="平台预设">
            <label className="text-[12.6px] font-medium text-text-secondary">中转平台</label>
            <Select value={platformPreset} onValueChange={(value) => handlePresetChange(value as PlatformPreset)}>
              <SelectTrigger className="h-11 w-full rounded-xl border-border bg-white px-3 text-[13.65px] shadow-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="rounded-2xl border border-border/80 bg-white p-1 shadow-[0_18px_44px_-12px_rgba(0,0,0,0.18)]">
                {PLATFORM_PRESETS.map((preset) => (
                  <SelectItem key={preset.value} value={preset.value} className="rounded-xl px-3 py-2 text-[13.65px] text-text-primary focus:bg-[#F5F4F0] focus:text-text-primary">
                    {preset.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Section>

          <Section title="接口配置">
            <div className="mt-1 flex flex-col gap-5">
              <input type="text" name="fake-username" autoComplete="username" tabIndex={-1} aria-hidden="true" className="hidden" />
              <input type="password" name="fake-password" autoComplete="current-password" tabIndex={-1} aria-hidden="true" className="hidden" />

              <div className="flex flex-col gap-2">
                <label className="text-[12.6px] font-medium text-text-secondary">文本 API</label>
                <div className="rounded-xl border border-border bg-white shadow-sm transition-colors focus-within:border-button-main/40 focus-within:ring-2 focus-within:ring-button-main/20">
                  <Input
                    type="text"
                    name="batch-refiner-text-api-base"
                    autoComplete="off"
                    placeholder="文本 API 地址，例如 https://ai.comfly.chat"
                    value={textApiBaseUrl}
                    onChange={(e) => {
                      setTextApiBaseUrlValue(e.target.value);
                      setApiBaseUrlValue(e.target.value);
                    }}
                    className={mergedInputClassName}
                  />
                  <div className="h-px bg-border/70" />
                  <Input
                    type="password"
                    name="batch-refiner-text-api-key"
                    autoComplete="off"
                    autoCapitalize="off"
                    autoCorrect="off"
                    spellCheck={false}
                    data-form-type="other"
                    data-lpignore="true"
                    data-1p-ignore="true"
                    placeholder="文本 API Key，用于提示词和文本模型"
                    value={textApiKey}
                    onChange={(e) => setTextApiKeyValue(e.target.value)}
                    className={mergedInputClassName}
                  />
                  <div className="h-px bg-border/70" />
                  <ModelInput
                    value={localTextModel}
                    onChange={setLocalTextModel}
                    options={textModelOptions}
                    placeholder="文本模型，例如 gemini-3.1-flash-lite-preview"
                  />
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-[12.6px] font-medium text-text-secondary">生图 API</label>
                <div className="rounded-xl border border-border bg-white shadow-sm transition-colors focus-within:border-button-main/40 focus-within:ring-2 focus-within:ring-button-main/20">
                  <Input
                    type="text"
                    name="batch-refiner-image-api-base"
                    autoComplete="off"
                    placeholder="生图 API 地址，留空则使用文本 API 地址"
                    value={imageApiBaseUrl}
                    onChange={(e) => setImageApiBaseUrlValue(e.target.value)}
                    className={mergedInputClassName}
                  />
                  <div className="h-px bg-border/70" />
                  <Input
                    type="text"
                    name="batch-refiner-image-api-path"
                    autoComplete="off"
                    placeholder="生图接口路径，例如 /v1/images/edits"
                    value={imageApiPath}
                    onChange={(e) => setImageApiPathValue(e.target.value)}
                    className={mergedInputClassName}
                  />
                  <div className="h-px bg-border/70" />
                  <Input
                    type="password"
                    name="batch-refiner-image-api-key"
                    autoComplete="off"
                    autoCapitalize="off"
                    autoCorrect="off"
                    spellCheck={false}
                    data-form-type="other"
                    data-lpignore="true"
                    data-1p-ignore="true"
                    placeholder="生图 API Key，留空则使用文本 API Key"
                    value={imageApiKey}
                    onChange={(e) => setImageApiKeyValue(e.target.value)}
                    className={mergedInputClassName}
                  />
                  <div className="h-px bg-border/70" />
                  <ModelInput
                    value={localImageModel}
                    onChange={setLocalImageModel}
                    options={imageModelOptions}
                    placeholder="图片模型，例如 gemini-3.1-flash-image-preview"
                  />
                </div>
              </div>

              <div className="rounded-2xl border border-border/70 bg-[#F6F1E8]/70 p-3 shadow-inner">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[12.6px] font-medium text-text-primary">实际生效关系</div>
                    <p className="mt-1 text-[11.55px] leading-5 text-text-secondary">
                      这里显示的是当前设置保存后，提示词和生图请求真正会走到哪条接口。
                    </p>
                  </div>
                </div>
                <div className="space-y-2">
                  <RouteSummaryCard route={textRoute} />
                  <RouteSummaryCard route={imageRouteWithoutInput} />
                  <RouteSummaryCard route={imageRouteWithInput} />
                </div>
              </div>

              <div className="mt-1 flex flex-col gap-2 rounded-2xl border border-black/5 bg-black/[0.03] p-3 shadow-inner">
                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={testConnection}
                    disabled={isTesting}
                    className="h-8 rounded-xl border-none bg-white text-[12.6px] text-text-primary shadow-[0_2px_8px_rgba(0,0,0,0.06)] transition-all hover:bg-black/5"
                  >
                    {isTesting ? '测试中...' : '测试 API 连接'}
                  </Button>
                  {supportsQuota && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={checkQuota}
                      disabled={isCheckingQuota || !textApiKey.trim()}
                      className="h-8 rounded-xl border-none bg-white text-[12.6px] text-text-primary shadow-[0_2px_8px_rgba(0,0,0,0.06)] transition-all hover:bg-black/5"
                    >
                      {isCheckingQuota ? '查询中...' : '查询额度'}
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={loadRemoteModels}
                    disabled={isLoadingModels || (!textApiKey.trim() && !imageApiKey.trim())}
                    className="h-8 rounded-xl border-none bg-white text-[12.6px] text-text-primary shadow-[0_2px_8px_rgba(0,0,0,0.06)] transition-all hover:bg-black/5"
                  >
                    {isLoadingModels ? '拉取中...' : '拉取模型'}
                  </Button>
                </div>

                {testResult.status === 'success' ? <StatusBox tone="success" message={testResult.msg} /> : null}
                {quotaResult.status === 'success' ? <StatusBox tone="success" message={quotaResult.msg} /> : null}
                {testResult.status === 'error' ? <StatusBox tone="error" message={testResult.msg} /> : null}
                {quotaResult.status === 'error' ? <StatusBox tone="error" message={quotaResult.msg} /> : null}
              </div>
            </div>
          </Section>

          <Section title="结果图下载">
            <div className="rounded-2xl border border-border/60 bg-white/70 px-4 py-3">
              <div className="text-[12.6px] font-medium text-text-primary">当前目录</div>
              <div className="mt-1 break-all text-[12.6px] text-text-secondary">
                {downloadDirectoryName || '未设置，当前会回退为浏览器 ZIP 下载'}
              </div>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={handlePickDownloadDirectory}
                disabled={!supportsDirectoryDownload() || isPickingDirectory}
                className="h-9 rounded-xl bg-white text-[12.6px]"
              >
                {isPickingDirectory ? '选择中...' : downloadDirectoryName ? '重新选择目录' : '选择下载目录'}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={handleClearDownloadDirectory}
                disabled={!downloadDirectoryName}
                className="h-9 rounded-xl text-[12.6px]"
              >
                清除目录
              </Button>
            </div>
            {!supportsDirectoryDownload() ? (
              <p className="text-[11.55px] text-text-secondary">
                当前环境不支持指定目录写入，请使用 Edge，或继续使用 ZIP 下载。
              </p>
            ) : null}
          </Section>

          <Section title="本地缓存">
            <div className="rounded-2xl border border-border/60 bg-white/70 px-4 py-3">
              <div className="text-[12.6px] font-medium text-text-primary">当前缓存目录</div>
              <div className="mt-1 break-all text-[12.6px] text-text-secondary">
                {cacheDirectoryName || '未设置，结果图只会保存在浏览器本地缓存'}
              </div>
              <p className="mt-2 text-[11.55px] text-text-secondary">
                设置后会写入 batch-refiner-cache 子目录，并每 5 分钟保存一次项目快照。
              </p>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={handlePickCacheDirectory}
                disabled={!supportsCacheDirectory() || isPickingCacheDirectory}
                className="h-9 rounded-xl bg-white text-[12.6px]"
              >
                {isPickingCacheDirectory ? '选择中...' : cacheDirectoryName ? '重新选择缓存目录' : '选择缓存目录'}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={handleClearCache}
                disabled={isClearingCache}
                className="h-9 rounded-xl bg-white text-[12.6px]"
              >
                {isClearingCache ? '清理中...' : '一键清理缓存'}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={handleForgetCacheDirectory}
                disabled={!cacheDirectoryName}
                className="h-9 rounded-xl text-[12.6px]"
              >
                清除目录
              </Button>
            </div>
            {!supportsCacheDirectory() ? (
              <p className="text-[11.55px] text-text-secondary">
                当前环境不支持指定缓存目录，请使用 Edge。
              </p>
            ) : null}
          </Section>

          <Section title="任务并发">
            <Input
              type="number"
              min="1"
              max="10"
              value={maxConcurrency}
              onChange={(e) => setMaxConcurrencyValue(e.target.value)}
              className="rounded-xl border-border bg-white text-[13.65px] shadow-sm focus-visible:ring-button-main/30"
            />
            <p className="mt-1 text-[11.55px] text-text-secondary">
              这里只控制“同时跑多少个任务”。单个任务里如果带了多张原图或参考图，仍然会按同一次任务流程串行整理后再发请求，不会拆成多路并行。
            </p>
          </Section>
        </div>

        <div className="flex justify-end pt-4 pb-2">
          <Button onClick={handleSave} className="h-auto rounded-xl bg-button-main px-6 py-2 text-[13.65px] font-medium text-white shadow-md transition-all hover:-translate-y-0.5 hover:bg-[#333230]">
            保存设置
          </Button>
        </div>
        <div className="flex justify-start pt-1">
          <Button
            type="button"
            variant="outline"
            onClick={() => setIsLogDialogOpen(true)}
            className="h-auto rounded-xl bg-white px-4 py-2 text-[12.6px] font-medium"
          >
            查看生成日志
          </Button>
        </div>
      </DialogContent>
      <GenerationLogDialog
        open={isLogDialogOpen}
        onOpenChange={setIsLogDialogOpen}
        sessions={generationLogs}
        title="生成日志"
        allowClear
      />
    </Dialog>
  );
}
