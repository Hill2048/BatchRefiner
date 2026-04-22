import * as React from 'react';
import { toast } from 'sonner';
import { useAppStore } from '@/store';
import { PlatformApiConfigMap, PlatformPreset } from '@/types';
import { clearDownloadDirectory, pickDownloadDirectory, supportsDirectoryDownload } from '@/lib/downloadDirectory';
import {
  ApiConfigPayload,
  decryptApiConfig,
  encryptApiConfig,
  isEncryptedApiConfig,
  MultiPlatformApiConfigPayload,
} from '@/lib/secureConfig';
import { fetchPlatformQuota, type PlatformQuotaSnapshot } from '@/lib/platformQuota';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog';
import { Input } from './ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';

type ResultState = {
  status: 'idle' | 'success' | 'error';
  msg: string;
};

type ModelItem = {
  id?: unknown;
  supported_endpoint_types?: unknown;
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
      apiKey: '',
      textModel: 'gemini-3.1-flash-lite-preview',
      imageModel: 'gemini-3.1-flash-image-preview',
    },
    'comfly-chat': {
      apiBaseUrl: 'https://ai.comfly.chat',
      apiKey: '',
      textModel: 'gemini-3.1-flash-lite-preview',
      imageModel: 'gemini-3.1-flash-image-preview',
    },
    'openai-compatible': {
      apiBaseUrl: '',
      apiKey: '',
      textModel: 'gpt-4o',
      imageModel: 'gpt-image-2',
    },
    'gemini-native': {
      apiBaseUrl: '',
      apiKey: '',
      textModel: 'gemini-2.5-flash',
      imageModel: 'imagen-3.0-generate-001',
    },
    'custom': {
      apiBaseUrl: '',
      apiKey: '',
      textModel: '',
      imageModel: '',
    },
  };
}

