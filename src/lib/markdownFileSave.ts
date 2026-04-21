export async function saveMarkdownAsFile(content: string, suggestedName: string) {
  const safeName = suggestedName?.trim() || "提示词优化.md";
  const finalName = safeName.endsWith(".md") ? safeName : `${safeName}.md`;
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });

  const saveFilePicker = (
    window as typeof window & {
      showSaveFilePicker?: (options?: {
        suggestedName?: string;
        types?: Array<{
          description?: string;
          accept: Record<string, string[]>;
        }>;
      }) => Promise<FileSystemFileHandle>;
    }
  ).showSaveFilePicker;

  if (typeof saveFilePicker === "function") {
    const handle = await saveFilePicker({
      suggestedName: finalName,
      types: [
        {
          description: "Markdown 文件",
          accept: {
            "text/markdown": [".md"],
            "text/plain": [".md"],
          },
        },
      ],
    });

    const writable = await handle.createWritable();
    await writable.write(content);
    await writable.close();
    return;
  }

  const { saveAs } = await import("file-saver");
  saveAs(blob, finalName);
}
