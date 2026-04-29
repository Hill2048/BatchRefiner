import * as React from 'react';
import { cn } from '@/lib/utils';

type AnalyzingImageProps = React.HTMLAttributes<HTMLDivElement>;

export function AnalyzingImage({ className, ...props }: AnalyzingImageProps) {
  return (
    <div
      aria-label="正在分析图片"
      role="status"
      {...props}
      className={cn(
        'loading-analyzing-image relative inline-flex aspect-square items-center justify-center overflow-hidden text-current',
        className,
      )}
    >
      <svg
        aria-hidden="true"
        className="h-full w-full"
        viewBox="0 0 64 64"
        fill="none"
      >
        <rect x="10" y="12" width="44" height="40" rx="8" stroke="currentColor" strokeWidth="3" />
        <circle cx="25" cy="27" r="4.5" fill="currentColor" opacity="0.32" />
        <path
          d="M17 46l10.8-11.2a4 4 0 015.8 0L39 40.2l4.2-4.3a4 4 0 015.8.1L54 41.5"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="3"
        />
      </svg>
      <span aria-hidden="true" className="loading-analyzing-image__scan" />
    </div>
  );
}
