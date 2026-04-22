export function getTaskBatchFileName(taskIndex: number, batchIndex: number, extension = 'jpg') {
  const normalizedExtension = extension.replace(/^\./, '') || 'jpg';
  return `${String(taskIndex).padStart(3, '0')}_x${batchIndex + 1}.${normalizedExtension}`;
}
