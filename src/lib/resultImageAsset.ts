import type { TaskResultImage } from '@/types';

export interface ResultImageDimensions {
  width: number;
  height: number;
}

export function getResultImageAssetSrc(result: Pick<TaskResultImage, 'assetSrc' | 'originalSrc' | 'src'>) {
  return result.src || result.assetSrc || result.originalSrc;
}

export function getResultImageDownloadSourceType(result: Pick<TaskResultImage, 'downloadSourceType' | 'assetSrc' | 'originalSrc' | 'src'>) {
  if (result.downloadSourceType) return result.downloadSourceType;
  const source = result.src || result.assetSrc || result.originalSrc || '';
  if (source.startsWith('data:')) return 'data_url';
  return 'src';
}

export function getResultImageAssetDimensions(result: Pick<TaskResultImage, 'assetWidth' | 'assetHeight' | 'width' | 'height'>): ResultImageDimensions | null {
  const width = result.assetWidth || result.width;
  const height = result.assetHeight || result.height;
  if (!width || !height) return null;
  return { width, height };
}

export function getResultImageRequestedDimensions(result: Pick<TaskResultImage, 'requestedWidth' | 'requestedHeight'>): ResultImageDimensions | null {
  if (!result.requestedWidth || !result.requestedHeight) return null;
  return { width: result.requestedWidth, height: result.requestedHeight };
}

export function isValidResultImageAssetSrc(src?: string | null) {
  if (!src) return false;
  return /^(data:image\/|https?:\/\/|blob:)/i.test(src);
}

export function inferMimeTypeFromDataUrl(src: string) {
  const match = src.match(/^data:(image\/[^;]+);base64,/i);
  return match?.[1]?.toLowerCase() || undefined;
}

export function inferExtensionFromMimeType(mimeType?: string) {
  switch ((mimeType || '').toLowerCase()) {
    case 'image/jpeg':
    case 'image/jpg':
      return 'jpg';
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    case 'image/gif':
      return 'gif';
    case 'image/bmp':
      return 'bmp';
    case 'image/svg+xml':
      return 'svg';
    default:
      return undefined;
  }
}

export function inferExtensionFromUrl(src: string) {
  const normalized = src.split('?')[0]?.split('#')[0] || '';
  const match = normalized.match(/\.([a-z0-9]+)$/i);
  if (!match?.[1]) return undefined;
  const extension = match[1].toLowerCase();
  return extension === 'jpeg' ? 'jpg' : extension;
}

export function inferResultImageAssetMetadata(src: string, blob?: Blob | null) {
  const mimeType = blob?.type || inferMimeTypeFromDataUrl(src) || undefined;
  const extension = inferExtensionFromMimeType(mimeType) || inferExtensionFromUrl(src) || 'png';
  return {
    mimeType,
    extension,
  };
}

export function getResultImageAssetExtension(result: Pick<TaskResultImage, 'assetExtension' | 'assetMimeType' | 'assetSrc' | 'originalSrc' | 'src'>) {
  if (result.assetExtension) return result.assetExtension;
  return inferResultImageAssetMetadata(getResultImageAssetSrc(result)).extension;
}
