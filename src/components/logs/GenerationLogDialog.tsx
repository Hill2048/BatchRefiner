import * as React from 'react';
import { Copy, Download, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { clearGenerationLogs } from '@/lib/appLogger';
import type { GenerationLogSession } from '@/types';

type GenerationLogDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessions: GenerationLogSession[];
  title: string;
  allowClear?: boolean;
};

function formatTime(timestamp?: number) {
  if (!timestamp) return '--';
  return new Date(timestamp).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatMode(mode: GenerationLogSession['mode']) {
  switch (mode) {
    case 'prompt-preview':
      return '预览提示词';
    case 'prompt-batch':
      return '批量提示词';
    case 'image-batch':
      return '批量生图';
    case 'all-batch':
      return '批量全流程';
    default:
      return '单任务生图';
  }
}

function getStatusLabel(status: GenerationLogSession['status']) {
  switch (status) {
    case 'running':
      return '进行中';
    case 'success':
      return '成功';
    case 'partial_success':
      return '部分成功';
    case 'halted':
      return '已中断';
    default:
      return '失败';
  }
}

function getStatusClass(status: GenerationLogSession['status']) {
  switch (status) {
    case 'running':
      return 'bg-[#FDF8EB] text-[#B97512] border-[#D9A33B]/24';
    case 'success':
      return 'bg-[#F3F9F5] text-[#2D734C] border-[#2D734C]/12';
    case 'partial_success':
      return 'bg-[#FFF8ED] text-[#A16207] border-[#F5D39A]';
    case 'halted':
      return 'bg-[#F5F4F0] text-text-secondary border-black/10';
    default:
      return 'bg-[#FEF4F4] text-[#BE3827] border-[#BE3827]/12';
  }
}

function buildExportPayload(sessions: GenerationLogSession[]) {
  return {
    exportedAt: Date.now(),
    sessionCount: sessions.length,
    sessions,
  };
}

async function copyJson(payload: unknown) {
  await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
}

async function exportJsonFile(payload: unknown, fileName: string) {
  const { saveAs } = await import('file-saver');
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json;charset=utf-8',
  });
  saveAs(blob, fileName);
}

