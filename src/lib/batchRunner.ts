import { AspectRatio, BatchCount, ImageQuality, PlatformPreset, Resolution, Task, TaskResultImage, TaskStatus } from "@/types";
import { useAppStore } from "@/store";
import { toast } from "sonner";
import { getBatchCountNumber, getEffectiveBatchCount } from "./taskResults";
import { normalizeTaskConcurrency, runTaskExecutionQueue } from "./taskExecutionQueue";
import { getExecutablePromptText, getPreparedPromptText, isPromptOptimizationEnabled } from "./promptExecution";
import { dataUrlToBlob, primeResultImageCache, primeTaskResultImageCache, storeResultImageBlob } from "./resultImageCache";
import { getResultImageAssetSrc, inferResultImageAssetMetadata, isValidResultImageAssetSrc } from "./resultImageAsset";
import { storeImageAssetFromDataUrl } from "./imageAssetStore";
import {
  appendGenerationLogEvent,
  buildGenerationTaskSnapshot,
  buildImageResultSummary,
  createGenerationLogSession,
  finishGenerationLogSession,
  sanitizeLogData,
  updateGenerationLogSummary,
} from "./appLogger";

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const PROMPT_REQUEST_TIMEOUT_MS = 90_000;
const IMAGE_REQUEST_TIMEOUT_MS = 180_000;
const YUNWU_GPT_IMAGE_REQUEST_TIMEOUT_MS = 300_000;
const IMAGE_UPDATE_FLUSH_MS = 350;

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
  assetId?: string;
  assetSrc?: string;
  assetStorageStatus?: "stored" | "skipped" | "failed";
  assetMimeType?: string;
  assetExtension?: string;
  assetSize?: number;
  downloadSourceType?: "original" | "src" | "data_url";
  downloadCacheStatus?: "primed" | "miss" | "failed";
  normalizationStatus?: "ok" | "invalid_source" | "download_unreachable";
  downloadStatus?: "ready" | "fetch_failed" | "cache_failed" | "save_failed" | "invalid_source";
  downloadFailureStage?: "normalize" | "fetch" | "cache" | "save";
  downloadFailureReason?: string;
  assetWidth?: number;
  assetHeight?: number;
  requestedWidth?: number;
  requestedHeight?: number;
  generationTimeMs?: number;
}

interface GeneratedBatchResult {
  images: TaskResultImage[];
  failedCount: number;
}

interface RunImageGenerationOptions {
  onImage?: (image: TaskResultImage, images: TaskResultImage[], failedCount: number) => void;
  logSessionId?: string;
  shouldContinue?: () => boolean;
}

interface GeneratedPromptResult {
  promptText: string;
  inputSignature: string;
  logSessionId?: string;
}

interface GenerationLogContext {
  logSessionId?: string;
  triggerId?: string;
  mode?: "prompt-preview" | "prompt-batch" | "image-single" | "image-batch" | "all-batch";
}

function getRequestPathLabel(url: string) {
  try {
    const parsed = new URL(url, window.location.origin);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return url;
  }
}

function summarizePromptImages(imageInputs: string[]) {
  return imageInputs.map((image, index) => ({
    index,
    sourceType: image.startsWith('data:image/') ? 'data_url' : image.startsWith('blob:') ? 'blob' : 'url',
    length: image.length,
    preview: typeof image === 'string' ? image.slice(0, 64) : '',
  }));
}

function summarizeTextForLog(text: string, previewLength = 180) {
  return {
    length: text.length,
    preview: text.slice(0, previewLength),
  };
}

async function summarizeGenerationImageInputs(task: Task, imageInputs: string[]) {
  const sources = getTaskImageInputsDetailed(task, useAppStore.getState().globalReferenceImages);
  const summaries = await Promise.all(
    imageInputs.map(async (image, index) => {
      const dimensions = await measureImageDimensions(image);
      const mimeMatch = image.match(/^data:(image\/[^;]+);base64,/i);
      return {
        index,
        role: sources[index]?.type || 'reference',
        mime: mimeMatch?.[1] || 'image/unknown',
        length: image.length,
        width: dimensions?.width,
        height: dimensions?.height,
        preview: image.slice(0, 48),
      };
    }),
  );
  return summaries;
}

function summarizeJsonImageRequestBody(payload: Record<string, unknown>, promptText?: string) {
  const summary: Record<string, unknown> = {
    keys: Object.keys(payload),
  };

  if (typeof payload.model === "string") summary.model = payload.model;
  if (typeof payload.size === "string") summary.size = payload.size;
  if (typeof payload.quality === "string") summary.quality = payload.quality;
  if (typeof payload.response_format === "string") summary.responseFormat = payload.response_format;
  if (typeof payload.n === "number" || typeof payload.n === "string") summary.n = payload.n;
  if (typeof payload.sampleCount === "number") summary.sampleCount = payload.sampleCount;
  if (typeof payload.aspect_ratio === "string") summary.aspectRatio = payload.aspect_ratio;

  if (Array.isArray(payload.image)) {
    summary.imageCount = payload.image.length;
  } else if (payload.image) {
    summary.hasImage = true;
  }

  if (payload.messages) {
    summary.hasMessages = true;
  }

  if (payload.contents) {
    summary.hasContents = true;
  }

  if (payload.parameters && typeof payload.parameters === "object") {
    summary.parameters = sanitizeLogData(payload.parameters);
  }

  if (promptText) {
    summary.prompt = summarizeTextForLog(promptText);
  } else if (typeof payload.prompt === "string") {
    summary.prompt = summarizeTextForLog(payload.prompt);
  }

  return sanitizeLogData(summary) as Record<string, unknown>;
}

function summarizeFormDataForLog(fields: Record<string, unknown>, promptText?: string) {
  const summary: Record<string, unknown> = {
    ...fields,
  };
  if (promptText) {
    summary.prompt = summarizeTextForLog(promptText);
  }
  return sanitizeLogData(summary) as Record<string, unknown>;
}

function summarizeGeneratedImageResponse(result: GeneratedImageResult) {
  return sanitizeLogData({
    sourceType: result.sourceType,
    hasPreviewSrc: Boolean(result.previewSrc),
    hasOriginalSrc: Boolean(result.originalSrc),
    responseKind: result.src.startsWith("data:image/")
      ? "data_url"
      : result.src.startsWith("http")
        ? "url"
        : result.src.startsWith("blob:")
          ? "blob"
          : "unknown",
    srcPreview: result.src.slice(0, 120),
    requestedWidth: result.requestedWidth,
    requestedHeight: result.requestedHeight,
    generationTimeMs: result.generationTimeMs,
  }) as Record<string, unknown>;
}

function buildResultSizeComparison(image: TaskResultImage) {
  const requestedWidth = image.requestedWidth;
  const requestedHeight = image.requestedHeight;
  const actualWidth = image.assetWidth || image.width;
  const actualHeight = image.assetHeight || image.height;

  return sanitizeLogData({
    requestedWidth,
    requestedHeight,
    requestedSize:
      requestedWidth && requestedHeight ? `${requestedWidth}x${requestedHeight}` : undefined,
    actualWidth,
    actualHeight,
    actualSize:
      actualWidth && actualHeight ? `${actualWidth}x${actualHeight}` : undefined,
  }) as Record<string, unknown>;
}

interface PromptInputSignatureContext {
  globalReferenceImages?: string[];
  globalSkillText?: string;
  enablePromptOptimization?: boolean;
  textModel?: string;
  platformPreset?: PlatformPreset;
  apiBaseUrl?: string;
  textApiBaseUrl?: string;
}

function getBuiltInGeminiApiKey() {
  return import.meta.env.VITE_GEMINI_API_KEY?.trim() || "";
}

function createStageError(message: string, stage: string) {
  const error = new Error(message);
  (error as any).stage = stage;
  return error;
}

function isBatchExecutionActive() {
  return useAppStore.getState().isBatchRunning;
}

function getNormalizedModelName(model?: string) {
  return (model || "").trim().toLowerCase();
}

function isGptImageModel(model?: string) {
  const normalized = getNormalizedModelName(model);
  return normalized.startsWith("gpt-image") || normalized === "image2";
}

function isDocumentedImage2Model(model?: string) {
  const normalized = getNormalizedModelName(model);
  return normalized === "image2" || normalized.startsWith("gpt-image-2");
}


