import { del, get, set } from "idb-keyval";

const DOWNLOAD_DIRECTORY_HANDLE_KEY = "batch-refiner-download-directory-handle";

type DirectoryHandle = FileSystemDirectoryHandle;
type PermissionedDirectoryHandle = DirectoryHandle & {
  queryPermission?: (descriptor?: { mode?: "read" | "readwrite" }) => Promise<PermissionState>;
  requestPermission?: (descriptor?: { mode?: "read" | "readwrite" }) => Promise<PermissionState>;
};

let activeDirectoryPicker: Promise<{ handle: DirectoryHandle; name: string }> | null = null;

function getDirectoryApi() {
  return (window as typeof window & {
    showDirectoryPicker?: () => Promise<DirectoryHandle>;
  }).showDirectoryPicker;
}

export function supportsDirectoryDownload() {
  return typeof window !== "undefined" && typeof getDirectoryApi() === "function";
}

export async function pickDownloadDirectory() {
  const picker = getDirectoryApi();
  if (!picker) {
    throw new Error("当前浏览器不支持选择下载目录。请使用 Edge，或改用普通 ZIP 下载。");
  }

  if (activeDirectoryPicker) {
    throw new Error("目录选择器已打开，请先完成当前选择。");
  }

  activeDirectoryPicker = (async () => {
    try {
      const handle = await picker();
      await set(DOWNLOAD_DIRECTORY_HANDLE_KEY, handle);
      return {
        handle,
        name: handle.name,
      };
    } catch (error: any) {
      if (error?.name === "InvalidStateError") {
        throw new Error("目录选择器已打开，请先完成当前选择。");
      }
      throw error;
    } finally {
      activeDirectoryPicker = null;
    }
  })();

  return activeDirectoryPicker;
}

export async function clearDownloadDirectory() {
  await del(DOWNLOAD_DIRECTORY_HANDLE_KEY);
}

export async function getDownloadDirectoryHandle() {
  const handle = await get<DirectoryHandle>(DOWNLOAD_DIRECTORY_HANDLE_KEY);
  return handle || null;
}

export async function ensureDownloadDirectoryPermission(handle: DirectoryHandle) {
  const permissionHandle = handle as PermissionedDirectoryHandle;
  const current = await permissionHandle.queryPermission?.({ mode: "readwrite" });
  if (current === "granted") return true;

  const requested = await permissionHandle.requestPermission?.({ mode: "readwrite" });
  return requested === "granted";
}

export async function writeBlobToDirectory(handle: DirectoryHandle, filename: string, blob: Blob) {
  const fileHandle = await handle.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(blob);
  await writable.close();
}
