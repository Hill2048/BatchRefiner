import { get, set } from 'idb-keyval';

const RESULT_IMAGE_CACHE_PREFIX = 'batch-refiner-result-image:';

export type ResultImageCacheStatus = 'primed' | 'miss' | 'failed';

function isDataUrl(value: string) {
  return value.startsWith('data:');
}

function getResultImageCacheKey(src: string) {
  return `${RESULT_IMAGE_CACHE_PREFIX}${src}`;
}

export async function storeResultImageBlob(src: string, blob: Blob) {
  if (!src) return;
  await set(getResultImageCacheKey(src), blob);
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

export async function getResultImageBlobWithStatus(src: string): Promise<{ blob: Blob; cacheStatus: ResultImageCacheStatus }> {
  if (isDataUrl(src)) {
    return {
      blob: dataUrlToBlob(src),
      cacheStatus: 'primed',
    };
  }

  const cacheKey = getResultImageCacheKey(src);
  const cachedBlob = await get<Blob>(cacheKey);
  if (cachedBlob) {
    return {
      blob: cachedBlob,
      cacheStatus: 'primed',
    };
  }

  const blob = await fetchRemoteImageBlob(src);
  try {
    await set(cacheKey, blob);
    return {
      blob,
      cacheStatus: 'miss',
    };
  } catch {
    return {
      blob,
      cacheStatus: 'failed',
    };
  }
}

export async function getResultImageBlob(src: string) {
  const { blob } = await getResultImageBlobWithStatus(src);
  return blob;
}

export async function primeResultImageCache(src?: string | null): Promise<ResultImageCacheStatus> {
  if (!src) return 'failed';
  if (isDataUrl(src)) return 'primed';

  const cacheKey = getResultImageCacheKey(src);
  const cachedBlob = await get<Blob>(cacheKey);
  if (cachedBlob) return 'primed';

  try {
    const blob = await fetchRemoteImageBlob(src);
    await set(cacheKey, blob);
    return 'miss';
  } catch {
    return 'failed';
  }
}

export async function primeTaskResultImageCache(sources: Array<string | undefined | null>) {
  const uniqueSources = Array.from(new Set(sources.filter(Boolean))) as string[];
  return Promise.all(uniqueSources.map((src) => primeResultImageCache(src)));
}
