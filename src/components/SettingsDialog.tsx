import * as React from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { useAppStore } from '@/store';
import { PlatformPreset } from '@/types';
import { toast } from 'sonner';
import { clearDownloadDirectory, pickDownloadDirectory, supportsDirectoryDownload } from '@/lib/downloadDirectory';

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
    defaultImageModel: 'gpt-image-1',
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

function getPresetConfig(preset: PlatformPreset) {
  return PLATFORM_PRESETS.find((item) => item.value === preset) || PLATFORM_PRESETS[0];
}

export function SettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const store = useAppStore();
  const [platformPreset, setPlatformPreset] = React.useState<PlatformPreset>(store.platformPreset || 'yunwu');
  const [apiKey, setApiKey] = React.useState(store.apiKey);
  const [apiBaseUrl, setApiBaseUrl] = React.useState(store.apiBaseUrl);
  const [maxConcurrency, setMaxConcurrency] = React.useState(String(store.maxConcurrency));
  const [localTextModel, setLocalTextModel] = React.useState(store.textModel || 'gemini-3.1-flash-lite-preview');
  const [localImageModel, setLocalImageModel] = React.useState(store.imageModel || 'gemini-3.1-flash-image-preview');
  const [downloadDirectoryName, setDownloadDirectoryName] = React.useState(store.downloadDirectoryName || '');
  const [isPickingDirectory, setIsPickingDirectory] = React.useState(false);
  const [isTesting, setIsTesting] = React.useState(false);
  const [testResult, setTestResult] = React.useState<{ status: 'idle' | 'success' | 'error'; msg: string }>({
    status: 'idle',
    msg: '',
  });

  React.useEffect(() => {
    setPlatformPreset(store.platformPreset || 'yunwu');
    setApiKey(store.apiKey);
    setApiBaseUrl(store.apiBaseUrl);
    setMaxConcurrency(String(store.maxConcurrency));
    setLocalTextModel(store.textModel || 'gemini-3.1-flash-lite-preview');
    setLocalImageModel(store.imageModel || 'gemini-3.1-flash-image-preview');
    setDownloadDirectoryName(store.downloadDirectoryName || '');
    setTestResult({ status: 'idle', msg: '' });
    setIsPickingDirectory(false);
  }, [open, store.apiKey, store.apiBaseUrl, store.downloadDirectoryName, store.imageModel, store.maxConcurrency, store.platformPreset, store.textModel]);

  const applyPreset = (preset: PlatformPreset) => {
    setPlatformPreset(preset);
    const presetConfig = getPresetConfig(preset);
    if (presetConfig.defaultBaseUrl) setApiBaseUrl(presetConfig.defaultBaseUrl);
    if (presetConfig.defaultTextModel) setLocalTextModel(presetConfig.defaultTextModel);
    if (presetConfig.defaultImageModel) setLocalImageModel(presetConfig.defaultImageModel);
  };

  const testConnection = async () => {
    setIsTesting(true);
    setTestResult({ status: 'idle', msg: '正在测试...' });

    try {
      const modelToTest = localTextModel || 'gemini-2.5-flash';
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
        let baseUrl = apiBaseUrl.trim().replace(/\/+$/, '');
        if (baseUrl.endsWith('/v1beta') || baseUrl.endsWith('/v1alpha')) baseUrl = baseUrl.replace(/\/v1(beta|alpha)$/, '/v1');
        if (!baseUrl.endsWith('/v1') && !baseUrl.includes('/v1/')) baseUrl += '/v1';
        apiEndpoint = `${baseUrl}/chat/completions`;
        headers.Authorization = `Bearer ${apiKey}`;
        body = JSON.stringify({
          model: modelToTest,
          messages: [{ role: 'user', content: 'Say hello' }],
        });
      }

      const res = await fetch(apiEndpoint, { method: 'POST', headers, body });
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error?.message || '连接测试失败');
      }

      setTestResult({ status: 'success', msg: '连接正常' });
      toast.success('API 连接正常');
    } catch (e: any) {
      const message = e?.message || '连接失败';
      setTestResult({ status: 'error', msg: message });
      toast.error('API 连接失败，请检查地址、密钥或网络');
    } finally {
      setIsTesting(false);
    }
  };

  const handleImportConfig = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e: Event) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (event) => {
        if (!event.target?.result) return;
        try {
          const data = JSON.parse(event.target.result as string);
          if (data.platformPreset) setPlatformPreset(data.platformPreset);
          if (data.apiBaseUrl !== undefined) setApiBaseUrl(data.apiBaseUrl);
          if (data.apiKey !== undefined) setApiKey(data.apiKey);
          if (data.downloadDirectoryName !== undefined) setDownloadDirectoryName(data.downloadDirectoryName);
          if (data.textModel) setLocalTextModel(data.textModel);
          if (data.imageModel) setLocalImageModel(data.imageModel);
          if (data.maxConcurrency) setMaxConcurrency(String(data.maxConcurrency));
          toast.success('已导入配置文件');
        } catch {
          toast.error('配置文件解析失败，请确认 JSON 格式正确');
        }
      };
      reader.readAsText(file);
    };
    input.click();
  };

  const handleExportConfig = async () => {
    try {
      const { saveAs } = await import('file-saver');
      const configToExport = {
        platformPreset,
        apiBaseUrl,
        apiKey,
        downloadDirectoryName,
        maxConcurrency: parseInt(maxConcurrency, 10) || store.maxConcurrency,
        textModel: localTextModel,
        imageModel: localImageModel,
        exportDate: new Date().toISOString(),
      };

      const blob = new Blob([JSON.stringify(configToExport, null, 2)], { type: 'application/json;charset=utf-8' });
      saveAs(blob, `BatchRefiner_Settings_${new Date().toISOString().slice(0, 10)}.json`);
      toast.success('配置已导出');
    } catch {
      toast.error('导出失败');
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
    } catch (e: any) {
      if (e?.name !== 'AbortError') {
        toast.error(e?.message || '选择下载目录失败');
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
    });
    toast.success('设置已保存');
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px] rounded-[24px] border-border/40 shadow-[0_12px_40px_-5px_rgba(0,0,0,0.12)] bg-[#F9F8F6]">
        <DialogHeader>
          <div className="flex items-center justify-between mt-1 mb-2">
            <DialogTitle className="font-serif tracking-tight text-[18.9px]">系统设置</DialogTitle>
            <div className="flex items-center gap-1.5 pr-6">
              <Button variant="ghost" size="sm" onClick={handleImportConfig} className="text-button-main hover:bg-black/5 text-[12.6px] h-7 px-3 rounded-lg font-medium transition-colors">
                导入
              </Button>
              <div className="w-px h-3 bg-border" />
              <Button variant="ghost" size="sm" onClick={handleExportConfig} className="text-button-main hover:bg-black/5 text-[12.6px] h-7 px-3 rounded-lg font-medium transition-colors">
                导出
              </Button>
            </div>
          </div>
          <DialogDescription className="text-[13.65px] text-text-secondary">
            先选择平台预设，再配置 API、模型和下载目录。
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-6 py-4 overflow-y-auto max-h-[70vh] pr-2 -mr-2">
          <div className="flex flex-col gap-2">
            <h4 className="text-[15.44px] font-medium text-text-primary">平台预设</h4>
            <label className="text-[12.6px] text-text-secondary font-medium">中转平台</label>
            <Select value={platformPreset} onValueChange={(value) => applyPreset(value as PlatformPreset)}>
              <SelectTrigger className="h-11 w-full rounded-xl border-border bg-white px-3 text-[13.65px] shadow-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="rounded-2xl border border-border/80 bg-white p-1 shadow-[0_18px_44px_-12px_rgba(0,0,0,0.18)]">
                {PLATFORM_PRESETS.map((preset) => (
                  <SelectItem
                    key={preset.value}
                    value={preset.value}
                    className="rounded-xl px-3 py-2 text-[13.65px] text-text-primary focus:bg-[#F5F4F0] focus:text-text-primary"
                  >
                    {preset.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11.55px] text-text-secondary">
              `云雾` 优先走 Gemini 原生 `generateContent`，`comfly.chat` 启用平台专属的模型映射和请求适配。
            </p>
          </div>

          <div className="flex flex-col gap-2 border-t border-border/80 pt-5">
            <h4 className="text-[15.44px] font-medium text-text-primary">默认模型</h4>

            <div className="flex flex-col gap-1 mt-2">
              <label className="text-[12.6px] text-text-secondary font-medium">文本模型</label>
              <Input
                type="text"
                list="text-model-list"
                value={localTextModel}
                onChange={(e) => setLocalTextModel(e.target.value)}
                className="text-[13.65px] rounded-xl border-border bg-white shadow-sm focus-visible:ring-button-main/30"
                placeholder="gemini-3.1-flash-lite-preview"
              />
              <datalist id="text-model-list">
                <option value="gemini-3.1-flash-lite-preview" />
                <option value="gemini-3.1-pro" />
                <option value="gemini-2.5-flash" />
                <option value="gemini-2.5-pro" />
                <option value="gpt-4o" />
                <option value="claude-3-5-sonnet-20241022" />
              </datalist>
            </div>

            <div className="flex flex-col gap-1 mt-2">
              <label className="text-[12.6px] text-text-secondary font-medium">图片模型</label>
              <Input
                type="text"
                list="image-model-list"
                value={localImageModel}
                onChange={(e) => setLocalImageModel(e.target.value)}
                className="text-[13.65px] rounded-xl border-border bg-white shadow-sm focus-visible:ring-button-main/30"
                placeholder="gemini-3.1-flash-image-preview"
              />
              <datalist id="image-model-list">
                <option value="gemini-3.1-flash-image-preview" />
                <option value="gemini-3.1-flash-image-preview-2k" />
                <option value="gemini-3.1-flash-image-preview-4k" />
                <option value="gemini-2.5-flash-image" />
                <option value="gemini-3-pro-image-preview" />
                <option value="nano-banana-pro" />
                <option value="nano-banana-pro-2k" />
                <option value="gpt-image-1" />
                <option value="imagen-3.0-generate-001" />
              </datalist>
            </div>
          </div>

          <div className="flex flex-col gap-2 border-t border-border/80 pt-5">
            <h4 className="text-[15.44px] font-medium text-text-primary">接口配置</h4>
            <div className="flex flex-col gap-1 mt-1">
              <label className="text-[13.65px] font-medium text-text-secondary">API Base URL</label>
              <Input
                type="text"
                placeholder="例如: https://yunwu.ai"
                value={apiBaseUrl}
                onChange={(e) => setApiBaseUrl(e.target.value)}
                className="text-[13.65px] rounded-xl border-border bg-white shadow-sm focus-visible:ring-button-main/30"
              />

              <label className="text-[13.65px] font-medium text-text-secondary mt-3">API Key</label>
              <Input
                type="password"
                placeholder="AIzaSy... / sk-..."
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                className="font-mono text-[13.65px] rounded-xl border-border bg-white shadow-sm focus-visible:ring-button-main/30"
              />

              <div className="flex flex-col gap-2 mt-3 p-3 bg-black/[0.03] rounded-2xl border border-black/5 shadow-inner">
                <div className="flex items-center gap-3">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={testConnection}
                    disabled={isTesting}
                    className="text-[12.6px] h-8 rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] bg-white border-none hover:bg-black/5 transition-all text-text-primary"
                  >
                    测试 API 连接
                  </Button>
                  {testResult.status !== 'idle' && (
                    <span className={`text-[12.6px] font-medium ${testResult.status === 'success' ? 'text-green-600' : 'text-red-600'}`}>
                      {testResult.status === 'success' ? '连接正常' : '连接失败'}
                    </span>
                  )}
                </div>
                {testResult.status === 'error' && (
                  <div className="text-[11.55px] font-mono text-red-600 break-all bg-red-50/50 p-2 rounded-xl border border-red-100 max-h-24 overflow-y-auto">
                    {testResult.msg}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-2 border-t border-border/80 pt-5">
            <h4 className="text-[15.44px] font-medium text-text-primary">结果图下载</h4>
            <div className="rounded-2xl border border-border/60 bg-white/70 px-4 py-3">
              <div className="text-[12.6px] font-medium text-text-primary">当前目录</div>
              <div className="mt-1 text-[12.6px] text-text-secondary break-all">
                {downloadDirectoryName || '未设置，当前将回退为浏览器 ZIP 下载'}
              </div>
            </div>
            <div className="flex items-center gap-2 mt-2">
              <Button
                type="button"
                variant="outline"
                onClick={handlePickDownloadDirectory}
                disabled={!supportsDirectoryDownload() || isPickingDirectory}
                className="text-[12.6px] h-9 rounded-xl bg-white"
              >
                {isPickingDirectory ? '选择中...' : downloadDirectoryName ? '重新选择目录' : '选择下载目录'}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={handleClearDownloadDirectory}
                disabled={!downloadDirectoryName}
                className="text-[12.6px] h-9 rounded-xl"
              >
                清除目录
              </Button>
            </div>
            {!supportsDirectoryDownload() && (
              <p className="text-[11.55px] text-text-secondary">
                当前环境不支持指定目录写入，请使用 Edge，或继续使用 ZIP 下载。
              </p>
            )}
          </div>

          <div className="flex flex-col gap-2 border-t border-border/80 pt-5">
            <label className="text-[13.65px] font-medium text-text-secondary">任务并发数</label>
            <Input
              type="number"
              min="1"
              max="10"
              value={maxConcurrency}
              onChange={(e) => setMaxConcurrency(e.target.value)}
              className="text-[13.65px] rounded-xl border-border bg-white shadow-sm focus-visible:ring-button-main/30"
            />
            <p className="text-[11.55px] text-text-secondary mt-1">
              控制同时提交给平台的任务数量，过高可能触发中转平台限流。
            </p>
          </div>
        </div>

        <div className="flex justify-end pt-4 pb-2">
          <Button onClick={handleSave} className="bg-button-main hover:bg-[#333230] text-white rounded-xl px-6 py-2 h-auto shadow-md transition-all hover:-translate-y-0.5 font-medium text-[13.65px]">
            保存设置
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