function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`);
    return `{${entries.join(",")}}`;
  }

  return JSON.stringify(value);
}

export function buildPromptInputSignature(
  task: Pick<Task, "description" | "referenceImages">,
  context: PromptInputSignatureContext,
) {
  const signaturePayload = {
    description: task.description?.trim() || "",
    referenceImages: task.referenceImages || [],
    globalReferenceImages: context.globalReferenceImages || [],
    globalSkillText: context.globalSkillText?.trim() || "",
    enablePromptOptimization: context.enablePromptOptimization !== false,
    textModel: context.textModel || "",
    platformPreset: context.platformPreset,
    apiBaseUrl: context.textApiBaseUrl || context.apiBaseUrl || "",
  };

  return stableStringify(signaturePayload);
}

export function getTaskPromptInputSignature(task: Pick<Task, "description" | "referenceImages">): string {
  const store = useAppStore.getState();
  return buildPromptInputSignature(task, store);
}

export function isTaskPromptCurrent(task: Pick<Task, "description" | "referenceImages" | "promptText" | "promptInputSignature">) {
  const promptText = task.promptText?.trim();
  if (!promptText) return false;
  return task.promptInputSignature === getTaskPromptInputSignature(task);
}

function isComflyResponsesImageModel(model?: string, platformPreset?: PlatformPreset) {
  if (platformPreset !== "comfly-chat") return false;
  const normalized = getNormalizedModelName(model);
  return normalized === "gpt-image-2" || normalized === "image2";
}

function isYunwuGptImageModel(model?: string, platformPreset?: PlatformPreset) {
  if (platformPreset !== "yunwu") return false;
  const normalized = getNormalizedModelName(model);
  return normalized === "gpt-image-2" || normalized === "gpt-image-2-all" || normalized === "image2";
}

function normalizeComflyImageModelAlias(modelName: string) {
  const normalized = getNormalizedModelName(modelName);
  if (normalized === "image2") return "gpt-image-2";
  return modelName;
}

function normalizeYunwuImageModelAlias(modelName: string) {
  const normalized = getNormalizedModelName(modelName);
  if (normalized === "image2" || normalized === "gpt-image-2") return "gpt-image-2-all";
  return modelName;
}

function normalizeOpenAIImageModelAlias(modelName: string) {
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

function gcd(a: number, b: number) {
  let x = Math.abs(Math.round(a));
  let y = Math.abs(Math.round(b));
  while (y !== 0) {
    const next = x % y;
    x = y;
    y = next;
  }
  return x || 1;
}

function reduceAspectRatio(width: number, height: number) {
  const divisor = gcd(width, height);
  return `${Math.round(width / divisor)}:${Math.round(height / divisor)}`;
}

function resolveAspectRatioForImage2(task: Task, aspectRatio: string, sourceDimensions?: ImageDimensions | null) {
  if (aspectRatio !== "auto") return aspectRatio;
  if (!sourceDimensions?.width || !sourceDimensions?.height) return aspectRatio;
  return reduceAspectRatio(sourceDimensions.width, sourceDimensions.height);
}

function getPlatformPreset() {
  return (useAppStore.getState().platformPreset || "comfly-chat") as PlatformPreset;
}

function getTextApiBaseUrl(store: { apiBaseUrl?: string; textApiBaseUrl?: string }) {
  return (store.textApiBaseUrl || store.apiBaseUrl || "").trim();
}

function getImageApiBaseUrl(store: { apiBaseUrl?: string; imageApiBaseUrl?: string; textApiBaseUrl?: string }) {
  return (store.imageApiBaseUrl || store.apiBaseUrl || store.textApiBaseUrl || "").trim();
}

function getImageApiPath(store: { imageApiPath?: string }) {
  return (store.imageApiPath || "").trim();
}

function buildConfiguredImageApiUrl(baseUrl: string, defaultPath: string, customPath?: string) {
  const normalizedBase = baseUrl.trim().replace(/\/+$/, "");
  const path = (customPath || "").trim();

  if (path) {
    if (/^https?:\/\//i.test(path)) return path;
    const normalizedPath = path.replace(/^\/+/, "");
    const baseWithoutDuplicateVersion =
      normalizedPath.startsWith("v1/") || normalizedPath === "v1"
        ? normalizedBase.replace(/\/v1$/, "")
        : normalizedBase;
    return `${baseWithoutDuplicateVersion}/${normalizedPath}`;
  }

  const openAIBaseUrl = normalizedBase.endsWith("/v1") ? normalizedBase : `${normalizedBase}/v1`;
  return `${openAIBaseUrl}/${defaultPath.replace(/^\/+/, "")}`;
}

function getTextApiKey(store: { apiKey?: string; textApiKey?: string }) {
  return (store.textApiKey || store.apiKey || "").trim();
}

function getImageApiKey(store: { apiKey?: string; imageApiKey?: string; textApiKey?: string }) {
  return (store.imageApiKey || store.textApiKey || store.apiKey || "").trim();
}

function isGeminiGatewayPreset(platformPreset: PlatformPreset) {
  return platformPreset === "gemini-native";
}

function getEffectiveResolution(task: Task) {
  const store = useAppStore.getState();
  return normalizeResolution(task.resolution || store.globalResolution || "1K");
}

function getEffectiveAspectRatio(task: Task) {
  const store = useAppStore.getState();
  return normalizeAspectRatio(task.aspectRatio || store.globalAspectRatio || "auto");
}

function normalizeImageQuality(value?: ImageQuality | string): ImageQuality {
  switch ((value || "auto").toString().trim().toLowerCase()) {
    case "low":
      return "low";
    case "medium":
      return "medium";
    case "high":
      return "high";
    default:
      return "auto";
  }
}

function getEffectiveImageQuality(task: Pick<Task, "imageQuality">): ImageQuality {
  const store = useAppStore.getState();
  return normalizeImageQuality(task.imageQuality || store.globalImageQuality || "auto");
}

function getEffectiveTaskBatchCount(task: Task): BatchCount {
  const store = useAppStore.getState();
  return getEffectiveBatchCount(task, store.globalBatchCount);
}

function shouldOptimizePrompts() {
  return isPromptOptimizationEnabled(useAppStore.getState().enablePromptOptimization);
}

function getRenderableTaskPrompt(task: Pick<Task, "promptText" | "description">) {
  return getExecutablePromptText(task);
}

function getExecutionReadyTaskPrompt(task: Pick<Task, "promptText" | "description">) {
  return getPreparedPromptText(task, useAppStore.getState().enablePromptOptimization);
}

function getMissingPromptError() {
  return createStageError("当前任务缺少可执行文本，请先填写生成指令或 AI 提示词。", "Image Generation");
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

function getTaskImageInputsDetailed(task: Task, globalReferenceImages: string[]) {
  const images: Array<{ type: 'source' | 'reference' | 'global_reference'; src: string }> = [];
  if (task.sourceImage) images.push({ type: 'source', src: task.sourceImage });
  if (task.referenceImages?.length) {
    images.push(...task.referenceImages.map((src) => ({ type: 'reference' as const, src })));
  }
  if (globalReferenceImages.length) {
    images.push(...globalReferenceImages.map((src) => ({ type: 'global_reference' as const, src })));
  }
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
    const actualModel = normalizeYunwuImageModelAlias(modelName);
    const normalized = getNormalizedModelName(actualModel);
    if (isYunwuGptImageModel(actualModel, platformPreset)) {
      return { requestedModel: modelName, actualModel, resolutionSupport: "hard" };
    }
    if (normalized.startsWith("gemini-3.1-flash-image-preview") || normalized.startsWith("gemini-3-pro-image-preview")) {
      return { requestedModel: modelName, actualModel, resolutionSupport: "hard" };
    }
    return { requestedModel: modelName, actualModel, resolutionSupport: "soft" };
  }

  const actualModel = normalizeOpenAIImageModelAlias(modelName);
  const normalized = getNormalizedModelName(actualModel);
  if (GEMINI_NATIVE_HARD_RESOLUTION_MODELS.includes(normalized)) {
    return { requestedModel: modelName, actualModel, resolutionSupport: "hard" };
  }

  if (isGptImageModel(normalized) || normalized.startsWith("dall-e")) {
    return { requestedModel: modelName, actualModel, resolutionSupport: "hard" };
  }

  return { requestedModel: modelName, actualModel, resolutionSupport: "soft" };
}

export function supportsImageInput(modelName: string, apiBaseUrl: string, apiKey: string, platformPreset: PlatformPreset) {
  const normalizedModel = getNormalizedModelName(modelName);

  if (platformPreset === "comfly-chat") {
    return normalizedModel.includes("gemini") || normalizedModel.includes("banana") || normalizedModel.includes("gpt-image") || normalizedModel === "image2";
  }

  if (platformPreset === "yunwu") {
    return normalizedModel.includes("gemini") || normalizedModel.includes("gpt-image") || normalizedModel === "image2";
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
  const imageApiBaseUrl = getImageApiBaseUrl(store);
  const imageApiKey = getImageApiKey(store);
  if (!taskHasImageInputs(task, store.globalReferenceImages)) return;

  if (!supportsImageInput(store.imageModel, imageApiBaseUrl, imageApiKey, platformPreset)) {
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

function buildPromptGenerationText(task: Task, globalSkillText: string) {
  return [
    "[Skill]",
    (globalSkillText || "N/A").trim() || "N/A",
    "",
    "[Generation Instruction]",
    (task.description || "N/A").trim() || "N/A",
    "",
    "[Image Inputs]",
    "Please generate the final image prompt mainly based on the provided images, skill, and generation instruction. Do not add explanation.",
  ].join("\n");
}

function buildImageAwarePrompt(task: Task, promptText: string, imageCount: number, resolution: string, aspectRatio: string) {
  return [
    buildGenerationConstraints(task, resolution, aspectRatio),
    "",
    `[Image Inputs]`,
    `${imageCount}`,
    "",
    "[Prompt]",
    promptText,
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

function looksLikeBase64Image(value: string) {
  const normalized = value.trim();
  if (!normalized || normalized.length < 128) return false;
  if (normalized.startsWith("data:image/")) return true;
  return /^[A-Za-z0-9+/=\r\n]+$/.test(normalized);
}

function extractBase64MimeTypeFromPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  const directKeys = ["mime_type", "mimeType", "content_type", "contentType"];
  for (const key of directKeys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().startsWith("image/")) {
      return value.trim().toLowerCase();
    }
  }

  for (const value of Object.values(record)) {
    const candidate = extractBase64MimeTypeFromPayload(value);
    if (candidate) return candidate;
  }

  return null;
}

function extractBase64ImageFromPayload(payload: unknown): { base64: string; mimeType?: string } | null {
  if (!payload) return null;

  if (typeof payload === "string") {
    return looksLikeBase64Image(payload) ? { base64: payload.trim() } : null;
  }

  if (Array.isArray(payload)) {
    for (const item of payload) {
      const candidate = extractBase64ImageFromPayload(item);
      if (candidate) return candidate;
    }
    return null;
  }

  if (typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    const directKeys = ["b64_json", "base64", "image_base64", "imageBase64"];
    for (const key of directKeys) {
      const value = record[key];
      if (typeof value === "string" && looksLikeBase64Image(value)) {
        return {
          base64: value.trim(),
          mimeType: extractBase64MimeTypeFromPayload(payload) || undefined,
        };
      }
    }

    for (const value of Object.values(record)) {
      const candidate = extractBase64ImageFromPayload(value);
      if (candidate) return candidate;
    }
  }

  return null;
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
  const rawBase64 = extractBase64ImageFromPayload(payload);
  if (rawBase64) {
    const mimeType = rawBase64.mimeType || "image/png";
    const src = rawBase64.base64.startsWith("data:image/") ? rawBase64.base64 : `data:${mimeType};base64,${rawBase64.base64}`;
    return {
      src,
      sourceType: "base64",
      originalSrc: src,
    };
  }

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

async function cacheDownloadableResultSources(result: GeneratedImageResult) {
  const preferredDownloadSrc = result.src;
  if (!preferredDownloadSrc) return;

  try {
    if (preferredDownloadSrc.startsWith("data:")) {
      const blob = dataUrlToBlob(preferredDownloadSrc);
      await storeResultImageBlob(preferredDownloadSrc, blob);
      if (result.src && result.src !== preferredDownloadSrc) {
        await storeResultImageBlob(result.src, blob);
      }
      return;
    }

    await primeTaskResultImageCache([preferredDownloadSrc]);
  } catch {
    // Cache warmup is best-effort and should not block the main flow.
  }
}

function createBufferedImageNotifier(
  onImage: (image: TaskResultImage, images: TaskResultImage[], failedCount: number) => void,
) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let latestImage: TaskResultImage | null = null;
  let latestImages: TaskResultImage[] = [];
  let latestFailedCount = 0;

  const flush = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (!latestImage) return;
    onImage(latestImage, latestImages, latestFailedCount);
    latestImage = null;
    latestImages = [];
  };

  return {
    queue(image: TaskResultImage, images: TaskResultImage[], failedCount: number) {
      latestImage = image;
      latestImages = images;
      latestFailedCount = failedCount;
      if (!timer) {
        timer = setTimeout(flush, IMAGE_UPDATE_FLUSH_MS);
      }
    },
    flush,
  };
}

async function createResultPreviewDataUrl(src: string, dimensions?: ImageDimensions | null) {
  if (!src.startsWith('data:image/') || typeof document === 'undefined') return undefined;

  const maxEdge = 640;
  const measured = dimensions || await measureImageDimensions(src);
  if (!measured?.width || !measured.height) return undefined;

  const scale = Math.min(1, maxEdge / Math.max(measured.width, measured.height));
  const width = Math.max(1, Math.round(measured.width * scale));
  const height = Math.max(1, Math.round(measured.height * scale));

  return new Promise<string | undefined>((resolve) => {
    const image = new Image();
    image.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d', { alpha: true });
        if (!context) {
          resolve(undefined);
          return;
        }
        context.drawImage(image, 0, 0, width, height);
        resolve(canvas.toDataURL('image/webp', 0.72));
      } catch {
        resolve(undefined);
      }
    };
    image.onerror = () => resolve(undefined);
    image.src = src;
  });
}

async function createTaskResultImage(result: GeneratedImageResult, sessionId?: string): Promise<TaskResultImage> {
  const assetSrc = result.src;
  const hasValidAssetSrc = isValidResultImageAssetSrc(assetSrc);
  const dimensions = hasValidAssetSrc ? await measureImageDimensions(assetSrc) : null;
  const generatedPreviewSrc = assetSrc.startsWith('data:image/')
    ? await createResultPreviewDataUrl(assetSrc, dimensions)
    : undefined;
  const previewSrc = generatedPreviewSrc || result.previewSrc;
  const storedAsset = assetSrc.startsWith('data:image/')
    ? await storeImageAssetFromDataUrl(assetSrc, {
        kind: 'result',
        previewSrc: previewSrc || assetSrc,
        width: result.assetWidth || dimensions?.width,
        height: result.assetHeight || dimensions?.height,
      })
    : null;
  const hasStoredOriginal = Boolean(storedAsset?.assetId);
  let downloadCacheStatus = result.downloadCacheStatus;
  let normalizationStatus = result.normalizationStatus;
  let downloadStatus = result.downloadStatus;
  let downloadFailureStage = result.downloadFailureStage;
  let downloadFailureReason = result.downloadFailureReason;

  if (!hasValidAssetSrc) {
    downloadCacheStatus = 'failed';
    normalizationStatus = 'invalid_source';
    downloadStatus = 'invalid_source';
    downloadFailureStage = 'normalize';
    downloadFailureReason = '结果图源无效';
  } else if (!downloadCacheStatus) {
    if (assetSrc.startsWith("data:")) {
      if (hasStoredOriginal) {
        result.assetMimeType = result.assetMimeType || storedAsset?.metadata.mimeType;
        result.assetExtension = result.assetExtension || storedAsset?.metadata.extension;
      } else {
        const blob = dataUrlToBlob(assetSrc);
        await storeResultImageBlob(assetSrc, blob);
        if (result.src && result.src !== assetSrc) {
          await storeResultImageBlob(result.src, blob);
        }
        const assetMetadata = inferResultImageAssetMetadata(assetSrc, blob);
        result.assetMimeType = result.assetMimeType || assetMetadata.mimeType;
        result.assetExtension = result.assetExtension || assetMetadata.extension;
      }
      downloadCacheStatus = 'primed';
    } else {
      downloadCacheStatus = await primeResultImageCache(assetSrc);
    }
  }

  if (hasValidAssetSrc && !hasStoredOriginal) {
    await cacheDownloadableResultSources({ ...result, assetSrc });
  }
  void primeTaskResultImageCache([previewSrc, result.previewSrc]);
  const assetWidth = result.assetWidth || dimensions?.width;
  const assetHeight = result.assetHeight || dimensions?.height;
  const assetMetadata = inferResultImageAssetMetadata(assetSrc);
  const canUseLightweightState = hasStoredOriginal && Boolean(previewSrc);
  const displaySrc = canUseLightweightState ? previewSrc! : result.src;
  const retainedOriginalSrc = canUseLightweightState ? undefined : result.originalSrc;
  const retainedAssetSrc = canUseLightweightState ? undefined : assetSrc;
  normalizationStatus =
    normalizationStatus ||
    (hasValidAssetSrc ? "ok" : "invalid_source");
  downloadStatus =
    downloadStatus ||
    (normalizationStatus === 'invalid_source'
      ? 'invalid_source'
      : downloadCacheStatus === 'failed'
        ? 'cache_failed'
        : 'ready');
  downloadFailureStage =
    downloadFailureStage ||
    (normalizationStatus === 'invalid_source'
      ? 'normalize'
      : downloadCacheStatus === 'failed'
        ? 'cache'
        : undefined);
  downloadFailureReason =
    downloadFailureReason ||
    (normalizationStatus === 'invalid_source'
      ? '结果图源无效'
      : downloadCacheStatus === 'failed'
        ? '结果图缓存预热失败'
        : undefined);
  return {
    id: crypto.randomUUID(),
    src: displaySrc,
    previewSrc,
    originalSrc: retainedOriginalSrc,
    assetId: result.assetId || storedAsset?.assetId,
    assetSrc: retainedAssetSrc,
    assetStorageStatus: result.assetStorageStatus || storedAsset?.storageStatus || (assetSrc.startsWith('data:image/') ? 'failed' : 'skipped'),
    sourceType: result.sourceType,
    downloadSourceType: result.downloadSourceType || (hasStoredOriginal ? 'asset' : assetSrc.startsWith('data:') ? 'data_url' : "src"),
    downloadCacheStatus,
    normalizationStatus,
    downloadStatus,
    downloadFailureStage,
    downloadFailureReason,
    assetMimeType: result.assetMimeType || storedAsset?.metadata.mimeType || assetMetadata.mimeType,
    assetExtension: result.assetExtension || storedAsset?.metadata.extension || assetMetadata.extension,
    assetSize: result.assetSize || storedAsset?.metadata.size,
    sessionId,
    width: assetWidth,
    height: assetHeight,
    assetWidth,
    assetHeight,
    requestedWidth: result.requestedWidth,
    requestedHeight: result.requestedHeight,
    generationTimeMs: result.generationTimeMs,
    createdAt: Date.now(),
  };
}

function finalizeGeneratedImageResult(
  result: GeneratedImageResult,
  startedAt: number,
  expectedDimensions?: ImageDimensions | null,
): GeneratedImageResult {
  return {
    ...result,
    requestedWidth: expectedDimensions?.width,
    requestedHeight: expectedDimensions?.height,
    generationTimeMs: Math.max(0, Date.now() - startedAt),
  };
}

function buildTaskImageUpdatePayload(task: Task, images: TaskResultImage[], failedCount: number) {
  const historicalImages = task.activeResultSessionId
    ? (task.resultImages || []).filter((image) => image.sessionId !== task.activeResultSessionId)
    : (task.resultImages || []);
  const mergedImages = [...images, ...historicalImages];
  const primaryResult = images[0];
  return {
    resultImages: mergedImages,
    resultImage: primaryResult?.src,
    resultImagePreview: primaryResult?.previewSrc,
    resultImageOriginal: primaryResult?.originalSrc,
    resultImageSourceType: primaryResult?.sourceType,
    resultImageWidth: primaryResult?.assetWidth || primaryResult?.width,
    resultImageHeight: primaryResult?.assetHeight || primaryResult?.height,
    requestedBatchCount: getEffectiveTaskBatchCount(task),
    failedResultCount: failedCount,
  };
}

function updateTaskWithGeneratedImages(taskId: string, images: TaskResultImage[], failedCount: number, status?: TaskStatus) {
  const store = useAppStore.getState();
  const currentTask = store.taskLookup[taskId];
  if (!currentTask || images.length === 0) return;

  store.updateTask(taskId, {
    ...buildTaskImageUpdatePayload(currentTask, images, failedCount),
    ...(status ? { status } : {}),
    progressStage: "写入结果",
  });
}

function isManuallyHaltedTask(task?: Task) {
  if (!task || task.status !== "Error") return false;
  const message = task.errorLog?.message || "";
  return message.includes("手动中断") || message.includes("用户手动");
}

function updateTaskProgress(taskId: string, status: TaskStatus, progressStage: string) {
  const store = useAppStore.getState();
  if (isManuallyHaltedTask(store.taskLookup[taskId])) return;

  store.updateTask(taskId, {
    status,
    progressStage,
    errorLog: undefined,
  });
}

function ensureGenerationLogSession(taskId: string, context: GenerationLogContext = {}) {
  if (context.logSessionId) return context.logSessionId;
  const task = useAppStore.getState().taskLookup[taskId];
  return createGenerationLogSession({
    mode: context.mode || 'image-single',
    task,
    triggerId: context.triggerId,
  });
}

function logGenerationEvent(
  taskId: string,
  stage: "prepare" | "prompt" | "image" | "download" | "export" | "writeback",
  event: string,
  message: string,
  context: GenerationLogContext = {},
  data?: Record<string, unknown>,
  options?: { level?: "debug" | "info" | "warn" | "error"; incrementAttempt?: boolean },
) {
  const sessionId = ensureGenerationLogSession(taskId, context);
  appendGenerationLogEvent(sessionId, {
    stage,
    event,
    message,
    data,
    level: options?.level,
    incrementAttempt: options?.incrementAttempt,
  });
  return sessionId;
}

function withStreamFlag(body: BodyInit | null | undefined, contentType?: string | null) {
  if (!body) return body;

  if (typeof body === 'string' && contentType?.includes('application/json')) {
    try {
      const parsed = JSON.parse(body);
      return JSON.stringify({ ...parsed, stream: true });
    } catch {
      return body;
    }
  }

  if (body instanceof FormData) {
    const nextBody = new FormData();
    body.forEach((value, key) => {
      nextBody.append(key, value);
    });
    nextBody.set('stream', 'true');
    return nextBody;
  }

  return body;
}

function extractImageResultFromStreamPayload(payloadText: string): GeneratedImageResult | null {
  if (!payloadText.trim()) return null;

  const parsedEvents: unknown[] = [];
  const lines = payloadText.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line.startsWith('data:')) continue;

    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') continue;

    try {
      parsedEvents.push(JSON.parse(data));
    } catch {
      parsedEvents.push(data);
    }
  }

  for (let index = parsedEvents.length - 1; index >= 0; index -= 1) {
    const event = parsedEvents[index];
    const extracted = extractImageResultFromResponsesApi(event) || extractImageResultFromResponse(event);
    if (extracted) return extracted;
  }

  try {
    const parsed = JSON.parse(payloadText);
    return extractImageResultFromResponsesApi(parsed) || extractImageResultFromResponse(parsed);
  } catch {
    return extractImageResultFromResponse(payloadText);
  }
}

async function fetchImageResultWithOptionalStream(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
  enableStream: boolean,
) {
  const contentType =
    init.headers instanceof Headers
      ? init.headers.get('Content-Type')
      : (init.headers as Record<string, string> | undefined)?.['Content-Type'] ||
        (init.headers as Record<string, string> | undefined)?.['content-type'] ||
        null;

  const attempts = enableStream
    ? [
        { ...init, body: withStreamFlag(init.body, contentType) },
        init,
      ]
    : [init];

  let lastError: unknown;

  for (let index = 0; index < attempts.length; index += 1) {
    try {
      const response = await fetchWithTimeout(input, attempts[index], timeoutMs);
      const payloadText = await response.text();

      if (!response.ok) {
        throw new Error(`HTTP Error ${response.status}: ${payloadText.substring(0, 160)}`);
      }

      const extracted = extractImageResultFromStreamPayload(payloadText);
      if (!extracted) {
        throw new Error('No image source returned from image generation');
      }

      return extracted;
    } catch (error) {
      lastError = error;
      if (index === attempts.length - 1) throw error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Image request failed');
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

async function imageInputToFileValue(image: string, fallbackName: string) {
  if (image.startsWith("data:image/jpeg;base64,")) {
    const response = await fetch(image);
    const blob = await response.blob();
    return new File([blob], `${fallbackName}.jpg`, { type: "image/jpeg" });
  }

  const response = await fetch(image);
  const originalBlob = await response.blob();
  const optimizedBlob = await optimizeUploadImageBlob(originalBlob);
  const extension = optimizedBlob.type.split("/")[1] || "jpg";
  return new File([optimizedBlob], `${fallbackName}.${extension}`, { type: optimizedBlob.type || "image/jpeg" });
}

async function optimizeUploadImageBlob(blob: Blob) {
  if (!blob.type.startsWith("image/")) return blob;

  try {
    const objectUrl = URL.createObjectURL(blob);
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Failed to decode upload image"));
      img.src = objectUrl;
    });

    const maxSize = 4000;
    let width = image.naturalWidth || image.width;
    let height = image.naturalHeight || image.height;
    if (!width || !height) {
      URL.revokeObjectURL(objectUrl);
      return blob;
    }

    if (width > maxSize || height > maxSize) {
      const ratio = Math.min(maxSize / width, maxSize / height);
      width = Math.max(1, Math.round(width * ratio));
      height = Math.max(1, Math.round(height * ratio));
    }

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) {
      URL.revokeObjectURL(objectUrl);
      return blob;
    }

    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    URL.revokeObjectURL(objectUrl);

    const optimizedBlob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((value) => resolve(value), "image/jpeg", 0.88);
    });

    return optimizedBlob || blob;
  } catch {
    return blob;
  }
}

async function imageInputToDataUrl(image: string) {
  if (image.startsWith("data:image/")) return image;
  const response = await fetch(image);
  const blob = await response.blob();
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === "string") {
        resolve(result);
        return;
      }
      reject(new Error("Failed to convert image input to data URL"));
    };
    reader.onerror = () => reject(reader.error || new Error("Failed to read image input"));
    reader.readAsDataURL(blob);
  });
}

async function normalizePromptImageInputs(taskId: string, imageInputs: string[]) {
  const normalizedImageInputs: string[] = [];

  for (let index = 0; index < imageInputs.length; index += 1) {
    updateTaskProgress(taskId, "Prompting", `读取提示词图片 ${index + 1}/${imageInputs.length}`);
    normalizedImageInputs.push(await imageInputToDataUrl(imageInputs[index]));
  }

  return normalizedImageInputs;
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
  if (longestEdge > 3840) {
    const scale = 3840 / longestEdge;
    width = floorToMultipleOf16(width * scale);
    height = floorToMultipleOf16(height * scale);
  }

  let pixels = width * height;
  if (pixels < 655_360) {
    const scale = Math.sqrt(655_360 / pixels);
    width = roundToMultipleOf16(width * scale);
    height = roundToMultipleOf16(height * scale);
    if (Math.max(width, height) > 3840) {
      const retryScale = 3840 / Math.max(width, height);
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

export function getOpenAIImageQuality(
  task: Pick<Task, "imageQuality">,
  context?: {
    model?: string;
    endpoint?: "edits" | "generations";
    platformPreset?: PlatformPreset;
  },
) {
  const quality = getEffectiveImageQuality(task);
  if (isDocumentedImage2Model(context?.model)) {
    return quality === "auto" ? undefined : quality;
  }

  switch (quality) {
    case "high":
      return "hd";
    case "low":
    case "medium":
      return "standard";
    default:
      return undefined;
  }
}

function getImage2ResponseFormat(model?: string) {
  return isDocumentedImage2Model(model) ? "b64_json" : undefined;
}

function parseCustomImageSize(resolution: string) {
  const match = String(resolution || "").trim().match(/^(\d+)x(\d+)$/i);
  if (!match) return null;

  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isInteger(width) || !Number.isInteger(height)) return null;
  if (width <= 0 || height <= 0) return null;
  if (width % 16 !== 0 || height % 16 !== 0) return null;
  if (width > 3840 || height > 3840) return null;

  const ratio = Math.max(width / height, height / width);
  if (ratio > 3) return null;

  const pixels = width * height;
  if (pixels < 655_360 || pixels > 8_294_400) return null;

  return `${width}x${height}`;
}

function parseDimensionString(size?: string | null): ImageDimensions | null {
  const match = String(size || "").trim().match(/^(\d+)x(\d+)$/i);
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  return { width, height };
}

function isExactImage2Size(resolution: string) {
  return Boolean(parseCustomImageSize(resolution));
}

export function getRequestedImageSize(modelName: string, aspectRatio: string, resolution: string) {
  if (isComflyResponsesImageModel(modelName, "comfly-chat") || isDocumentedImage2Model(modelName)) {
    return parseCustomImageSize(resolution) || getImage2ImageSize(aspectRatio, resolution);
  }

  return getOpenAIImageSize(aspectRatio);
}

export function buildOpenAIImageRequestFields(
  task: Pick<Task, "imageQuality">,
  context: {
    model: string;
    endpoint: "edits" | "generations";
    platformPreset: PlatformPreset;
    aspectRatio: string;
    resolution: string;
  },
) {
  const normalizedModel = getNormalizedModelName(context.model);
  const isOpenAIImageModel = isGptImageModel(normalizedModel) || normalizedModel.startsWith("dall-e");
  if (!isOpenAIImageModel) return {} as Record<string, string>;

  const fields: Record<string, string> = {
    size: getRequestedImageSize(context.model, context.aspectRatio, context.resolution),
  };
  const quality = getOpenAIImageQuality(task, {
    model: context.model,
    endpoint: context.endpoint,
    platformPreset: context.platformPreset,
  });
  if (quality) {
    fields.quality = quality;
  }
  const responseFormat = getImage2ResponseFormat(context.model);
  if (responseFormat) {
    fields.response_format = responseFormat;
  }
  return fields;
}

function buildComflyResolutionFields(modelName: string, resolution: string, aspectRatio: string) {
  const payload: Record<string, string> = { model: modelName };

  if (isComflyResponsesImageModel(modelName, "comfly-chat")) {
    payload.size = getRequestedImageSize(modelName, aspectRatio, resolution);
    if (aspectRatio !== "auto") {
      payload.aspect_ratio = aspectRatio;
    }
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
    const trimmedBase64Image = base64Image.trim();
    const src = trimmedBase64Image.startsWith("data:image/")
      ? trimmedBase64Image
      : `data:${mimeType};base64,${trimmedBase64Image}`;
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
  const promptOptimizationEnabled = shouldOptimizePrompts();
  const triggerId = crypto.randomUUID();

  if (mode === "prompts" && !promptOptimizationEnabled) {
    toast.info("提示词优化已关闭");
    store.setBatchRunning(false);
    return;
  }

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

  await runTaskExecutionQueue({
    items: tasksToProcess,
    concurrency: normalizeTaskConcurrency(store.maxConcurrency),
    shouldContinue: isBatchExecutionActive,
    worker: async (task) => {
      if (!isBatchExecutionActive()) return;
      const logMode = mode === "prompts" ? "prompt-batch" : mode === "images" ? "image-batch" : "all-batch";
      const logSessionId = createGenerationLogSession({
        mode: logMode,
        task,
        triggerId,
        summary: {
          requestCount: getBatchCountNumber(getEffectiveTaskBatchCount(task)),
        },
      });
      appendGenerationLogEvent(logSessionId, {
        stage: "prepare",
        event: "task.batch.started",
        message: "批量任务开始",
        data: buildGenerationTaskSnapshot(task, {
          mode,
          platformPreset: getPlatformPreset(),
          textModel: store.textModel,
          imageModel: store.imageModel,
          enablePromptOptimization: promptOptimizationEnabled,
          globalReferenceImageCount: store.globalReferenceImages.length,
        }),
      });

    window.dispatchEvent(new CustomEvent("scroll-to-task", { detail: { id: task.id } }));

    try {
      if (mode === "all" || mode === "prompts") {
        const currentTask = useAppStore.getState().taskLookup[task.id];
        if (currentTask && promptOptimizationEnabled && !isTaskPromptCurrent(currentTask)) {
          updateTaskProgress(task.id, "Prompting", "准备提示词");
          const generatedPrompt = await retryWrap(() =>
            generateTaskPrompt(task.id, { logSessionId, triggerId, mode: logMode }),
          );
          useAppStore.getState().updateTask(task.id, {
            promptText: generatedPrompt.promptText,
            promptInputSignature: generatedPrompt.inputSignature,
            promptSource: "auto",
            errorLog: undefined,
            progressStage: undefined,
          });
        }
      }

      if (!isBatchExecutionActive()) return;

      if (mode === "all" || mode === "images") {
        const currentTask = useAppStore.getState().taskLookup[task.id];
        const executablePromptText = currentTask ? getExecutionReadyTaskPrompt(currentTask) : null;
        if (currentTask && executablePromptText) {
          const sessionId = crypto.randomUUID();
          useAppStore.getState().updateTask(task.id, {
            activeResultSessionId: sessionId,
            requestedBatchCount: getEffectiveTaskBatchCount(currentTask),
            failedResultCount: 0,
            status: "Rendering",
            progressStage: "准备任务",
            errorLog: undefined,
          });
          const generatedBatch = await runImageGeneration(task.id, {
            logSessionId,
            shouldContinue: isBatchExecutionActive,
            onImage: (_image, images, failedCount) => {
              if (!isBatchExecutionActive()) return;
              updateTaskWithGeneratedImages(task.id, images, failedCount, "Rendering");
            },
          });
          if (!isBatchExecutionActive()) return;
          if (generatedBatch.images.length === 0) {
            throw createStageError("没有成功返回任何结果图。", "Image Generation");
          }
          const latestTask = useAppStore.getState().taskLookup[task.id] || currentTask;
          useAppStore.getState().updateTask(task.id, {
            ...buildTaskImageUpdatePayload(latestTask, generatedBatch.images, generatedBatch.failedCount),
            status: "Success",
            progressStage: undefined,
            errorLog: generatedBatch.failedCount > 0 ? {
              message: `部分成功：已返回 ${generatedBatch.images.length}/${getBatchCountNumber(getEffectiveTaskBatchCount(currentTask))} 张结果图。`,
              time: Date.now(),
              stage: "Image Generation",
            } : undefined,
          });
          finishGenerationLogSession(logSessionId, generatedBatch.failedCount > 0 ? "partial_success" : "success", {
            resultCount: generatedBatch.images.length,
            failedCount: generatedBatch.failedCount,
            requestCount: getBatchCountNumber(getEffectiveTaskBatchCount(currentTask)),
          });
        } else if (currentTask && !executablePromptText) {
          throw getMissingPromptError();
        }
      } else {
        useAppStore.getState().updateTask(task.id, { status: "Success" });
        finishGenerationLogSession(logSessionId, "success", {
          promptGenerated: promptOptimizationEnabled,
          resultCount: 0,
          failedCount: 0,
        });
      }
    } catch (error: any) {
      if (!isBatchExecutionActive()) return;
      toast.error(`任务 ${task.title || task.index} 处理失败`);
      useAppStore.getState().updateTask(task.id, {
        status: "Error",
        progressStage: undefined,
        errorLog: {
          message: error.message || "Error occurred",
          time: Date.now(),
          stage: error.stage || "Unknown"
        }
      });
      appendGenerationLogEvent(logSessionId, {
        level: "error",
        stage: mode === "prompts" ? "prompt" : "image",
        event: "task.batch.failed",
        message: "批量任务失败",
        data: {
          stage: error?.stage || "Unknown",
          error: sanitizeLogData(error),
        },
      });
      finishGenerationLogSession(logSessionId, "error", {
        errorMessage: error?.message || "Error occurred",
      });
    }
    },
  });

  if (isBatchExecutionActive()) {
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
        progressStage: undefined,
        errorLog: { message: "已被用户手动中断", time: Date.now(), stage: t.status }
      };
    }
    return t;
  });
  store.setProjectFields({ tasks });
  store.generationLogs
    .filter((session) => session.status === "running")
    .forEach((session) => {
      finishGenerationLogSession(session.id, "halted", {
        errorMessage: "已被用户手动中断",
      });
    });
}

export async function processSingleTask(taskId: string) {
  const store = useAppStore.getState();
  const task = store.taskLookup[taskId];
  if (!task) return;
  const logSessionId = createGenerationLogSession({
    mode: "image-single",
    task,
    summary: {
      requestCount: getBatchCountNumber(getEffectiveTaskBatchCount(task)),
    },
  });
  appendGenerationLogEvent(logSessionId, {
    stage: "prepare",
    event: "task.single.started",
    message: "单任务执行开始",
    data: buildGenerationTaskSnapshot(task, {
      platformPreset: getPlatformPreset(),
      textModel: store.textModel,
      imageModel: store.imageModel,
      enablePromptOptimization: shouldOptimizePrompts(),
      globalReferenceImageCount: store.globalReferenceImages.length,
    }),
  });

  try {
    const currentTask = useAppStore.getState().taskLookup[taskId];
    if (!currentTask) return;

    let promptText = getExecutionReadyTaskPrompt(currentTask);
    if (shouldOptimizePrompts() && !isTaskPromptCurrent(currentTask)) {
      updateTaskProgress(taskId, "Prompting", "准备提示词");
      const generatedPrompt = await retryWrap(() => generateTaskPrompt(taskId, { logSessionId, mode: "image-single" }));
      promptText = generatedPrompt.promptText;
      store.updateTask(taskId, {
        promptText,
        promptInputSignature: generatedPrompt.inputSignature,
        promptSource: "auto",
        errorLog: undefined,
        progressStage: undefined,
      });
      promptText = getExecutionReadyTaskPrompt(useAppStore.getState().taskLookup[taskId] || {
        promptText,
        description: currentTask.description,
      });
    }

    if (!promptText) {
      throw getMissingPromptError();
    }

    const sessionId = crypto.randomUUID();
    store.updateTask(taskId, {
      activeResultSessionId: sessionId,
      requestedBatchCount: getEffectiveTaskBatchCount(currentTask),
      failedResultCount: 0,
      status: "Rendering",
      progressStage: "准备任务",
      errorLog: undefined,
    });
    const generatedBatch = await runImageGeneration(taskId, {
      logSessionId,
      onImage: (_image, images, failedCount) => {
        updateTaskWithGeneratedImages(taskId, images, failedCount, "Rendering");
      },
    });
    if (generatedBatch.images.length === 0) {
      throw createStageError("没有成功返回任何结果图。", "Image Generation");
    }
    const latestTask = useAppStore.getState().taskLookup[taskId] || currentTask;
      store.updateTask(taskId, {
        ...buildTaskImageUpdatePayload(latestTask, generatedBatch.images, generatedBatch.failedCount),
        progressStage: undefined,
        errorLog: generatedBatch.failedCount > 0 ? {
        message: `部分成功：已返回 ${generatedBatch.images.length}/${getBatchCountNumber(getEffectiveTaskBatchCount(currentTask))} 张结果图。`,
        time: Date.now(),
        stage: "Image Generation",
      } : undefined,
      status: "Success"
    });
    finishGenerationLogSession(logSessionId, generatedBatch.failedCount > 0 ? "partial_success" : "success", {
      promptLength: promptText?.length || 0,
      resultCount: generatedBatch.images.length,
      failedCount: generatedBatch.failedCount,
      requestCount: getBatchCountNumber(getEffectiveTaskBatchCount(currentTask)),
    });
  } catch (error: any) {
    store.updateTask(taskId, {
      status: "Error",
      progressStage: undefined,
      errorLog: { message: error.message || "Error occurred", time: Date.now(), stage: error.stage }
    });
    appendGenerationLogEvent(logSessionId, {
      level: "error",
      stage: error?.stage === "Prompt Generation" ? "prompt" : "image",
      event: "task.single.failed",
      message: "单任务执行失败",
      data: {
        stage: error?.stage,
        error: sanitizeLogData(error),
      },
    });
    finishGenerationLogSession(logSessionId, "error", {
      errorMessage: error?.message || "Error occurred",
    });
  }
}

export async function generateTaskPrompt(taskId: string, context: GenerationLogContext = {}): Promise<GeneratedPromptResult> {
  const store = useAppStore.getState();
  const task = store.taskLookup[taskId];
  if (!task) throw new Error("Task not found");
  const inputSignature = getTaskPromptInputSignature(task);
  const logSessionId = ensureGenerationLogSession(taskId, {
    mode: context.mode || "prompt-preview",
    triggerId: context.triggerId,
    logSessionId: context.logSessionId,
  });
  const ownsSession = !context.logSessionId;
  const promptStartedAt = Date.now();

  updateTaskProgress(taskId, "Prompting", "整理提示词输入");
  const imageInputs = getTaskImageInputs(task, store.globalReferenceImages);
  const systemPrompt = "你负责根据用户输入整理出一段可直接用于生图或改图的最终提示词，不强制英文，不额外解释。";
  const contentMsg = buildPromptGenerationText(task, store.globalSkillText || "");
  const platformPreset = getPlatformPreset();
  const textApiBaseUrl = getTextApiBaseUrl(store);
  const textApiKey = getTextApiKey(store);
  const isYunwuPromptImageModel = isYunwuGptImageModel(store.textModel, platformPreset);
  const isGeminiGateway = platformPreset === "yunwu" && !!textApiBaseUrl && !!textApiKey && !isYunwuPromptImageModel;
  const isCustomOpenAI = !isGeminiGateway && (platformPreset === "comfly-chat" || platformPreset === "openai-compatible" || platformPreset === "custom");
  appendGenerationLogEvent(logSessionId, {
    stage: "prompt",
    event: "prompt.started",
    message: "开始生成提示词",
    data: buildGenerationTaskSnapshot(task, {
      mode: context.mode || "prompt-preview",
      platformPreset,
      textModel: store.textModel,
      imageModel: store.imageModel,
      imageInputCount: imageInputs.length,
      imageInputs: summarizePromptImages(imageInputs),
      globalReferenceImageCount: store.globalReferenceImages.length,
      hasSkill: Boolean((store.globalSkillText || "").trim()),
      hasDescription: Boolean((task.description || "").trim()),
    }),
  });

  try {
    {
    if (isGeminiGateway) {
      const geminiBaseUrl = normalizeGeminiBaseUrl(textApiBaseUrl);
      appendGenerationLogEvent(logSessionId, {
        stage: "prompt",
        event: "prompt.images.normalize",
        message: "开始整理提示词图片",
        data: { imageInputCount: imageInputs.length },
      });
      const normalizedImageInputs = await normalizePromptImageInputs(taskId, imageInputs);
      appendGenerationLogEvent(logSessionId, {
        stage: "prompt",
        event: "prompt.request.started",
        message: "开始请求提示词 API",
        data: {
          requestPath: getRequestPathLabel(`${geminiBaseUrl}/models/${store.textModel}:generateContent`),
          model: store.textModel,
          imageInputCount: normalizedImageInputs.length,
        },
      });
      updateTaskProgress(taskId, "Prompting", "请求提示词 API");
      const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [{ text: contentMsg }];
      normalizedImageInputs.forEach(image => {
        const mimeTypeMatch = image.match(/^data:(image\/[^;]+);base64,/i);
        parts.push({
          inlineData: {
            mimeType: mimeTypeMatch?.[1] || "image/jpeg",
            data: dataUrlToBase64(image)
          }
        });
      });

      const res = await fetchWithTimeout(`${geminiBaseUrl}/models/${store.textModel}:generateContent`, {
        method: "POST",
        headers: buildGeminiGatewayHeaders(textApiKey),
        body: JSON.stringify({
          contents: [{ role: "user", parts }],
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
      const promptText = json.candidates?.[0]?.content?.parts?.map((part: any) => part.text).filter(Boolean).join("\n").trim() || "Generated prompt fallback";
      updateGenerationLogSummary(logSessionId, {
        promptGenerated: true,
        promptLength: promptText.length,
      });
      appendGenerationLogEvent(logSessionId, {
        stage: "prompt",
        event: "prompt.completed",
        message: "提示词生成完成",
        data: {
          promptLength: promptText.length,
          elapsedMs: Date.now() - promptStartedAt,
        },
      });
      if (ownsSession) {
        finishGenerationLogSession(logSessionId, "success", {
          promptGenerated: true,
          promptLength: promptText.length,
        });
      }
      return {
        promptText,
        inputSignature,
        logSessionId,
      };
    }

    if (isCustomOpenAI && textApiBaseUrl && textApiKey) {
      let baseUrl = textApiBaseUrl.replace(/\/+$/, "");
      if (!baseUrl.endsWith("/v1")) baseUrl += "/v1";
      const userContent: Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }> = [
        { type: "text", text: contentMsg }
      ];
      imageInputs.forEach(image => {
        userContent.push({ type: "image_url", image_url: { url: image } });
      });

      updateTaskProgress(taskId, "Prompting", "请求提示词 API");
      const res = await fetchWithTimeout(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${textApiKey}`
        },
        body: JSON.stringify({
          model: store.textModel,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userContent }
          ]
        })
      }, PROMPT_REQUEST_TIMEOUT_MS);

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`HTTP Error ${res.status}: ${errText.substring(0, 100)}`);
      }

      const json = await res.json();
      const promptText = json.choices?.[0]?.message?.content?.trim() || "Generated prompt fallback";
      updateGenerationLogSummary(logSessionId, {
        promptGenerated: true,
        promptLength: promptText.length,
      });
      appendGenerationLogEvent(logSessionId, {
        stage: "prompt",
        event: "prompt.completed",
        message: "提示词生成完成",
        data: {
          promptLength: promptText.length,
          elapsedMs: Date.now() - promptStartedAt,
        },
      });
      if (ownsSession) {
        finishGenerationLogSession(logSessionId, "success", {
          promptGenerated: true,
          promptLength: promptText.length,
        });
      }
      return {
        promptText,
        inputSignature,
        logSessionId,
      };
    }

    const apiKey = getBuiltInGeminiApiKey();
    if (!apiKey) {
      throw new Error("Missing built-in Gemini API Key. For public deployments, use the in-app API settings instead of bundling a key into the frontend.");
    }

    const normalizedImageInputs = await normalizePromptImageInputs(taskId, imageInputs);
    updateTaskProgress(taskId, "Prompting", "请求提示词 API");
    const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [{ text: contentMsg }];
    normalizedImageInputs.forEach(image => {
      const mimeTypeMatch = image.match(/^data:(image\/[^;]+);base64,/i);
      parts.push({
        inlineData: {
          mimeType: mimeTypeMatch?.[1] || "image/jpeg",
          data: dataUrlToBase64(image)
        }
      });
    });

    const res = await fetchWithTimeout(`https://generativelanguage.googleapis.com/v1beta/models/${store.textModel || "gemini-2.0-flash"}:generateContent?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: [{ parts }]
      })
    }, PROMPT_REQUEST_TIMEOUT_MS);

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Gemini Error ${res.status}: ${errText.substring(0, 100)}`);
    }

    const json = await res.json();
    const promptText = json.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "Generated prompt fallback";
    updateGenerationLogSummary(logSessionId, {
      promptGenerated: true,
      promptLength: promptText.length,
    });
    appendGenerationLogEvent(logSessionId, {
      stage: "prompt",
      event: "prompt.completed",
      message: "提示词生成完成",
      data: {
        promptLength: promptText.length,
        elapsedMs: Date.now() - promptStartedAt,
      },
    });
    if (ownsSession) {
      finishGenerationLogSession(logSessionId, "success", {
        promptGenerated: true,
        promptLength: promptText.length,
      });
    }
    return {
      promptText,
      inputSignature,
      logSessionId,
    };
    }

    if (isGeminiGateway) {
      if (imageInputs.length > 0) {
        updateTaskProgress(taskId, "Prompting", "读取提示词图片");
      }
      updateTaskProgress(taskId, "Prompting", imageInputs.length > 0 ? "上传提示词图片" : "请求提示词 API");
      const geminiBaseUrl = normalizeGeminiBaseUrl(textApiBaseUrl);
      const normalizedImageInputs = await Promise.all(imageInputs.map(imageInputToDataUrl));
      updateTaskProgress(taskId, "Prompting", "请求提示词 API");
      const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [{ text: contentMsg }];
      normalizedImageInputs.forEach(image => {
        const mimeTypeMatch = image.match(/^data:(image\/[^;]+);base64,/i);
        parts.push({
          inlineData: {
            mimeType: mimeTypeMatch?.[1] || "image/jpeg",
            data: dataUrlToBase64(image)
          }
        });
      });
      const res = await fetchWithTimeout(`${geminiBaseUrl}/models/${store.textModel}:generateContent`, {
        method: "POST",
        headers: buildGeminiGatewayHeaders(textApiKey),
        body: JSON.stringify({
          contents: [{ role: "user", parts }],
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
      return {
        promptText: json.candidates?.[0]?.content?.parts?.map((part: any) => part.text).filter(Boolean).join("\n").trim() || "Generated prompt fallback",
        inputSignature,
      };
    }

    if (isCustomOpenAI && textApiBaseUrl && textApiKey) {
      updateTaskProgress(taskId, "Prompting", "请求提示词 API");
      updateTaskProgress(taskId, "Prompting", imageInputs.length > 0 ? "上传提示词图片" : "请求提示词 API");
      let baseUrl = textApiBaseUrl.replace(/\/+$/, "");
      if (!baseUrl.endsWith("/v1")) baseUrl += "/v1";
      const userContent: Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }> = [
        { type: "text", text: contentMsg }
      ];
      imageInputs.forEach(image => {
        userContent.push({ type: "image_url", image_url: { url: image } });
      });

      const res = await fetchWithTimeout(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${textApiKey}`
        },
        body: JSON.stringify({
          model: store.textModel,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userContent }
          ]
        })
      }, PROMPT_REQUEST_TIMEOUT_MS);

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`HTTP Error ${res.status}: ${errText.substring(0, 100)}`);
      }

      const json = await res.json();
      const promptText = json.choices?.[0]?.message?.content?.trim() || "Generated prompt fallback";
      updateGenerationLogSummary(logSessionId, {
        promptGenerated: true,
        promptLength: promptText.length,
      });
      appendGenerationLogEvent(logSessionId, {
        stage: "prompt",
        event: "prompt.completed",
        message: "提示词生成完成",
        data: {
          promptLength: promptText.length,
          elapsedMs: Date.now() - promptStartedAt,
        },
      });
      if (ownsSession) {
        finishGenerationLogSession(logSessionId, "success", {
          promptGenerated: true,
          promptLength: promptText.length,
        });
      }
      return {
        promptText,
        inputSignature,
        logSessionId,
      };
    }

    const apiKey = getBuiltInGeminiApiKey();
    if (!apiKey) {
      throw new Error("Missing built-in Gemini API Key. For public deployments, use the in-app API settings instead of bundling a key into the frontend.");
    }

    updateTaskProgress(taskId, "Prompting", imageInputs.length > 0 ? "上传提示词图片" : "请求提示词 API");
    if (imageInputs.length > 0) {
      updateTaskProgress(taskId, "Prompting", "读取提示词图片");
    }
    const normalizedImageInputs = await Promise.all(imageInputs.map(imageInputToDataUrl));
    updateTaskProgress(taskId, "Prompting", "请求提示词 API");
    const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [{ text: contentMsg }];
    normalizedImageInputs.forEach(image => {
      const mimeTypeMatch = image.match(/^data:(image\/[^;]+);base64,/i);
      parts.push({
        inlineData: {
          mimeType: mimeTypeMatch?.[1] || "image/jpeg",
          data: dataUrlToBase64(image)
        }
      });
    });

    const res = await fetchWithTimeout(`https://generativelanguage.googleapis.com/v1beta/models/${store.textModel || "gemini-2.0-flash"}:generateContent?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: [{ parts }]
      })
    }, PROMPT_REQUEST_TIMEOUT_MS);

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Gemini Error ${res.status}: ${errText.substring(0, 100)}`);
    }

    const json = await res.json();
    const promptText = json.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "Generated prompt fallback";
    updateGenerationLogSummary(logSessionId, {
      promptGenerated: true,
      promptLength: promptText.length,
    });
    appendGenerationLogEvent(logSessionId, {
      stage: "prompt",
      event: "prompt.completed",
      message: "提示词生成完成",
      data: {
        promptLength: promptText.length,
        elapsedMs: Date.now() - promptStartedAt,
      },
    });
    if (ownsSession) {
      finishGenerationLogSession(logSessionId, "success", {
        promptGenerated: true,
        promptLength: promptText.length,
      });
    }
    return {
      promptText,
      inputSignature,
      logSessionId,
    };
  } catch (e: any) {
    appendGenerationLogEvent(logSessionId, {
      level: "error",
      stage: "prompt",
      event: "prompt.failed",
      message: "提示词生成失败",
      data: {
        error: sanitizeLogData(e),
        elapsedMs: Date.now() - promptStartedAt,
      },
    });
    if (ownsSession) {
      finishGenerationLogSession(logSessionId, "error", {
        errorMessage: e?.message || "Prompt generation failed",
      });
    }
    throw createStageError(e.message, "Prompt Generation");
  }
}

async function runSingleImageGeneration(taskId: string, context: GenerationLogContext = {}): Promise<GeneratedImageResult> {
  const store = useAppStore.getState();
  const task = store.taskLookup[taskId];
  const effectivePromptText = task ? getRenderableTaskPrompt(task) : null;
  if (!task || !effectivePromptText) throw getMissingPromptError();
  const startedAt = Date.now();
  const logSessionId = ensureGenerationLogSession(taskId, context);
  updateTaskProgress(taskId, "Rendering", "准备参数");

  const platformPreset = getPlatformPreset();
  const imageApiBaseUrl = getImageApiBaseUrl(store);
  const imageApiKey = getImageApiKey(store);
  const imageApiPath = getImageApiPath(store);
  const resolution = getEffectiveResolution(task);
  const resolvedModel = resolveImageModel(store.imageModel, resolution, platformPreset);
  const isYunwuGptImage = isYunwuGptImageModel(resolvedModel.actualModel, platformPreset);
  const isGeminiGateway = platformPreset === "yunwu" && !!imageApiBaseUrl && !!imageApiKey && !isYunwuGptImage;
  const isCustomOpenAI = !isGeminiGateway && (platformPreset === "comfly-chat" || platformPreset === "openai-compatible" || platformPreset === "custom");
  const imageRequestTimeoutMs =
    platformPreset === "yunwu" && isYunwuGptImage
      ? YUNWU_GPT_IMAGE_REQUEST_TIMEOUT_MS
      : IMAGE_REQUEST_TIMEOUT_MS;
  const supportsStreamAttempt = platformPreset === 'comfly-chat' || (platformPreset === 'yunwu' && isYunwuGptImage);
  const aspectRatio = getEffectiveAspectRatio(task);
  const imageInputs = getTaskImageInputs(task, store.globalReferenceImages);
  const hasImageInputs = imageInputs.length > 0;
  if (hasImageInputs) {
    updateTaskProgress(taskId, "Rendering", "准备图片");
  }
  const sourceImageDimensions = task.sourceImage ? await measureImageDimensions(task.sourceImage) : null;
  const resolvedAspectRatio = resolveAspectRatioForImage2(task, aspectRatio, sourceImageDimensions);
  const expectedOutputSize =
    (isGptImageModel(resolvedModel.actualModel) ||
      resolvedModel.actualModel.startsWith("dall-e") ||
      isComflyResponsesImageModel(resolvedModel.actualModel, platformPreset))
      ? getRequestedImageSize(resolvedModel.actualModel, resolvedAspectRatio, resolution)
      : null;
  const expectedOutputDimensions = parseDimensionString(expectedOutputSize);
  const openAIImageRequestFields =
    ((platformPreset === "yunwu" && isYunwuGptImage) || isCustomOpenAI) &&
    (isGptImageModel(resolvedModel.actualModel) || resolvedModel.actualModel.startsWith("dall-e"))
      ? buildOpenAIImageRequestFields(task, {
          model: resolvedModel.actualModel,
          endpoint: hasImageInputs ? "edits" : "generations",
          platformPreset,
          aspectRatio: resolvedAspectRatio,
          resolution,
        })
      : {};
  const requestQuality = typeof openAIImageRequestFields.quality === "string" ? openAIImageRequestFields.quality : undefined;
  const requestResponseFormat =
    typeof openAIImageRequestFields.response_format === "string"
      ? openAIImageRequestFields.response_format
      : undefined;
  useAppStore.getState().updateTask(taskId, {
    lastUsedImageModel: resolvedModel.actualModel
  });
  const imageInputSummary = hasImageInputs ? await summarizeGenerationImageInputs(task, imageInputs) : [];
  appendGenerationLogEvent(logSessionId, {
    stage: "image",
    event: "image.prepare.completed",
    message: "生图参数准备完成",
    data: {
      platformPreset,
      model: resolvedModel.actualModel,
      requestedModel: resolvedModel.requestedModel,
      resolvedAspectRatio,
      resolution,
      size: expectedOutputSize,
      uiQuality: getEffectiveImageQuality(task),
      quality: requestQuality || "auto",
      responseFormat: requestResponseFormat || "default",
      timeoutMs: imageRequestTimeoutMs,
      hasImageInputs,
      imageInputCount: imageInputs.length,
      imageInputs: imageInputSummary,
      supportsStreamAttempt,
      expectedOutputDimensions: expectedOutputDimensions
        ? `${expectedOutputDimensions.width}x${expectedOutputDimensions.height}`
        : undefined,
    },
  });

  let promptForGeneration = effectivePromptText;
  if (resolvedModel.resolutionSupport === "soft") {
    promptForGeneration = appendSoftResolutionHint(promptForGeneration, resolution, resolvedAspectRatio);
  } else if (resolvedModel.resolutionSupport === "none") {
    throw createStageError("当前平台或模型不支持所选分辨率，请切换模型或改用较低分辨率。", "Image Generation");
  }

  try {
    if (hasImageInputs) {
      assertImageInputSupport(task);
    }

    if (isGeminiGateway) {
      updateTaskProgress(taskId, "Rendering", hasImageInputs ? "上传到 API" : "请求 API");
      const geminiBaseUrl = normalizeGeminiBaseUrl(imageApiBaseUrl);
      const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [
        { text: hasImageInputs ? buildImageAwarePrompt(task, promptForGeneration, imageInputs.length, resolution, resolvedAspectRatio) : promptForGeneration }
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

      const geminiAspectRatio = getGeminiAspectRatio(resolvedAspectRatio);
      if (geminiAspectRatio) {
        (generationConfig.imageConfig as Record<string, unknown>).aspectRatio = geminiAspectRatio;
      }

      appendGenerationLogEvent(logSessionId, {
        stage: "image",
        event: "image.request.started",
        message: "开始请求生图 API",
        data: {
          requestPath: getRequestPathLabel(`${geminiBaseUrl}/models/${resolvedModel.actualModel}:generateContent`),
          method: "POST",
          requestType: "gemini_gateway_generate_content",
          body: summarizeJsonImageRequestBody(
            {
              contents: [{ role: "user", parts }],
              generationConfig,
            },
            hasImageInputs ? buildImageAwarePrompt(task, promptForGeneration, imageInputs.length, resolution, resolvedAspectRatio) : promptForGeneration,
          ),
        },
      });

      const res = await fetchWithTimeout(`${geminiBaseUrl}/models/${resolvedModel.actualModel}:generateContent`, {
        method: "POST",
        headers: buildGeminiGatewayHeaders(imageApiKey),
        body: JSON.stringify({
          contents: [{ role: "user", parts }],
          generationConfig
        })
      }, imageRequestTimeoutMs);

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`HTTP Error ${res.status}: ${errText.substring(0, 160)}`);
      }

      const json = await res.json();
      updateTaskProgress(taskId, "Rendering", "解析结果");
      const responseParts = json.candidates?.[0]?.content?.parts || [];
      const inlineImagePart = responseParts.find((part: any) => part.inlineData?.data);
      if (!inlineImagePart?.inlineData?.data) {
        throw new Error("No image data returned from Gemini gateway");
      }

      const mimeType = inlineImagePart.inlineData.mimeType || "image/png";
      const src = `data:${mimeType};base64,${inlineImagePart.inlineData.data}`;
      const finalized = finalizeGeneratedImageResult({
        src,
        sourceType: "base64",
        originalSrc: src
      }, startedAt, expectedOutputDimensions);
      appendGenerationLogEvent(logSessionId, {
        stage: "image",
        event: "image.response.received",
        message: "生图结果已返回",
        data: summarizeGeneratedImageResponse(finalized),
      });
      return finalized;
    }

    if (platformPreset === "yunwu" && isYunwuGptImage && imageApiBaseUrl && imageApiKey) {
      let baseUrl = imageApiBaseUrl.replace(/\/+$/, "");
      if (!baseUrl.endsWith("/v1")) baseUrl += "/v1";
      const editsUrl = buildConfiguredImageApiUrl(baseUrl, "/images/edits", imageApiPath);
      const generationsUrl = buildConfiguredImageApiUrl(baseUrl, "/images/generations", imageApiPath);

      const isImage2Request = isDocumentedImage2Model(resolvedModel.actualModel);

      if (hasImageInputs) {
        updateTaskProgress(taskId, "Rendering", "上传到 API");
        const formData = new FormData();
        formData.append("model", resolvedModel.actualModel);
        formData.append("prompt", promptForGeneration);
        Object.entries(openAIImageRequestFields).forEach(([key, value]) => {
          formData.append(key, value);
        });
        if (!isImage2Request) {
          formData.append("n", "1");
        }

        for (let index = 0; index < imageInputs.length; index += 1) {
          const fileValue = await imageInputToFileValue(imageInputs[index], `reference-${index + 1}`);
          formData.append("image", fileValue);
        }

        appendGenerationLogEvent(logSessionId, {
          stage: "image",
          event: "image.request.started",
          message: "开始请求生图 API",
          data: {
            requestPath: getRequestPathLabel(editsUrl),
            method: "POST",
            requestType: "openai_image_edits",
            body: summarizeFormDataForLog({
              model: resolvedModel.actualModel,
              ...openAIImageRequestFields,
              ...(isImage2Request ? {} : { n: 1 }),
              imageCount: imageInputs.length,
            }, promptForGeneration),
          },
        });

        const extracted = await fetchImageResultWithOptionalStream(editsUrl, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${imageApiKey}`
          },
          body: formData
        }, imageRequestTimeoutMs, supportsStreamAttempt);

        const finalized = finalizeGeneratedImageResult(extracted, startedAt, expectedOutputDimensions);
        appendGenerationLogEvent(logSessionId, {
          stage: "image",
          event: "image.response.received",
          message: "生图结果已返回",
          data: summarizeGeneratedImageResponse(finalized),
        });
        return finalized;
      }

      updateTaskProgress(taskId, "Rendering", "请求 API");
      const requestBody: Record<string, unknown> = {
        model: resolvedModel.actualModel,
        prompt: promptForGeneration,
        ...openAIImageRequestFields,
        ...(isImage2Request ? {} : { n: 1 }),
      };

      appendGenerationLogEvent(logSessionId, {
        stage: "image",
        event: "image.request.started",
        message: "开始请求生图 API",
        data: {
          requestPath: getRequestPathLabel(generationsUrl),
          method: "POST",
          requestType: "openai_image_generations",
          body: summarizeJsonImageRequestBody(requestBody, promptForGeneration),
        },
      });

      appendGenerationLogEvent(logSessionId, {
        stage: "image",
        event: "image.request.started",
        message: "开始请求生图 API",
        data: {
          requestPath: getRequestPathLabel(generationsUrl),
          method: "POST",
          requestType: "openai_image_generations",
          body: summarizeJsonImageRequestBody(requestBody, promptForGeneration),
        },
      });
      appendGenerationLogEvent(logSessionId, {
        stage: "image",
        event: "image.request.started",
        message: "寮€濮嬭姹傜敓鍥?API",
        data: {
          requestPath: getRequestPathLabel(generationsUrl),
          method: "POST",
          requestType: "openai_image_generations",
          body: summarizeJsonImageRequestBody(requestBody, promptForGeneration),
        },
      });
      appendGenerationLogEvent(logSessionId, {
        stage: "image",
        event: "image.request.started",
        message: "寮€濮嬭姹傜敓鍥?API",
        data: {
          requestPath: getRequestPathLabel(generationsUrl),
          method: "POST",
          requestType: "openai_image_generations",
          body: summarizeJsonImageRequestBody(requestBody, promptForGeneration),
        },
      });
      const extracted = await fetchImageResultWithOptionalStream(generationsUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${imageApiKey}`
        },
        body: JSON.stringify(requestBody)
      }, imageRequestTimeoutMs, supportsStreamAttempt);

      const finalized = finalizeGeneratedImageResult(extracted, startedAt, expectedOutputDimensions);
      appendGenerationLogEvent(logSessionId, {
        stage: "image",
        event: "image.response.received",
        message: "生图结果已返回",
        data: summarizeGeneratedImageResponse(finalized),
      });
      return finalized;
    }

    if (isCustomOpenAI) {
      let baseUrl = imageApiBaseUrl.replace(/\/+$/, "");
      if (!baseUrl.endsWith("/v1")) baseUrl += "/v1";
      const editsUrl = buildConfiguredImageApiUrl(baseUrl, "/images/edits", imageApiPath);
      const generationsUrl = buildConfiguredImageApiUrl(baseUrl, "/images/generations", imageApiPath);

      if (
        hasImageInputs &&
        (isGptImageModel(resolvedModel.actualModel) || resolvedModel.actualModel.startsWith("dall-e"))
      ) {
        updateTaskProgress(taskId, "Rendering", "上传到 API");
        const formData = new FormData();
        formData.append("model", resolvedModel.actualModel);
        formData.append("prompt", promptForGeneration);
        const isImage2Request = isDocumentedImage2Model(resolvedModel.actualModel);
        Object.entries(openAIImageRequestFields).forEach(([key, value]) => {
          formData.append(key, value);
        });
        if (!isImage2Request) {
          formData.append("n", "1");
        }

        for (let index = 0; index < imageInputs.length; index += 1) {
          const fileValue = await imageInputToFileValue(imageInputs[index], `reference-${index + 1}`);
          formData.append("image", fileValue);
        }

        appendGenerationLogEvent(logSessionId, {
          stage: "image",
          event: "image.request.started",
          message: "开始请求生图 API",
          data: {
            requestPath: getRequestPathLabel(editsUrl),
            method: "POST",
            requestType: "openai_image_edits",
            body: summarizeFormDataForLog({
              model: resolvedModel.actualModel,
              ...openAIImageRequestFields,
              ...(isImage2Request ? {} : { n: 1 }),
              imageCount: imageInputs.length,
            }, promptForGeneration),
          },
        });

        const extracted = await fetchImageResultWithOptionalStream(editsUrl, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${imageApiKey}`
          },
          body: formData
        }, imageRequestTimeoutMs, supportsStreamAttempt);

        const finalized = finalizeGeneratedImageResult(extracted, startedAt, expectedOutputDimensions);
        appendGenerationLogEvent(logSessionId, {
          stage: "image",
          event: "image.response.received",
          message: "生图结果已返回",
          data: summarizeGeneratedImageResponse(finalized),
        });
        return finalized;
      }

      if (isComflyResponsesImageModel(resolvedModel.actualModel, platformPreset) && hasImageInputs) {
        updateTaskProgress(taskId, "Rendering", "上传到 API");
        const requestBody: Record<string, unknown> = {
          model: resolvedModel.actualModel,
          prompt: buildImageAwarePrompt(task, promptForGeneration, imageInputs.length, resolution, resolvedAspectRatio),
          image: imageInputs,
        };
        Object.assign(requestBody, buildComflyResolutionFields(resolvedModel.actualModel, resolution, resolvedAspectRatio));

        appendGenerationLogEvent(logSessionId, {
          stage: "image",
          event: "image.request.started",
          message: "开始请求生图 API",
          data: {
            requestPath: getRequestPathLabel(generationsUrl),
            method: "POST",
            requestType: "comfly_image_generations",
            body: summarizeJsonImageRequestBody(requestBody, String(requestBody.prompt || "")),
          },
        });

        const extracted = await fetchImageResultWithOptionalStream(generationsUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${imageApiKey}`
          },
          body: JSON.stringify(requestBody)
        }, imageRequestTimeoutMs, supportsStreamAttempt);

        const finalized = finalizeGeneratedImageResult(extracted, startedAt, expectedOutputDimensions);
        appendGenerationLogEvent(logSessionId, {
          stage: "image",
          event: "image.response.received",
          message: "生图结果已返回",
          data: summarizeGeneratedImageResponse(finalized),
        });
        return finalized;
      }

      if (hasImageInputs) {
        updateTaskProgress(taskId, "Rendering", "上传到 API");
        const content = [
          { type: "text", text: buildImageAwarePrompt(task, promptForGeneration, imageInputs.length, resolution, resolvedAspectRatio) },
          ...imageInputs.map(image => ({ type: "image_url", image_url: { url: image } }))
        ];

        const requestBody: Record<string, unknown> = {
          model: resolvedModel.actualModel,
          messages: [{ role: "user", content }]
        };

        if (platformPreset === "comfly-chat") {
          Object.assign(requestBody, buildComflyResolutionFields(resolvedModel.actualModel, resolution, resolvedAspectRatio));
        }

        appendGenerationLogEvent(logSessionId, {
          stage: "image",
          event: "image.request.started",
          message: "开始请求生图 API",
          data: {
            requestPath: getRequestPathLabel(`${baseUrl}/chat/completions`),
            method: "POST",
            requestType: "chat_completions_image_aware",
            body: summarizeJsonImageRequestBody(requestBody),
          },
        });

        const res = await fetchWithTimeout(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${imageApiKey}`
          },
          body: JSON.stringify(requestBody)
        }, imageRequestTimeoutMs);

        if (!res.ok) {
          const errText = await res.text();
          throw new Error(`HTTP Error ${res.status}: ${errText.substring(0, 100)}`);
        }

        const json = await res.json();
        updateTaskProgress(taskId, "Rendering", "解析结果");
        const extracted = extractImageResultFromResponse(json);
        if (!extracted) throw new Error("Could not extract image from image-aware model output");
        const finalized = finalizeGeneratedImageResult(extracted, startedAt, expectedOutputDimensions);
        appendGenerationLogEvent(logSessionId, {
          stage: "image",
          event: "image.response.received",
          message: "生图结果已返回",
          data: summarizeGeneratedImageResponse(finalized),
        });
        return finalized;
      }

      const requestBody: Record<string, unknown> = {
        model: resolvedModel.actualModel,
        prompt: promptForGeneration,
      };

      if (isGptImageModel(resolvedModel.actualModel) || resolvedModel.actualModel.startsWith("dall-e")) {
        Object.assign(requestBody, openAIImageRequestFields);
        if (!isDocumentedImage2Model(resolvedModel.actualModel)) {
          requestBody.n = 1;
        }
      } else if (platformPreset === "comfly-chat") {
        Object.assign(requestBody, buildComflyResolutionFields(resolvedModel.actualModel, resolution, resolvedAspectRatio));
      }

      updateTaskProgress(taskId, "Rendering", "请求 API");
      const extracted = await fetchImageResultWithOptionalStream(generationsUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${imageApiKey}`
        },
        body: JSON.stringify(requestBody)
      }, imageRequestTimeoutMs, supportsStreamAttempt);

      const finalized = finalizeGeneratedImageResult(extracted, startedAt, expectedOutputDimensions);
      appendGenerationLogEvent(logSessionId, {
        stage: "image",
        event: "image.response.received",
        message: "生图结果已返回",
        data: summarizeGeneratedImageResponse(finalized),
      });
      return finalized;
    }

    const apiKey = getBuiltInGeminiApiKey();
    if (!apiKey) {
      throw new Error("Missing built-in Gemini API Key for image generation. For public deployments, use the in-app API settings instead of bundling a key into the frontend.");
    }

    if (hasImageInputs) {
      updateTaskProgress(taskId, "Rendering", "上传到 API");
      const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [
        { text: buildImageAwarePrompt(task, promptForGeneration, imageInputs.length, resolution, resolvedAspectRatio) }
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
      }, imageRequestTimeoutMs);

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Gemini Error ${res.status}: ${errText.substring(0, 100)}`);
      }

      const json = await res.json();
      updateTaskProgress(taskId, "Rendering", "解析结果");
      const responseParts = json.candidates?.[0]?.content?.parts || [];
      const inlineImagePart = responseParts.find((part: any) => part.inlineData?.data);
      if (!inlineImagePart?.inlineData?.data) {
        throw new Error("No image data returned from Gemini image-input generation");
      }

      const mimeType = inlineImagePart.inlineData.mimeType || "image/png";
      const finalized = finalizeGeneratedImageResult({
        src: `data:${mimeType};base64,${inlineImagePart.inlineData.data}`,
        sourceType: "base64",
        originalSrc: `data:${mimeType};base64,${inlineImagePart.inlineData.data}`
      }, startedAt, expectedOutputDimensions);
      appendGenerationLogEvent(logSessionId, {
        stage: "image",
        event: "image.response.received",
        message: "生图结果已返回",
        data: summarizeGeneratedImageResponse(finalized),
      });
      return finalized;
    }

    const params: Record<string, unknown> = {
      sampleCount: 1,
      personGeneration: "ALLOW_ADULT"
    };

    if (resolvedModel.resolutionSupport === "hard") {
      params.sampleImageSize = getGeminiSampleImageSize(resolution);
      const geminiAspectRatio = getGeminiAspectRatio(resolvedAspectRatio);
      if (geminiAspectRatio) params.aspectRatio = geminiAspectRatio;
    }

    updateTaskProgress(taskId, "Rendering", "请求 API");
    const res = await fetchWithTimeout(`https://generativelanguage.googleapis.com/v1beta/models/${resolvedModel.actualModel}:predict?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        instances: [{ prompt: promptForGeneration }],
        parameters: params
      })
    }, imageRequestTimeoutMs);

    updateTaskProgress(taskId, "Rendering", "请求 API");
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Imagen Error ${res.status}: ${errText.substring(0, 100)}`);
    }

    const json = await res.json();
    updateTaskProgress(taskId, "Rendering", "解析结果");
    const b64 = json.predictions?.[0]?.bytesBase64Encoded;
    if (!b64) throw new Error("No predictions returned from Imagen");
    const finalized = finalizeGeneratedImageResult({
      src: `data:image/jpeg;base64,${b64}`,
      sourceType: "base64",
      originalSrc: `data:image/jpeg;base64,${b64}`
    }, startedAt, expectedOutputDimensions);
    appendGenerationLogEvent(logSessionId, {
      stage: "image",
      event: "image.response.received",
      message: "生图结果已返回",
      data: summarizeGeneratedImageResponse(finalized),
    });
    return finalized;
  } catch (e: any) {
    appendGenerationLogEvent(logSessionId, {
      level: "error",
      stage: "image",
      event: "image.failed",
      message: "生图请求失败",
      data: {
        error: sanitizeLogData(e),
        model: resolvedModel.actualModel,
        platformPreset,
        resolvedAspectRatio,
        resolution,
        size: expectedOutputSize,
        hasImageInputs,
      },
    });
    throw createStageError(e.message, "Image Generation");
  }
}

