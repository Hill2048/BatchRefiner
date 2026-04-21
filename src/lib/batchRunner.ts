import { AspectRatio, PlatformPreset, Resolution, Task } from "@/types";
import { useAppStore } from "@/store";
import pLimit from "p-limit";
import { toast } from "sonner";

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const PROMPT_REQUEST_TIMEOUT_MS = 90_000;
const IMAGE_REQUEST_TIMEOUT_MS = 180_000;

const GEMINI_NATIVE_IMAGE_INPUT_MODELS = [
  "gemini-2.0-flash-preview-image-generation",
  "gemini-3.1-flash-image-preview",
  "gemini-2.5-flash-image",
  "gemini-3-pro-image-preview",
];

const GEMINI_NATIVE_HARD_RESOLUTION_MODELS = [
  "imagen-3.0-generate-001",
  "imagen-3.0-generate-002",
  "imagen-4.0-generate-preview",
];

const GEMINI_SUPPORTED_ASPECT_RATIOS = new Set(["1:1", "5:4", "4:3", "3:2", "16:9", "9:16"]);

type ResolutionSupport = "hard" | "soft" | "none";

interface ResolvedModelInfo {
  requestedModel: string;
  actualModel: string;
  resolutionSupport: ResolutionSupport;
}

interface ImageDimensions {
  width: number;
  height: number;
}

interface GeneratedImageResult {
  src: string;
  sourceType: "preview" | "original" | "base64";
  previewSrc?: string;
  originalSrc?: string;
}

function getBuiltInGeminiApiKey() {
  return import.meta.env.VITE_GEMINI_API_KEY?.trim() || "";
}

function createStageError(message: string, stage: string) {
  const error = new Error(message);
  (error as any).stage = stage;
  return error;
}

function getNormalizedModelName(model?: string) {
  return (model || "").trim().toLowerCase();
}

function isGptImageModel(model?: string) {
  const normalized = getNormalizedModelName(model);
  return normalized.startsWith("gpt-image") || normalized === "image2";
}

function isComflyResponsesImageModel(model?: string, platformPreset?: PlatformPreset) {
  if (platformPreset !== "comfly-chat") return false;
  const normalized = getNormalizedModelName(model);
  return normalized === "gpt-image-2" || normalized === "image2";
}

function normalizeComflyImageModelAlias(modelName: string) {
  const normalized = getNormalizedModelName(modelName);
  if (normalized === "image2") return "gpt-image-2";
  return modelName;
}

function normalizeResolution(value?: Resolution) {
  return (value || "1K").toUpperCase();
}

function normalizeAspectRatio(value?: AspectRatio) {
  return (value || "auto").trim();
}

function getPlatformPreset() {
  return (useAppStore.getState().platformPreset || "comfly-chat") as PlatformPreset;
}

function isGeminiGatewayPreset(platformPreset: PlatformPreset) {
  return platformPreset === "gemini-native" || platformPreset === "yunwu";
}

function getEffectiveResolution(task: Task) {
  const store = useAppStore.getState();
  return normalizeResolution(task.resolution || store.globalResolution || "1K");
}

function getEffectiveAspectRatio(task: Task) {
  const store = useAppStore.getState();
  return normalizeAspectRatio(task.aspectRatio || store.globalAspectRatio || "auto");
}

export function taskHasImageInputs(task: Task, globalReferenceImages: string[]) {
  return Boolean(
    task.sourceImage ||
    (task.referenceImages && task.referenceImages.length > 0) ||
    globalReferenceImages.length > 0
  );
}

function getTaskImageInputs(task: Task, globalReferenceImages: string[]) {
  const images: string[] = [];
  if (task.sourceImage) images.push(task.sourceImage);
  if (task.referenceImages?.length) images.push(...task.referenceImages);
  if (globalReferenceImages.length) images.push(...globalReferenceImages);
  return images;
}

function getComflyModelResolutionSupport(modelName: string, resolution: string): ResolutionSupport {
  const normalized = getNormalizedModelName(normalizeComflyImageModelAlias(modelName));

  if (normalized.startsWith("gemini-3.1-flash-image-preview")) {
    return resolution === "1K" || resolution === "2K" || resolution === "4K" ? "hard" : "soft";
  }

  if (normalized.startsWith("nano-banana-pro")) {
    return resolution === "1K" || resolution === "2K" ? "hard" : "none";
  }

  if (normalized === "banana2" || normalized === "banana-pro" || normalized === "bananapro") {
    return resolution === "1K" || resolution === "2K" || resolution === "4K" ? "hard" : "soft";
  }

  if (normalized === "gpt-image-2") {
    return "hard";
  }

  return "soft";
}

