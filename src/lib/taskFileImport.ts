import { Task } from '@/types';

export async function optimizeImageToDataUrl(file: File): Promise<string> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const maxSize = 1200;
      let width = img.width;
      let height = img.height;
      if (width > maxSize || height > maxSize) {
        const ratio = Math.min(maxSize / width, maxSize / height);
        width *= ratio;
        height *= ratio;
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      } else {
        const reader = new FileReader();
        reader.onload = (event) => resolve(event.target?.result as string);
        reader.readAsDataURL(file);
      }
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      const reader = new FileReader();
      reader.onload = (event) => resolve(event.target?.result as string);
      reader.readAsDataURL(file);
      URL.revokeObjectURL(url);
    };
    img.src = url;
  });
}

export async function buildImportedTasksFromFiles(
  files: File[],
  startIndex: number,
): Promise<Array<Pick<Task, 'index' | 'title' | 'description' | 'sourceImage' | 'referenceImages'>>> {
  const images = files.filter((file) => file.type.startsWith('image/'));
  const encodedImages = await Promise.all(images.map((file) => optimizeImageToDataUrl(file)));

  return encodedImages.map((dataUrl, index) => ({
    index: startIndex + index,
    title: images[index].name,
    description: '',
    sourceImage: dataUrl,
    referenceImages: [],
  }));
}

export async function buildReferenceImagesFromFiles(files: File[]) {
  const images = files.filter((file) => file.type.startsWith('image/'));
  return Promise.all(images.map((file) => optimizeImageToDataUrl(file)));
}
