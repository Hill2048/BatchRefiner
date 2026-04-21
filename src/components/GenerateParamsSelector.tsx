import * as React from "react";
import { Film, Image as ImgIcon, RectangleHorizontal, Square } from "lucide-react";
import { AspectRatio, Resolution } from "@/types";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";

interface GenerateParamsSelectorProps {
  resolution?: Resolution;
  aspectRatio?: AspectRatio;
  imageModel?: string;
  onResolutionChange: (res: Resolution) => void;
  onAspectRatioChange: (ar: AspectRatio) => void;
  triggerClassName?: string;
}

const GEMINI_RESOLUTIONS: Array<{ value: Resolution; label: string }> = [
  { value: "1K", label: "1K" },
  { value: "2K", label: "2K" },
  { value: "4K", label: "4K" },
];

const GPT_RESOLUTIONS: Array<{ value: Resolution; label: string }> = [
  { value: "1K", label: "1K" },
  { value: "2K", label: "2K" },
  { value: "4K", label: "4K 实验" },
];

const GEMINI_ASPECT_RATIOS: AspectRatio[] = [
  "auto", "1:1", "9:16", "16:9", "3:4", "4:3",
  "3:2", "2:3", "4:5", "5:4", "8:1", "1:8", "4:1", "1:4", "21:9"
];

const GPT_ASPECT_RATIOS: AspectRatio[] = [
  "auto", "1:1", "2:3", "3:2", "9:16", "16:9"
];

function getModelFamily(model?: string) {
  const normalized = (model || "").trim().toLowerCase();
  if (normalized.startsWith("gpt-image") || normalized === "image2") return "gpt";
  return "gemini";
}

function isCustomResolutionValue(value?: string) {
  return /^\d+x\d+$/i.test((value || "").trim());
}

function parseCustomResolution(value?: string) {
  if (!isCustomResolutionValue(value)) return null;
  const [widthText, heightText] = String(value).toLowerCase().split("x");
  const width = Number(widthText);
  const height = Number(heightText);
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  return { width, height };
}

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) {
    const next = x % y;
    x = y;
    y = next;
  }
  return x || 1;
}

function reduceAspectRatio(width: number, height: number) {
  const divisor = gcd(width, height);
  return `${width / divisor}:${height / divisor}`;
}

function snapToNearestMultipleOf16(value: number) {
  return Math.max(16, Math.round(value / 16) * 16);
}

function validateGptCustomSize(width: number, height: number) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    return "宽和高必须是正整数";
  }
  const normalizedWidth = snapToNearestMultipleOf16(width);
  const normalizedHeight = snapToNearestMultipleOf16(height);

  if (normalizedWidth > 4000 || normalizedHeight > 4000) {
    return "任意一边都不能超过 4000px";
  }
  const ratio = Math.max(normalizedWidth / normalizedHeight, normalizedHeight / normalizedWidth);
  if (ratio > 3) {
    return "宽高比例不能超过 3:1";
  }
  const pixels = normalizedWidth * normalizedHeight;
  if (pixels < 655_360) {
    return "总像素不能低于 655,360";
  }
  if (pixels > 8_294_400) {
    return "总像素不能超过 8,294,400";
  }
  return "";
}

function renderRatioIcon(ar: AspectRatio) {
  if (ar === "auto") return <div className="h-4 w-5 rounded-sm border border-dashed border-current opacity-60" />;
  if (ar === "1:1") return <Square className="h-4 w-4 opacity-70" />;

  const parts = ar.split(":");
  if (parts.length === 2) {
    const width = parseInt(parts[0], 10);
    const height = parseInt(parts[1], 10);
    if (!Number.isNaN(width) && !Number.isNaN(height)) {
      if (width > height) {
        if (width / height >= 2) return <Film className="h-4 w-4 opacity-70" />;
        return <RectangleHorizontal className="h-4 w-4 opacity-70" />;
      }
      return <RectangleHorizontal className="h-4 w-4 rotate-90 opacity-70" />;
    }
  }

  return <ImgIcon className="h-4 w-4 opacity-70" />;
}

function getRatioLabel(ar: AspectRatio) {
  if (ar === "auto") return "自动";
  return ar;
}

