import type { TaskResultImage } from '@/types';
import { dataUrlToBlob } from './resultImageCache';
import { getStoredImageAsset } from './imageAssetStore';

export type DownloadFailureStage = 'normalize' | 'fetch' | 'cache' | 'save';
export type DownloadStatus = 'ready' | 'fetch_failed' | 'cache_failed' | 'save_failed' | 'invalid_source';

export class ResultImageDownloadError extends Error {
  stage: DownloadFailureStage;
  status: DownloadStatus;
  sourceType: TaskResultImage['downloadSourceType'];
  cacheStatus: TaskResultImage['downloadCacheStatus'];

  constructor(options: {
    message: string;
    stage: DownloadFailureStage;
    status: DownloadStatus;
    sourceType: TaskResultImage['downloadSourceType'];
    cacheStatus: TaskResultImage['downloadCacheStatus'];
  }) {
    super(options.message);
    this.name = 'ResultImageDownloadError';
    this.stage = options.stage;
    this.status = options.status;
    this.sourceType = options.sourceType;
    this.cacheStatus = options.cacheStatus;
  }
}

export function getResultDownloadDiagnostics(
  result: TaskResultImage,
  overrides?: Partial<Pick<ResultImageDownloadError, 'stage' | 'sourceType' | 'cacheStatus'>>,
) {
  return [
    `阶段=${overrides?.stage || result.downloadFailureStage || 'unknown'}`,
    `源=${overrides?.sourceType || (result.src?.startsWith('data:image/') ? 'data_url' : 'src')}`,
    `缓存=${overrides?.cacheStatus || result.downloadCacheStatus || 'miss'}`,
  ].join(' / ');
}

export async function resolveResultImageDownloadBlob(result: TaskResultImage) {
  if (result.assetId) {
    const storedAsset = await getStoredImageAsset(result.assetId);
    if (storedAsset?.blob) {
      return {
        blob: storedAsset.blob,
        sourceType: 'asset' as const,
        cacheStatus: 'primed' as const,
        assetSrc: result.assetSrc || result.originalSrc || result.src,
        status: 'ready' as DownloadStatus,
      };
    }
  }

  const resultSrc = (result.src || '').trim();
  const sourceType = resultSrc.startsWith('data:image/')
    ? 'data_url'
    : (result.downloadSourceType || 'src');

  if (!resultSrc || (!resultSrc.startsWith('data:image/') && !/^https?:\/\//i.test(resultSrc) && !/^blob:/i.test(resultSrc))) {
    throw new ResultImageDownloadError({
      message: '结果图源无效',
      stage: 'normalize',
      status: 'invalid_source',
      sourceType,
      cacheStatus: 'failed',
    });
  }

  try {
    let blob: Blob;
    let cacheStatus: TaskResultImage['downloadCacheStatus'] = 'miss';

    if (resultSrc.startsWith('data:image/')) {
      blob = dataUrlToBlob(resultSrc);
      cacheStatus = 'primed';
    } else {
      const response = await fetch(resultSrc);
      if (!response.ok) {
        throw new Error(`下载结果图失败：HTTP ${response.status}`);
      }
      blob = await response.blob();
    }

    return {
      blob,
      sourceType,
      cacheStatus,
      assetSrc: resultSrc,
      status: 'ready' as DownloadStatus,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : '读取结果图失败';
    throw new ResultImageDownloadError({
      message,
      stage: 'fetch',
      status: 'fetch_failed',
      sourceType,
      cacheStatus: 'failed',
    });
  }
}
