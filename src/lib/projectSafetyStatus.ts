const PROJECT_SAFETY_STATUS_KEY = 'batch-refiner-project-safety-status';
const PROJECT_SAFETY_STATUS_EVENT = 'batch-refiner:project-safety-status-changed';

export interface ProjectSafetyRecord {
  savedUpdatedAt?: number;
  cachedUpdatedAt?: number;
}

type ProjectSafetyStatusMap = Record<string, ProjectSafetyRecord>;

function readProjectSafetyStatus(): ProjectSafetyStatusMap {
  if (typeof window === 'undefined') return {};

  try {
    const raw = window.localStorage.getItem(PROJECT_SAFETY_STATUS_KEY);
    return raw ? (JSON.parse(raw) as ProjectSafetyStatusMap) : {};
  } catch {
    return {};
  }
}

function writeProjectSafetyStatus(status: ProjectSafetyStatusMap) {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(PROJECT_SAFETY_STATUS_KEY, JSON.stringify(status));
    window.dispatchEvent(new Event(PROJECT_SAFETY_STATUS_EVENT));
  } catch {
    // If metadata cannot be stored, the refresh guard remains conservative.
  }
}

function markProjectSafety(projectId: string, field: keyof ProjectSafetyRecord, updatedAt: number) {
  if (!projectId) return;

  const status = readProjectSafetyStatus();
  const current = status[projectId] || {};
  status[projectId] = {
    ...current,
    [field]: Math.max(current[field] || 0, updatedAt || Date.now()),
  };
  writeProjectSafetyStatus(status);
}

export function markProjectFileSaved(projectId: string, updatedAt: number) {
  markProjectSafety(projectId, 'savedUpdatedAt', updatedAt);
}

export function markProjectCacheSaved(projectId: string, updatedAt: number) {
  markProjectSafety(projectId, 'cachedUpdatedAt', updatedAt);
}

export function getProjectSafetyStatus(projectId: string): ProjectSafetyRecord {
  return readProjectSafetyStatus()[projectId] || {};
}

export function isProjectExternallySafe(projectId: string, updatedAt: number) {
  const status = getProjectSafetyStatus(projectId);
  return Boolean(
    (status.savedUpdatedAt && status.savedUpdatedAt >= updatedAt) ||
      (status.cachedUpdatedAt && status.cachedUpdatedAt >= updatedAt),
  );
}

export function subscribeProjectSafetyStatus(listener: () => void) {
  if (typeof window === 'undefined') return () => {};

  window.addEventListener(PROJECT_SAFETY_STATUS_EVENT, listener);
  window.addEventListener('storage', listener);
  return () => {
    window.removeEventListener(PROJECT_SAFETY_STATUS_EVENT, listener);
    window.removeEventListener('storage', listener);
  };
}
