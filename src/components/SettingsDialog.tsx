import * as React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { useAppStore } from '@/store';
import { toast } from 'sonner';

export function SettingsDialog({ open, onOpenChange }: { open: boolean, onOpenChange: (open: boolean) => void }) {
  const store = useAppStore();
  const [apiKey, setApiKey] = React.useState(store.apiKey);
  const [apiBaseUrl, setApiBaseUrl] = React.useState(store.apiBaseUrl);
  const [maxConcurrency, setMaxConcurrency] = React.useState(store.maxConcurrency.toString());
  const [localTextModel, setLocalTextModel] = React.useState(store.textModel || 'gemini-3.1-flash-lite');
  const [localImageModel, setLocalImageModel] = React.useState(store.imageModel || 'banana2');


  const [isTesting, setIsTesting] = React.useState(false);
  const [testResult, setTestResult] = React.useState<{status: 'idle' | 'success' | 'error', msg: string}>({status: 'idle', msg: ''});

  const testConnection = async () => {
     setIsTesting(true);
     setTestResult({status: 'idle', msg: '正在测试...'});
     let currentMappedParams = {};
     try {
       const modelToTest = localTextModel || 'gemini-2.5-flash';
       let apiEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelToTest}:generateContent?key=${apiKey}`;
       let headers: any = { 'Content-Type': 'application/json' };
       let body = JSON.stringify({ contents: [{ parts: [{ text: "Say hello" }] }] });

       if (apiBaseUrl && apiBaseUrl.trim() !== '') {
          let baseUrl = apiBaseUrl.trim();
          if (baseUrl.endsWith('/')) baseUrl = baseUrl.slice(0, -1);
          if (baseUrl.endsWith('/v1beta') || baseUrl.endsWith('/v1alpha')) baseUrl = baseUrl.replace(/\/v1(beta|alpha)/, '/v1');
          if (!baseUrl.endsWith('/v1') && !baseUrl.includes('/v1/')) baseUrl += '/v1';
          apiEndpoint = `${baseUrl}/chat/completions`;
          headers['Authorization'] = `Bearer ${apiKey}`;
          body = JSON.stringify({
            model: modelToTest,
            messages: [{ role: "user", content: "Say hello" }]
          });
       }

       const res = await fetch(apiEndpoint, {
          method: 'POST',
          headers,
          body
       });
       
       const data = await res.json();
       if (!res.ok || data.error) throw new Error(data.error?.message || "连接验证被拒绝");

       setTestResult({status: 'success', msg: 'API 连通性测试成功 (🟢 联通正常)'});
       toast.success('API 连通正常！');
     } catch(e: any) {
        setTestResult({status: 'error', msg: `连接失败 (🔴): ${e.message}`});
        toast.error('API 连通失败，请检查密钥或网络');
     } finally {
        setIsTesting(false);
     }
  };

  const handleImportConfig = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = (e: any) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (event) => {
        if (event.target?.result) {
          try {
             const data = JSON.parse(event.target.result as string);
             if (data.apiBaseUrl !== undefined) setApiBaseUrl(data.apiBaseUrl);
             if (data.apiKey !== undefined) setApiKey(data.apiKey);
             if (data.textModel) setLocalTextModel(data.textModel);
             if (data.imageModel) setLocalImageModel(data.imageModel);
             if (data.maxConcurrency) setMaxConcurrency(data.maxConcurrency.toString());
             toast.success("成功导入 API 配置文件");
          } catch(e) {
             toast.error("配置文件解析失败，请确保格式是正确的 JSON");
          }
        }
      };
      reader.readAsText(file);
    };
    input.click();
  };

  const handleSave = () => {
    store.setApiKey(apiKey);
    store.setApiBaseUrl(apiBaseUrl);
    const parsedConcurrency = parseInt(maxConcurrency);
    if (!isNaN(parsedConcurrency) && parsedConcurrency > 0) {
       store.setMaxConcurrency(parsedConcurrency);
    }
    store.setProjectFields({ textModel: localTextModel, imageModel: localImageModel });
    toast.success('设置已保存');
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <div className="flex items-center justify-between">
             <DialogTitle>系统设置 (Settings)</DialogTitle>
             <Button variant="ghost" size="sm" onClick={handleImportConfig} className="text-primary hover:bg-primary/10 text-[12px] h-7 px-2">
               导入 JSON 配置文件
             </Button>
          </div>
          <DialogDescription>
            配置您的 API Key 以及相关底层参数。设置将会被加密存储在浏览器本地 IndexedDB 中。
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-8 py-4">
          <div className="flex flex-col gap-4">
             <h4 className="text-sm font-serif font-medium tracking-wide text-foreground">默认模型选择</h4>
             
             <div className="flex flex-col gap-1.5 mt-1">
               <label className="text-[12px] font-medium text-muted-foreground">文本理解 / 提示词生成模型</label>
               <Input 
                 type="text"
                 list="text-model-list"
                 value={localTextModel} 
                 onChange={(e) => setLocalTextModel(e.target.value)}
                 className="text-[13px] bg-background"
                 placeholder="gemini-2.5-flash"
               />
               <datalist id="text-model-list">
                  <option value="gemini-3.1-flash-lite" />
                  <option value="gemini-3.1-pro" />
                  <option value="gemini-2.5-flash" />
                  <option value="gemini-2.5-pro" />
                  <option value="gpt-4o" />
                  <option value="claude-3-5-sonnet-20241022" />
               </datalist>
             </div>

             <div className="flex flex-col gap-1.5 mt-2">
               <label className="text-[12px] font-medium text-muted-foreground">图像生成模型</label>
               <Input 
                 type="text"
                 list="image-model-list"
                 value={localImageModel} 
                 onChange={(e) => setLocalImageModel(e.target.value)}
                 className="text-[13px] bg-background"
                 placeholder="imagen-3.0-generate-001"
               />
               <datalist id="image-model-list">
                  <option value="banana2" />
                  <option value="bananapro" />
                  <option value="imagen-3.0-generate-001" />
               </datalist>
             </div>
          </div>

          <div className="flex flex-col gap-4 border-t border-border pt-6">
            <h4 className="text-sm font-serif font-medium tracking-wide text-foreground">高级配置</h4>
            <div className="flex flex-col gap-1.5 mt-1">
               <label className="text-sm font-medium text-foreground/80">接口地址 (API Base URL)</label>
               <Input
                 type="text"
                 placeholder="例如: https://gpt-best.apifox.cn"
                 value={apiBaseUrl}
                 onChange={(e) => setApiBaseUrl(e.target.value)}
                 className="text-[13px] bg-background"
               />
               <p className="text-[11.5px] text-muted-foreground mt-1 mb-3">可配置代理或第三方中转地址，例如 <code className="bg-black/5 text-foreground px-1.5 py-0.5 rounded font-mono">https://gpt-best.apifox.cn</code>。为空使用默认源。</p>

               <label className="text-sm font-medium text-foreground/80 mt-2">
                 Google Gemini / Imagen API Key
               </label>
               <Input
                 type="password"
                 placeholder="AIzaSy..."
                 value={apiKey}
                 onChange={(e) => setApiKey(e.target.value)}
                 className="font-mono text-[13px] bg-background"
               />
               <div className="flex flex-col gap-3 mt-4 p-4 bg-background/50 rounded-xl border border-border">
                 <div className="flex items-center gap-3">
                   <Button 
                     variant="outline" 
                     size="sm" 
                     onClick={testConnection} 
                     disabled={isTesting}
                     className="text-[12px] h-8 rounded-lg shadow-sm"
                   >
                     {isTesting ? '验证中...' : '🔌 验证 API 连通性'}
                   </Button>
                   {testResult.status !== 'idle' && (
                      <span className={`text-[12px] font-medium ${testResult.status === 'success' ? 'text-green-600' : 'text-red-600'}`}>
                         {testResult.status === 'success' ? '🟢 联通正常' : '🔴 连接失败'}
                      </span>
                   )}
                 </div>
                 {testResult.status === 'error' && (
                    <div className="text-[11px] font-mono text-red-600 break-all bg-red-50/50 p-2 rounded border border-red-100 max-h-24 overflow-y-auto">
                      {testResult.msg.replace('连接失败 (🔴): ', '')}
                    </div>
                 )}
               </div>
               <p className="text-[11px] text-muted-foreground mt-1">若不填写则默认使用部署时的环境变量。</p>
            </div>
          </div>
          
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium">
              任务并发数 (Max Concurrency)
            </label>
            <Input
              type="number"
              min="1"
              max="10"
              value={maxConcurrency}
              onChange={(e) => setMaxConcurrency(e.target.value)}
              className="text-[13px]"
            />
            <p className="text-[11px] text-muted-foreground mt-1">控制同时生成的图片数量。过高可能遭遇 API Rate Limit。</p>
          </div>
        </div>
        <div className="flex justify-end">
          <Button onClick={handleSave} className="bg-primary hover:bg-primary/90 text-primary-foreground">保存设置</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
