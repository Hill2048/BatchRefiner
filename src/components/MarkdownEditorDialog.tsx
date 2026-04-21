import * as React from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";
import { saveMarkdownAsFile } from "@/lib/markdownFileSave";

interface MarkdownEditorDialogProps {
  open: boolean;
  fileName: string;
  value: string;
  onOpenChange: (open: boolean) => void;
  onSave: (value: string) => void;
}

const DEFAULT_WIDTH = 960;
const MIN_WIDTH = 960;
const MAX_WIDTH = 1680;

function clampWidth(width: number) {
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, width));
}

export function MarkdownEditorDialog({
  open,
  fileName,
  value,
  onOpenChange,
  onSave,
}: MarkdownEditorDialogProps) {
  const [draft, setDraft] = React.useState(value);
  const [dialogWidth, setDialogWidth] = React.useState(DEFAULT_WIDTH);
  const resizeStateRef = React.useRef<{ startX: number; startWidth: number } | null>(null);

  React.useEffect(() => {
    if (open) setDraft(value);
  }, [open, value]);

  React.useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const resizeState = resizeStateRef.current;
      if (!resizeState) return;

      const deltaX = event.clientX - resizeState.startX;
      setDialogWidth(clampWidth(resizeState.startWidth + deltaX));
    };

    const handlePointerUp = () => {
      resizeStateRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, []);

  const isDirty = draft !== value;
  const resolvedFileName = fileName?.trim() || "提示词优化.md";

  const requestClose = React.useCallback(() => {
    if (isDirty && !window.confirm("当前修改还没有保存，确定关闭吗？")) return;
    onOpenChange(false);
  }, [isDirty, onOpenChange]);

  const handleSave = React.useCallback(() => {
    onSave(draft);
    onOpenChange(false);
  }, [draft, onOpenChange, onSave]);

  const handleExport = React.useCallback(async () => {
    try {
      await saveMarkdownAsFile(draft, resolvedFileName);
      toast.success("已另存为本地 Markdown 文件");
    } catch (error: any) {
      if (error?.name === "AbortError") return;
      toast.error(error?.message || "另存为失败");
    }
  }, [draft, resolvedFileName]);

  const handleResizeStart = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (window.innerWidth < 640) return;

      resizeStateRef.current = {
        startX: event.clientX,
        startWidth: dialogWidth,
      };

      document.body.style.cursor = "ew-resize";
      document.body.style.userSelect = "none";
    },
    [dialogWidth],
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) {
          onOpenChange(true);
          return;
        }
        requestClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="rounded-[28px] border-border/50 bg-[#F9F8F6] p-0 shadow-[0_24px_80px_-24px_rgba(0,0,0,0.35)]"
        style={{
          width: `min(calc(100vw - 48px), ${dialogWidth}px)`,
          maxWidth: `min(calc(100vw - 48px), ${dialogWidth}px)`,
        }}
      >
        <div className="relative flex h-[84vh] flex-col overflow-hidden rounded-[28px]">
          <div
            className="absolute right-0 top-0 hidden h-full w-4 cursor-ew-resize sm:block"
            onPointerDown={handleResizeStart}
            title="拖动调整宽度"
          >
            <div className="absolute right-1 top-1/2 h-16 w-1 -translate-y-1/2 rounded-full bg-black/8" />
          </div>

          <DialogHeader className="gap-3 border-b border-border/70 px-6 py-5">
            <div className="flex items-start justify-between gap-4 pr-6 sm:pr-8">
              <div className="min-w-0">
                <DialogTitle className="truncate font-serif text-[22px] tracking-tight text-text-primary">
                  {resolvedFileName}
                </DialogTitle>
                <DialogDescription className="mt-1 text-[13px] text-text-secondary">
                  这里直接编辑完整 Markdown 内容，保存后会同步更新到提示词 Skills。
                </DialogDescription>
              </div>
              <Button variant="ghost" size="sm" className="rounded-xl px-3" onClick={requestClose}>
                关闭
              </Button>
            </div>
          </DialogHeader>

          <div className="flex-1 bg-[#F5F4F0] px-6 py-5">
            <Textarea
              autoFocus
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="请输入 Markdown 内容"
              className="h-full min-h-full resize-none rounded-[24px] border border-border/80 bg-white p-5 font-mono text-[14px] leading-7 text-foreground shadow-none focus-visible:ring-1 focus-visible:ring-button-main"
            />
          </div>

          <div className="flex items-center justify-between border-t border-border/70 bg-[#F9F8F6] px-6 py-4">
            <div className="flex items-center gap-4 text-[12px] text-text-secondary">
              <span>{isDirty ? "有未保存修改" : "内容已同步"}</span>
              <span className="hidden sm:inline">右侧拖动可调宽窄</span>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" className="rounded-xl bg-white" onClick={handleExport}>
                另存为 .md
              </Button>
              <Button variant="ghost" className="rounded-xl" onClick={requestClose}>
                取消
              </Button>
              <Button className="rounded-xl bg-button-main text-white hover:bg-[#333230]" onClick={handleSave}>
                保存
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