function SummaryItem({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-black/6 bg-[#FCFBF8] px-3 py-2.5">
      <div className="text-[10px] font-medium uppercase tracking-wider text-black/42">{label}</div>
      <div className="mt-1 break-words text-[12px] font-medium text-black/78">{value}</div>
    </div>
  );
}

export function GenerationLogDialog({
  open,
  onOpenChange,
  sessions,
  title,
  allowClear = false,
}: GenerationLogDialogProps) {
  const [selectedId, setSelectedId] = React.useState<string | null>(sessions[0]?.id || null);

  React.useEffect(() => {
    if (!open) return;
    if (!selectedId || !sessions.some((session) => session.id === selectedId)) {
      setSelectedId(sessions[0]?.id || null);
    }
  }, [open, selectedId, sessions]);

  const selectedSession = sessions.find((session) => session.id === selectedId) || sessions[0] || null;

  const handleCopySelected = async () => {
    if (!selectedSession) return;
    await copyJson(buildExportPayload([selectedSession]));
    toast.success('日志已复制');
  };

  const handleExportSelected = async () => {
    if (!selectedSession) return;
    await exportJsonFile(
      buildExportPayload([selectedSession]),
      `generation-log-${selectedSession.taskIndex || 'task'}-${selectedSession.id}.json`,
    );
    toast.success('日志已导出');
  };

  const handleExportAll = async () => {
    await exportJsonFile(buildExportPayload(sessions), `generation-logs-${Date.now()}.json`);
    toast.success('全部日志已导出');
  };

  const handleClear = () => {
    clearGenerationLogs();
    toast.success('日志已清空');
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(84vh,820px)] max-w-[min(1280px,calc(100vw-2rem))] sm:max-w-[min(1280px,calc(100vw-2rem))] flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b border-black/8 px-5 py-4">
          <div className="flex flex-col gap-3">
            <div className="flex items-start justify-between gap-3 pr-10">
              <div className="min-w-0">
                <DialogTitle className="truncate">{title}</DialogTitle>
                <div className="mt-1 text-[12px] text-text-secondary">共 {sessions.length} 次生成记录</div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {selectedSession ? (
                <>
                  <Button type="button" variant="outline" size="sm" className="h-8 rounded-lg text-[12px]" onClick={handleCopySelected}>
                    <Copy className="mr-1.5 h-3.5 w-3.5" />
                    复制本次
                  </Button>
                  <Button type="button" variant="outline" size="sm" className="h-8 rounded-lg text-[12px]" onClick={handleExportSelected}>
                    <Download className="mr-1.5 h-3.5 w-3.5" />
                    导出本次
                  </Button>
                </>
              ) : null}
              <Button type="button" variant="outline" size="sm" className="h-8 rounded-lg text-[12px]" onClick={handleExportAll} disabled={sessions.length === 0}>
                <Download className="mr-1.5 h-3.5 w-3.5" />
                导出全部
              </Button>
              {allowClear ? (
                <Button type="button" variant="outline" size="sm" className="h-8 rounded-lg text-[12px] text-[#BE3827]" onClick={handleClear}>
                  <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                  清空
                </Button>
              ) : null}
            </div>
          </div>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 grid-cols-[320px_minmax(0,1fr)] overflow-hidden">
          <div className="min-h-0 border-r border-black/8 bg-[#FCFBF8]">
            <ScrollArea className="h-full">
              <div className="flex flex-col gap-2 p-3">
                {sessions.length === 0 ? (
                  <div className="rounded-xl border border-black/6 bg-white p-4 text-[12px] text-text-secondary">
                    暂无生成日志
                  </div>
                ) : (
                  sessions.map((session) => (
                    <button
                      key={session.id}
                      type="button"
                      onClick={() => setSelectedId(session.id)}
                      className={`rounded-xl border px-3 py-2.5 text-left transition-colors ${
                        selectedSession?.id === session.id
                          ? 'border-[#D97757]/45 bg-white shadow-sm'
                          : 'border-black/6 bg-white/80 hover:border-black/12'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate text-[12px] font-medium text-black/80">
                            #{session.taskIndex || '--'} {session.taskTitle || '未命名任务'}
                          </div>
                          <div className="mt-1 text-[11px] text-text-secondary">{formatTime(session.createdAt)}</div>
                        </div>
                        <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium ${getStatusClass(session.status)}`}>
                          {getStatusLabel(session.status)}
                        </span>
                      </div>
                      <div className="mt-2 text-[11px] text-black/58">
                        {formatMode(session.mode)} / 请求 {session.attemptCount}
                      </div>
                    </button>
                  ))
                )}
              </div>
            </ScrollArea>
          </div>

          <div className="min-w-0 min-h-0">
            <ScrollArea className="h-full">
              {selectedSession ? (
                <div className="flex min-h-full flex-col gap-4 p-5">
                  <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
                    <SummaryItem label="任务" value={`#${selectedSession.taskIndex || '--'} ${selectedSession.taskTitle || '未命名任务'}`} />
                    <SummaryItem label="状态" value={getStatusLabel(selectedSession.status)} />
                    <SummaryItem label="模式" value={formatMode(selectedSession.mode)} />
                    <SummaryItem label="请求次数" value={selectedSession.attemptCount} />
                    <SummaryItem label="开始" value={formatTime(selectedSession.createdAt)} />
                    <SummaryItem label="结束" value={formatTime(selectedSession.finishedAt)} />
                    <SummaryItem label="结果数" value={selectedSession.summary?.resultCount ?? 0} />
                    <SummaryItem label="失败数" value={selectedSession.summary?.failedCount ?? 0} />
                  </div>

                  {selectedSession.summary?.errorMessage ? (
                    <div className="rounded-2xl border border-[#BE3827]/12 bg-[#FEF4F4] px-4 py-3 text-[12px] text-[#BE3827]">
                      {selectedSession.summary.errorMessage}
                    </div>
                  ) : null}

                  <div className="flex flex-col gap-3">
                    {selectedSession.events.map((event) => (
                      <div key={event.id} className="rounded-2xl border border-black/6 bg-white px-4 py-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span
                                className={`inline-flex h-2.5 w-2.5 rounded-full ${
                                  event.level === 'error'
                                    ? 'bg-[#BE3827]'
                                    : event.level === 'warn'
                                      ? 'bg-[#B97512]'
                                      : 'bg-[#2D734C]'
                                }`}
                              />
                              <span className="text-[12px] font-medium text-black/80">{event.message}</span>
                            </div>
                            <div className="mt-1 text-[11px] text-black/52">
                              {event.stage} / {event.event}
                            </div>
                          </div>
                          <div className="shrink-0 text-[11px] text-text-secondary">{formatTime(event.time)}</div>
                        </div>

                        {event.data ? (
                          <pre className="mt-3 max-w-full overflow-x-auto whitespace-pre-wrap break-all rounded-xl bg-[#F7F5F1] p-3 text-[11px] leading-relaxed text-black/72">
                            {JSON.stringify(event.data, null, 2)}
                          </pre>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="p-5 text-[12px] text-text-secondary">暂无可查看的日志</div>
              )}
            </ScrollArea>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