async function runImageGeneration(taskId: string, options: RunImageGenerationOptions = {}): Promise<GeneratedBatchResult> {
  const store = useAppStore.getState();
  const task = store.taskLookup[taskId];
  if (!task) throw new Error("Task not found");

  const targetBatchCount = getBatchCountNumber(getEffectiveTaskBatchCount(task));
  const images: TaskResultImage[] = [];
  let failedCount = 0;
  const logSessionId = options.logSessionId;
  const imageNotifier = options.onImage ? createBufferedImageNotifier(options.onImage) : null;
  const shouldContinue = options.shouldContinue;

  if (logSessionId) {
    appendGenerationLogEvent(logSessionId, {
      stage: "image",
      event: "image.batch.started",
      message: "开始执行生图批次",
      data: {
        targetBatchCount,
      },
    });
  }

  for (let index = 0; index < targetBatchCount; index += 1) {
    if (shouldContinue && !shouldContinue()) {
      break;
    }
    try {
      if (logSessionId) {
        appendGenerationLogEvent(logSessionId, {
          stage: "image",
          event: "image.attempt.started",
          message: `开始第 ${index + 1} 次生图请求`,
          data: {
            attempt: index + 1,
            targetBatchCount,
          },
          incrementAttempt: true,
        });
      }
      const generatedImage = await runSingleImageGeneration(taskId, { logSessionId });
      if (shouldContinue && !shouldContinue()) {
        break;
      }
      const createdImage = await createTaskResultImage(generatedImage, task.activeResultSessionId);
      images.push(createdImage);
      if (logSessionId) {
        appendGenerationLogEvent(logSessionId, {
          stage: "writeback",
          event: "image.result.saved",
          message: `第 ${index + 1} 张结果图已写入`,
          data: {
            attempt: index + 1,
            image: buildImageResultSummary([createdImage])[0],
            sizeComparison: buildResultSizeComparison(createdImage),
            totalImages: images.length,
            failedCount,
          },
        });
      }
      imageNotifier?.queue(createdImage, [...images], failedCount);
    } catch (error) {
      failedCount += 1;
      if (logSessionId) {
        appendGenerationLogEvent(logSessionId, {
          level: "error",
          stage: "image",
          event: "image.attempt.failed",
          message: `第 ${index + 1} 次生图请求失败`,
          data: {
            attempt: index + 1,
            failedCount,
            error: sanitizeLogData(error),
          },
        });
      }
      if (targetBatchCount === 1) {
        throw error;
      }
    }
  }

  if (logSessionId) {
    updateGenerationLogSummary(logSessionId, {
      resultCount: images.length,
      failedCount,
      requestCount: targetBatchCount,
    });
    appendGenerationLogEvent(logSessionId, {
      stage: "writeback",
      event: "image.batch.completed",
      message: "生图批次执行完成",
      data: {
        resultCount: images.length,
        failedCount,
        images: buildImageResultSummary(images),
        sizeComparisons: images.map((image) => ({
          id: image.id,
          ...buildResultSizeComparison(image),
        })),
      },
    });
  }

  imageNotifier?.flush();

  return { images, failedCount };
}