function resolveComflyImageModel(modelName: string, resolution: string) {
  const canonicalModelName = normalizeComflyImageModelAlias(modelName);
  const normalized = getNormalizedModelName(canonicalModelName);

  if (normalized.startsWith("gemini-3.1-flash-image-preview")) {
    if (resolution === "2K") return "gemini-3.1-flash-image-preview-2k";
    if (resolution === "4K") return "gemini-3.1-flash-image-preview-4k";
    if (resolution === "512PX") return "gemini-3.1-flash-image-preview-512px";
    return "gemini-3.1-flash-image-preview";
  }

  if (normalized.startsWith("nano-banana-pro")) {
    if (resolution === "2K") return "nano-banana-pro-2k";
    if (resolution === "4K") {
      throw createStageError("comfly.chat 当前没有 nano-banana-pro 的 4K 模型，请改用 2K 或切换到 gemini-3.1-flash-image-preview 系列。", "Image Generation");
    }
    return "nano-banana-pro";
  }

  return canonicalModelName;
}

function resolveImageModel(modelName: string, resolution: string, platformPreset: PlatformPreset): ResolvedModelInfo {
  if (platformPreset === "comfly-chat") {
    const actualModel = resolveComflyImageModel(modelName, resolution);
    return {
      requestedModel: modelName,
      actualModel,
      resolutionSupport: getComflyModelResolutionSupport(actualModel, resolution),
    };
  }

  if (platformPreset === "yunwu") {
    const normalized = getNormalizedModelName(modelName);
    if (normalized.startsWith("gemini-3.1-flash-image-preview") || normalized.startsWith("gemini-3-pro-image-preview")) {
      return { requestedModel: modelName, actualModel: modelName, resolutionSupport: "hard" };
    }
    return { requestedModel: modelName, actualModel: modelName, resolutionSupport: "soft" };
  }

  const normalized = getNormalizedModelName(modelName);
  if (GEMINI_NATIVE_HARD_RESOLUTION_MODELS.includes(normalized)) {
    return { requestedModel: modelName, actualModel: modelName, resolutionSupport: "hard" };
  }

  if (isGptImageModel(normalized) || normalized.startsWith("dall-e")) {
    return { requestedModel: modelName, actualModel: modelName, resolutionSupport: "hard" };
  }

  return { requestedModel: modelName, actualModel: modelName, resolutionSupport: "soft" };
}

export function supportsImageInput(modelName: string, apiBaseUrl: string, apiKey: string, platformPreset: PlatformPreset) {
  const normalizedModel = getNormalizedModelName(modelName);

  if (platformPreset === "comfly-chat") {
    return normalizedModel.includes("gemini") || normalizedModel.includes("banana") || normalizedModel.includes("gpt-image") || normalizedModel === "image2";
  }

  if (platformPreset === "yunwu") {
    return normalizedModel.includes("gemini");
  }

  const isCustomOpenAI = !!apiBaseUrl && !!apiKey;
  if (isCustomOpenAI) {
    return isGptImageModel(normalizedModel) || normalizedModel.includes("banana") || normalizedModel.includes("gemini");
  }

  return GEMINI_NATIVE_IMAGE_INPUT_MODELS.includes(normalizedModel);
}

function assertImageInputSupport(task: Task) {
  const store = useAppStore.getState();
  const platformPreset = getPlatformPreset();
  if (!taskHasImageInputs(task, store.globalReferenceImages)) return;

  if (!supportsImageInput(store.imageModel, store.apiBaseUrl, store.apiKey, platformPreset)) {
    throw createStageError(
      "当前模型不支持基于原图或参考图生成，请切换到支持图片输入的模型后再执行。",
      "Image Generation"
    );
  }
}

function buildGenerationConstraints(task: Task, resolution: string, aspectRatio: string) {
  return [
    "[Task Title]",
    task.title,
    "",
    "[Task Description]",
    task.description || "N/A",
    "",
    "[Aspect Ratio]",
    aspectRatio,
    "",
    "[Resolution]",
    resolution,
  ].join("\n");
}

function appendSoftResolutionHint(prompt: string, resolution: string, aspectRatio: string) {
  return `${prompt}\n\n分辨率：${resolution}\n比例：${aspectRatio}\n尽量贴近以上尺寸要求。`;
}

function buildImageAwarePrompt(task: Task, imageCount: number, resolution: string, aspectRatio: string) {
  return [
    buildGenerationConstraints(task, resolution, aspectRatio),
    "",
    `[Image Inputs]`,
    `${imageCount}`,
    "",
    "[Prompt]",
    task.promptText || "N/A",
  ].join("\n");
}

function dataUrlToBase64(dataUrl: string) {
  const parts = dataUrl.split(",");
  return parts.length > 1 ? parts[1] : dataUrl;
}