export function GenerateParamsSelector({
  resolution = "1K",
  aspectRatio = "auto",
  imageModel,
  onResolutionChange,
  onAspectRatioChange,
  triggerClassName = "",
}: GenerateParamsSelectorProps) {
  const family = getModelFamily(imageModel);
  const resolutions = family === "gpt" ? GPT_RESOLUTIONS : GEMINI_RESOLUTIONS;
  const aspectRatios = family === "gpt" ? GPT_ASPECT_RATIOS : GEMINI_ASPECT_RATIOS;
  const customSize = parseCustomResolution(resolution);
  const [customWidth, setCustomWidth] = React.useState(customSize ? String(customSize.width) : "");
  const [customHeight, setCustomHeight] = React.useState(customSize ? String(customSize.height) : "");

  React.useEffect(() => {
    const next = parseCustomResolution(resolution);
    setCustomWidth(next ? String(next.width) : "");
    setCustomHeight(next ? String(next.height) : "");
  }, [resolution]);

  const currentResolutionLabel = customSize
    ? `${customSize.width}x${customSize.height}`
    : resolutions.find((item) => item.value === resolution)?.label || resolution;

  const customValidationMessage =
    family === "gpt" && customWidth && customHeight
      ? validateGptCustomSize(Number(customWidth), Number(customHeight))
      : "";

  const applyCustomSize = () => {
    const width = snapToNearestMultipleOf16(Number(customWidth));
    const height = snapToNearestMultipleOf16(Number(customHeight));
    const validationMessage = validateGptCustomSize(Number(customWidth), Number(customHeight));
    if (validationMessage) return;

    setCustomWidth(String(width));
    setCustomHeight(String(height));
    onResolutionChange(`${width}x${height}`);
    onAspectRatioChange(reduceAspectRatio(width, height));
  };

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            className={`h-8 border-border/80 bg-card text-[12.6px] font-mono text-text-primary hover:bg-black/5 ${triggerClassName}`}
          >
            {aspectRatio === "auto" ? "" : <RectangleHorizontal className="mr-1.5 h-3.5 w-3.5 opacity-70" />}
            {aspectRatio === "auto" ? "自动" : aspectRatio} / {currentResolutionLabel}
          </Button>
        }
      />
      <PopoverContent className="w-[min(360px,calc(100vw-2rem))] rounded-2xl border-border bg-card p-4 shadow-lg" align="start">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <span className="text-[12.6px] font-medium text-text-secondary">分辨率</span>
            <div className="flex gap-2">
              {resolutions.map((item) => (
                <button
                  key={item.value}
                  onClick={() => onResolutionChange(item.value)}
                  className={`flex-1 rounded-lg border py-1.5 text-[12.6px] font-mono transition-colors
                    ${resolution === item.value
                      ? "border-button-main bg-button-main font-medium text-[#FFFFFF] shadow-md"
                      : "border-border/60 bg-transparent text-text-secondary hover:border-button-main/50 hover:bg-black/5"}`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-[12.6px] font-medium text-text-secondary">比例</span>
            <div className="grid grid-cols-5 gap-2">
              {aspectRatios.map((ar) => (
                <button
                  key={ar}
                  onClick={() => onAspectRatioChange(ar)}
                  className={`flex flex-col items-center justify-center gap-1.5 rounded-xl border py-2 transition-all
                    ${aspectRatio === ar
                      ? "border-button-main bg-button-main/[0.03] text-[#D97757] shadow-[0_0_0_1px_rgba(217,119,87,0.2)]"
                      : "border-border/40 bg-transparent text-text-primary hover:border-border hover:bg-black/5"}`}
                >
                  <div className="flex h-5 w-5 items-center justify-center">
                    {renderRatioIcon(ar)}
                  </div>
                  <span className={`text-[11.55px] ${aspectRatio === ar ? "font-medium" : "font-mono opacity-80"}`}>
                    {getRatioLabel(ar)}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {family === "gpt" ? (
            <div className="flex flex-col gap-2 rounded-xl border border-border/60 bg-white/70 p-3">
              <span className="text-[12.6px] font-medium text-text-secondary">自定义宽高</span>
              <div className="grid grid-cols-[1fr_auto_1fr_auto] items-center gap-2">
                <Input
                  value={customWidth}
                  onChange={(e) => setCustomWidth(e.target.value.replace(/[^\d]/g, ""))}
                  placeholder="宽"
                  name="image2-custom-width"
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  inputMode="numeric"
                  className="h-8 rounded-lg text-[12.6px]"
                />
                <span className="text-[12px] text-text-secondary">x</span>
                <Input
                  value={customHeight}
                  onChange={(e) => setCustomHeight(e.target.value.replace(/[^\d]/g, ""))}
                  placeholder="高"
                  name="image2-custom-height"
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  inputMode="numeric"
                  className="h-8 rounded-lg text-[12.6px]"
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={applyCustomSize}
                  disabled={!customWidth || !customHeight || Boolean(customValidationMessage)}
                  className="h-8 rounded-lg px-3 text-[12px]"
                >
                  应用
                </Button>
              </div>
              {customValidationMessage ? <p className="text-[11px] leading-5 text-red-600">{customValidationMessage}</p> : null}
            </div>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}
