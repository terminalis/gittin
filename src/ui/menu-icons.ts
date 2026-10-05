import { el } from './dom';
import { icon, type IconName } from './icons';

const actionIcons: Record<string, IconName> = {
  home: 'home', new: 'file-description', open: 'folder', 'open-folder': 'folder',
  'make-copy': 'copy', 'email-file': 'mail', 'email-draft': 'mail',
  save: 'device-floppy', 'save-as': 'file-export', 'version-history': 'history',
  rename: 'pencil', move: 'folder-share', 'delete-file': 'trash', location: 'folder-symlink',
  favourite: 'star',
  details: 'info-circle', print: 'printer', 'download-pdf': 'file-type-pdf', close: 'x', undo: 'arrow-back-up', redo: 'arrow-forward-up',
  cut: 'cut', copy: 'copy', paste: 'clipboard', selectAll: 'select-all',
  deleteSelection: 'trash', duplicateLines: 'copy', moveLinesUp: 'arrow-up',
  moveLinesDown: 'arrow-down', deleteLines: 'trash', find: 'search',
  'line-numbers': 'list-numbers', showComments: 'message', syntaxHighlighting: 'code',
  whitespace: 'pilcrow', wordWrap: 'text-wrap', fullscreen: 'maximize', focus: 'focus-2',
  markdown: 'code', diff: 'git-compare', preview: 'file-text', light: 'sun', dark: 'moon', system: 'brightness-half',
  addTable: 'table', addImage: 'photo', 'folder-image': 'folder', addLink: 'link',
  'heading-link': 'link', symbols: 'mood-smile', hr: 'separator-horizontal',
  'line-break': 'page-break', codeBlock: 'code', toc: 'list-details', footnote: 'superscript',
  'collapsible-section': 'arrows-vertical', 'comment-stub': 'message', alert: 'alert-triangle',
  math: 'math', diagram: 'schema',
  bold: 'bold', italic: 'italic', strike: 'strikethrough', code: 'code',
  ins: 'underline', sup: 'superscript', sub: 'subscript', mark: 'highlight',
  blockQuote: 'quote', convertToComment: 'message', convertToText: 'typography', clearFormatting: 'clear-formatting',
  alignLeft: 'align-left', alignCenter: 'align-center', alignRight: 'align-right', alignJustify: 'align-justified',
  indent: 'indent-increase', outdent: 'indent-decrease',
  bulletList: 'list', orderedList: 'list-numbers', taskList: 'list-check',
  addRowToUp: 'row-insert-top', addRowToDown: 'row-insert-bottom', removeRow: 'row-remove',
  addColumnToLeft: 'column-insert-left', addColumnToRight: 'column-insert-right', removeColumn: 'column-remove',
  alignColumn: 'align-justified', removeTable: 'trash',
  'image-size': 'aspect-ratio', 'image-reset': 'restore',
  'image-left': 'align-left', 'image-center': 'align-center', 'image-right': 'align-right',
  'heading-0': 'pilcrow', 'heading-1': 'h-1', 'heading-2': 'h-2',
  'heading-3': 'h-3', 'heading-4': 'h-4', 'heading-5': 'h-5', 'heading-6': 'h-6',
  statistics: 'file-text',
  'compare-files': 'git-compare', attributions: 'quote', 'linked-resources': 'link',
  preferences: 'settings',
  commands: 'search', 'gittin-help': 'help', 'getting-started': 'school', 'whats-new': 'broadcast',
  feedback: 'message-report', privacy: 'shield-lock', terms: 'file-description',
  notices: 'file-description', about: 'info-circle', shortcuts: 'keyboard',
  'reset-toolbar': 'restore', 'submenu-arrow': 'chevron-right', heading: 'pilcrow',
};
const groupIcons: Record<string, IconName> = {
  New: 'file-description', Open: 'folder', Email: 'mail', Text: 'bold',
  'Paragraph styles': 'align-justified', Lists: 'list', 'Align and indent': 'indent-increase',
  Image: 'photo', Table: 'table', Elements: 'file-text', Snippets: 'terminal-2', Lines: 'align-left',
  Mode: 'pencil', Appearance: 'palette', Toolbar: 'layout-navbar',
  'Find & history': 'arrow-back-up', 'Text formatting': 'bold', Paragraph: 'pilcrow',
  Code: 'terminal-2', Indentation: 'indent-increase', 'Line editing': 'align-left', Insert: 'photo',
};
const toolbarGroupIcons: Record<string, IconName> = {
  history: 'arrow-back-up', text: 'bold', block: 'pilcrow', code: 'terminal-2', lists: 'list',
  indentation: 'indent-increase', lines: 'align-left', insert: 'photo',
};

export function actionIcon(key: string): IconName | undefined {
  if (key.startsWith('new-')) return 'file-description';
  if (key.startsWith('snippet-')) return 'terminal-2';
  if (key.startsWith('toolbar-group-')) return toolbarGroupIcons[key.slice('toolbar-group-'.length)];
  if (key.startsWith('toolbar-item-')) return actionIcons[key.slice('toolbar-item-'.length)];
  return actionIcons[key];
}

export function menuIcon(key: string, options: { selected?: boolean; submenu?: boolean } = {}) {
  const slot = el('span', { className: 'menu-icon', ariaHidden: 'true' });
  const name = options.selected ? 'check' : options.submenu ? groupIcons[key] : actionIcon(key);
  if (name) slot.append(icon(name));
  return slot;
}
