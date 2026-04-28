import * as React from "react";
import { Film, Image as ImgIcon, RectangleHorizontal, Square } from "lucide-react";
import { AspectRatio, BatchCount, ImageQuality, Resolution } from "@/types";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { BATCH_COUNT_OPTIONS } from "@/lib/taskResults";

interface GenerateParamsSelectorProps {
  resolution?: Resolution;
  aspectRatio?: AspectRatio;
  batchCount?: BatchCount;
  imageQuality?: ImageQuality;
  imageModel?: string;
  onResolutionChange: (res: Resolution) => void;
  onAspectRatioChange: (ar: AspectRatio) => void;
  onBatchCountChange?: (count: BatchCount) => void;
  onImageQualityChange?: (quality: ImageQuality) => void;
  allowBatchInherit?: boolean;
  onClearBatchCount?: () => void;
  inheritedBatchLabel?: string;
  triggerClassName?: string;
}

const GEMINI_RESOLUTIONS: Array<{ value: Resolution; label: string }> = [
  { value: "1K", label: "1K" },
  { value: "2K", label: "2K" },
  { value: "4K", label: "4K" },
];

const GPT_RESOLUTIONS: Array<{ value: Resolution; label: string }> = [
  { value: "1K", label: "高清 1K" },
  { value: "2K", label: "高清 2K" },
  { value: "4K", label: "超清 4K" },
];

const GEMINI_ASPECT_RATIOS: AspectRatio[] = [
  "auto", "1:1", "9:16", "16:9", "3:4", "4:3",
  "3:2", "2:3", "4:5", "5:4", "8:1", "1:8", "4:1", "1:4", "21:9",
];

const GPT_ASPECT_RATIOS: AspectRatio[] = [
  "auto", "21:9", "16:9", "3:2", "4:3", "1:1", "3:4", "2:3", "9:16", "5:4", "4:5", "9:21",
];

const GPT_IMAGE_QUALITIES: Array<{ value: ImageQuality; label: string }> = [
  { value: "auto", label: "自动" },
  { value: "low", label: "低" },
  { value: "medium", label: "中" },
  { value: "high", label: "高" },
];

const QUALITY_LABELS: Record<ImageQuality, string> = {
  auto: "自动",
  low: "低",
  medium: "中",
  high: "高",
};

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

  if (normalizedWidth > 3840 || normalizedHeight > 3840) {
    return "任意一边都不能超过 3840px";
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
  if (ar === "auto") return <div className="h-4 w-4 rounded-sm border border-dashed border-current opacity-70" />;
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
  if (ar === "auto") return "智能";
  return ar;
}

