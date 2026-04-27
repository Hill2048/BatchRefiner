import { Task } from '@/types';

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
  return optimizeDataUrlForUpload(rawDataUrl);
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
): Promise<Array<Pick<Task, 'index' | 'title' | 'description' | 'sourceImage' | 'referenceImages'>>> {
  const images = files.filter((file) => file.type.startsWith('image/'));
  const tasks: Array<Pick<Task, 'index' | 'title' | 'description' | 'sourceImage' | 'referenceImages'>> = [];

  for (const [index, file] of images.entries()) {
    const dataUrl = await optimizeImageToDataUrl(file);
    tasks.push({
      index: startIndex + index,
      title: file.name,
      description: '',
      sourceImage: dataUrl,
      referenceImages: [],
    });
  }

  return tasks;
}

export async function buildReferenceImagesFromFiles(files: File[]) {
  const images = files.filter((file) => file.type.startsWith('image/'));
  const optimizedImages: string[] = [];

  for (const file of images) {
    optimizedImages.push(await optimizeImageToDataUrl(file));
  }

  return optimizedImages;
}
