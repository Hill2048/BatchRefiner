import { del, get, set } from "idb-keyval";

const PROJECT_FILE_HANDLE_PREFIX = "batch-refiner-project-file-handle:";

type FileHandle = FileSystemFileHandle;
type PermissionedFileHandle = FileHandle & {
  queryPermission?: (descriptor?: { mode?: "read" | "readwrite" }) => Promise<PermissionState>;
  requestPermission?: (descriptor?: { mode?: "read" | "readwrite" }) => Promise<PermissionState>;
};

function getSaveFileApi() {
  return (window as typeof window & {
    showSaveFilePicker?: (options?: {
      suggestedName?: string;
      types?: Array<{
        description?: string;
        accept: Record<string, string[]>;
      }>;
    }) => Promise<FileHandle>;
  }).showSaveFilePicker;
}

export function supportsProjectFileSave() {
  return typeof window !== "undefined" && typeof getSaveFileApi() === "function";
}

function getProjectFileHandleKey(projectId: string) {
  return `${PROJECT_FILE_HANDLE_PREFIX}${projectId}`;
}

export async function getProjectFileHandle(projectId: string) {
  return (await get<FileHandle>(getProjectFileHandleKey(projectId))) || null;
}

export async function clearProjectFileHandle(projectId: string) {
  await del(getProjectFileHandleKey(projectId));
}

export async function ensureProjectFilePermission(handle: FileHandle) {
  const permissionHandle = handle as PermissionedFileHandle;
  const current = await permissionHandle.queryPermission?.({ mode: "readwrite" });
  if (current === "granted") return true;

  const requested = await permissionHandle.requestPermission?.({ mode: "readwrite" });
  return requested === "granted";
}

export async function pickProjectSaveFile(projectId: string, suggestedName: string) {
  const saveFilePicker = getSaveFileApi();
  if (!saveFilePicker) {
    throw new Error("当前浏览器不支持直接覆盖保存，请退回普通下载。");
  }

  const handle = await saveFilePicker({
    suggestedName,
    types: [
      {
        description: "BatchRefiner 项目文件",
        accept: {
          "application/json": [".json"],
        },
      },
    ],
  });

  await set(getProjectFileHandleKey(projectId), handle);
  return handle;
}

export async function writeProjectFile(handle: FileHandle, content: string) {
  const writable = await handle.createWritable();
  await writable.write(content);
  await writable.close();
}
