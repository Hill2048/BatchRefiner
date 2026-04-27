import type { Task } from '@/types';

export const MAX_PERSISTED_STATE_LENGTH = 12 * 1024 * 1024;
export const OVERSIZED_PERSISTENCE_NOTICE =
  '检测到上次保存的项目过大，已自动清理图片数据以避免页面闪退。任务文字仍会保留。';

type PersistedStateShape = {
  tasks?: Task[];
  globalReferenceImages?: string[];
};

type PersistEnvelope = {
  state?: PersistedStateShape;
  version?: number;
};

type PersistCompactionResult = {
  value: string;
  compacted: boolean;
};

function stripTaskBinaryPayload(task: Task): Task {
  return {
    ...task,
    sourceImage: undefined,
    referenceImages: [],
    resultImage: undefined,
    resultImagePreview: undefined,
    resultImageOriginal: undefined,
    resultImageSourceType: undefined,
    resultImageWidth: undefined,
    resultImageHeight: undefined,
    resultImages: [],
    activeResultSessionId: undefined,
  };
}

function compactState(state: PersistedStateShape): PersistedStateShape {
  return {
    ...state,
    globalReferenceImages: [],
    tasks: Array.isArray(state.tasks) ? state.tasks.map(stripTaskBinaryPayload) : state.tasks,
  };
}

export function compactPersistedStateValue(
  rawValue: string,
  maxLength = MAX_PERSISTED_STATE_LENGTH,
): PersistCompactionResult {
  if (rawValue.length <= maxLength) {
    return { value: rawValue, compacted: false };
  }

  try {
    const parsed = JSON.parse(rawValue) as PersistEnvelope | PersistedStateShape;
    const hasEnvelope = typeof parsed === 'object' && parsed !== null && 'state' in parsed;
    const currentState = (hasEnvelope ? (parsed as PersistEnvelope).state : parsed) as PersistedStateShape | undefined;

    if (!currentState || typeof currentState !== 'object') {
      return { value: rawValue, compacted: false };
    }

    const compactedState = compactState(currentState);
    const nextValue = hasEnvelope
      ? JSON.stringify({ ...(parsed as PersistEnvelope), state: compactedState })
      : JSON.stringify(compactedState);

    if (nextValue.length >= rawValue.length) {
      return { value: rawValue, compacted: false };
    }

    return { value: nextValue, compacted: true };
  } catch {
    return { value: rawValue, compacted: false };
  }
}
