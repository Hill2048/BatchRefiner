import { BatchCount } from '@/types';
import { BATCH_COUNT_OPTIONS } from '@/lib/taskResults';

interface BatchCountSelectorProps {
  value?: BatchCount;
  onChange: (value: BatchCount) => void;
  allowInherit?: boolean;
  inheritedLabel?: string;
  onClear?: () => void;
  className?: string;
}

export function BatchCountSelector({
  value,
  onChange,
  allowInherit = false,
  inheritedLabel = '跟随全局',
  onClear,
  className = '',
}: BatchCountSelectorProps) {
  return (
    <div className={`inline-flex items-center rounded-full border border-border/70 bg-white p-1 gap-1 ${className}`}>
      {allowInherit && (
        <button
          type="button"
          onClick={onClear}
          className={`rounded-full px-3 py-1 text-[11px] transition-colors ${
            !value ? 'bg-button-main text-white' : 'text-text-secondary hover:bg-black/5'
          }`}
        >
          {inheritedLabel}
        </button>
      )}
      {BATCH_COUNT_OPTIONS.map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => onChange(option)}
          className={`rounded-full px-3 py-1 text-[11px] transition-colors ${
            value === option
              ? 'bg-button-main text-white'
              : 'text-text-secondary hover:bg-black/5'
          }`}
        >
          {option}
        </button>
      ))}
    </div>
  );
}
