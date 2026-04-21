import { useAppStore } from "@/store";
import { v4 as uuidv4 } from "uuid";
import { get, set, del, keys } from "idb-keyval";
import { mergeProjectSnapshotWithGlobalConfig, sanitizeProjectSnapshot } from "./projectSnapshot";

export interface ProjectMeta {
  projectId: string;
  projectName: string;
  taskCount: number;
  updatedAt: number;
}

export async function saveCurrentProject() {
  const store = useAppStore.getState();
  const projectMeta: ProjectMeta = {
    projectId: store.projectId,
    projectName: store.projectName,
    taskCount: store.tasks.length,
    updatedAt: Date.now(),
  };
  await set(`meta_${store.projectId}`, projectMeta);
  
  // also save full project? idb-keyval handled by zustand persist, but wait
  // the current active one is auto-saved by zustand. 
  // We just need to persist the active state if we're switching.
  // Actually we need to copy current persisted state to a specific project id key
  // But zustand saves to "batch-refiner-idb". 
  const json = await get("batch-refiner-idb");
  if (json) {
    const parsed = JSON.parse(json as string);
    const sanitized = {
      ...parsed,
      state: sanitizeProjectSnapshot(parsed.state || {}),
    };
    await set(`project_${store.projectId}`, JSON.stringify(sanitized));
  }
}

export async function getProjectIndex(): Promise<ProjectMeta[]> {
  const allKeys = await keys();
  const metaKeys = allKeys.filter(k => typeof k === 'string' && k.startsWith("meta_"));
  const metas: ProjectMeta[] = [];
  for (const k of metaKeys) {
    const meta = await get(k as string);
    if (meta) metas.push(meta);
  }
  return metas.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function switchProject(projectId: string) {
  await saveCurrentProject();
  const json = await get(`project_${projectId}`);
  if (json) {
    const parsed = JSON.parse(json as string);
    const merged = {
      ...parsed,
      state: mergeProjectSnapshotWithGlobalConfig(parsed.state || {}, useAppStore.getState()),
    };
    const mergedJson = JSON.stringify(merged);
    await set("batch-refiner-idb", mergedJson);
    // Reload state from new json
    if (merged.state) {
        useAppStore.setState({ ...merged.state });
    }
  }
}

export async function createNewProject() {
  await saveCurrentProject();
  useAppStore.getState().clearProject();
  const newId = useAppStore.getState().projectId;
  await saveCurrentProject();
}

export async function deleteProject(projectId: string) {
  await del(`meta_${projectId}`);
  await del(`project_${projectId}`);
}
