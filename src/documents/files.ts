import { fileDescriptor, fileName, type FileType } from './file-types';
import { encodeSource } from '../editor/source-projection';
export function downloadMarkdown(name: string, source: string, fileType: FileType = 'markdown'): void {
  const url = URL.createObjectURL(
    new Blob([encodeSource(source)], { type: (fileDescriptor(fileType)?.mime ?? 'text/plain') + ';charset=utf-8' })
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName(name || 'Untitled file', fileType);
  try {
    document.body.append(link);
    link.click();
  } finally {
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
