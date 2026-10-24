import { commandRegistry, type CommandId } from '../editor/commands';
import { el } from './dom';

/**
 * Every keyboard shortcut, in the order Help lists them: the menu Help groups it under, the command or action it runs,
 * its keys, and a name for those that are not editor commands. "Mod" is Ctrl, or ⌘ on a Mac.
 */
export const shortcuts = ([
  ['File', 'save', 'Mod-s', 'Save'], ['File', 'print', 'Mod-p', 'Print'],
  ['Edit', 'undo', 'Mod-z'], ['Edit', 'redo', 'Mod-Shift-z'], ['Edit', 'find', 'Mod-f', 'Find and replace'],
  ['Edit', 'moveLinesUp', 'Alt-ArrowUp'], ['Edit', 'moveLinesDown', 'Alt-ArrowDown'], ['Edit', 'deleteLines', 'Mod-d'],
  ['View', 'menus', 'Ctrl-Shift-F', 'Hide or show the menus'],
  ['Insert', 'addLink', 'Mod-k'],
  ['Format', 'bold', 'Mod-b'], ['Format', 'italic', 'Mod-i'], ['Format', 'strike', 'Mod-Shift-s'],
  ['Help', 'commands', 'Mod-Shift-p', 'Search the menus'],
] as [string, string, string, string?][]).map(([menu, id, keys, label]) =>
  ({ menu, id, keys, label: label ?? commandRegistry[id as CommandId].label }));

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

/** The keys as this device names them, one per key cap: "Mod" is Ctrl, or ⌘ on a Mac, as Shift is ⇧ and Alt ⌥
 * there; arrow keys are arrows. */
export function keyNames(keys: string) {
  const mac = /Mac|iPhone|iPad/.test(navigator.platform);
  const names: Record<string, string> = {
    Mod: mac ? '⌘' : 'Ctrl', Shift: mac ? '⇧' : 'Shift', Alt: mac ? '⌥' : 'Alt',
    ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  };
  return keyCaps(keys).split('-').map(key => names[key] ?? key);
}

/** Keys drawn as key caps. */
export const keyCapRow = (keys: string) =>
  el('span', { className: 'key-caps' }, ...keyNames(keys).map(key => el('kbd', { textContent: key })));
