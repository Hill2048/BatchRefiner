import * as React from "react";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { Button } from "./ui/button";
import { AspectRatio, Resolution } from "@/types";
import { RectangleHorizontal, StretchHorizontal, Square, Film, Image as ImgIcon, DiscAlbum } from "lucide-react";

interface GenerateParamsSelectorProps {
  resolution?: Resolution;
  aspectRatio?: AspectRatio;
  onResolutionChange: (res: Resolution) => void;
  onAspectRatioChange: (ar: AspectRatio) => void;
  triggerClassName?: string;
}

const RESOLUTIONS: Resolution[] = ['1K', '2K', '4K'];
const ASPECT_RATIOS: AspectRatio[] = [
  'auto', '1:1', '9:16', '16:9', '3:4', '4:3', 
  '3:2', '2:3', '4:5', '5:4', '8:1', '1:8', '4:1', '1:4', '21:9'
];

export function GenerateParamsSelector({
  resolution = '1K',
  aspectRatio = 'auto',
  onResolutionChange,
  onAspectRatioChange,
  triggerClassName = ""
}: GenerateParamsSelectorProps) {

  // Simple icon renderer based on ratio string
  const renderRatioIcon = (ar: AspectRatio) => {
    if (ar === 'auto') return <div className="w-5 h-4 border border-dashed border-current rounded-sm opacity-60" />;
    if (ar === '1:1') return <Square className="w-4 h-4 opacity-70" />;
    
    // Parse to determine generic landscape/portrait
    const parts = ar.split(':');
    if (parts.length === 2) {
      const w = parseInt(parts[0]);
      const h = parseInt(parts[1]);
      if (w > h) {
        if (w / h >= 2) return <Film className="w-4 h-4 opacity-70" />; // ultra wide
        return <RectangleHorizontal className="w-4 h-4 opacity-70" />;
      } else {
        return <RectangleHorizontal className="w-4 h-4 opacity-70 rotate-90" />;
      }
    }
    return <ImgIcon className="w-4 h-4 opacity-70" />;
  };

  const getLabel = (ar: AspectRatio) => {
    if (ar === 'auto') return '自动 (由模型决定)';
    return ar;
  };

  return (
    <Popover>
      <PopoverTrigger render={
        <Button 
          variant="outline" 
          size="sm" 
          className={`h-8 bg-card border-border/80 text-[12px] font-mono text-foreground hover:bg-black/5 ${triggerClassName}`}
        >
          {aspectRatio === 'auto' ? '' : <RectangleHorizontal className="w-3.5 h-3.5 mr-1.5 opacity-70" />}
          {aspectRatio === 'auto' ? '自动 (由模型决定)' : aspectRatio} · {resolution}
        </Button>
      } />
      <PopoverContent className="w-[340px] p-4 bg-card border-border shadow-lg rounded-2xl" align="start">
        <div className="flex flex-col gap-4">
          
          <div className="flex flex-col gap-2">
            <span className="text-[12px] font-medium text-muted-foreground">分辨率</span>
            <div className="flex gap-2">
              {RESOLUTIONS.map(res => (
                <button
                  key={res}
                  onClick={() => onResolutionChange(res)}
                  className={`flex-1 py-1.5 rounded-lg text-[12px] font-mono transition-colors border
                    ${resolution === res 
                      ? 'bg-primary text-white border-primary font-medium' 
                      : 'bg-transparent text-muted-foreground border-border/60 hover:border-primary/50 hover:bg-black/5'}`}
                >
                  {res}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-[12px] font-medium text-muted-foreground">比例</span>
            <div className="grid grid-cols-5 gap-2">
              {ASPECT_RATIOS.map(ar => (
                <button
                  key={ar}
                  onClick={() => onAspectRatioChange(ar)}
                  className={`flex flex-col items-center justify-center py-2 gap-1.5 rounded-xl border transition-all
                    ${aspectRatio === ar
                      ? 'bg-primary/[0.03] border-primary text-primary shadow-[0_0_0_1px_rgba(42,126,79,0.2)]'
                      : 'bg-transparent border-border/40 text-foreground hover:border-border hover:bg-black/5'}
                  `}
                >
                  <div className="flex items-center justify-center h-5 w-5">
                    {renderRatioIcon(ar)}
                  </div>
                  <span className={`text-[11px] ${aspectRatio === ar ? 'font-medium' : 'opacity-80 font-mono'}`}>
                    {getLabel(ar)}
                  </span>
                </button>
              ))}
            </div>
          </div>
          
        </div>
      </PopoverContent>
    </Popover>
  );
}
