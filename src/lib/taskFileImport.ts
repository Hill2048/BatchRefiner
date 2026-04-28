import { Task } from '@/types';
import { runWithBackgroundYields, yieldToMainThread } from './backgroundQueue';
import { storeImageAssetFromDataUrl, type StoreImageAssetResult } from './imageAssetStore';

export async function readImageFileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => resolve(event.target?.result as string);
    reader.onerror = () => reject(reader.error || new Error('Failed to read image file'));
    reader.readAsDataURL(file);
  });
}

export async function optimizeImageToDataUrl(file: File): Promise<string> {
  const rawDataUrl = await readImageFileToDataUrl(file);
  await yieldToMainThread();
  return optimizeDataUrlForUpload(rawDataUrl);
}

export interface OptimizedImageAsset {
  dataUrl: string;
  assetId?: string;
  previewSrc?: string;
  metadata: StoreImageAssetResult['metadata'];
  storageStatus: StoreImageAssetResult['storageStatus'];
}

export async function optimizeImageToAsset(file: File, kind: 'source' | 'reference'): Promise<OptimizedImageAsset> {
  const dataUrl = await optimizeImageToDataUrl(file);
  const asset = await storeImageAssetFromDataUrl(dataUrl, {
    kind,
    previewSrc: dataUrl,
    originalName: file.name,
  });

  return {
    dataUrl,
    assetId: asset.assetId,
    previewSrc: asset.previewSrc,
    metadata: asset.metadata,
    storageStatus: asset.storageStatus,
  };
}

export async function optimizeDataUrlForUpload(dataUrl: string): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const maxSize = 4000;
      let width = img.width;
      let height = img.height;
      if (width > maxSize || height > maxSize) {
        const ratio = Math.min(maxSize / width, maxSize / height);
        width = Math.max(1, Math.round(width * ratio));
        height = Math.max(1, Math.round(height * ratio));
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.88));
      } else {
        const reader = new FileReader();
        reader.onload = (event) => resolve(event.target?.result as string);
        fetch(dataUrl)
          .then((response) => response.blob())
          .then((blob) => reader.readAsDataURL(blob))
          .catch(() => resolve(dataUrl));
      }
    };
    img.onerror = () => {
      resolve(dataUrl);
    };
    img.src = dataUrl;
  });
}

export async function buildImportedTasksFromFiles(
  files: File[],
  startIndex: number,
): Promise<Array<Pick<Task, 'index' | 'title' | 'description' | 'sourceImage' | 'sourceImageAssetId' | 'referenceImages'>>> {
  const images = files.filter((file) => file.type.startsWith('image/'));
  const tasks: Array<Pick<Task, 'index' | 'title' | 'description' | 'sourceImage' | 'sourceImageAssetId' | 'referenceImages'>> = [];

  await runWithBackgroundYields(images, async (file, index) => {
    const imageAsset = await optimizeImageToAsset(file, 'source');
    tasks.push({
      index: startIndex + index,
      title: file.name,
      description: '',
      sourceImage: imageAsset.dataUrl,
      sourceImageAssetId: imageAsset.assetId,
      referenceImages: [],
    });
  });

  return tasks;
}

export async function buildReferenceImagesFromFiles(files: File[]) {
  const images = files.filter((file) => file.type.startsWith('image/'));
  const optimizedImages: string[] = [];

  await runWithBackgroundYields(images, async (file) => {
    const imageAsset = await optimizeImageToAsset(file, 'reference');
    optimizedImages.push(imageAsset.dataUrl);
  });

  return optimizedImages;
}

export async function buildReferenceImageAssetsFromFiles(files: File[]) {
  const images = files.filter((file) => file.type.startsWith('image/'));
  const optimizedImages: OptimizedImageAsset[] = [];

  await runWithBackgroundYields(images, async (file) => {
    optimizedImages.push(await optimizeImageToAsset(file, 'reference'));
  });

  return optimizedImages;
}
