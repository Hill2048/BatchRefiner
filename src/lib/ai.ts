import { Task, ProjectData } from '../types';
import { useAppStore } from '../store';

export async function generatePromptForTask(task: Task, project: ProjectData): Promise<string> {
  const customBaseUrl = useAppStore.getState().apiBaseUrl;
  const keyToUse = useAppStore.getState().apiKey;
  const mappedTextModel = project.textModel || 'gemini-2.5-flash';
  const ar = task.aspectRatio || project.globalAspectRatio || 'auto';

  if (!keyToUse) {
    throw new Error('未配置 API Key。请在系统的全局设置中填入 API Key。');
  }

  let promptContext = `你是一个顶级的图像生成提示词专家。你的任务是根据给定的要求，详细观察原图与参考图，撰写出高度细节化且结构清晰的图像提示词。优先使用中文，用词精准。\n\n`;
  
  if (project.globalSkillText && project.globalSkillText.trim() !== '') {
    promptContext += `【全局核心技能与框架规范 (Skill Document)】\n${project.globalSkillText}\n*要求：必须严格遵循上述规范与设定结构。*\n\n`;
  }
  if (project.globalTargetText && project.globalTargetText.trim() !== '') {
    promptContext += `【全局核心目标】\n${project.globalTargetText}\n\n`;
  }
  promptContext += `【本条任务具体设定】\n任务名称：${task.title}\n`;
  if (task.description && task.description.trim() !== '') {
    promptContext += `用户补充描述：${task.description}\n`;
  }
  if (ar !== 'auto') {
    promptContext += `【尺寸比例设定】：当前目标图片画幅比例为 ${ar}，你写入提示词时必须完全考虑或尊崇此比例进行构图描述。\n`;
  }
  promptContext += `\n请根据以上所有的文本要求，以及提供的视觉参考图，直接生成最终的图像提示词，不要输出多余格式。`;

  // Proxy Custom Mode (OpenAI Compatible Mode)
  if (customBaseUrl && customBaseUrl.trim() !== '') {
     let baseUrl = customBaseUrl.trim();
     if (baseUrl.endsWith('/')) baseUrl = baseUrl.slice(0, -1);
     if (baseUrl.endsWith('/v1beta') || baseUrl.endsWith('/v1alpha')) baseUrl = baseUrl.replace(/\/v1(beta|alpha)/, '/v1');
     if (!baseUrl.endsWith('/v1') && !baseUrl.includes('/v1/')) baseUrl += '/v1';

     const contentArray: any[] = [{ type: "text", text: promptContext }];
     const addImg = (imgUrl: string) => {
        if (imgUrl) contentArray.push({ type: "image_url", image_url: { url: imgUrl } });
     };
     addImg(task.sourceImage || '');
     project.globalReferenceImages?.forEach(img => addImg(img));
     task.referenceImages?.forEach(img => addImg(img));

     const abortController = new AbortController();
     const timeoutId = setTimeout(() => abortController.abort(), 60000);
     try {
        const res = await fetch(`${baseUrl}/chat/completions`, {
           method: 'POST',
           headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${keyToUse}` },
           signal: abortController.signal,
           body: JSON.stringify({
              model: mappedTextModel,
              messages: [{ role: "user", content: contentArray }]
           })
        });
        clearTimeout(timeoutId);
        const data = await res.json();
        if (!res.ok || data.error) throw new Error(data.error?.message || JSON.stringify(data.error || data));
        return data.choices?.[0]?.message?.content?.trim() || '生成提示词为空。';
     } catch(e: any) {
        clearTimeout(timeoutId);
        throw e;
     }
  }

  // Official Gemini REST API
  const contents: any[] = [];
  const addGeminiImg = (imgStr: string) => {
     if (imgStr) {
        const base64Data = imgStr.split(',')[1];
        const mimeType = imgStr.split(';')[0].split(':')[1] || 'image/jpeg';
        if (base64Data) contents.push({ inlineData: { data: base64Data, mimeType } });
     }
  }
  
  contents.push({ text: promptContext });
  addGeminiImg(task.sourceImage || '');
  project.globalReferenceImages?.forEach(img => addGeminiImg(img));
  task.referenceImages?.forEach(img => addGeminiImg(img));

  const bodyData = {
    contents: [{ parts: contents }],
    generationConfig: { temperature: 0.7 }
  };

  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${mappedTextModel}:generateContent?key=${keyToUse}`, {
     method: 'POST',
     headers: { 'Content-Type': 'application/json' },
     body: JSON.stringify(bodyData)
  });
  
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error?.message || JSON.stringify(data.error || data));

  const textOutput = data.candidates?.[0]?.content?.parts?.[0]?.text;
  return textOutput?.trim() || '生成提示词失败。';
}

export async function runImageGenerationMode(task: Task, project: ProjectData): Promise<string> {
  try {
    const customBaseUrl = useAppStore.getState().apiBaseUrl;
    const keyToUse = useAppStore.getState().apiKey;
    const imageModelStr = useAppStore.getState().imageModel;
    const mappedImageModel = imageModelStr || 'imagen-3.0-generate-001';
    const ar = task.aspectRatio || project.globalAspectRatio || 'auto';
    const finalPrompt = task.promptText || task.description || '';

    if (!keyToUse) {
       throw new Error('未配置 API Key。请在系统的全局设置中填入 API Key。');
    }

    if (mappedImageModel.includes('gemini') || mappedImageModel.toLowerCase().includes('gpt') || mappedImageModel.toLowerCase().includes('claude')) {
        if (customBaseUrl && customBaseUrl.trim() !== '') {
            let baseUrl = customBaseUrl.trim();
            if (baseUrl.endsWith('/')) baseUrl = baseUrl.slice(0, -1);
            if (baseUrl.endsWith('/v1beta') || baseUrl.endsWith('/v1alpha')) baseUrl = baseUrl.replace(/\/v1(beta|alpha)/, '/v1');
            if (!baseUrl.endsWith('/v1') && !baseUrl.includes('/v1/')) {
               baseUrl += '/v1';
            }

            const contentArray: any[] = [];
            if (finalPrompt) contentArray.push({ type: "text", text: finalPrompt });

            const addImg = (imgUrl: string) => {
               if (imgUrl) contentArray.push({ type: "image_url", image_url: { url: imgUrl } });
            };
            addImg(task.sourceImage || '');
            project.globalReferenceImages?.forEach(img => addImg(img));
            task.referenceImages?.forEach(img => addImg(img));

            const abortController = new AbortController();
            const timeoutId = setTimeout(() => abortController.abort(), 60000); 

            try {
                const res = await fetch(`${baseUrl}/chat/completions`, {
                   method: 'POST',
                   headers: {
                      'Content-Type': 'application/json',
                      'Authorization': `Bearer ${keyToUse}`
                   },
                   signal: abortController.signal,
                   body: JSON.stringify({
                      model: mappedImageModel,
                      messages: [{ role: "user", content: contentArray }]
                   })
                });
                clearTimeout(timeoutId);

                const data = await res.json();
                if (!res.ok || data.error) {
                   throw new Error(data.error?.message || JSON.stringify(data.error || data));
                }

                const text = data.choices?.[0]?.message?.content || '';

                const mdImageMatch = text.match(/!\[.*?\]\((https?:\/\/[^\s\)]+)\)/);
                if (mdImageMatch && mdImageMatch[1]) return mdImageMatch[1];
                
                const urlMatch = text.match(/(https?:\/\/[^\s\)]+(?:jpg|jpeg|png|webp|gif))/i);
                if (urlMatch && urlMatch[1]) return urlMatch[1];

                if (text.trim().startsWith('data:image')) return text.trim();

                throw new Error('代理返回无图: ' + text.substring(0, 50));
            } catch (err: any) {
               clearTimeout(timeoutId);
               if (err.name === 'AbortError') throw new Error('API 请求超时卡死，已自动中断');
               throw err;
            }
        }

        const contents: any[] = [];
        if (finalPrompt) contents.push({ text: finalPrompt });

        const addGeminiImg = (imgStr: string) => {
           if (imgStr) {
              const base64Data = imgStr.split(',')[1];
              const mimeType = imgStr.split(';')[0].split(':')[1] || 'image/jpeg';
              if (base64Data) contents.push({ inlineData: { data: base64Data, mimeType } });
           }
        };
        addGeminiImg(task.sourceImage || '');
        project.globalReferenceImages?.forEach(img => addGeminiImg(img));
        task.referenceImages?.forEach(img => addGeminiImg(img));

        const bodyData = { contents: [{ parts: contents }] };

        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${mappedImageModel}:generateContent?key=${keyToUse}`, {
           method: 'POST',
           headers: { 'Content-Type': 'application/json' },
           body: JSON.stringify(bodyData)
        });
        const data = await res.json();
        if (!res.ok || data.error) throw new Error(data.error?.message || JSON.stringify(data.error || data));

        if (data.candidates?.[0]?.content?.parts) {
            for (const part of data.candidates[0].content.parts) {
                if (part.inlineData && part.inlineData.data) {
                    return `data:${part.inlineData.mimeType || 'image/jpeg'};base64,${part.inlineData.data}`;
                }
            }
        }
        
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        const mdImageMatch = text.match(/!\[.*?\]\((https?:\/\/[^\s\)]+)\)/);
        if (mdImageMatch && mdImageMatch[1]) return mdImageMatch[1];
        
        const urlMatch = text.match(/(https?:\/\/[^\s\)]+(?:jpg|jpeg|png|webp|gif))/i);
        if (urlMatch && urlMatch[1]) return urlMatch[1];
        
        if (text.trim().startsWith('data:image')) return text.trim();

        throw new Error('大模型未能返回有效的图片数据或图片URL，模型回复: ' + text.substring(0, 50));
    }

    if (customBaseUrl && customBaseUrl.trim() !== '') {
       let baseUrl = customBaseUrl.trim();
       if (baseUrl.endsWith('/')) baseUrl = baseUrl.slice(0, -1);
       if (baseUrl.endsWith('/v1beta')) baseUrl = baseUrl.replace('/v1beta', '/v1');
       if (!baseUrl.endsWith('/v1') && !baseUrl.includes('/v1/')) baseUrl += '/v1';

       const res = await fetch(`${baseUrl}/images/generations`, {
          method: 'POST',
          headers: {
             'Content-Type': 'application/json',
             'Authorization': `Bearer ${keyToUse}`
          },
          body: JSON.stringify({
             model: mappedImageModel,
             prompt: finalPrompt,
             n: 1
          })
       });
       const data = await res.json();
       if (!res.ok || data.error) throw new Error(data.error?.message || JSON.stringify(data.error || data));

       if (data.data && data.data.length > 0) {
          const img = data.data[0];
          if (img.b64_json) return `data:image/jpeg;base64,${img.b64_json}`;
          if (img.url) return img.url;
       }
       throw new Error('代理接口未返回任何图片数据 (No image returned from proxy).');
    }

    // Official Imagen API via standard REST Endpoint
    const bodyData: any = {
      instances: [{ prompt: finalPrompt }],
      parameters: {
        sampleCount: 1,
        personGeneration: "allow_adult"
      }
    };
    if (ar !== 'auto') bodyData.parameters.aspectRatio = ar;

    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${mappedImageModel}:predict?key=${keyToUse}`, {
       method: 'POST',
       headers: { 'Content-Type': 'application/json' },
       body: JSON.stringify(bodyData)
    });
    const data = await res.json();
    
    if (!res.ok || data.error) throw new Error(data.error?.message || JSON.stringify(data.error || data));
    
    if (data.predictions && data.predictions.length > 0) {
       const prediction = data.predictions[0];
       if (prediction.bytesBase64Encoded) {
           return `data:${prediction.mimeType || 'image/jpeg'};base64,${prediction.bytesBase64Encoded}`;
       }
    }
    
    throw new Error('No image returned from model predict endpoint.');
  } catch (err: any) {
    console.warn("Generation failed:", err);
    throw err;
  }
}