function normalizeCandidateUrl(value: string) {
  return value.replace(/[)"'\],]+$/g, "").trim();
}

function extractImageCandidatesFromString(input: string) {
  const candidates = new Set<string>();
  const markdownRegex = /!\[.*?\]\((https?:\/\/[^\s)]+)\)/gi;
  const urlRegex = /(https?:\/\/[^\s"'<>]+?\.(?:png|jpg|jpeg|gif|webp)(?:\?[^\s"'<>]*)?)/gi;
  const base64Regex = /(data:image\/(?:png|jpeg|jpg|webp|gif);base64,[a-z0-9+/=]+)/gi;

  for (const match of input.matchAll(markdownRegex)) {
    if (match[1]) candidates.add(normalizeCandidateUrl(match[1]));
  }
  for (const match of input.matchAll(urlRegex)) {
    if (match[1]) candidates.add(normalizeCandidateUrl(match[1]));
  }
  for (const match of input.matchAll(base64Regex)) {
    if (match[1]) candidates.add(match[1].trim());
  }

  return Array.from(candidates);
}

function collectImageCandidates(value: unknown, results = new Set<string>()) {
  if (!value) return results;

  if (typeof value === "string") {
    extractImageCandidatesFromString(value).forEach(candidate => results.add(candidate));
    return results;
  }

  if (Array.isArray(value)) {
    value.forEach(item => collectImageCandidates(item, results));
    return results;
  }

  if (typeof value === "object") {
    Object.values(value as Record<string, unknown>).forEach(item => collectImageCandidates(item, results));
  }

  return results;
}

function scoreImageCandidate(candidate: string) {
  const normalized = candidate.toLowerCase();
  let score = 0;

  if (normalized.startsWith("data:image/")) score += 500;
  if (normalized.includes("original")) score += 180;
  if (normalized.includes("full")) score += 160;
  if (normalized.includes("download")) score += 140;
  if (normalized.includes("raw")) score += 120;
  if (normalized.includes("hd")) score += 90;
  if (normalized.includes("4k")) score += 90;
  if (normalized.includes("2k")) score += 60;
  if (normalized.includes("large")) score += 50;

  if (normalized.includes("preview")) score -= 220;
  if (normalized.includes("thumb")) score -= 180;
  if (normalized.includes("thumbnail")) score -= 180;
  if (normalized.includes("small")) score -= 140;
  if (normalized.includes("compress")) score -= 120;
  if (normalized.includes("resize")) score -= 100;
  if (normalized.includes("cdn")) score -= 10;

  score += candidate.length > 180 ? 25 : 0;

  return score;
}

function classifyImageSourceType(candidate: string) {
  const normalized = candidate.toLowerCase();
  if (normalized.startsWith("data:image/")) return "base64" as const;
  if (normalized.includes("preview") || normalized.includes("thumb") || normalized.includes("thumbnail") || normalized.includes("small") || normalized.includes("compress")) {
    return "preview" as const;
  }
  return "original" as const;
}

function extractImageResultFromResponse(payload: unknown): GeneratedImageResult | null {
  const candidates = Array.from(collectImageCandidates(payload));
  if (candidates.length === 0) return null;

  const ranked = candidates
    .map(candidate => ({ candidate, score: scoreImageCandidate(candidate), type: classifyImageSourceType(candidate) }))
    .sort((a, b) => b.score - a.score);

  const best = ranked[0];
  const bestPreview = ranked.find(item => item.type === "preview")?.candidate;
  const bestOriginal = ranked.find(item => item.type === "original" || item.type === "base64")?.candidate;

  return {
    src: best.candidate,
    sourceType: best.type,
    previewSrc: bestPreview,
    originalSrc: best.type === "preview" ? bestOriginal : best.candidate,
  };
}

async function measureImageDimensions(src: string): Promise<ImageDimensions | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function getGeminiSampleImageSize(resolution: string) {
  switch (resolution) {
    case "4K":
      return "4096";
    case "2K":
      return "2048";
    default:
      return "1024";
  }
}

function getGeminiAspectRatio(aspectRatio: string) {
  return GEMINI_SUPPORTED_ASPECT_RATIOS.has(aspectRatio) ? aspectRatio : undefined;
}

function getGeminiImageSize(resolution: string) {
  switch (resolution) {
    case "4K":
      return "4K";
    case "2K":
      return "2K";
    default:
      return "1K";
  }
}

function normalizeGeminiBaseUrl(baseUrl: string) {
  let normalized = baseUrl.replace(/\/+$/, "");
  if (normalized.endsWith("/v1")) return normalized.replace(/\/v1$/, "/v1beta");
  if (normalized.endsWith("/v1beta")) return normalized;
  return `${normalized}/v1beta`;
}

function buildGeminiGatewayHeaders(apiKey: string) {
  return {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${apiKey}`
  };
}

function getOpenAIImageSize(aspectRatio: string) {
  if (aspectRatio === "9:16" || aspectRatio === "3:4" || aspectRatio === "2:3" || aspectRatio === "1:4" || aspectRatio === "1:8") {
    return "1024x1536";
  }
  if (aspectRatio === "16:9" || aspectRatio === "4:3" || aspectRatio === "3:2" || aspectRatio === "4:1" || aspectRatio === "8:1" || aspectRatio === "21:9") {
    return "1536x1024";
  }
  return "1024x1024";
}

function parseAspectRatioValue(aspectRatio: string) {
  if (!aspectRatio || aspectRatio === "auto") return 1;
  const parts = aspectRatio.split(":");
  if (parts.length !== 2) return 1;
  const width = Number(parts[0]);
  const height = Number(parts[1]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return 1;
  return width / height;
}

function clampImage2AspectRatio(aspectRatio: string) {
  const ratio = parseAspectRatioValue(aspectRatio);
  return Math.min(3, Math.max(1 / 3, ratio));
}

function roundToMultipleOf16(value: number) {
  return Math.max(16, Math.round(value / 16) * 16);
}

function floorToMultipleOf16(value: number) {
  return Math.max(16, Math.floor(value / 16) * 16);
}

function getImage2TargetPixels(resolution: string) {
  switch (resolution) {
    case "4K":
      return 8_294_400;
    case "2K":
      return 2_359_296;
    default:
      return 1_048_576;
  }
}

function getImage2ImageSize(aspectRatio: string, resolution: string) {
  const targetPixels = getImage2TargetPixels(resolution);
  const ratio = clampImage2AspectRatio(aspectRatio);
  let width = Math.sqrt(targetPixels * ratio);
  let height = width / ratio;

  width = roundToMultipleOf16(width);
  height = roundToMultipleOf16(height);

  const longestEdge = Math.max(width, height);
  if (longestEdge > 4000) {
    const scale = 4000 / longestEdge;
    width = floorToMultipleOf16(width * scale);
    height = floorToMultipleOf16(height * scale);
  }

  let pixels = width * height;
  if (pixels < 655_360) {
    const scale = Math.sqrt(655_360 / pixels);
    width = roundToMultipleOf16(width * scale);
    height = roundToMultipleOf16(height * scale);
    if (Math.max(width, height) > 4000) {
      const retryScale = 4000 / Math.max(width, height);
      width = floorToMultipleOf16(width * retryScale);
      height = floorToMultipleOf16(height * retryScale);
    }
    pixels = width * height;
  }

  if (pixels > 8_294_400) {
    const scale = Math.sqrt(8_294_400 / pixels);
    width = floorToMultipleOf16(width * scale);
    height = floorToMultipleOf16(height * scale);
  }

  return `${width}x${height}`;
}

function getOpenAIImageQuality(resolution: string) {
  return resolution === "4K" || resolution === "2K" ? "high" : "medium";
}

function parseCustomImageSize(resolution: string) {
  const match = String(resolution || "").trim().match(/^(\d+)x(\d+)$/i);
  if (!match) return null;

  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isInteger(width) || !Number.isInteger(height)) return null;
  if (width <= 0 || height <= 0) return null;
  if (width % 16 !== 0 || height % 16 !== 0) return null;
  if (width > 4000 || height > 4000) return null;

  const ratio = Math.max(width / height, height / width);
  if (ratio > 3) return null;

  const pixels = width * height;
  if (pixels < 655_360 || pixels > 8_294_400) return null;

  return `${width}x${height}`;
}

function isExactImage2Size(resolution: string) {
  return Boolean(parseCustomImageSize(resolution));
}

function getRequestedImageSize(modelName: string, aspectRatio: string, resolution: string) {
  if (isComflyResponsesImageModel(modelName, "comfly-chat") || getNormalizedModelName(modelName) === "gpt-image-2") {
    return parseCustomImageSize(resolution) || getImage2ImageSize(aspectRatio, resolution);
  }

  return getOpenAIImageSize(aspectRatio);
}

function buildComflyResolutionFields(modelName: string, resolution: string, aspectRatio: string) {
  const payload: Record<string, string> = { model: modelName };

  if (isComflyResponsesImageModel(modelName, "comfly-chat")) {
    payload.size = getRequestedImageSize(modelName, aspectRatio, resolution);
    return payload;
  }

  if (modelName.includes("banana")) {
    payload.resolution = resolution;
    payload.size = resolution;
  }

  if (aspectRatio !== "auto") {
    payload.aspect_ratio = aspectRatio;
  }

  return payload;
}

function extractImageResultFromResponsesApi(payload: any): GeneratedImageResult | null {
  const imageOutput = payload?.output?.find?.((item: any) => item?.type === "image_generation_call");
  const base64Image = imageOutput?.result;
  if (typeof base64Image === "string" && base64Image.trim()) {
    const mimeType = imageOutput?.mime_type || "image/png";
    const src = `data:${mimeType};base64,${base64Image}`;
    return {
      src,
      sourceType: "base64",
      originalSrc: src
    };
  }

  return extractImageResultFromResponse(payload);
}

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } catch (error: any) {
    if (error?.name === "AbortError") {
      throw new Error(`Request timed out after ${Math.round(timeoutMs / 1000)} seconds`);
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

async function retryWrap<T>(fn: () => Promise<T>, maxRetries = 2, delay = 1500): Promise<T> {
  let attempt = 0;
  while (attempt <= maxRetries) {
    try {
      return await fn();
    } catch (err: any) {
      if (attempt === maxRetries) throw err;
      attempt++;
      await sleep(delay);
    }
  }
  throw new Error("Retry failed");
}

export async function processBatch(mode: "all" | "prompts" | "images" = "all") {
  const store = useAppStore.getState();
  store.setBatchRunning(true);

  if ("Notification" in window && Notification.permission === "default") {
    Notification.requestPermission();
  }

  const selectedTaskIds = store.selectedTaskIds;
  const useSelected = selectedTaskIds.length > 0;
  const tasksToProcess = store.tasks.filter(t => {
    if (useSelected && !selectedTaskIds.includes(t.id)) return false;
    return t.status !== "Success";
  });

  if (tasksToProcess.length === 0) {
    store.setBatchRunning(false);
    return;
  }

  const limit = pLimit(store.maxConcurrency || 3);
  const promises = tasksToProcess.map(task => limit(async () => {
    if (!useAppStore.getState().isBatchRunning) return;

    window.dispatchEvent(new CustomEvent("scroll-to-task", { detail: { id: task.id } }));

    try {
      if (mode === "all" || mode === "prompts") {
        const currentTask = useAppStore.getState().tasks.find(x => x.id === task.id);
        if (currentTask && !currentTask.promptText) {
          useAppStore.getState().updateTask(task.id, { status: "Prompting" });
          const generatedPrompt = await retryWrap(() => generateTaskPrompt(task.id));
          useAppStore.getState().updateTask(task.id, { promptText: generatedPrompt, promptSource: "auto", errorLog: undefined });
        }
      }

      if (!useAppStore.getState().isBatchRunning) return;

      if (mode === "all" || mode === "images") {
        const currentTask = useAppStore.getState().tasks.find(x => x.id === task.id);
        if (currentTask && currentTask.promptText && !currentTask.resultImage) {
          useAppStore.getState().updateTask(task.id, { status: "Rendering", errorLog: undefined });
          const generatedImage = await retryWrap(() => runImageGeneration(task.id));
          const dimensions = await measureImageDimensions(generatedImage.src);
          useAppStore.getState().updateTask(task.id, {
            resultImage: generatedImage.src,
            resultImagePreview: generatedImage.previewSrc,
            resultImageOriginal: generatedImage.originalSrc,
            resultImageSourceType: generatedImage.sourceType,
            resultImageWidth: dimensions?.width,
            resultImageHeight: dimensions?.height,
            status: "Success"
          });
        } else if (currentTask && currentTask.resultImage) {
          useAppStore.getState().updateTask(task.id, { status: "Success" });
        }
      } else {
        useAppStore.getState().updateTask(task.id, { status: "Success" });
      }
    } catch (error: any) {
      if (!useAppStore.getState().isBatchRunning) return;
      toast.error(`任务 ${task.title || task.index} 处理失败`);
      useAppStore.getState().updateTask(task.id, {
        status: "Error",
        errorLog: {
          message: error.message || "Error occurred",
          time: Date.now(),
          stage: error.stage || "Unknown"
        }
      });
    }
  }));

  await Promise.allSettled(promises);

  if (useAppStore.getState().isBatchRunning) {
    useAppStore.getState().setBatchRunning(false);
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification("BatchRefiner", { body: "批量处理完成" });
    }
  }
}

export function haltBatch() {
  const store = useAppStore.getState();
  store.setBatchRunning(false);
  const tasks = store.tasks.map(t => {
    if (t.status === "Prompting" || t.status === "Rendering") {
      return {
        ...t,
        status: "Error" as const,
        errorLog: { message: "已被用户手动中断", time: Date.now(), stage: t.status }
      };
    }
    return t;
  });
  store.setProjectFields({ tasks });
}

export async function processSingleTask(taskId: string) {
  const store = useAppStore.getState();
  const task = store.tasks.find(t => t.id === taskId);
  if (!task) return;

  try {
    const currentTask = useAppStore.getState().tasks.find(x => x.id === taskId);
    if (!currentTask) return;

    let promptText = currentTask.promptText;
    if (!promptText) {
      store.updateTask(taskId, { status: "Prompting", errorLog: undefined });
      promptText = await retryWrap(() => generateTaskPrompt(taskId));
      store.updateTask(taskId, { promptText, promptSource: "auto", errorLog: undefined });
    }

    store.updateTask(taskId, { status: "Rendering", errorLog: undefined });
    const generatedImage = await retryWrap(() => runImageGeneration(taskId));
    const dimensions = await measureImageDimensions(generatedImage.src);
    store.updateTask(taskId, {
      resultImage: generatedImage.src,
      resultImagePreview: generatedImage.previewSrc,
      resultImageOriginal: generatedImage.originalSrc,
      resultImageSourceType: generatedImage.sourceType,
      resultImageWidth: dimensions?.width,
      resultImageHeight: dimensions?.height,
      status: "Success"
    });
  } catch (error: any) {
    store.updateTask(taskId, {
      status: "Error",
      errorLog: { message: error.message || "Error occurred", time: Date.now(), stage: error.stage }
    });
  }
}

export async function generateTaskPrompt(taskId: string): Promise<string> {
  const store = useAppStore.getState();
  const task = store.tasks.find(t => t.id === taskId);
  if (!task) throw new Error("Task not found");

  const resolution = getEffectiveResolution(task);
  const aspectRatio = getEffectiveAspectRatio(task);
  const systemPrompt = "你负责根据用户输入整理出一段可直接用于生图或改图的最终提示词，不强制英文，不额外解释。";
  const contentMsg = [
    `[Global Skill (Style Constraint)]\n${store.globalSkillText || "N/A"}`,
    `[Global Target (Action Constraint)]\n${store.globalTargetText || "N/A"}`,
    buildGenerationConstraints(task, resolution, aspectRatio),
  ].join("\n\n");
  const platformPreset = getPlatformPreset();
  const isGeminiGateway = platformPreset === "yunwu" && !!store.apiBaseUrl && !!store.apiKey;
  const isCustomOpenAI = !isGeminiGateway && (platformPreset === "comfly-chat" || platformPreset === "openai-compatible" || platformPreset === "custom");

  try {
    if (isGeminiGateway) {
      const geminiBaseUrl = normalizeGeminiBaseUrl(store.apiBaseUrl);
      const res = await fetchWithTimeout(`${geminiBaseUrl}/models/${store.textModel}:generateContent`, {
        method: "POST",
        headers: buildGeminiGatewayHeaders(store.apiKey),
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: contentMsg }] }],
          generationConfig: {
            temperature: 0.4
          }
        })
      }, PROMPT_REQUEST_TIMEOUT_MS);

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`HTTP Error ${res.status}: ${errText.substring(0, 100)}`);
      }

      const json = await res.json();
      return json.candidates?.[0]?.content?.parts?.map((part: any) => part.text).filter(Boolean).join("\n").trim() || "Generated prompt fallback";
    }

    if (isCustomOpenAI && store.apiBaseUrl && store.apiKey) {
      let baseUrl = store.apiBaseUrl.replace(/\/+$/, "");
      if (!baseUrl.endsWith("/v1")) baseUrl += "/v1";

      const res = await fetchWithTimeout(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${store.apiKey}`
        },
        body: JSON.stringify({
          model: store.textModel,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: contentMsg }
          ]
        })
      }, PROMPT_REQUEST_TIMEOUT_MS);

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`HTTP Error ${res.status}: ${errText.substring(0, 100)}`);
      }

      const json = await res.json();
      return json.choices?.[0]?.message?.content?.trim() || "Generated prompt fallback";
    }

    const apiKey = getBuiltInGeminiApiKey();
    if (!apiKey) {
      throw new Error("Missing built-in Gemini API Key. For public deployments, use the in-app API settings instead of bundling a key into the frontend.");
    }

    const res = await fetchWithTimeout(`https://generativelanguage.googleapis.com/v1beta/models/${store.textModel || "gemini-2.0-flash"}:generateContent?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: [{ parts: [{ text: contentMsg }] }]
      })
    }, PROMPT_REQUEST_TIMEOUT_MS);

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Gemini Error ${res.status}: ${errText.substring(0, 100)}`);
    }

    const json = await res.json();
    return json.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "Generated prompt fallback";
  } catch (e: any) {
    throw createStageError(e.message, "Prompt Generation");
  }
}

