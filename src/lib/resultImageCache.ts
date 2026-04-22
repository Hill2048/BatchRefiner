import { get, set } from 'idb-keyval';

const RESULT_IMAGE_CACHE_PREFIX = 'batch-refiner-result-image:';

function isDataUrl(value: string) {
  return value.startsWith('data:');
}

function getResultImageCacheKey(src: string) {
  return `${RESULT_IMAGE_CACHE_PREFIX}${src}`;
}

export function dataUrlToBlob(dataUrl: string) {
  const [header, base64 = ''] = dataUrl.split(',');
  const mimeTypeMatch = header.match(/^data:(.*?);base64$/i);
  const mimeType = mimeTypeMatch?.[1] || 'application/octet-stream';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new Blob([bytes], { type: mimeType });
}

async function fetchRemoteImageBlob(src: string) {
  const response = await fetch(src);
  if (!response.ok) {
    throw new Error(`下载结果图失败：HTTP ${response.status}`);
  }
  return response.blob();
}

export async function getResultImageBlob(src: string) {
  if (isDataUrl(src)) {
    return dataUrlToBlob(src);
  }

  const cacheKey = getResultImageCacheKey(src);
  const cachedBlob = await get<Blob>(cacheKey);
  if (cachedBlob) {
    return cachedBlob;
  }

  const blob = await fetchRemoteImageBlob(src);
  await set(cacheKey, blob);
  return blob;
}

export async function primeResultImageCache(src?: string | null) {
  if (!src || isDataUrl(src)) return;

  const cacheKey = getResultImageCacheKey(src);
  const cachedBlob = await get<Blob>(cacheKey);
  if (cachedBlob) return;

  try {
    const blob = await fetchRemoteImageBlob(src);
    await set(cacheKey, blob);
  } catch {
    // 后台预热失败不阻塞主流程，下载时再兜底拉取。
  }
}

export async function primeTaskResultImageCache(sources: Array<string | undefined | null>) {
  const uniqueSources = Array.from(new Set(sources.filter(Boolean))) as string[];
  await Promise.all(uniqueSources.map((src) => primeResultImageCache(src)));
}
