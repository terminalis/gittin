import { button, closeButton, dialogShell, el, field, fileDialog } from './dom';
import { icon, type IconName } from './icons';
import { keyCaps, shortcuts } from './shortcuts';
import { desktop, place } from '../platform';
/** A point of a Help topic: its heading, then a sentence or two. */
type Point = [heading: string, text: string];
const topics: Record<string, Point[]> = {
  'Editing': [
    ['Edit is the source', "Edit changes the file's exact text, and Undo and Redo cover every change."],
    ['Find and replace', 'Find searches this file in any view. Replace works in Edit.'],
    ['Hidden toolbar items', 'Every toolbar command is in the menus too, many with a keyboard shortcut.'],
  ],
  'Preview and Diff': [
    ['Both are read-only', 'Preview and Diff never change the file; Edit does.'],
    ['Preview', 'Shows Markdown and HTML as a page, with maths, Mermaid diagrams, emoji shortcodes and front matter, '
      + "as common Markdown renderers do. Syntax it doesn't support stays as text. Code and HTML never run."],
    ['Diff', 'Shows what changed since the file was opened or last saved.'],
    ['Compare files', 'Tools › Compare files… shows another file in Diff instead, until you clear it.'],
  ],
  'Saving and recovery': [
    ['Save', 'Writes back to the file you opened, and stops if the file changed on disk.'],
    ['Save as', 'Writes a new file.' + (desktop ? '' : " In browsers that can't write files, it downloads one.")],
    ['Unsaved changes', desktop ? 'Kept in this app until you save. Quitting asks about every unsaved file.'
      : 'Kept in this browser, which you or the browser can clear.'],
    ...(desktop ? [['In a git repository',
      'Save also commits, with a message that says what changed; Preferences › Git sets how it starts.'] as Point] : []),
    ['Version history', desktop
      ? "Lists a repository file's commits, and keeps up to 20 saves of any other file in this app."
      : `Keeps up to 20 saves per file in ${place}.`],
  ],
  ...(desktop ? {
    'GitHub': [
      ['Signing in', "Choose GitHub's mark at the right of the header, on Home or in a file. Gittin shows a code: "
        + 'choose Copy & Open GitHub, then paste the code there.'],
      ['Only your own codes', 'Enter only a code Gittin showed you, never one someone gives you: anyone can start a '
        + "sign-in that GitHub shows as Gittin's."],
      ['Clone', 'Clone repository, on Home and in File › Open, copies a repository into a new folder in the folder '
        + 'you choose.'],
      ['Sync', 'In the Folder panel and the File menu. Sync saves first, lists the files GitHub has changed, then '
        + "brings GitHub's changes in and sends yours."],
      ['Both changed the same lines', 'You keep one version; the other stays in Version history.'],
      ['On GitHub or not yet', 'The status footer says whether the open file is on GitHub; the Folder panel counts '
        + "the edited files that aren't yet."],
      ['Publish', 'A repository with no remote offers Publish to GitHub instead of Sync.'],
      ['Workflow files', 'Changes to them are saved but left out of commits unless you choose Allow workflow '
        + 'changes…, which the save dialog and a refused Sync offer.'],
      ['Disconnect', 'Disconnect GitHub, in the account menu, forgets the sign-in on this computer. To revoke it, go '
        + 'to Settings › Applications on GitHub.'],
    ] as Point[],
  } : {}),
  'Markdown syntax': [
    ['What Gittin reads', 'Common Markdown, with tables, task lists, alerts and footnotes.'],
    ['Insert', 'The Insert menu adds templates, symbols, heading links, footnotes, alerts and more.'],
  ],
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
/** Help's topics on the left and the chosen one's points on the right; `chosen` runs after a topic is picked. */
function helpTopics(body: HTMLElement, chosen = () => {}) {
  const nav = el('nav', { ariaLabel: 'Help topics' }), content = el('div', { className: 'help-topic' });
  const show = (title: string) => {
    content.replaceChildren(...topics[title].flatMap(([heading, text]) =>
      [el('h3', { textContent: heading }), el('p', { textContent: text })]));
    if (title === 'Markdown syntax') content.append(cheatSheetTable());
    for (const item of nav.querySelectorAll('button')) item.ariaPressed = String(item.textContent === title);
  };
  nav.append(...Object.keys(topics).map(title => button(title, () => { show(title); chosen(); })));
  body.classList.add('help-topics');
  body.append(nav, content);
  show('Editing');
  return {
    /** Keeps the tallest topic's height, within the window, so switching topic moves nothing. Run once shown. */
    fit() {
      content.style.minHeight =
        `${Math.max(...Object.keys(topics).map(title => { show(title); return content.scrollHeight; }))}px`;
      show('Editing');
    },
  };
}
export function workspaceHelpDialog(host: HTMLElement, signal: AbortSignal) {
  const existing = host.querySelector<HTMLDialogElement>('.help-dialog');
  if (existing) { existing.querySelector<HTMLElement>('h2')?.focus(); return existing; }
  const { dialog, heading, titleRow, body } = dialogShell('Gittin Help', 'help-dialog');
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
  const help = helpTopics(body, () => keepInView());
  titleRow.append(closeButton(() => close()));
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
  help.fit();
  heading.focus({ preventScroll: true });
  return dialog;
}
/** Getting Started's steps: an icon, a short title and one line each. */
const steps: [name: IconName, title: string, text: string][] = [
  ['file-plus', 'Start a file', 'Create a new file, or open one from your device. Every file opens in Edit.'],
  ['pencil', 'Write', 'Type, or use the toolbar and menus. Undo covers every change.'],
  ['file-text', 'Check it', 'Preview shows the page and Diff what changed. Neither changes the file.'],
  ['folder', 'Work in a folder', 'Open a folder to browse and edit its files.'],
  ['help', 'Look things up', 'Gittin Help and Keyboard shortcuts are in the Help menu.'
    + (desktop ? '' : ' After its first visit, Gittin can start offline on this device.')],
];
/** How Gittin keeps your files, under Getting Started's steps. */
const yourFiles: [label: string, text: string][] = [
  ['Your files', desktop ? 'Stay on your device, and go to GitHub only when you sync or publish a repository.'
    : 'Stay on your device. Gittin has no accounts.'],
  ['Saving', 'Save writes back to the file you opened; Save as writes a new file.'
    + (desktop ? ' In a git repository, Save also commits.' : '')],
  ['Unsaved changes', desktop ? 'Kept in this app until you save.'
    : 'Kept in this browser, which you or the browser can clear.'],
];
export function gettingStarted() {
  fileDialog('Getting Started', body => body.append(
    el('ul', { className: 'start-steps' }, ...steps.map(([name, title, text]) =>
      el('li', {}, icon(name), el('div', {}, el('strong', { textContent: title }), el('p', { textContent: text }))))),
    el('h3', { textContent: 'Your files' }),
    el('dl', { className: 'start-files' }, ...yourFiles.flatMap(([label, text]) =>
      [el('dt', { textContent: label }), el('dd', { textContent: text })]))),
  { className: 'start-dialog', info: true });
}
/** Every release, newest first: its name, its date and its changes. */
const releases: [name: string, date: string, changes: string[]][] = [
  ...desktop ? [['Git in the desktop apps', '23 October 2026', [
    'In a folder that is a git repository, saving also commits, with a message that says what changed.',
    "Version history lists a repository file's commits.",
    'Renaming, moving and deleting a file in a repository commit at once.',
    'Start a repository gives any other folder git history.',
    'Quitting asks about every unsaved file.',
  ]] as [string, string, string[]]] : [],
  ['Lists, paste, images and backups', '22 October 2026', [
    'A pressed list button removes the list.',
    'Pasted links keep their addresses, and pasted tables become Markdown tables.',
    'Add images from this device to files in a folder with Insert › Image › From device…, by pasting or by dropping.',
    'Export drafts saves a .zip with each draft as its own file.',
    'The side panels and the appearance stay as they were after printing.',
    'Fixes for dragging text, input methods and mixed line endings.',
    'Preview shows more unusual Markdown correctly.',
  ]],
  ['Desktop apps', '19 October 2026', [
    'Gittin for Windows from the Microsoft Store and for Linux as a Flatpak, saving straight back to your files and '
      + 'offered in Open with.',
    'Downloads became Export…, and Download as PDF… became Export as PDF….',
  ]],
  ['Files and folders', '2 October 2026', [
    'Create folders.',
    'Rename, move and delete files, and delete folders, from the Folder panel or the File menu.',
    'Relative links open at their #section.',
  ]],
  ['Local files and folders', '30 September 2026', [
    'Open a folder.',
    'Save back to your files.',
    'Browse the version history of your saves.',
  ]],
  ['Preview and drafts', '29 September 2026', [
    'Maths, Mermaid diagrams, emoji shortcodes and front matter in Preview.',
    'Export as PDF….',
    'Line and column in the status bar.',
    'Typewriter centring in Focus mode.',
    'Back up and restore drafts.',
    'Install Gittin and start it offline.',
  ]],
  ['Local workspace', '27 September 2026', [
    'File recovery and metadata.',
    'Shared source formatting and Undo.',
    'Read-only Preview and Diff.',
    'Source insertion and contextual tables and images.',
    'Device toolbar and prose preferences.',
    'Statistics, temporary comparison, attributions, linked resources, email previews and Help.',
  ]],
];
export function whatsNew() {
  fileDialog("What's new", body => body.append(...releases.map(([name, date, changes], index) =>
    el('details', { className: 'release', open: index === 0 },
      el('summary', {}, el('strong', { textContent: name }), el('small', { textContent: date })),
      el('ul', {}, ...changes.map(change => el('li', { textContent: change })))))),
  { className: 'releases-dialog', info: true });
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
  }, { info: true });
}

/** Home's Help: the workspace's topics and points in a dialog of its own. */
export function helpDialog() {
  let help!: ReturnType<typeof helpTopics>;
  fileDialog('Gittin Help', body => { help = helpTopics(body); }, { className: 'help-dialog', info: true });
  help.fit();
}
