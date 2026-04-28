import { delMany, get, keys, set } from 'idb-keyval';
import { dataUrlToBlob } from './resultImageCache';
import { inferResultImageAssetMetadata } from './resultImageAsset';
import { writeCacheBlob } from './cacheDirectory';

const IMAGE_ASSET_PREFIX = 'batch-refiner-image-asset:';

export type ImageAssetKind = 'source' | 'reference' | 'result';
export type ImageAssetStorageStatus = 'stored' | 'skipped' | 'failed';

export interface ImageAssetMetadata {
  mimeType?: string;
  extension?: string;
  size?: number;
  width?: number;
  height?: number;
  originalName?: string;
}

export interface StoredImageAsset {
  id: string;
  kind: ImageAssetKind;
  blob: Blob;
  previewSrc?: string;
  metadata: ImageAssetMetadata;
  createdAt: number;
}

export interface StoreImageAssetResult {
  assetId?: string;
  previewSrc?: string;
  metadata: ImageAssetMetadata;
  storageStatus: ImageAssetStorageStatus;
}

function getImageAssetKey(assetId: string) {
  return `${IMAGE_ASSET_PREFIX}${assetId}`;
}

function createAssetId(kind: ImageAssetKind) {
  const randomId = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${kind}-${randomId}`;
}

export async function getStoredImageAsset(assetId: string) {
  return get<StoredImageAsset>(getImageAssetKey(assetId));
}

export async function clearStoredImageAssets() {
  const allKeys = await keys();
  const assetKeys = allKeys.filter((key) => typeof key === 'string' && key.startsWith(IMAGE_ASSET_PREFIX));
  if (assetKeys.length > 0) {
    await delMany(assetKeys);
  }
  return assetKeys.length;
}

export async function storeImageAssetBlob(
  blob: Blob,
  options: {
    kind: ImageAssetKind;
    previewSrc?: string;
    metadata?: ImageAssetMetadata;
    assetId?: string;
  },
): Promise<StoreImageAssetResult> {
  const assetId = options.assetId || createAssetId(options.kind);
  const metadata = {
    ...options.metadata,
    mimeType: options.metadata?.mimeType || blob.type || undefined,
    size: options.metadata?.size || blob.size,
  };

  try {
    await set(getImageAssetKey(assetId), {
      id: assetId,
      kind: options.kind,
      blob,
      previewSrc: options.previewSrc,
      metadata,
      createdAt: Date.now(),
    } satisfies StoredImageAsset);
    const extension = metadata.extension || inferResultImageAssetMetadata('', blob).extension;
    void writeCacheBlob(`${assetId}.${extension}`, blob);

    return {
      assetId,
      previewSrc: options.previewSrc,
      metadata,
      storageStatus: 'stored',
    };
  } catch {
    return {
      previewSrc: options.previewSrc,
      metadata,
      storageStatus: 'failed',
    };
  }
}

export async function storeImageAssetFromDataUrl(
  dataUrl: string,
  options: {
    kind: ImageAssetKind;
    previewSrc?: string;
    originalName?: string;
    width?: number;
    height?: number;
  },
): Promise<StoreImageAssetResult> {
  if (!dataUrl.startsWith('data:image/')) {
    return {
      previewSrc: options.previewSrc,
      metadata: {
        originalName: options.originalName,
        width: options.width,
        height: options.height,
      },
      storageStatus: 'skipped',
    };
  }

  const blob = dataUrlToBlob(dataUrl);
  const metadata = {
    ...inferResultImageAssetMetadata(dataUrl, blob),
    size: blob.size,
    width: options.width,
    height: options.height,
    originalName: options.originalName,
  };

  return storeImageAssetBlob(blob, {
    kind: options.kind,
    previewSrc: options.previewSrc || dataUrl,
    metadata,
  });
}
