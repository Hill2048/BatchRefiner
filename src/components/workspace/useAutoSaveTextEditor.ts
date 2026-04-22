import * as React from 'react';

type UseAutoSaveTextEditorOptions = {
  value: string;
  onSave: (nextValue: string) => void;
};

export function useAutoSaveTextEditor({ value, onSave }: UseAutoSaveTextEditorOptions) {
  const [localValue, setLocalValue] = React.useState(value);
  const [isEditing, setIsEditing] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

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
    if (!isEditing) return;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (containerRef.current?.contains(target)) return;
      closeEditor(true);
    };

    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [closeEditor, isEditing]);

  React.useEffect(() => {
    if (!isEditing) return;

    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      const length = textareaRef.current?.value.length ?? 0;
      textareaRef.current?.setSelectionRange(length, length);
    });
  }, [isEditing]);

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
