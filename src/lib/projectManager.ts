import { get, set, keys, del } from 'idb-keyval';
import { useAppStore } from '@/store';
import { v4 as uuidv4 } from 'uuid';

export interface ProjectMeta {
  projectId: string;
  projectName: string;
  updatedAt: number;
  taskCount: number;
}

const PROJECT_INDEX_KEY = 'batch-refiner-project-index';

export async function getProjectIndex(): Promise<ProjectMeta[]> {
  const index = await get(PROJECT_INDEX_KEY);
  return index || [];
}

export async function saveCurrentProject() {
  const state = useAppStore.getState();
  const currentProjectId = state.projectId;
  if (!currentProjectId) return;

  // Save full state to a specific key
  await set(`project_data_${currentProjectId}`, {
    projectId: state.projectId,
    projectName: state.projectName,
    globalSkillText: state.globalSkillText,
    globalTargetText: state.globalTargetText,
    globalReferenceImages: state.globalReferenceImages,
    globalAspectRatio: state.globalAspectRatio,
    globalResolution: state.globalResolution,
    skillFileName: state.skillFileName,
    imageModel: state.imageModel,
    textModel: state.textModel,
    tasks: state.tasks,
    createdAt: state.createdAt,
    updatedAt: state.updatedAt
  });

  // Update index
  let index = await getProjectIndex();
  const existing = index.findIndex(p => p.projectId === currentProjectId);
  const meta: ProjectMeta = {
    projectId: currentProjectId,
    projectName: state.projectName,
    updatedAt: Date.now(),
    taskCount: state.tasks.length
  };

  if (existing >= 0) {
    index[existing] = meta;
  } else {
    index.push(meta);
  }
  
  index.sort((a,b) => b.updatedAt - a.updatedAt);
  await set(PROJECT_INDEX_KEY, index);
}

export async function loadProject(projectId: string) {
  // First save current project to ensure no data loss
  await saveCurrentProject();

  const data = await get(`project_data_${projectId}`);
  if (data) {
    useAppStore.getState().setProjectFields({
       ...data,
       isBatchRunning: false,
       activeTaskId: null,
       lightboxTaskId: null,
       selectedTaskIds: []
    });
  }
}

export async function switchProject(projectId: string) {
   await loadProject(projectId);
}

export async function createNewProject() {
  await saveCurrentProject();
  useAppStore.getState().clearProject();
}

export async function deleteProject(projectId: string) {
  await del(`project_data_${projectId}`);
  let index = await getProjectIndex();
  index = index.filter(p => p.projectId !== projectId);
  await set(PROJECT_INDEX_KEY, index);

  // If we deleted the current project, create a new one
  if (useAppStore.getState().projectId === projectId) {
     useAppStore.getState().clearProject();
  }
}
