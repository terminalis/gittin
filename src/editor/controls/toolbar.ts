import type { Preferences } from '../../preferences';
import { commandRegistry, type CommandId } from '../commands';

export const toolbarGroups = [
  { id: 'history', label: 'Find & history', items: ['find', 'undo', 'redo'] },
  { id: 'block', label: 'Paragraph', items: ['heading', 'blockQuote', 'hr'] },
  { id: 'text', label: 'Text formatting', items: ['bold', 'italic', 'ins', 'strike', 'mark', 'sup', 'sub', 'clearFormatting'] },
  { id: 'code', label: 'Code', items: ['code', 'codeBlock', 'convertToComment', 'convertToText'] },
  { id: 'lists', label: 'Lists', items: ['bulletList', 'orderedList', 'taskList'] },
  { id: 'indentation', label: 'Indentation', items: ['outdent', 'indent'] },
  { id: 'lines', label: 'Line editing', items: ['duplicateLines', 'moveLinesUp', 'moveLinesDown', 'deleteLines'] },
  { id: 'insert', label: 'Insert', items: ['addLink', 'addImage', 'addTable'] },
] as const;
export type ToolbarCommand = CommandId | 'find';

export const documentZoomLevels = [50, 75, 90, 100, 125, 150, 175, 200] as const;
export function documentZoom(value?: number) {
  return documentZoomLevels.find(level => level === value) ?? 100;
}

export function toolbarVisible(preferences: Preferences, id: string) {
  const group = toolbarGroups.find(group => (group.items as readonly string[]).includes(id));
  return preferences.toolbarGroups?.[group?.id ?? ''] !== false && preferences.toolbarItems?.[id] !== false;
}
export function toolbarLabel(id: string) {
  return id === 'find' ? 'Find in current file' : id === 'codeBlock' ? 'Fenced code block'
    : id === 'convertToComment' ? 'Comment selection' : id === 'convertToText' ? 'Uncomment selection'
      : commandRegistry[id as CommandId].label;
}

