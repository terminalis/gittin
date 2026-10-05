import { commandRegistry, type CommandId } from '../editor/commands';

/**
 * Every keyboard shortcut, in the order Help lists them: the command or action it runs, its keys,
 * and a name for those that are not editor commands. "Mod" is Ctrl, or ⌘ on a Mac.
 */
export const shortcuts = ([
  ['save', 'Mod-s', 'Save'], ['print', 'Mod-p', 'Print'],
  ['undo', 'Mod-z'], ['redo', 'Mod-Shift-z'], ['find', 'Mod-f', 'Find and replace'],
  ['moveLinesUp', 'Alt-ArrowUp'], ['moveLinesDown', 'Alt-ArrowDown'], ['deleteLines', 'Mod-d'],
  ['menus', 'Ctrl-Shift-F', 'Hide or show the menus'],
  ['addLink', 'Mod-k'], ['bold', 'Mod-b'], ['italic', 'Mod-i'], ['strike', 'Mod-Shift-s'],
  ['commands', 'Mod-Shift-p', 'Search the menus'],
] as [string, string, string?][]).map(([id, keys, label]) =>
  ({ id, keys, label: label ?? commandRegistry[id as CommandId].label }));

/** The keys of the command or action with this id, if it has a shortcut. */
export const keysFor = (id: string) => shortcuts.find(shortcut => shortcut.id === id)?.keys;

/** Whether the key event is the shortcut `keys`; "Ctrl" is Ctrl on a Mac too. */
export function pressed(event: KeyboardEvent, keys: string) {
  const parts = keys.split('-'), key = parts.pop()!.toLowerCase();
  const control = parts.includes('Mod') ? event.ctrlKey || event.metaKey
    : parts.includes('Ctrl') ? event.ctrlKey && !event.metaKey : !event.ctrlKey && !event.metaKey;
  return control && event.key.toLowerCase() === key && event.shiftKey === parts.includes('Shift')
    && event.altKey === parts.includes('Alt');
}

/** The editor command a key event runs, if any. */
export function shortcutCommand(event: KeyboardEvent): CommandId | undefined {
  // AltGr, and Ctrl with Alt, type characters on some keyboards.
  if (event.getModifierState('AltGraph') || event.altKey && (event.ctrlKey || event.metaKey)) return;
  if (pressed(event, 'Ctrl-y')) return 'redo';
  const found = shortcuts.find(({ id, keys }) => id in commandRegistry && pressed(event, keys));
  return found?.id as CommandId | undefined;
}

/** Shows a letter key as a capital, as on keycaps: "Mod-b" reads "Mod-B". */
export const keyCaps = (keys: string) =>
  keys.replace(/(^|-)([a-z])$/, (_, separator, key) => separator + key.toUpperCase());

/** Keys as menus and tooltips show them: "Ctrl/⌘-B". */
export const shortcutHint = (keys: string) => keyCaps(keys).replace('Mod', 'Ctrl/⌘');