export function GenerateParamsSelector({
  resolution = "1K",
  aspectRatio = "auto",
  batchCount = "x1",
  imageQuality = "auto",
  imageModel,
  onResolutionChange,
  onAspectRatioChange,
  onBatchCountChange,
  onImageQualityChange,
  allowBatchInherit = false,
  onClearBatchCount,
  inheritedBatchLabel = "跟随全局",
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
    const validationMessage = validateGptCustomSize(Number(customWidth), Number(customHeight));
    if (validationMessage) return;

    const width = snapToNearestMultipleOf16(Number(customWidth));
    const height = snapToNearestMultipleOf16(Number(customHeight));

    setCustomWidth(String(width));
    setCustomHeight(String(height));
    onResolutionChange(`${width}x${height}`);
    onAspectRatioChange(reduceAspectRatio(width, height));
  };

  const triggerParts = [
    aspectRatio === "auto" ? "自动" : String(aspectRatio),
    currentResolutionLabel,
    family === "gpt" && onImageQualityChange ? QUALITY_LABELS[imageQuality] : null,
    allowBatchInherit && !batchCount ? "全局" : batchCount,
  ].filter(Boolean);

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
            {triggerParts.join(" / ")}
          </Button>
        }
      />
      <PopoverContent
        className="w-[min(460px,calc(100vw-2rem))] rounded-[22px] border border-white/70 bg-white/92 p-4 shadow-[0_18px_55px_rgba(23,18,14,0.12)] backdrop-blur-xl"
        align="start"
      >
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-3">
            <span className="text-[12.6px] font-medium text-text-secondary">选择比例</span>
            <div className="grid grid-cols-5 overflow-hidden rounded-xl bg-[#F7F5F1] p-1 sm:grid-cols-9">
              {aspectRatios.map((ar) => (
                <button
                  key={ar}
                  onClick={() => onAspectRatioChange(ar)}
                  className={`flex min-h-[56px] flex-col items-center justify-center gap-1.5 rounded-lg border border-transparent px-1.5 py-2 transition-all ${
                    aspectRatio === ar
                      ? "bg-white text-text-primary shadow-[0_6px_18px_rgba(23,18,14,0.08)]"
                      : "text-text-primary hover:bg-white/62"
                  }`}
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

          <div className="flex flex-col gap-3">
            <span className="text-[12.6px] font-medium text-text-secondary">选择分辨率</span>
            <div className="grid grid-cols-2 overflow-hidden rounded-xl bg-[#F7F5F1] p-1">
              {resolutions.map((item) => (
                <button
                  key={item.value}
                  onClick={() => onResolutionChange(item.value)}
                  className={`rounded-lg py-2.5 text-[12.6px] transition-colors ${
                    resolution === item.value
                      ? "bg-white font-medium text-[#2C2B29] shadow-[0_6px_18px_rgba(23,18,14,0.07)]"
                      : "font-medium text-text-secondary hover:bg-white/62 hover:text-text-primary"
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          {family === "gpt" ? (
            <div className="flex flex-col gap-3">
              <span className="text-[12.6px] font-medium text-text-secondary">尺寸</span>
              <div className="grid grid-cols-[1fr_auto_1fr_auto] items-center gap-3">
                <Input
                  value={customWidth}
                  onChange={(e) => setCustomWidth(e.target.value.replace(/[^\d]/g, ""))}
                  placeholder="W"
                  name="image2-custom-width"
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  inputMode="numeric"
                  className="h-10 rounded-lg border-transparent bg-[#F7F5F1] text-center text-[12.6px] text-text-primary shadow-none placeholder:text-text-secondary/42 focus-visible:ring-1 focus-visible:ring-button-main"
                />
                <span className="text-[12px] text-text-secondary">↔</span>
                <Input
                  value={customHeight}
                  onChange={(e) => setCustomHeight(e.target.value.replace(/[^\d]/g, ""))}
                  placeholder="H"
                  name="image2-custom-height"
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  inputMode="numeric"
                  className="h-10 rounded-lg border-transparent bg-[#F7F5F1] text-center text-[12.6px] text-text-primary shadow-none placeholder:text-text-secondary/42 focus-visible:ring-1 focus-visible:ring-button-main"
                />
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={applyCustomSize}
                  disabled={!customWidth || !customHeight || Boolean(customValidationMessage)}
                  className="h-10 rounded-lg px-3 text-[12px] font-medium text-text-secondary hover:bg-[#F7F5F1] disabled:opacity-45"
                >
                  PX
                </Button>
              </div>
              {customValidationMessage ? <p className="text-[11px] leading-5 text-red-600">{customValidationMessage}</p> : null}
            </div>
          ) : null}

          {family === "gpt" && onImageQualityChange ? (
            <div className="flex flex-col gap-3">
              <span className="text-[12.6px] font-medium text-text-secondary">质量</span>
              <div className="grid grid-cols-4 overflow-hidden rounded-xl bg-[#F7F5F1] p-1">
                {GPT_IMAGE_QUALITIES.map((item) => (
                  <button
                    key={item.value}
                    onClick={() => onImageQualityChange(item.value)}
                    className={`rounded-lg py-2 text-[12.6px] transition-colors ${
                      imageQuality === item.value
                        ? "bg-white font-medium text-[#2C2B29] shadow-[0_6px_18px_rgba(23,18,14,0.07)]"
                        : "text-text-secondary hover:bg-white/62 hover:text-text-primary"
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {onBatchCountChange ? (
            <div className="flex flex-col gap-3">
              <span className="text-[12.6px] font-medium text-text-secondary">张数</span>
              <div className="flex flex-wrap gap-2">
                {allowBatchInherit ? (
                  <button
                    type="button"
                    onClick={onClearBatchCount}
                    className={`rounded-lg px-3 py-1.5 text-[12px] transition-colors ${
                      !batchCount
                        ? "bg-white text-text-primary shadow-[0_6px_18px_rgba(23,18,14,0.07)]"
                        : "bg-[#F7F5F1] text-text-secondary hover:bg-white"
                    }`}
                  >
                    {inheritedBatchLabel}
                  </button>
                ) : null}
                {BATCH_COUNT_OPTIONS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => onBatchCountChange(option)}
                    className={`rounded-lg px-3 py-1.5 text-[12px] font-mono transition-colors ${
                      batchCount === option
                        ? "bg-white text-text-primary shadow-[0_6px_18px_rgba(23,18,14,0.07)]"
                        : "bg-[#F7F5F1] text-text-secondary hover:bg-white"
                    }`}
                  >
                    {option}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}
