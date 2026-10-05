import { snippets } from '../editor/markdown-elements';
import type { GittinController } from '../editor/controller';
import { commandRegistry, type CommandId } from '../editor/commands';
import type { EditorControls } from '../editor/controls/controls';
import { button, el, field, fileDialog, narrow, onDocumentClick } from './dom';
import { menuIcon } from './menu-icons';
import { arrangeMenu, submenuOf } from './menu-layout';
import { keysFor, shortcutHint } from './shortcuts';
export interface Action {
  id: string;
  label: string;
  /** Its menu and any submenus: "Format/Text" is Format › Text. */
  menu: string;
  separatorBefore?: boolean;
  run(): void;
  state?(): { disabled?: boolean; selected?: boolean };
}
export function editorActions(controller: GittinController, controls: EditorControls): Action[] {
  const commands = (Object.keys(commandRegistry) as CommandId[]).filter(id => id !== 'heading')
    .map((id): Action => ({
      id, menu: commandRegistry[id].menu,
      label: id === 'addImage' ? 'From URL…'
        : id === 'hr' ? 'Horizontal line' : commandRegistry[id].label,
      run: () => controls.activate(id), state: () => controller.commandState(id),
    }));
  const headings = Array.from({ length: 7 }, (_, n): Action => {
    const label = n ? 'Heading ' + n : 'Paragraph';
    const run = () => { controller.execute('heading', n); };
    const disabled = () => controller.commandState('heading').disabled;
    return { id: 'heading-' + n, label, menu: commandRegistry.heading.menu, run,
      state: () => ({ disabled: disabled(), selected: controller.blockLabel() === label }) };
  });
  return [...insertionActions(controller, controls), ...commands, ...headings];
}
function insertionActions(controller: GittinController, controls: EditorControls): Action[] {
  const fileType = () => controller.getFileType();
  const editable = () => ({ disabled: !controller.isEditable() });
  const markdown = () => ({ disabled: !controller.isEditable() || fileType() !== 'markdown' });
  const image = () => ({ disabled: !controller.sourceImageContext() });
  const dialog = (id: string, label: string, kind: string, menu = 'Insert', state = markdown): Action =>
    ({ id, label, menu, run: () => controls.openInsert(kind), state });
  const element = (id: string, label: string, kind: string, state = markdown) =>
    dialog(id, label, kind, 'Insert/Elements', state);
  const imageCommand = (id: string, label: string, run: () => void): Action =>
    ({ id, label, menu: 'Format/Image', run, state: image });
  const aligns = { left: 'Align image left', center: 'Centre image', right: 'Align image right' };
  const types = ['markdown', 'javascript', 'typescript', 'html', 'css', 'json', 'yaml'] as const;
  return [
    { id: 'folder-image', label: 'From folder…', menu: 'Insert/Image',
      run: () => controls.openInsert('folderImage'),
      state: () => ({ disabled: markdown().disabled || !controls.onFolderImage }) },
    dialog('symbols', 'Symbols…', 'symbol', 'Insert', editable),
    dialog('heading-link', 'Link to heading…', 'headingLink'),
    { id: 'line-break', label: 'Line break', menu: 'Insert', state: markdown,
      run: () => { controller.insertElement({ kind: 'lineBreak' }); } },
    element('toc', 'Table of contents…', 'toc'),
    element('footnote', 'Footnote…', 'footnote'),
    element('collapsible-section', 'Collapsible section…', 'details',
      () => ({ disabled: !controller.isEditable() || !['markdown', 'html'].includes(fileType()) })),
    element('comment-stub', 'Comment…', 'comment', () =>
      ({ disabled: !controller.isEditable() || ['text', 'json', 'unknown'].includes(fileType()) })),
    element('alert', 'Alert…', 'alert'),
    element('math', 'Math…', 'math'),
    element('diagram', 'Diagram…', 'diagram'),
    imageCommand('image-size', 'Size…', () => controls.openInsert('imageSize')),
    imageCommand('image-reset', 'Reset size', () => { controller.transformImage({ reset: true }); }),
    ...(Object.entries(aligns) as [keyof typeof aligns, string][]).map(([align, label]) =>
      imageCommand('image-' + align, label, () => { controller.transformImage({ align }); })),
    ...types.flatMap(type => snippets(type).map((snippet): Action => ({
      id: `snippet-${type}-${snippet.id}`, label: snippet.label + (type === 'markdown' ? '' : ` (${type})`),
      menu: 'Insert/Snippets', run: () => controls.openInsert('snippet', snippet.id),
      state: () => ({ disabled: !controller.isEditable() || fileType() !== type }) }))),
  ];
}

