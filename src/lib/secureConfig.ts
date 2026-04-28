import type { PlatformApiConfigMap, PlatformPreset } from "@/types";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const DEFAULT_ENCRYPTED_CONFIG_PATH = "/default-api-config.json";
const BUILT_IN_SECRET = [
  "BatchRefiner",
  "AutoImport",
  "ConfigShield",
  "2026",
  "yunwu",
].join(":");

export interface ApiConfigPayload {
  version: 1;
  platformPreset: PlatformPreset;
  apiBaseUrl: string;
  textApiBaseUrl?: string;
  imageApiBaseUrl?: string;
  imageApiPath?: string;
  textToImageApiBaseUrl?: string;
  textToImageApiPath?: string;
  imageToImageApiBaseUrl?: string;
  imageToImageApiPath?: string;
  apiKey: string;
  textApiKey?: string;
  imageApiKey?: string;
  textToImageApiKey?: string;
  imageToImageApiKey?: string;
  textModel: string;
  imageModel: string;
  textToImageModel?: string;
  imageToImageModel?: string;
  exportedAt: string;
}

export interface MultiPlatformApiConfigPayload {
  version: 2;
  selectedPlatformPreset: PlatformPreset;
  platformConfigs: PlatformApiConfigMap;
  exportedAt: string;
}

interface ProtectedConfigEnvelope {
  type: "batch-refiner-protected-config";
  version: 2;
  algorithm: "AES-GCM";
  iv: string;
  ciphertext: string;
}

interface ChunkedProtectedConfigEnvelope {
  type: "batch-refiner-protected-config";
  version: 3;
  algorithm: "chunked-obfuscation";
  payload: Omit<ApiConfigPayload, "apiKey" | "textApiKey" | "imageApiKey" | "textToImageApiKey" | "imageToImageApiKey">;
  keyData: {
    nonce: string;
    order: number[];
    chunks: string[];
  };
  textKeyData?: ChunkedProtectedConfigEnvelope["keyData"];
  imageKeyData?: ChunkedProtectedConfigEnvelope["keyData"];
  textToImageKeyData?: ChunkedProtectedConfigEnvelope["keyData"];
  imageToImageKeyData?: ChunkedProtectedConfigEnvelope["keyData"];
}

type ProtectedKeyBundle = {
  apiKey: ChunkedProtectedConfigEnvelope["keyData"];
  textApiKey?: ChunkedProtectedConfigEnvelope["keyData"];
  imageApiKey?: ChunkedProtectedConfigEnvelope["keyData"];
  textToImageApiKey?: ChunkedProtectedConfigEnvelope["keyData"];
  imageToImageApiKey?: ChunkedProtectedConfigEnvelope["keyData"];
};

