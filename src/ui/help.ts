import { button, dialogShell, el, field, fileDialog } from './dom';
import { keyCaps, shortcuts } from './shortcuts';
const topics: Record<string, string> = {
  'Editing': 'Edit changes exact source with shared Undo. Preview and Diff are read-only. '
    + 'Find searches this file; replacement is available in Edit. '
    + 'Use menus or assigned shortcuts when a toolbar item is hidden.',
  'Preview and Diff': 'Preview and Diff are read-only. Preview sanitizes supported Markdown/HTML and '
    + 'renders maths, Mermaid diagrams, emoji shortcodes and front matter as common Markdown renderers '
    + 'do; other unsupported syntax stays visible as source. Code and HTML files are readable source '
    + 'and never execute. Diff compares the exact opened or explicitly saved baseline; Compare files '
    + 'supplies a temporary comparison that can be cleared.',
  'Saving and recovery': 'Save writes back to the file you opened and stops if the file changed on '
    + 'disk. Save as writes a new file; in browsers that cannot write files it downloads one. '
    + 'Unsaved changes are kept in this browser, which you or the browser can clear. '
    + 'Version history keeps up to 20 saves per file in this browser.',
  'Markdown syntax': 'Common Markdown with tables, task lists, alerts and footnotes. Insert provides '
    + 'source templates, symbols, heading links, footnotes, alerts and more.',
};
const cheatSheet: [string, string][] = [
  ['Heading', '# Heading 1\n## Heading 2'],
  ['Bold, italic, strikethrough', '**bold** *italic* ~~struck~~'],
  ['Inline code', '`code`'],
  ['Link', '[text](https://example.com)'],
  ['Image', '![alt text](https://example.com/image.png)'],
  ['Bulleted list', '- item\n- item'],
  ['Numbered list', '1. first\n2. second'],
  ['Task list', '- [ ] to do\n- [x] done'],
  ['Quote', '> quoted text'],
  ['Alert', '> [!NOTE]\n> Useful information'],
  ['Code block', '```js\nconsole.log(1);\n```'],
  ['Table', '| A | B |\n| --- | --- |\n| 1 | 2 |'],
  ['Footnote', 'Text[^1]\n\n[^1]: The note'],
  ['Maths', 'Inline $E = mc^2$, or on its own lines:\n$$\n\\sum_{i=1}^{n} i\n$$'],
  ['Diagram', '```mermaid\ngraph LR\n  A --> B\n```'],
  ['Emoji', ':smile: :+1: :tada:'],
  ['Front matter (top of the file)', '---\ntitle: My page\n---'],
  ['Horizontal rule', '---'],
  ['Line break', 'End a line with a backslash\\'],
  ['Comment (hidden in Preview)', '<!-- note to self -->'],
];
function cheatSheetTable() {
  const table = el('table', { className: 'cheat-sheet' });
  table.innerHTML = '<thead><tr><th scope="col">To get</th><th scope="col">Type</th></tr></thead>';
  const body = table.createTBody();
  for (const [label, syntax] of cheatSheet) {
    const row = body.insertRow();
    row.insertCell().textContent = label;
    row.insertCell().append(el('pre', { textContent: syntax }));
  }
  return table;
}
export function workspaceHelpDialog(host: HTMLElement, signal: AbortSignal) {
  const existing = host.querySelector<HTMLDialogElement>('.help-dialog');
  if (existing) { existing.querySelector<HTMLElement>('h2')?.focus(); return existing; }
  const { dialog, heading, body, footer } = dialogShell('Gittin Help', 'help-dialog');
  const lifecycle = new AbortController();
  const close = (restoreFocus = true) => {
    lifecycle.abort();
    dialog.close();
    dialog.remove();
    if (restoreFocus) {
      const workspace = host.closest('#workspace');
      const menu = workspace?.querySelector<HTMLElement>('.menus > details:last-child > summary');
      menu?.focus();
      // Hidden menus cannot take focus; the menu toggle is where hiding them sends it. On phones that
      // toggle is hidden and the Menus button stands in.
      const toggle = workspace?.querySelector<HTMLElement>('.toolbar-menu-toggle');
      if (document.activeElement !== menu) toggle?.focus();
      if (document.activeElement !== menu && document.activeElement !== toggle)
        workspace?.querySelector<HTMLElement>('#menus-toggle')?.focus();
    }
  };
  const nav = el('nav', { ariaLabel: 'Help topics' }), content = el('div');
  const show = (title: string) => {
    content.replaceChildren(el('p', { textContent: topics[title] }));
    if (title === 'Markdown syntax') content.append(cheatSheetTable());
  };
  for (const title of Object.keys(topics)) {
    const topic = button(title, () => {
      show(title);
      for (const item of nav.querySelectorAll('button')) item.ariaPressed = String(item === topic);
      keepInView();
    });
    topic.ariaPressed = String(title === 'Editing');
    nav.append(topic);
  }
  show('Editing');
  body.append(nav, content);
  footer.append(button('Close Help', () => close()));
  heading.classList.add('dialog-drag-handle');
  heading.tabIndex = 0;
  heading.title = 'Drag to move. Use arrow keys when focused.';
  const move = (x: number, y: number) => {
    const bounds = dialog.getBoundingClientRect(), edge = 16;
    dialog.style.margin = '0';
    dialog.style.inset = 'auto';
    dialog.style.left = Math.max(edge, Math.min(x, window.innerWidth - bounds.width - edge)) + 'px';
    dialog.style.top = Math.max(edge, Math.min(y, window.innerHeight - bounds.height - edge)) + 'px';
  };
  const keepInView = () => {
    const bounds = dialog.getBoundingClientRect();
    move(bounds.x, bounds.y);
  };
  let drag: { id: number; x: number; y: number } | undefined;
  heading.addEventListener('pointerdown', event => {
    if (event.button !== 0 || !event.isPrimary) return;
    event.preventDefault();
    heading.focus({ preventScroll: true });
    const bounds = dialog.getBoundingClientRect();
    drag = { id: event.pointerId, x: event.clientX - bounds.x, y: event.clientY - bounds.y };
    heading.setPointerCapture(event.pointerId);
    heading.classList.add('dragging');
  });
  heading.addEventListener('pointermove', event => {
    if (drag?.id === event.pointerId) move(event.clientX - drag.x, event.clientY - drag.y);
  });
  const stopDrag = () => { drag = undefined; heading.classList.remove('dragging'); };
  heading.addEventListener('pointerup', stopDrag);
  heading.addEventListener('pointercancel', stopDrag);
  heading.addEventListener('lostpointercapture', stopDrag);
  heading.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    const bounds = dialog.getBoundingClientRect(), step = event.shiftKey ? 40 : 10;
    move(bounds.x + (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0),
      bounds.y + (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0));
  });
  dialog.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
  });
  signal.addEventListener('abort', () => close(false), { once: true, signal: lifecycle.signal });
  window.addEventListener('resize', keepInView, { signal: lifecycle.signal });
  host.append(dialog);
  dialog.show();
  heading.focus({ preventScroll: true });
  return dialog;
}
const steps = [
  'Create a new file or open a UTF-8 file. Every file opens in Edit.',
  'Write source and use the formatting toolbar or menus. Undo shares one history.',
  'Check Preview or Diff without changing source.',
  'Save to write back to your file, or Save as to choose a new one. '
    + 'Open a folder to browse and edit its files.',
  'Use Help topics and Keyboard shortcuts for reference. '
    + 'After its first visit, Gittin can start offline on this device.',
];
export function gettingStarted() {
  fileDialog('Getting Started', body =>
    body.append(el('ol', {}, ...steps.map(text => el('li', { textContent: text })))));
}
const releases = [
  'Files and folders — 2 October 2026: create folders; rename, move and delete files and delete '
    + 'folders from the Folder panel or the File menu; relative links open at their #section.',
  'Local files and folders — 30 September 2026: open a folder, save back to your files, '
    + 'and browse version history of your saves.',
  'Preview and drafts — 29 September 2026: maths, Mermaid diagrams, emoji shortcodes and front matter '
    + 'in Preview; Download as PDF…; line and column in the status bar; typewriter centring in Focus '
    + 'mode; back up and restore drafts; install Gittin and start it offline.',
  'Local workspace — 27 September 2026: file recovery and metadata; shared source formatting and '
    + 'Undo; read-only Preview/Diff; source insertion and contextual tables/images; device toolbar and '
    + 'prose preferences; statistics, temporary comparison, attributions, linked resources, '
    + 'email previews and Help.',
];
export function whatsNew() {
  fileDialog("What's new", body => body.append(el('p', { textContent: releases.join(' ') })));
}
function shortcutLabel(keys: string) {
  const mac = /Mac|iPhone|iPad/.test(navigator.platform);
  return keyCaps(keys).replace('Mod', mac ? '⌘' : 'Ctrl').replace(/Shift/g, mac ? '⇧' : 'Shift')
    .replace(/Alt/g, mac ? '⌥' : 'Alt').replace(/-/g, ' + ');
}
export function keyboardShortcuts() {
  return fileDialog('Keyboard shortcuts', body => {
    const input = el('input', { type: 'search' }), results = el('div');
    const render = () => {
      const query = input.value.toLowerCase();
      results.replaceChildren(...shortcuts.flatMap(({ label, keys }) => {
        const text = label + ' — ' + shortcutLabel(keys);
        return text.toLowerCase().includes(query) ? [el('p', { textContent: text })] : [];
      }));
    };
    input.oninput = render;
    body.append(field('Search assigned shortcuts', input), results);
    render();
  });
}

export function helpDialog() {
  return fileDialog('Gittin Help', body => {
    const intro = 'Create a new file or open a file from your device to start writing.';
    body.append(el('p', { textContent: intro }), ...Object.entries(topics).map(([title, text]) =>
        el('details', {}, el('summary', { textContent: title }), el('p', { textContent: text }))));
    body.classList.add('home-help-topics');
  });
}
