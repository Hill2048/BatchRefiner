import * as React from 'react';
import { toast } from 'sonner';
import { optimizeDataUrlForUpload, readImageFileToDataUrl } from '@/lib/taskFileImport';
import { useAppStore } from '@/store';

export function useQuickTaskComposer() {
  const importTasks = useAppStore((state) => state.importTasks);
  const [chatInput, setChatInput] = React.useState('');
  const chatFileRef = React.useRef<HTMLInputElement>(null);

  const parseCsv = React.useCallback(
    async (input: string) => {
      const Papa = (await import('papaparse')).default;
      const results = Papa.parse(input, { header: true, skipEmptyLines: true });
      if (results.errors.length > 0 || !results.data || results.data.length === 0) return 0;

      const firstRow = results.data[0] as Record<string, string>;
      const columns = Object.keys(firstRow);
      const titleColumn =
        columns.find(
          (column) =>
            column.toLowerCase().includes('name') ||
            column.toLowerCase().includes('title') ||
            column.includes('名称') ||
            column.includes('标题'),
        ) || columns[0];
      const descriptionColumn =
        columns.find(
          (column) =>
            column.toLowerCase().includes('desc') ||
            column.includes('描述') ||
            column.includes('提示词') ||
            column.toLowerCase().includes('prompt'),
        ) ||
        columns[1] ||
        columns[0];
      const currentTaskCount = useAppStore.getState().tasks.length;
      const tasksToImport = results.data.map((row, index) => {
        const record = row as Record<string, string>;
        return {
          index: currentTaskCount + index + 1,
          title: record[titleColumn] || `任务 ${currentTaskCount + index + 1}`,
          description: record[descriptionColumn] || '',
          referenceImages: [],
        };
      });
      importTasks(tasksToImport);
      return tasksToImport.length;
    },
    [importTasks],
  );

  const parseList = React.useCallback(
    (input: string) => {
      const lines = input
        .split('\n')
        .filter((line) => line.trim().length > 0)
        .map((line) => line.replace(/^(\d+[\.\)\]]\s*|[-*+]\s+)/, '').trim());

      if (lines.length === 0) return 0;
      if (lines.length === 1 && lines[0].length > 100) return 0;

      const currentTaskCount = useAppStore.getState().tasks.length;
      const tasksToImport = lines.map((line, index) => ({
        index: currentTaskCount + index + 1,
        title: line.slice(0, 50) + (line.length > 50 ? '...' : ''),
        description: line,
        referenceImages: [],
      }));
      importTasks(tasksToImport);
      return tasksToImport.length;
    },
    [importTasks],
  );

  const importFilesAsTasks = React.useCallback(
    async (files: File[]) => {
      const images = files.filter((file) => file.type.startsWith('image/'));
      const texts = files.filter((file) => file.name.endsWith('.csv') || file.name.endsWith('.txt'));
      let addedCount = 0;

      const textContents: Record<string, string> = {};
      for (const file of texts) {
        if (!file.name.endsWith('.txt')) continue;
        const baseName = file.name.substring(0, file.name.lastIndexOf('.'));
        textContents[baseName] = await file.text();
      }

      if (images.length > 0) {
        toast.info(`开始分批加载 ${images.length} 张图片...`);
        let startIndex = useAppStore.getState().tasks.length + 1;
        const chunkSize = 5;

        for (let index = 0; index < images.length; index += chunkSize) {
          const chunk = images.slice(index, index + chunkSize);
          const nextTasks: Array<{
            index: number;
            title: string;
            description: string;
            sourceImage: string;
            referenceImages: never[];
          }> = [];
          const chunkStartIndex = startIndex;

          for (const file of chunk) {
            const baseName = file.name.substring(0, file.name.lastIndexOf('.'));
            const dataUrl = await readImageFileToDataUrl(file);
            const initialDescription = textContents[baseName]?.trim() || '';
            delete textContents[baseName];

            nextTasks.push({
              index: startIndex++,
              title: file.name,
              description: initialDescription,
              sourceImage: dataUrl,
              referenceImages: [],
            });
          }

          importTasks(nextTasks);

          void (async () => {
            await new Promise((resolve) => setTimeout(resolve, 0));
            for (let offset = 0; offset < nextTasks.length; offset += 1) {
              const taskIndex = chunkStartIndex + offset;
              const optimizedSourceImage = await optimizeDataUrlForUpload(nextTasks[offset].sourceImage || '');
              const latestTask = useAppStore
                .getState()
                .tasks.find((item) => item.index === taskIndex && item.title === nextTasks[offset].title);
              if (!latestTask || !optimizedSourceImage || latestTask.sourceImage === optimizedSourceImage) continue;
              useAppStore.getState().updateTask(latestTask.id, { sourceImage: optimizedSourceImage });
            }
          })();

          await new Promise((resolve) => requestAnimationFrame(resolve));
        }

        addedCount += images.length;
        toast.success('图片导入完成');
      }

      for (const file of texts) {
        if (file.name.endsWith('.csv')) {
          addedCount += await parseCsv(await file.text());
          continue;
        }

        const baseName = file.name.substring(0, file.name.lastIndexOf('.'));
        if (textContents[baseName] !== undefined) {
          addedCount += parseList(textContents[baseName]);
        }
      }

      if (addedCount > 0) {
        toast.success(`成功导入 ${addedCount} 个任务`);
      }
    },
    [importTasks, parseCsv, parseList],
  );

  const handleChatSubmit = React.useCallback(async () => {
    if (!chatInput.trim()) return;

    const addedFromList = parseList(chatInput);
    if (addedFromList > 0) {
      toast.success(`成功从文本添加 ${addedFromList} 个任务`);
      setChatInput('');
      return;
    }

    const addedFromCsv = await parseCsv(chatInput);
    if (addedFromCsv > 0) {
      toast.success(`成功从表格数据添加 ${addedFromCsv} 个任务`);
      setChatInput('');
    }
  }, [chatInput, parseCsv, parseList]);

  const handleChatPaste = React.useCallback(
    async (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
      if (!event.clipboardData.files || event.clipboardData.files.length === 0) return;
      event.preventDefault();
      await importFilesAsTasks(Array.from(event.clipboardData.files) as File[]);
    },
    [importFilesAsTasks],
  );

  const handleChatFileAdd = React.useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      if (event.target.files && event.target.files.length > 0) {
        await importFilesAsTasks(Array.from(event.target.files) as File[]);
      }
      event.target.value = '';
    },
    [importFilesAsTasks],
  );

  const openFolderPicker = React.useCallback(() => {
    const input = document.createElement('input') as HTMLInputElement & { webkitdirectory?: boolean };
    input.type = 'file';
    input.multiple = true;
    input.webkitdirectory = true;
    input.onchange = (event: Event) => {
      const target = event.target as HTMLInputElement;
      if (!target.files) return;
      void importFilesAsTasks(Array.from(target.files) as File[]);
    };
    input.click();
  }, [importFilesAsTasks]);

  return {
    chatInput,
    setChatInput,
    chatFileRef,
    handleChatSubmit,
    handleChatPaste,
    handleChatFileAdd,
    openFolderPicker,
  };
}