interface MultiChunkedProtectedConfigEnvelope {
  type: "batch-refiner-protected-config";
  version: 4;
  algorithm: "chunked-obfuscation-multi";
  payload: Omit<MultiPlatformApiConfigPayload, "platformConfigs"> & {
    platformConfigs: Record<PlatformPreset, Omit<PlatformApiConfigMap[PlatformPreset], "apiKey" | "textApiKey" | "imageApiKey" | "textToImageApiKey" | "imageToImageApiKey">>;
  };
  keyDataByPlatform: Record<PlatformPreset, ChunkedProtectedConfigEnvelope["keyData"] | ProtectedKeyBundle>;
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function base64ToBytes(base64: string) {
  const binary = atob(base64);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function getBuiltInKey() {
  const hashBuffer = await crypto.subtle.digest("SHA-256", textEncoder.encode(BUILT_IN_SECRET));
  return crypto.subtle.importKey("raw", hashBuffer, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function hashBytes(input: string) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", textEncoder.encode(input)));
}

function normalizeChunkSizes(input: string) {
  if (input.length <= 6) return [input];

  const chunks: string[] = [];
  let index = 0;
  let round = 0;

  while (index < input.length) {
    const remaining = input.length - index;
    const nextSize = Math.min(4 + (round % 4), remaining);
    chunks.push(input.slice(index, index + nextSize));
    index += nextSize;
    round += 1;
  }

  return chunks;
}

async function maskChunk(chunk: string, nonce: string, index: number) {
  const bytes = textEncoder.encode(chunk);
  const mask = await hashBytes(`${BUILT_IN_SECRET}:${nonce}:${index}`);
  const masked = bytes.map((byte, byteIndex) => byte ^ mask[byteIndex % mask.length]);
  return bytesToBase64(masked);
}

async function unmaskChunk(maskedChunk: string, nonce: string, index: number) {
  const bytes = base64ToBytes(maskedChunk);
  const mask = await hashBytes(`${BUILT_IN_SECRET}:${nonce}:${index}`);
  const plain = bytes.map((byte, byteIndex) => byte ^ mask[byteIndex % mask.length]);
  return textDecoder.decode(plain);
}

async function obfuscateApiKey(apiKey: string) {
  const nonce = bytesToBase64(crypto.getRandomValues(new Uint8Array(8)));
  const originalChunks = normalizeChunkSizes(apiKey);
  const order = originalChunks.map((_, index) => index).reverse();
  const shuffledChunks = order.map((originalIndex) => originalChunks[originalIndex]);
  const maskedChunks = await Promise.all(
    shuffledChunks.map((chunk, index) => maskChunk(chunk, nonce, index)),
  );

  return {
    nonce,
    order,
    chunks: maskedChunks,
  };
}

async function restoreApiKey(keyData: ChunkedProtectedConfigEnvelope["keyData"]) {
  const shuffledChunks = await Promise.all(
    keyData.chunks.map((chunk, index) => unmaskChunk(chunk, keyData.nonce, index)),
  );
  const originalChunks = new Array(shuffledChunks.length).fill("");

  keyData.order.forEach((originalIndex, shuffledIndex) => {
    originalChunks[originalIndex] = shuffledChunks[shuffledIndex];
  });

  return originalChunks.join("");
}

export async function encryptApiConfig(payload: ApiConfigPayload | MultiPlatformApiConfigPayload) {
  if (payload.version === 2) {
    const platformEntries = Object.entries(payload.platformConfigs) as Array<[PlatformPreset, PlatformApiConfigMap[PlatformPreset]]>;
    const payloadPlatformConfigs = Object.fromEntries(
      platformEntries.map(([platform, config]) => [
        platform,
        {
          apiBaseUrl: config.apiBaseUrl,
          textApiBaseUrl: config.textApiBaseUrl,
          imageApiBaseUrl: config.imageApiBaseUrl,
          imageApiPath: config.imageApiPath,
          textToImageApiBaseUrl: config.textToImageApiBaseUrl,
          textToImageApiPath: config.textToImageApiPath,
          imageToImageApiBaseUrl: config.imageToImageApiBaseUrl,
          imageToImageApiPath: config.imageToImageApiPath,
          textModel: config.textModel,
          imageModel: config.imageModel,
          textToImageModel: config.textToImageModel,
          imageToImageModel: config.imageToImageModel,
        },
      ]),
    ) as MultiChunkedProtectedConfigEnvelope["payload"]["platformConfigs"];

    const keyDataByPlatform = Object.fromEntries(
      await Promise.all(
        platformEntries.map(async ([platform, config]) => [
          platform,
          {
            apiKey: await obfuscateApiKey(config.apiKey),
            textApiKey: await obfuscateApiKey(config.textApiKey || config.apiKey),
            imageApiKey: await obfuscateApiKey(config.imageApiKey || config.apiKey),
            textToImageApiKey: await obfuscateApiKey(config.textToImageApiKey || config.imageApiKey || config.apiKey),
            imageToImageApiKey: await obfuscateApiKey(config.imageToImageApiKey || config.imageApiKey || config.apiKey),
          },
        ]),
      ),
    ) as MultiChunkedProtectedConfigEnvelope["keyDataByPlatform"];

    const envelope: MultiChunkedProtectedConfigEnvelope = {
      type: "batch-refiner-protected-config",
      version: 4,
      algorithm: "chunked-obfuscation-multi",
      payload: {
        version: payload.version,
        selectedPlatformPreset: payload.selectedPlatformPreset,
        exportedAt: payload.exportedAt,
        platformConfigs: payloadPlatformConfigs,
      },
      keyDataByPlatform,
    };

    return JSON.stringify(envelope, null, 2);
  }

  const { apiKey, textApiKey, imageApiKey, textToImageApiKey, imageToImageApiKey, ...restPayload } = payload;
  const envelope: ChunkedProtectedConfigEnvelope = {
    type: "batch-refiner-protected-config",
    version: 3,
    algorithm: "chunked-obfuscation",
    payload: restPayload,
    keyData: await obfuscateApiKey(apiKey),
    textKeyData: await obfuscateApiKey(textApiKey || apiKey),
    imageKeyData: await obfuscateApiKey(imageApiKey || apiKey),
    textToImageKeyData: await obfuscateApiKey(textToImageApiKey || imageApiKey || apiKey),
    imageToImageKeyData: await obfuscateApiKey(imageToImageApiKey || imageApiKey || apiKey),
  };

  return JSON.stringify(envelope, null, 2);
}

export function isEncryptedApiConfig(input: unknown): input is ProtectedConfigEnvelope | ChunkedProtectedConfigEnvelope | MultiChunkedProtectedConfigEnvelope {
  if (!input || typeof input !== "object") return false;
  const envelope = input as { type?: unknown; version?: unknown };
  return envelope.type === "batch-refiner-protected-config" && (envelope.version === 2 || envelope.version === 3 || envelope.version === 4);
}

export async function decryptApiConfig(input: string) {
  const parsed = JSON.parse(input);
  if (!isEncryptedApiConfig(parsed)) {
    throw new Error("这不是当前版本的 BatchRefiner 配置文件");
  }

  if (parsed.version === 3) {
    const apiKey = await restoreApiKey(parsed.keyData);
    const textApiKey = parsed.textKeyData ? await restoreApiKey(parsed.textKeyData) : apiKey;
    const imageApiKey = parsed.imageKeyData ? await restoreApiKey(parsed.imageKeyData) : apiKey;
    const textToImageApiKey = parsed.textToImageKeyData ? await restoreApiKey(parsed.textToImageKeyData) : imageApiKey;
    const imageToImageApiKey = parsed.imageToImageKeyData ? await restoreApiKey(parsed.imageToImageKeyData) : imageApiKey;
    return {
      ...parsed.payload,
      apiKey,
      textApiKey,
      imageApiKey,
      textToImageApiKey,
      imageToImageApiKey,
    } as ApiConfigPayload | MultiPlatformApiConfigPayload;
  }

  if (parsed.version === 4) {
    const platformEntries = Object.entries(parsed.payload.platformConfigs) as Array<
      [PlatformPreset, Omit<PlatformApiConfigMap[PlatformPreset], "apiKey" | "textApiKey" | "imageApiKey" | "textToImageApiKey" | "imageToImageApiKey">]
    >;
    const platformConfigs = Object.fromEntries(
      await Promise.all(
        platformEntries.map(async ([platform, config]) => {
          const keyData = parsed.keyDataByPlatform[platform];
          const legacyKeyData = "chunks" in keyData ? keyData : keyData.apiKey;
          const apiKey = await restoreApiKey(legacyKeyData);
          const textApiKey = "chunks" in keyData || !keyData.textApiKey ? apiKey : await restoreApiKey(keyData.textApiKey);
          const imageApiKey = "chunks" in keyData || !keyData.imageApiKey ? apiKey : await restoreApiKey(keyData.imageApiKey);
          const textToImageApiKey =
            "chunks" in keyData || !keyData.textToImageApiKey
              ? imageApiKey
              : await restoreApiKey(keyData.textToImageApiKey);
          const imageToImageApiKey =
            "chunks" in keyData || !keyData.imageToImageApiKey
              ? imageApiKey
              : await restoreApiKey(keyData.imageToImageApiKey);

          return [
            platform,
            {
              ...config,
              apiKey,
              textApiKey,
              imageApiKey,
              textToImageApiKey,
              imageToImageApiKey,
            },
          ];
        }),
      ),
    ) as PlatformApiConfigMap;

    return {
      ...parsed.payload,
      platformConfigs,
    } as MultiPlatformApiConfigPayload;
  }

  const key = await getBuiltInKey();
  const iv = base64ToBytes(parsed.iv);
  const ciphertext = base64ToBytes(parsed.ciphertext);

  try {
    const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
    return JSON.parse(textDecoder.decode(plaintext)) as ApiConfigPayload | MultiPlatformApiConfigPayload;
  } catch {
    throw new Error("配置文件解密失败，文件可能已损坏");
  }
}

export async function loadBundledEncryptedApiConfig() {
  try {
    const response = await fetch(DEFAULT_ENCRYPTED_CONFIG_PATH, { cache: "no-store" });
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  }
}