async function runImageGeneration(taskId: string): Promise<GeneratedImageResult> {
  const store = useAppStore.getState();
  const task = store.tasks.find(t => t.id === taskId);
  if (!task || !task.promptText) throw new Error("Task or prompt missing");

  const platformPreset = getPlatformPreset();
  const isGeminiGateway = platformPreset === "yunwu" && !!store.apiBaseUrl && !!store.apiKey;
  const isCustomOpenAI = !isGeminiGateway && (platformPreset === "comfly-chat" || platformPreset === "openai-compatible" || platformPreset === "custom");
  const resolution = getEffectiveResolution(task);
  const aspectRatio = getEffectiveAspectRatio(task);
  const imageInputs = getTaskImageInputs(task, store.globalReferenceImages);
  const hasImageInputs = imageInputs.length > 0;
  const resolvedModel = resolveImageModel(store.imageModel, resolution, platformPreset);
  useAppStore.getState().updateTask(taskId, {
    lastUsedImageModel: resolvedModel.actualModel
  });

  let promptForGeneration = task.promptText;
  if (resolvedModel.resolutionSupport === "soft") {
    promptForGeneration = appendSoftResolutionHint(promptForGeneration, resolution, aspectRatio);
  } else if (resolvedModel.resolutionSupport === "none") {
    throw createStageError("当前平台或模型不支持所选分辨率，请切换模型或改用较低分辨率。", "Image Generation");
  }

  try {
    if (hasImageInputs) {
      assertImageInputSupport(task);
    }

    if (isGeminiGateway) {
      const geminiBaseUrl = normalizeGeminiBaseUrl(store.apiBaseUrl);
      const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [
        { text: hasImageInputs ? buildImageAwarePrompt(task, imageInputs.length, resolution, aspectRatio) : promptForGeneration }
      ];

      if (hasImageInputs) {
        imageInputs.forEach(image => {
          const mimeTypeMatch = image.match(/^data:(image\/[^;]+);base64,/i);
          parts.push({
            inlineData: {
              mimeType: mimeTypeMatch?.[1] || "image/jpeg",
              data: dataUrlToBase64(image)
            }
          });
        });
      }

      const generationConfig: Record<string, unknown> = {
        responseModalities: ["TEXT", "IMAGE"],
        imageConfig: {
          imageSize: getGeminiImageSize(resolution)
        }
      };

      const geminiAspectRatio = getGeminiAspectRatio(aspectRatio);
      if (geminiAspectRatio) {
        (generationConfig.imageConfig as Record<string, unknown>).aspectRatio = geminiAspectRatio;
      }

      const res = await fetchWithTimeout(`${geminiBaseUrl}/models/${resolvedModel.actualModel}:generateContent`, {
        method: "POST",
        headers: buildGeminiGatewayHeaders(store.apiKey),
        body: JSON.stringify({
          contents: [{ role: "user", parts }],
          generationConfig
        })
      }, IMAGE_REQUEST_TIMEOUT_MS);

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`HTTP Error ${res.status}: ${errText.substring(0, 160)}`);
      }

      const json = await res.json();
      const responseParts = json.candidates?.[0]?.content?.parts || [];
      const inlineImagePart = responseParts.find((part: any) => part.inlineData?.data);
      if (!inlineImagePart?.inlineData?.data) {
        throw new Error("No image data returned from Gemini gateway");
      }

      const mimeType = inlineImagePart.inlineData.mimeType || "image/png";
      const src = `data:${mimeType};base64,${inlineImagePart.inlineData.data}`;
      return {
        src,
        sourceType: "base64",
        originalSrc: src
      };
    }

    if (isCustomOpenAI) {
      let baseUrl = store.apiBaseUrl.replace(/\/+$/, "");
      if (!baseUrl.endsWith("/v1")) baseUrl += "/v1";

      if (isComflyResponsesImageModel(resolvedModel.actualModel, platformPreset) && hasImageInputs) {
        const requestBody: Record<string, unknown> = {
          model: resolvedModel.actualModel,
          prompt: buildImageAwarePrompt(task, imageInputs.length, resolution, aspectRatio),
          image: imageInputs,
          size: getRequestedImageSize(resolvedModel.actualModel, aspectRatio, resolution),
        };

        if (aspectRatio !== "auto" && !isExactImage2Size(resolution)) {
          requestBody.aspect_ratio = aspectRatio;
        }

        const res = await fetchWithTimeout(`${baseUrl}/images/generations`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${store.apiKey}`
          },
          body: JSON.stringify(requestBody)
        }, IMAGE_REQUEST_TIMEOUT_MS);

        if (!res.ok) {
          const errText = await res.text();
          throw new Error(`HTTP Error ${res.status}: ${errText.substring(0, 160)}`);
        }

        const json = await res.json();
        const extracted = extractImageResultFromResponse(json);
        if (!extracted) throw new Error("Could not extract image from comfly.chat image generation output");
        return extracted;
      }

      if (hasImageInputs) {
        const content = [
          { type: "text", text: buildImageAwarePrompt(task, imageInputs.length, resolution, aspectRatio) },
          ...imageInputs.map(image => ({ type: "image_url", image_url: { url: image } }))
        ];

        const requestBody: Record<string, unknown> = {
          model: resolvedModel.actualModel,
          messages: [{ role: "user", content }]
        };

        if (platformPreset === "comfly-chat") {
          Object.assign(requestBody, buildComflyResolutionFields(resolvedModel.actualModel, resolution, aspectRatio));
        }

        const res = await fetchWithTimeout(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${store.apiKey}`
          },
          body: JSON.stringify(requestBody)
        }, IMAGE_REQUEST_TIMEOUT_MS);

        if (!res.ok) {
          const errText = await res.text();
          throw new Error(`HTTP Error ${res.status}: ${errText.substring(0, 100)}`);
        }

        const json = await res.json();
        const extracted = extractImageResultFromResponse(json);
        if (!extracted) throw new Error("Could not extract image from image-aware model output");
        return extracted;
      }

      const requestBody: Record<string, unknown> = {
        model: resolvedModel.actualModel,
        prompt: promptForGeneration,
        n: 1
      };

      if (platformPreset === "comfly-chat") {
        Object.assign(requestBody, buildComflyResolutionFields(resolvedModel.actualModel, resolution, aspectRatio));
      } else if (isGptImageModel(resolvedModel.actualModel) || resolvedModel.actualModel.startsWith("dall-e")) {
        requestBody.size = getRequestedImageSize(resolvedModel.actualModel, aspectRatio, resolution);
        requestBody.quality = getOpenAIImageQuality(resolution);
      }

      const res = await fetchWithTimeout(`${baseUrl}/images/generations`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${store.apiKey}`
        },
        body: JSON.stringify(requestBody)
      }, IMAGE_REQUEST_TIMEOUT_MS);

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`HTTP Error ${res.status}: ${errText.substring(0, 100)}`);
      }

      const json = await res.json();
      const data = json.data?.[0];
      if (!data) throw new Error("No image data returned object");
      const resultSrc = data.b64_json ? `data:image/jpeg;base64,${data.b64_json}` : data.url;
      if (!resultSrc) throw new Error("No image source returned from image generation");
      return {
        src: resultSrc,
        sourceType: data.b64_json ? "base64" : "original",
        originalSrc: resultSrc
      };
    }

    const apiKey = getBuiltInGeminiApiKey();
    if (!apiKey) {
      throw new Error("Missing built-in Gemini API Key for image generation. For public deployments, use the in-app API settings instead of bundling a key into the frontend.");
    }

    if (hasImageInputs) {
      const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [
        { text: buildImageAwarePrompt(task, imageInputs.length, resolution, aspectRatio) }
      ];

      imageInputs.forEach(image => {
        const mimeTypeMatch = image.match(/^data:(image\/[^;]+);base64,/i);
        parts.push({
          inlineData: {
            mimeType: mimeTypeMatch?.[1] || "image/jpeg",
            data: dataUrlToBase64(image)
          }
        });
      });

      const res = await fetchWithTimeout(`https://generativelanguage.googleapis.com/v1beta/models/${resolvedModel.actualModel}:generateContent?key=${apiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts }],
          generationConfig: {
            responseModalities: ["TEXT", "IMAGE"]
          }
        })
      }, IMAGE_REQUEST_TIMEOUT_MS);

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Gemini Error ${res.status}: ${errText.substring(0, 100)}`);
      }

      const json = await res.json();
      const responseParts = json.candidates?.[0]?.content?.parts || [];
      const inlineImagePart = responseParts.find((part: any) => part.inlineData?.data);
      if (!inlineImagePart?.inlineData?.data) {
        throw new Error("No image data returned from Gemini image-input generation");
      }

      const mimeType = inlineImagePart.inlineData.mimeType || "image/png";
      return {
        src: `data:${mimeType};base64,${inlineImagePart.inlineData.data}`,
        sourceType: "base64",
        originalSrc: `data:${mimeType};base64,${inlineImagePart.inlineData.data}`
      };
    }

    const params: Record<string, unknown> = {
      sampleCount: 1,
      personGeneration: "ALLOW_ADULT"
    };

    if (resolvedModel.resolutionSupport === "hard") {
      params.sampleImageSize = getGeminiSampleImageSize(resolution);
      const geminiAspectRatio = getGeminiAspectRatio(aspectRatio);
      if (geminiAspectRatio) params.aspectRatio = geminiAspectRatio;
    }

    const res = await fetchWithTimeout(`https://generativelanguage.googleapis.com/v1beta/models/${resolvedModel.actualModel}:predict?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        instances: [{ prompt: promptForGeneration }],
        parameters: params
      })
    }, IMAGE_REQUEST_TIMEOUT_MS);

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Imagen Error ${res.status}: ${errText.substring(0, 100)}`);
    }

    const json = await res.json();
    const b64 = json.predictions?.[0]?.bytesBase64Encoded;
    if (!b64) throw new Error("No predictions returned from Imagen");
    return {
      src: `data:image/jpeg;base64,${b64}`,
      sourceType: "base64",
      originalSrc: `data:image/jpeg;base64,${b64}`
    };
  } catch (e: any) {
    throw createStageError(e.message, "Image Generation");
  }
}