function actionButton(action: Action, run: () => void) {
  const b = button('', () => { if (!action.state?.().disabled) run(); });
  b.setAttribute('aria-label', action.label);
  const state = action.state?.();
  b.append(menuIcon(action.id, { selected: state?.selected }),
    el('span', { className: 'menu-label', textContent: action.label }));
  const keys = keysFor(action.id);
  if (keys) b.append(el('kbd', { textContent: shortcutHint(keys) }));
  b.disabled = !!state?.disabled;
  if (state?.selected !== undefined) b.setAttribute('aria-pressed', String(state.selected));
  return b;
}
type MenuEntry = { summary: HTMLElement; panel: HTMLElement; render(): void };
export class Menus {
  readonly element = el('nav', { className: 'menus', ariaLabel: 'Document menus' });
  private dialog?: HTMLDialogElement;
  private abort = new AbortController();
  private removeOutside: () => void;
  private entries = new Map<HTMLDetailsElement, MenuEntry>();
  private hoverTimer?: ReturnType<typeof setTimeout>;
  constructor(readonly actions: Action[], private focusDocument: () => void) {
    for (const group of ['File', 'Edit', 'View', 'Insert', 'Format', 'Tools', 'Help']) {
      const summary =
        el('summary', { textContent: group, ariaHasPopup: 'true', ariaExpanded: 'false' });
      const list = el('div', { className: 'menu-items' });
      const details = el('details', {}, summary, list);
      const render = () => {
        list.replaceChildren();
        this.populate(list, actions.filter(a => a.menu.split('/')[0] === group), group);
      };
      this.entries.set(details, { summary, panel: list, render });
      summary.addEventListener('click', e => {
        e.preventDefault();
        this.cancelHover();
        if (details.open) this.closeBranch(details);
        else this.openMenu(details);
      });
      summary.addEventListener('pointerenter', e => {
        if (this.isHover(e) && !details.open && [...this.entries.keys()].some(item => item.open))
          this.scheduleHover(() => this.openMenu(details));
      });
      summary.addEventListener('pointerleave', () => this.cancelHover());
      list.addEventListener('pointerenter', () => this.cancelHover());
      this.watchBranch(details, summary, list, false);
      details.addEventListener('keydown', e => this.onKeyDown(e, details));
      this.element.append(details);
    }
    this.removeOutside = onDocumentClick([...this.entries.keys()], () => this.closeMenus());
    const signal = this.abort.signal;
    window.addEventListener('resize', () => this.positionOpenPanels(), { signal });
    this.element.addEventListener('scroll', () => this.positionOpenPanels(), { capture: true, signal });
  }
  /** Fills the panel of `menu` in one pass: a button per command, and a submenu per name below it. */
  private populate(host: HTMLElement, items: Action[], menu: string) {
    items = arrangeMenu(items, menu);
    const rendered = new Set<string>();
    for (const action of items) {
      const name = submenuOf(action, menu);
      if (name && rendered.has(name)) continue;
      if (action.separatorBefore && host.childElementCount) host.append(el('hr'));
      if (name) {
        rendered.add(name);
        host.append(this.submenu(name, items.filter(a => submenuOf(a, menu) === name), menu));
        continue;
      }
      const item = actionButton(action, () => this.runAction(action));
      item.addEventListener('pointerenter', e => {
        if (this.isHover(e)) this.scheduleHover(() => this.closeChildren(host));
      });
      host.append(item);
    }
  }
  private submenu(name: string, items: Action[], parent: string) {
    const arrow = menuIcon('submenu-arrow');
    arrow.classList.add('submenu-arrow');
    const label = el('span', { className: 'menu-label', textContent: name });
    const trigger = el('summary', { ariaHasPopup: 'true', ariaExpanded: 'false' },
      menuIcon(name, { submenu: true }), label, arrow);
    const children = el('div', { className: 'submenu-items' });
    this.populate(children, items, parent + '/' + name);
    const sub = el('details', { className: 'submenu' }, trigger, children);
    trigger.addEventListener('click', e => {
      e.preventDefault();
      this.cancelHover();
      if (sub.open && (narrow.matches || e.detail === 0)) this.closeBranch(sub);
      else this.openSubmenu(sub);
    });
    trigger.addEventListener('pointerenter', e => {
      if (this.isHover(e)) this.scheduleHover(() => this.openSubmenu(sub));
    });
    sub.addEventListener('pointerleave', e => {
      if (this.isHover(e)) this.scheduleHover(() => this.closeBranch(sub), 180);
    });
    children.addEventListener('pointerenter', () => this.cancelHover());
    this.watchBranch(sub, trigger, children, true);
    return sub;
  }
  private isHover(e: PointerEvent) {
    return !narrow.matches && e.pointerType === 'mouse';
  }
  private cancelHover() {
    clearTimeout(this.hoverTimer);
    this.hoverTimer = undefined;
  }
  private scheduleHover(action: () => void, delay = 100) {
    this.cancelHover();
    this.hoverTimer = setTimeout(() => { this.hoverTimer = undefined; action(); }, delay);
  }
  /** The toggle listener alone keeps aria-expanded in step with the branch. */
  private watchBranch(details: HTMLDetailsElement, trigger: HTMLElement, panel: HTMLElement,
    submenu: boolean) {
    details.addEventListener('toggle', () => {
      trigger.setAttribute('aria-expanded', String(details.open));
      if (details.open) this.positionPanel(panel, trigger, submenu);
      else this.closeChildren(panel);
    });
  }
  private closeBranch(details: HTMLDetailsElement) {
    for (const child of details.querySelectorAll<HTMLDetailsElement>('details')) child.open = false;
    details.open = false;
  }
  private closeChildren(panel: HTMLElement, except?: HTMLDetailsElement) {
    for (const item of panel.children)
      if (item instanceof HTMLDetailsElement && item !== except) this.closeBranch(item);
  }
  /** Closes the submenu that `panel` belongs to and focuses its trigger. */
  private closeParent(panel: HTMLElement) {
    const parent = panel.parentElement as HTMLDetailsElement;
    this.closeBranch(parent);
    parent.querySelector<HTMLElement>('summary')!.focus();
  }
  private openMenu(details: HTMLDetailsElement) {
    const entry = this.entries.get(details)!;
    this.cancelHover();
    this.closeChildren(this.element, details);
    if (!details.open) entry.render();
    details.open = true;
    this.positionPanel(entry.panel, entry.summary, false);
  }
  private openSubmenu(details: HTMLDetailsElement) {
    for (let parent = details.parentElement?.closest('details'); parent;
      parent = parent.parentElement?.closest('details') ?? null)
      if (!parent.open) return;
    this.closeChildren(details.parentElement!, details);
    details.open = true;
    const trigger = details.querySelector<HTMLElement>(':scope > summary')!;
    this.positionPanel(details.querySelector<HTMLElement>(':scope > .submenu-items')!, trigger, true);
  }
  private positionPanel(panel: HTMLElement, trigger: HTMLElement, submenu: boolean) {
    if (submenu && narrow.matches) {
      panel.style.removeProperty('left');
      panel.style.removeProperty('top');
      panel.style.removeProperty('max-height');
      return;
    }
    const edge = 8, viewportWidth = document.documentElement.clientWidth;
    const viewportHeight = window.innerHeight;
    const anchor = trigger.getBoundingClientRect();
    if (!submenu) {
      // Narrow screens open the panel below the whole header rather than below its menu name.
      const header = narrow.matches
        ? this.element.closest('header')?.getBoundingClientRect()
        : undefined;
      const top = (header?.bottom ?? anchor.bottom) + 4;
      panel.style.maxHeight = Math.max(32, viewportHeight - top - edge) + 'px';
      panel.style.top = top + 'px';
      const width = panel.getBoundingClientRect().width;
      const left = narrow.matches ? 12 : anchor.left;
      panel.style.left = Math.max(edge, Math.min(left, viewportWidth - width - edge)) + 'px';
      return;
    }
    panel.style.maxHeight = Math.max(32, viewportHeight - edge * 2) + 'px';
    const parent = trigger.closest('details')!.parentElement!.getBoundingClientRect();
    const bounds = panel.getBoundingClientRect();
    const left = parent.right + bounds.width - 1 <= viewportWidth - edge
      ? parent.right - 1 : parent.left - bounds.width + 1;
    panel.style.left = Math.max(edge, Math.min(left, viewportWidth - bounds.width - edge)) + 'px';
    const top = Math.min(anchor.top - 7, viewportHeight - bounds.height - edge);
    panel.style.top = Math.max(edge, top) + 'px';
  }
  private positionOpenPanels() {
    for (const [details, entry] of this.entries) {
      if (!details.open) continue;
      this.positionPanel(entry.panel, entry.summary, false);
      for (const sub of details.querySelectorAll<HTMLDetailsElement>('.submenu[open]')) {
        const trigger = sub.querySelector<HTMLElement>(':scope > summary')!;
        const panel = sub.querySelector<HTMLElement>(':scope > .submenu-items')!;
        const anchor = trigger.getBoundingClientRect();
        const parent = sub.parentElement!.getBoundingClientRect();
        // A submenu whose trigger has scrolled out of its parent panel closes rather than float alone.
        const outside = anchor.bottom <= parent.top || anchor.top >= parent.bottom;
        if (!narrow.matches && outside) this.closeBranch(sub);
        else this.positionPanel(panel, trigger, true);
      }
    }
  }
  private panelItems(panel: HTMLElement) {
    return [...panel.children].flatMap(item => {
      if (item instanceof HTMLButtonElement) return item.disabled ? [] : [item];
      if (item instanceof HTMLDetailsElement)
        return [item.querySelector<HTMLElement>(':scope > summary')!];
      return [];
    });
  }
  private switchMenu(details: HTMLDetailsElement, direction: number) {
    const menus = [...this.entries.keys()];
    const next = menus[(menus.indexOf(details) + direction + menus.length) % menus.length];
    this.openMenu(next);
    this.entries.get(next)!.summary.focus();
  }
  private onKeyDown(e: KeyboardEvent, details: HTMLDetailsElement) {
    const active = document.activeElement as HTMLElement;
    const entry = this.entries.get(details)!;
    const owner = active.closest('details') as HTMLDetailsElement | null;
    const panel = active.closest<HTMLElement>('.submenu-items, .menu-items') ?? entry.panel;
    const inSubmenu = panel.classList.contains('submenu-items');
    const onSubmenu = active.tagName === 'SUMMARY' && owner?.classList.contains('submenu');
    this.cancelHover();
    if (e.key === 'Tab') {
      this.closeMenus();
      entry.summary.focus();
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      if (owner?.classList.contains('submenu') && owner.open) {
        this.closeBranch(owner);
        owner.querySelector<HTMLElement>('summary')!.focus();
      } else if (inSubmenu) this.closeParent(panel);
      else { this.closeMenus(); entry.summary.focus(); }
      return;
    }
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      if (onSubmenu && owner!.open) this.closeBranch(owner!);
      else if (inSubmenu) this.closeParent(panel);
      else this.switchMenu(details, -1);
      return;
    }
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      if (onSubmenu) {
        this.openSubmenu(owner!);
        this.panelItems(owner!.querySelector<HTMLElement>(':scope > .submenu-items')!)[0]?.focus();
      } else if (panel === entry.panel) this.switchMenu(details, 1);
      return;
    }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
      e.preventDefault();
      if (!details.open) this.openMenu(details);
      const items = this.panelItems(panel), index = items.indexOf(active), last = items.length - 1;
      const next = items[e.key === 'Home' ? 0 : e.key === 'End' ? last
        : index < 0 ? (e.key === 'ArrowDown' ? 0 : last)
        : (index + (e.key === 'ArrowDown' ? 1 : last)) % items.length];
      if (next) {
        const branch = next.tagName === 'SUMMARY' ? next.parentElement as HTMLDetailsElement : undefined;
        this.closeChildren(panel, branch);
        next.focus();
        next.scrollIntoView({ block: 'nearest' });
      }
    }
  }
  // Menu items keep no focus once the menu closes. Focus the document before running so dialogs
  // record it as their return target; commands that move focus (dialogs, Find) still do so themselves.
  private runAction(action: Action) {
    this.closeMenus();
    this.focusDocument();
    const before = document.activeElement;
    action.run();
    // Commands that swap the document surface (mode switches, display toggles) leave focus on the
    // body or on the hidden old surface.
    const active = document.activeElement;
    if (!active || active === document.body || active === before) this.focusDocument();
  }
  closeMenus() {
    this.cancelHover();
    for (const details of this.entries.keys()) this.closeBranch(details);
  }
  search() {
    this.closeMenus();
    this.dialog?.remove();
    this.dialog = fileDialog('Search commands and settings', (body, close) => {
      const input = el('input', { type: 'search', placeholder: 'Try Bold, Find, or Dark…' });
      const results = el('div', { className: 'command-results' });
      const render = () => {
        const query = input.value.toLowerCase();
        const found = this.actions.filter(a =>
          (a.label + ' ' + a.menu.split('/').join(' ')).toLowerCase().includes(query));
        results.replaceChildren(...found.map(a =>
          actionButton(a, () => { close(); this.runAction(a); })));
      };
      input.oninput = render;
      body.append(field('Search', input), results);
      render();
    }, { className: 'command-dialog' });
  }
  dispose() {
    this.cancelHover();
    this.abort.abort();
    this.removeOutside();
    this.element.remove();
  }
}
