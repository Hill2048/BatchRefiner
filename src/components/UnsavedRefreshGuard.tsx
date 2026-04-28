import * as React from 'react';
import { toast } from 'sonner';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '@/store';
import { exportCurrentProjectFile } from '@/lib/projectFileActions';
import { isProjectExternallySafe, subscribeProjectSafetyStatus } from '@/lib/projectSafetyStatus';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog';

const REFRESH_WARNING = '当前项目还没有成功保存。继续刷新可能导致图片或项目内容丢失。';

function hasProjectContent(state: {
  tasksCount: number;
  globalTargetText: string;
  globalReferenceImages: string[];
}) {
  return (
    state.tasksCount > 0 ||
    Boolean(state.globalTargetText?.trim()) ||
    (state.globalReferenceImages?.length || 0) > 0
  );
}

function scheduleReload() {
  window.setTimeout(() => {
    window.location.reload();
  }, 150);
}

export function UnsavedRefreshGuard() {
  const projectState = useAppStore(
    useShallow((state) => ({
      projectId: state.projectId,
      updatedAt: state.updatedAt,
      tasksCount: state.tasksCount,
      globalTargetText: state.globalTargetText,
      globalReferenceImages: state.globalReferenceImages,
      flushDrafts: state.flushDrafts,
    })),
  );
  const [, setStatusVersion] = React.useState(0);
  const [open, setOpen] = React.useState(false);
  const [isSaving, setIsSaving] = React.useState(false);
  const bypassReloadRef = React.useRef(false);

  React.useEffect(
    () => subscribeProjectSafetyStatus(() => setStatusVersion((version) => version + 1)),
    [],
  );

  const hasContent = hasProjectContent(projectState);
  const isExternallySafe = isProjectExternallySafe(projectState.projectId, projectState.updatedAt);
  const shouldBlockRefresh = hasContent && !isExternallySafe;

  React.useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      projectState.flushDrafts();
      if (bypassReloadRef.current || !shouldBlockRefresh) return;

      event.preventDefault();
      event.returnValue = REFRESH_WARNING;
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [projectState, shouldBlockRefresh]);

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      const isKeyboardRefresh = event.key === 'F5' || ((event.ctrlKey || event.metaKey) && key === 'r');
      if (!isKeyboardRefresh) return;

      projectState.flushDrafts();
      if (!shouldBlockRefresh) return;

      event.preventDefault();
      setOpen(true);
    };

    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true });
  }, [projectState, shouldBlockRefresh]);

  const handleSaveProjectAndRefresh = async () => {
    if (isSaving) return;
    setIsSaving(true);
    try {
      await exportCurrentProjectFile();
      bypassReloadRef.current = true;
      scheduleReload();
    } catch (error: any) {
      toast.error(error?.message || '保存项目失败，已取消刷新');
    } finally {
      setIsSaving(false);
    }
  };

  const handleRefreshAnyway = () => {
    bypassReloadRef.current = true;
    scheduleReload();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-[380px] rounded-[24px] border-border/40 bg-[#F9F8F6] p-6 shadow-[0_24px_80px_-24px_rgba(0,0,0,0.35)]">
        <DialogHeader className="gap-2">
          <DialogTitle className="font-serif text-[20px] tracking-tight text-text-primary">
            刷新前先保存
          </DialogTitle>
          <DialogDescription className="text-[13.5px] leading-6 text-text-secondary">
            {REFRESH_WARNING}
          </DialogDescription>
        </DialogHeader>

        <div className="flex justify-end gap-2 pt-3">
          <Button type="button" variant="ghost" className="rounded-xl" onClick={() => setOpen(false)}>
            取消
          </Button>
          <Button
            type="button"
            variant="outline"
            className="rounded-xl bg-white"
            disabled={isSaving}
            onClick={handleRefreshAnyway}
          >
            仍然刷新
          </Button>
          <Button
            type="button"
            className="rounded-xl bg-button-main text-white hover:bg-[#333230]"
            disabled={isSaving}
            onClick={handleSaveProjectAndRefresh}
          >
            保存项目并刷新
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
