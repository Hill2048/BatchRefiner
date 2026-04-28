import { del, get, set } from 'idb-keyval';

const CACHE_DIRECTORY_HANDLE_KEY = 'batch-refiner-cache-directory-handle';
const CACHE_ROOT_DIRECTORY_NAME = 'batch-refiner-cache';

type DirectoryHandle = FileSystemDirectoryHandle;
type PermissionedDirectoryHandle = DirectoryHandle & {
  queryPermission?: (descriptor?: { mode?: 'read' | 'readwrite' }) => Promise<PermissionState>;
  requestPermission?: (descriptor?: { mode?: 'read' | 'readwrite' }) => Promise<PermissionState>;
};
type RemovableDirectoryHandle = DirectoryHandle & {
  removeEntry?: (name: string, options?: { recursive?: boolean }) => Promise<void>;
};

let activeCacheDirectoryPicker: Promise<{ handle: DirectoryHandle; name: string }> | null = null;

function getDirectoryApi() {
  return (window as typeof window & {
    showDirectoryPicker?: (options?: { mode?: 'read' | 'readwrite' }) => Promise<DirectoryHandle>;
  }).showDirectoryPicker;
}

function sanitizeCacheFileName(filename: string) {
  return filename.replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, ' ').trim() || 'cache-file';
}

async function getCacheRootDirectory(handle: DirectoryHandle, create: boolean) {
  return handle.getDirectoryHandle(CACHE_ROOT_DIRECTORY_NAME, { create });
}

export function supportsCacheDirectory() {
  return typeof window !== 'undefined' && typeof getDirectoryApi() === 'function';
}

export async function pickCacheDirectory() {
  const picker = getDirectoryApi();
  if (!picker) {
    throw new Error('当前浏览器不支持选择缓存目录，请使用 Edge。');
  }

  if (activeCacheDirectoryPicker) {
    throw new Error('目录选择器已打开，请先完成当前选择。');
  }

  activeCacheDirectoryPicker = (async () => {
    try {
      const handle = await picker({ mode: 'readwrite' });
      await set(CACHE_DIRECTORY_HANDLE_KEY, handle);
      await getCacheRootDirectory(handle, true);
      return {
        handle,
        name: handle.name,
      };
    } finally {
      activeCacheDirectoryPicker = null;
    }
  })();

  return activeCacheDirectoryPicker;
}

export async function clearCacheDirectoryHandle() {
  await del(CACHE_DIRECTORY_HANDLE_KEY);
}

export async function getCacheDirectoryHandle() {
  const handle = await get<DirectoryHandle>(CACHE_DIRECTORY_HANDLE_KEY);
  return handle || null;
}

export async function ensureCacheDirectoryPermission(
  handle: DirectoryHandle,
  options: { request?: boolean } = {},
) {
  const permissionHandle = handle as PermissionedDirectoryHandle;
  const current = await permissionHandle.queryPermission?.({ mode: 'readwrite' });
  if (current === 'granted') return true;
  if (options.request === false) return false;

  const requested = await permissionHandle.requestPermission?.({ mode: 'readwrite' });
  return requested === 'granted';
}

export async function writeCacheBlob(
  filename: string,
  blob: Blob,
  options: { requestPermission?: boolean } = {},
) {
  const handle = await getCacheDirectoryHandle();
  if (!handle) return false;

  const hasPermission = await ensureCacheDirectoryPermission(handle, {
    request: options.requestPermission === true,
  });
  if (!hasPermission) return false;

  const root = await getCacheRootDirectory(handle, true);
  const fileHandle = await root.getFileHandle(sanitizeCacheFileName(filename), { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(blob);
  await writable.close();
  return true;
}

export async function writeCacheText(filename: string, content: string) {
  return writeCacheBlob(filename, new Blob([content], { type: 'application/json;charset=utf-8' }));
}

export async function writeCacheTextWithPermission(filename: string, content: string) {
  return writeCacheBlob(filename, new Blob([content], { type: 'application/json;charset=utf-8' }), {
    requestPermission: true,
  });
}

export async function clearCacheDirectoryFiles() {
  const handle = await getCacheDirectoryHandle();
  if (!handle) return false;

  const hasPermission = await ensureCacheDirectoryPermission(handle, { request: true });
  if (!hasPermission) {
    throw new Error('没有缓存目录写入权限。');
  }

  const removableHandle = handle as RemovableDirectoryHandle;
  if (removableHandle.removeEntry) {
    try {
      await removableHandle.removeEntry(CACHE_ROOT_DIRECTORY_NAME, { recursive: true });
    } catch (error: any) {
      if (error?.name !== 'NotFoundError') throw error;
    }
  }
  await getCacheRootDirectory(handle, true);
  return true;
}
