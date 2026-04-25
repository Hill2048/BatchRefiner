import { v4 as uuidv4 } from 'uuid';
import { useAppStore } from '@/store';
import type {
  GenerationLogEvent,
  GenerationLogLevel,
  GenerationLogMode,
  GenerationLogSession,
  GenerationLogStage,
  GenerationLogStatus,
  Task,
  TaskResultImage,
} from '@/types';

const MAX_GENERATION_LOG_SESSIONS = 500;
const MAX_STRING_LOG_LENGTH = 500;
const REDACT_KEYS = ['apiKey', 'authorization', 'token', 'secret', 'signature', 'sig', 'password'];

function truncateString(value: string, maxLength = MAX_STRING_LOG_LENGTH) {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}...`;
}

function summarizeImageString(value: string) {
  if (value.startsWith('data:image/')) {
    const mimeMatch = value.match(/^data:(image\/[^;]+);base64,/i);
    const prefix = value.slice(0, Math.min(48, value.length));
    return {
      kind: 'data_url',
      mime: mimeMatch?.[1] || 'image/unknown',
      length: value.length,
      prefix,
    };
  }

  return truncateString(value);
}

export function sanitizeLogData(value: unknown): unknown {
  if (value == null) return value;

  if (typeof value === 'string') {
    if (value.startsWith('data:image/')) return summarizeImageString(value);
    if (value.length > MAX_STRING_LOG_LENGTH) return truncateString(value);
    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') return value;

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeLogData(item));
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack ? truncateString(value.stack, 1200) : undefined,
      stage: (value as { stage?: string }).stage,
    };
  }

  if (typeof value === 'object') {
    const next: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (REDACT_KEYS.some((redactKey) => key.toLowerCase().includes(redactKey.toLowerCase()))) {
        next[key] = '[REDACTED]';
        continue;
      }
      next[key] = sanitizeLogData(item);
    }
    return next;
  }

  return String(value);
}

function trimSessions(sessions: GenerationLogSession[]) {
  if (sessions.length <= MAX_GENERATION_LOG_SESSIONS) return sessions;
  return sessions.slice(sessions.length - MAX_GENERATION_LOG_SESSIONS);
}

export function createGenerationLogSession(options: {
  mode: GenerationLogMode;
  task?: Pick<Task, 'id' | 'index' | 'title'> | null;
  triggerId?: string;
  summary?: GenerationLogSession['summary'];
}) {
  const session: GenerationLogSession = {
    id: uuidv4(),
    triggerId: options.triggerId,
    createdAt: Date.now(),
    taskId: options.task?.id,
    taskIndex: options.task?.index,
    taskTitle: options.task?.title,
    mode: options.mode,
    status: 'running',
    attemptCount: 0,
    summary: options.summary,
    events: [],
  };

  useAppStore.setState((state) => ({
    generationLogs: trimSessions([...state.generationLogs, session]),
    updatedAt: Date.now(),
  }));

  return session.id;
}

export function appendGenerationLogEvent(
  sessionId: string,
  entry: {
    level?: GenerationLogLevel;
    stage: GenerationLogStage;
    event: string;
    message: string;
    data?: Record<string, unknown>;
    incrementAttempt?: boolean;
  },
) {
  useAppStore.setState((state) => ({
    generationLogs: state.generationLogs.map((session) => {
      if (session.id !== sessionId) return session;
      const event: GenerationLogEvent = {
        id: uuidv4(),
        time: Date.now(),
        level: entry.level || 'info',
        stage: entry.stage,
        event: entry.event,
        message: entry.message,
        data: entry.data ? (sanitizeLogData(entry.data) as Record<string, unknown>) : undefined,
      };
      return {
        ...session,
        attemptCount: session.attemptCount + (entry.incrementAttempt ? 1 : 0),
        summary: {
          ...session.summary,
          lastStage: entry.stage,
        },
        events: [...session.events, event],
      };
    }),
    updatedAt: Date.now(),
  }));
}

export function updateGenerationLogSummary(sessionId: string, summary: Partial<GenerationLogSession['summary']>) {
  useAppStore.setState((state) => ({
    generationLogs: state.generationLogs.map((session) =>
      session.id === sessionId
        ? {
            ...session,
            summary: {
              ...session.summary,
              ...(sanitizeLogData(summary) as Record<string, unknown>),
            },
          }
        : session,
    ),
    updatedAt: Date.now(),
  }));
}

export function finishGenerationLogSession(
  sessionId: string,
  status: GenerationLogStatus,
  summary?: Partial<GenerationLogSession['summary']>,
) {
  useAppStore.setState((state) => ({
    generationLogs: state.generationLogs.map((session) =>
      session.id === sessionId
        ? {
            ...session,
            status,
            finishedAt: Date.now(),
            summary: {
              ...session.summary,
              ...(summary ? (sanitizeLogData(summary) as Record<string, unknown>) : {}),
            },
          }
        : session,
    ),
    updatedAt: Date.now(),
  }));
}

export function clearGenerationLogs() {
  useAppStore.setState(() => ({
    generationLogs: [],
    updatedAt: Date.now(),
  }));
}

export function getGenerationLogSessionsForTask(taskId: string) {
  return useAppStore
    .getState()
    .generationLogs
    .filter((session) => session.taskId === taskId)
    .sort((left, right) => right.createdAt - left.createdAt);
}

export function getLatestGenerationLogSessionForTask(taskId: string) {
  return getGenerationLogSessionsForTask(taskId)[0] || null;
}

export function getGenerationLogSession(sessionId: string) {
  return useAppStore.getState().generationLogs.find((session) => session.id === sessionId) || null;
}

export function getAllGenerationLogSessions() {
  return [...useAppStore.getState().generationLogs].sort((left, right) => right.createdAt - left.createdAt);
}

export function buildGenerationLogExportPayload(sessionId?: string) {
  const sessions = sessionId ? [getGenerationLogSession(sessionId)].filter(Boolean) : getAllGenerationLogSessions();
  return {
    exportedAt: Date.now(),
    sessionCount: sessions.length,
    sessions,
  };
}

export function buildGenerationTaskSnapshot(task: Task, extra?: Record<string, unknown>) {
  return sanitizeLogData({
    taskId: task.id,
    taskIndex: task.index,
    taskTitle: task.title,
    status: task.status,
    aspectRatio: task.aspectRatio,
    resolution: task.resolution,
    imageQuality: task.imageQuality,
    batchCount: task.batchCount,
    promptSource: task.promptSource,
    hasSourceImage: Boolean(task.sourceImage),
    referenceImageCount: task.referenceImages?.length || 0,
    promptTextExists: Boolean(task.promptText?.trim()),
    promptTextLength: task.promptText?.length || 0,
    descriptionLength: task.description?.length || 0,
    ...extra,
  }) as Record<string, unknown>;
}

export function buildImageResultSummary(images: TaskResultImage[]) {
  return images.map((image) => ({
    id: image.id,
    sourceType: image.sourceType,
    width: image.assetWidth || image.width,
    height: image.assetHeight || image.height,
    generationTimeMs: image.generationTimeMs,
    sessionId: image.sessionId,
  }));
}