function mergePlatformConfigs(configs?: Partial<PlatformApiConfigMap> | null): PlatformApiConfigMap {
  const defaults = createDefaultPlatformConfigs();
  if (!configs) return defaults;

  return {
    'yunwu': { ...defaults['yunwu'], ...(configs['yunwu'] || {}) },
    'comfly-chat': { ...defaults['comfly-chat'], ...(configs['comfly-chat'] || {}) },
    'openai-compatible': { ...defaults['openai-compatible'], ...(configs['openai-compatible'] || {}) },
    'gemini-native': { ...defaults['gemini-native'], ...(configs['gemini-native'] || {}) },
    'custom': { ...defaults['custom'], ...(configs['custom'] || {}) },
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
    const id = typeof item?.id === 'string' ? item.id.trim() : '';
    if (!id) return;

    const endpointTypes = Array.isArray(item?.supported_endpoint_types)
      ? item.supported_endpoint_types.filter((value): value is string => typeof value === 'string')
      : [];

    if (looksLikeImageModel(id, endpointTypes)) {
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

export function SettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const store = useAppStore();
  const mergedPlatformConfigs = React.useMemo(
    () => mergePlatformConfigs(store.platformConfigs),
    [store.platformConfigs],
  );

  const [platformPreset, setPlatformPreset] = React.useState<PlatformPreset>(store.platformPreset || 'yunwu');
  const [apiKey, setApiKey] = React.useState(store.apiKey);
  const [apiBaseUrl, setApiBaseUrl] = React.useState(store.apiBaseUrl);
  const [maxConcurrency, setMaxConcurrency] = React.useState(String(store.maxConcurrency));
  const [localTextModel, setLocalTextModel] = React.useState(store.textModel || 'gemini-3.1-flash-lite-preview');
  const [localImageModel, setLocalImageModel] = React.useState(store.imageModel || 'gemini-3.1-flash-image-preview');
  const [downloadDirectoryName, setDownloadDirectoryName] = React.useState(store.downloadDirectoryName || '');
  const [allPlatformConfigs, setAllPlatformConfigs] = React.useState<PlatformApiConfigMap>(mergedPlatformConfigs);
  const [remoteTextModels, setRemoteTextModels] = React.useState<string[]>([]);
  const [remoteImageModels, setRemoteImageModels] = React.useState<string[]>([]);
  const [isPickingDirectory, setIsPickingDirectory] = React.useState(false);
  const [isTesting, setIsTesting] = React.useState(false);
  const [isCheckingQuota, setIsCheckingQuota] = React.useState(false);
  const [isLoadingModels, setIsLoadingModels] = React.useState(false);
  const [testResult, setTestResult] = React.useState<ResultState>({ status: 'idle', msg: '' });
  const [quotaResult, setQuotaResult] = React.useState<ResultState>({ status: 'idle', msg: '' });

  const applyPlatformConfigToForm = React.useCallback((preset: PlatformPreset, configs: PlatformApiConfigMap) => {
    const next = configs[preset];
    setPlatformPreset(preset);
    setApiKey(next.apiKey);
    setApiBaseUrl(next.apiBaseUrl);
    setLocalTextModel(next.textModel);
    setLocalImageModel(next.imageModel);
  }, []);

  const syncCurrentFormToConfigs = React.useCallback((configs: PlatformApiConfigMap): PlatformApiConfigMap => {
    return {
      ...configs,
      [platformPreset]: {
        apiBaseUrl,
        apiKey,
        textModel: localTextModel,
        imageModel: localImageModel,
      },
    };
  }, [apiBaseUrl, apiKey, localImageModel, localTextModel, platformPreset]);

  React.useEffect(() => {
    const nextConfigs = mergePlatformConfigs(store.platformConfigs);
    setAllPlatformConfigs(nextConfigs);
    applyPlatformConfigToForm(store.platformPreset || 'yunwu', nextConfigs);
    setMaxConcurrency(String(store.maxConcurrency));
    setDownloadDirectoryName(store.downloadDirectoryName || '');
    setRemoteTextModels([]);
    setRemoteImageModels([]);
    setTestResult({ status: 'idle', msg: '' });
    setQuotaResult({ status: 'idle', msg: '' });
    setIsPickingDirectory(false);
  }, [
    applyPlatformConfigToForm,
    open,
    store.downloadDirectoryName,
    store.maxConcurrency,
    store.platformConfigs,
    store.platformPreset,
  ]);

  const textModelOptions = uniqSorted([...BUILT_IN_TEXT_MODELS, ...remoteTextModels]);
  const imageModelOptions = uniqSorted([...BUILT_IN_IMAGE_MODELS, ...remoteImageModels]);
  const supportsQuota = platformPreset === 'yunwu' || platformPreset === 'comfly-chat';
  const isComfly = platformPreset === 'comfly-chat';

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
        apiKey: data.apiKey,
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

  const fetchComflyModels = React.useCallback(async () => {
    const response = await fetch(`${normalizeComflyBaseUrl(apiBaseUrl)}/models`, {
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
  }, [apiBaseUrl, apiKey]);

  const loadRemoteModels = async () => {
    setIsLoadingModels(true);
    try {
      const items = await fetchComflyModels();
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
        const items = await fetchComflyModels();
        setRemoteModels(items);

        const hasConfiguredModel = items.some((item) => item?.id === modelToTest);
        const msg = hasConfiguredModel
          ? `API Key 正常，已获取 ${items.length} 个模型`
          : `API Key 正常，已获取 ${items.length} 个模型，但当前文本模型 ${modelToTest} 不在列表中`;

        setTestResult({ status: 'success', msg });
        toast.success(msg);
        return;
      }

      let apiEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelToTest}:generateContent?key=${apiKey}`;
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      let body = JSON.stringify({ contents: [{ parts: [{ text: 'Say hello' }] }] });

      if (platformPreset === 'yunwu' && apiBaseUrl.trim()) {
        let baseUrl = apiBaseUrl.trim().replace(/\/+$/, '');
        if (baseUrl.endsWith('/v1')) baseUrl = baseUrl.replace(/\/v1$/, '/v1beta');
        if (!baseUrl.endsWith('/v1beta') && !baseUrl.includes('/v1beta/')) baseUrl += '/v1beta';
        apiEndpoint = `${baseUrl}/models/${modelToTest}:generateContent`;
        headers.Authorization = `Bearer ${apiKey}`;
      } else if (apiBaseUrl.trim()) {
        apiEndpoint = `${normalizeOpenAIBaseUrl(apiBaseUrl)}/chat/completions`;
        headers.Authorization = `Bearer ${apiKey}`;
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
      const snapshot = await fetchPlatformQuota(platformPreset, apiBaseUrl, apiKey);
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
        apiKey: currentConfig.apiKey,
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
      store.setProjectFields({ downloadDirectoryName: name });
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
      store.setProjectFields({ downloadDirectoryName: '' });
      toast.success('已清除结果图下载目录');
    } catch {
      toast.error('清除下载目录失败');
    }
  };

  const handleSave = () => {
    const parsedConcurrency = parseInt(maxConcurrency, 10);
    const nextPlatformConfigs = syncCurrentFormToConfigs(allPlatformConfigs);

    store.setApiKey(apiKey);
    store.setApiBaseUrl(apiBaseUrl);

    if (!Number.isNaN(parsedConcurrency) && parsedConcurrency > 0) {
      store.setMaxConcurrency(parsedConcurrency);
    }

    store.setProjectFields({
      platformPreset,
      downloadDirectoryName,
      textModel: localTextModel,
      imageModel: localImageModel,
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

          <Section title="默认模型">
            <div className="mt-2 flex flex-col gap-1">
              <label className="text-[12.6px] font-medium text-text-secondary">文本模型</label>
              <Input
                type="text"
                list="text-model-list"
                value={localTextModel}
                onChange={(e) => setLocalTextModel(e.target.value)}
                className="rounded-xl border-border bg-white text-[13.65px] shadow-sm focus-visible:ring-button-main/30"
                placeholder="gemini-3.1-flash-lite-preview"
              />
              <datalist id="text-model-list">
                {textModelOptions.map((model) => (
                  <option key={model} value={model} />
                ))}
              </datalist>
            </div>

            <div className="mt-2 flex flex-col gap-1">
              <label className="text-[12.6px] font-medium text-text-secondary">图片模型</label>
              <Input
                type="text"
                list="image-model-list"
                value={localImageModel}
                onChange={(e) => setLocalImageModel(e.target.value)}
                className="rounded-xl border-border bg-white text-[13.65px] shadow-sm focus-visible:ring-button-main/30"
                placeholder="gemini-3.1-flash-image-preview"
              />
              <datalist id="image-model-list">
                {imageModelOptions.map((model) => (
                  <option key={model} value={model} />
                ))}
              </datalist>
            </div>
          </Section>

          <Section title="接口配置">
            <div className="mt-1 flex flex-col gap-1">
              <input type="text" name="fake-username" autoComplete="username" tabIndex={-1} aria-hidden="true" className="hidden" />
              <input type="password" name="fake-password" autoComplete="current-password" tabIndex={-1} aria-hidden="true" className="hidden" />

              <label className="text-[13.65px] font-medium text-text-secondary">API Base URL</label>
              <Input
                type="text"
                name="batch-refiner-api-base"
                autoComplete="off"
                placeholder="例如: https://ai.comfly.chat"
                value={apiBaseUrl}
                onChange={(e) => setApiBaseUrl(e.target.value)}
                className="rounded-xl border-border bg-white text-[13.65px] shadow-sm focus-visible:ring-button-main/30"
              />

              <label className="mt-3 text-[13.65px] font-medium text-text-secondary">API Key</label>
              <Input
                type="text"
                name="batch-refiner-api-key"
                autoComplete="off"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                data-form-type="other"
                data-lpignore="true"
                data-1p-ignore="true"
                placeholder="AIzaSy... / sk-..."
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                className="font-mono rounded-xl border-border bg-white text-[13.65px] shadow-sm focus-visible:ring-button-main/30"
                style={{ WebkitTextSecurity: 'disc' } as React.CSSProperties}
              />

              <div className="mt-3 flex flex-col gap-2 rounded-2xl border border-black/5 bg-black/[0.03] p-3 shadow-inner">
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
                      disabled={isCheckingQuota || !apiKey.trim()}
                      className="h-8 rounded-xl border-none bg-white text-[12.6px] text-text-primary shadow-[0_2px_8px_rgba(0,0,0,0.06)] transition-all hover:bg-black/5"
                    >
                      {isCheckingQuota ? '查询中...' : '查询额度'}
                    </Button>
                  )}
                  {isComfly && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={loadRemoteModels}
                      disabled={isLoadingModels || !apiKey.trim()}
                      className="h-8 rounded-xl border-none bg-white text-[12.6px] text-text-primary shadow-[0_2px_8px_rgba(0,0,0,0.06)] transition-all hover:bg-black/5"
                    >
                      {isLoadingModels ? '拉取中...' : '拉取模型'}
                    </Button>
                  )}
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

          <Section title="任务并发">
            <Input
              type="number"
              min="1"
              max="10"
              value={maxConcurrency}
              onChange={(e) => setMaxConcurrency(e.target.value)}
              className="rounded-xl border-border bg-white text-[13.65px] shadow-sm focus-visible:ring-button-main/30"
            />
            <p className="mt-1 text-[11.55px] text-text-secondary">
              控制同时提交给平台的任务数量，过高可能触发中转平台限流。
            </p>
          </Section>
        </div>

        <div className="flex justify-end pt-4 pb-2">
          <Button onClick={handleSave} className="h-auto rounded-xl bg-button-main px-6 py-2 text-[13.65px] font-medium text-white shadow-md transition-all hover:-translate-y-0.5 hover:bg-[#333230]">
            保存设置
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
