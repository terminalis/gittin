/** Bounded creation formats. Unknown UTF-8 imports are retained as plain source. */
export const fileTypes = [
  { id: 'markdown', label: 'Markdown', tag: 'MD', extensions: ['.md', '.markdown'], mime: 'text/markdown' },
  { id: 'text', label: 'Plain text', tag: 'TXT', extensions: ['.txt'], mime: 'text/plain' },
  { id: 'javascript', label: 'JavaScript', tag: 'JS', extensions: ['.js'], mime: 'text/javascript' },
  { id: 'typescript', label: 'TypeScript', tag: 'TS', extensions: ['.ts'], mime: 'text/plain' },
  { id: 'json', label: 'JSON', tag: 'JSON', extensions: ['.json'], mime: 'application/json' },
  { id: 'html', label: 'HTML', tag: 'HTML', extensions: ['.html'], mime: 'text/html' },
  { id: 'css', label: 'CSS', tag: 'CSS', extensions: ['.css'], mime: 'text/css' },
  { id: 'yaml', label: 'YAML', tag: 'YAML', extensions: ['.yml', '.yaml', '.cff'], mime: 'text/yaml' },
] as const;
export type FileType = typeof fileTypes[number]['id'] | 'unknown';
export function fileTypeForName(name: string): FileType {
  return fileTypes.find(t => t.extensions.some(ext => name.toLowerCase().endsWith(ext)))?.id ?? 'unknown';
}
export function fileDescriptor(type: FileType) {
  return fileTypes.find(t => t.id === type);
}
export function fileName(title: string, type: FileType): string {
  const descriptor = fileDescriptor(type);
  // An existing extension (including an unknown import's) is preserved exactly.
  return /\.[^./\\]+$/.test(title) || !descriptor ? title : title + descriptor.extensions[0];
}
