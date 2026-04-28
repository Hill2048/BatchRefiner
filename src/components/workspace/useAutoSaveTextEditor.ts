import * as React from 'react';
import { useAppStore } from '@/store';

type UseAutoSaveTextEditorOptions = {
  value: string;
  onSave: (nextValue: string) => void;
  draftId?: string;
  enabled?: boolean;
};

export function useAutoSaveTextEditor({ value, onSave, draftId, enabled = true }: UseAutoSaveTextEditorOptions) {
  const [localValue, setLocalValue] = React.useState(value);
  const [isEditing, setIsEditing] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const registerDraftFlusher = useAppStore((state) => state.registerDraftFlusher);
  const unregisterDraftFlusher = useAppStore((state) => state.unregisterDraftFlusher);

  React.useEffect(() => {
    setLocalValue(value);
    setIsEditing(false);
  }, [value]);

  const saveIfChanged = React.useCallback(() => {
    if (localValue !== value) {
      onSave(localValue);
    }
  }, [localValue, onSave, value]);

  const closeEditor = React.useCallback(
    (shouldSave = true) => {
      if (shouldSave) {
        saveIfChanged();
      }
      setIsEditing(false);
    },
    [saveIfChanged],
  );

  const openEditor = React.useCallback(
    (event?: React.MouseEvent) => {
      event?.stopPropagation();
      event?.preventDefault();
      setIsEditing(true);
    },
    [],
  );

  React.useEffect(() => {
    if (!enabled || !isEditing) return;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (containerRef.current?.contains(target)) return;
      closeEditor(true);
    };

    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [closeEditor, enabled, isEditing]);

  React.useEffect(() => {
    if (!enabled || !isEditing) return;

    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      const length = textareaRef.current?.value.length ?? 0;
      textareaRef.current?.setSelectionRange(length, length);
    });
  }, [enabled, isEditing]);

  React.useEffect(() => {
    if (!enabled || !draftId) return;
    registerDraftFlusher(draftId, saveIfChanged);
    return () => unregisterDraftFlusher(draftId);
  }, [draftId, enabled, registerDraftFlusher, saveIfChanged, unregisterDraftFlusher]);

  React.useEffect(() => {
    if (enabled || !isEditing) return;
    closeEditor(true);
  }, [closeEditor, enabled, isEditing]);

  return {
    containerRef,
    textareaRef,
    localValue,
    setLocalValue,
    isEditing,
    openEditor,
    closeEditor,
    saveIfChanged,
  };
}
