import * as React from 'react';
import { cn } from '@/lib/utils';

type DotMatrixPulseProps = React.HTMLAttributes<HTMLDivElement> & {
  animated?: boolean;
  gridSizePercent?: number;
  insetPercent?: number;
};

export function DotMatrixPulse({
  className,
  animated = true,
  gridSizePercent = 12.5,
  insetPercent = 12,
  style,
  ...props
}: DotMatrixPulseProps) {
  return (
    <div
      aria-hidden="true"
      {...props}
      style={
        {
          '--dot-grid-size': `${gridSizePercent}%`,
          '--dot-matrix-inset': `${insetPercent}%`,
          ...style,
        } as React.CSSProperties
      }
      className={cn('loading-dot-matrix', !animated && 'loading-dot-matrix--static', className)}
    >
      <span className="loading-dot-matrix__base" />
      <span className="loading-dot-matrix__glow" />
      <span className="loading-dot-matrix__pulse" />
    </div>
  );
}
