import { InsertDialogs } from '../../ui/insert-dialogs';
import { GittinController } from '../controller';
import { commandRegistry, type CommandId } from '../commands';
import { ControlsResize } from './resize';
import type { Preferences } from '../../preferences';
import { icon } from '../../ui/icons';
import { actionIcon } from '../../ui/menu-icons';
import { keysFor, shortcutHint } from '../../ui/shortcuts';
import { toolbarGroups, toolbarVisible, toolbarLabel, documentZoomLevels, documentZoom, type ToolbarCommand } from './toolbar';
import { PopupMenu } from '../../ui/popup-menu';
export { toolbarGroups, toolbarVisible, toolbarLabel } from './toolbar';

const menusKeys = keysFor('menus')!;
/** Commands that ask for details first, and the dialog that asks. */
const dialogs: Partial<Record<CommandId, string>> = {
  addLink: 'link', addImage: 'image', addTable: 'table', codeBlock: 'codeBlock', alignColumn: 'alignColumn',
};
export class EditorControls {
  readonly element = document.createElement('div');
  private abort = new AbortController();
  private resize: ControlsResize;
  private subscriptions: (() => void)[] = [];
  private inserts: InsertDialogs;
  private buttons = new Map<ToolbarCommand, HTMLButtonElement>();
  private groups = new Map<string, HTMLElement>();
  private more = document.createElement('button');
  private menuToggle = document.createElement('button');
  private overflow =
    new PopupMenu('More toolbar controls', 'toolbar-overflow', { toolbar: true, alignEnd: true });
  private headings = new PopupMenu('Paragraph style', 'toolbar-heading-menu');
  private zoom = document.createElement('button');
  private zoomLabel = document.createElement('span');
  private zoomMenu = new PopupMenu('Document zoom', 'toolbar-zoom-menu');
  private zoomPercent = 100;
  onFolderImage?: () => void;
  constructor(
    private controller: GittinController,
    private find?: () => void,
    toggleMenus?: () => void,
    private changeZoom?: (percent: number) => void
  ) {
    this.inserts=new InsertDialogs(controller);
    this.element.className = 'gittin-controls workspace-toolbar';
    this.element.setAttribute('role', 'toolbar');
    this.element.setAttribute('aria-label', 'Editing tools');
    if (changeZoom) {
      this.zoom.type = 'button'; this.zoom.className = 'toolbar-zoom';
      this.zoom.setAttribute('aria-label', 'Document zoom');
      this.zoom.setAttribute('aria-haspopup', 'menu'); this.zoom.setAttribute('aria-expanded', 'false');
      this.zoom.append(this.zoomLabel, icon('chevron-down'));
      this.zoom.addEventListener('mousedown', event => event.preventDefault());
      this.zoom.addEventListener('click', () => this.toggleZoom());
      this.element.append(this.zoom);
      this.setZoom(100);
    }
    for (const descriptor of toolbarGroups) {
      const group = document.createElement('span');
      group.className = 'toolbar-group'; group.dataset.toolbarGroup = descriptor.id;
      group.setAttribute('role', 'group'); group.setAttribute('aria-label', descriptor.label);
      this.groups.set(descriptor.id, group); this.element.append(group);
    }
    for (const id of toolbarGroups.flatMap(group => [...group.items])) {
      if (id === 'find' && !find) continue;
      const button = document.createElement('button');
      button.type = 'button';
      const label = document.createElement('span'); label.className = 'toolbar-button-label';
      label.textContent = id === 'heading' ? 'Paragraph' : toolbarLabel(id);
      button.append(icon(id === 'heading' ? 'hash' : id === 'codeBlock' ? 'terminal-2' : actionIcon(id)!), label);
      if (id === 'heading') { button.append(icon('chevron-down')); button.setAttribute('aria-haspopup', 'menu'); button.setAttribute('aria-expanded', 'false'); }
      button.setAttribute('aria-label', toolbarLabel(id));
      button.title = toolbarLabel(id);
      button.dataset.command = id;
      if (id === 'find') button.id = 'find-file';
      const keys = keysFor(id);
      if (keys) button.title += ` (${shortcutHint(keys)})`;
      button.addEventListener('mousedown', (event) => event.preventDefault(), {
        signal: this.abort.signal,
      });
      button.addEventListener('click', () => {
        if (id === 'find') { this.closeMenus(); this.find?.(); }
        else this.activate(id);
      }, {
        signal: this.abort.signal,
      });
      const group = toolbarGroups.find(group=>(group.items as readonly string[]).includes(id))!;
      this.groups.get(group.id)!.append(button);
      this.buttons.set(id, button);
    }
    this.more.type = 'button'; this.more.className = 'toolbar-more';
    this.more.append(icon('dots-vertical'));
    this.more.setAttribute('aria-label', 'More toolbar controls'); this.more.title = 'More toolbar controls';
    this.more.setAttribute('aria-expanded', 'false');
    this.more.hidden = true;
    this.more.addEventListener('mousedown', event => event.preventDefault());
    this.more.addEventListener('click', () => this.toggleOverflow());
    this.element.append(this.more, this.overflow.element, this.headings.element, this.zoomMenu.element);
    if (toggleMenus) {
      this.menuToggle.type = 'button'; this.menuToggle.className = 'toolbar-menu-toggle';
      this.menuToggle.append(icon('chevron-down'));
      this.menuToggle.setAttribute('aria-controls', 'workspace-header');
      const aria = menusKeys.replace('Ctrl', 'Control').replace(/-/g, '+');
      this.menuToggle.setAttribute('aria-keyshortcuts', aria);
      this.menuToggle.addEventListener('mousedown', event => event.preventDefault());
      this.menuToggle.addEventListener('click', () => { this.closeMenus(); toggleMenus(); });
      this.element.append(this.menuToggle);
      this.setMenusHidden(false);
    }
    this.element.addEventListener('keydown', event => this.onKeyDown(event));
    this.subscriptions.push(
      controller.subscribeToolbar(() => this.refresh())
    );
    this.subscriptions.push(
      controller.subscribePopup((command) => this.activate(command))
    );
    this.resize = new ControlsResize(this.element, () => this.layout());
    queueMicrotask(() => this.layout());
    document.fonts?.ready.then(() => this.resize.schedule());
  }
  setVisibility(preferences: Preferences) {
    this.closeMenus();
    for (const [id, button] of this.buttons) button.hidden = !toolbarVisible(preferences, id);
    for (const group of this.groups.values()) {
      group.hidden=![...group.querySelectorAll<HTMLButtonElement>('button[data-command]')].some(button=>!button.hidden);
    }
    this.layout();
  }
  setMenusHidden(hidden: boolean) {
    const label = hidden ? 'Show the menus' : 'Hide the menus';
    this.menuToggle.setAttribute('aria-label', label);
    this.menuToggle.setAttribute('aria-expanded', String(!hidden));
    this.menuToggle.title = `${label} (${shortcutHint(menusKeys)})`;
  }
  setZoom(percent?: number) {
    this.zoomPercent = documentZoom(percent);
    this.zoomLabel.textContent = this.zoomPercent + '%';
    this.zoom.title = 'Document zoom: ' + this.zoomPercent + '%';
  }
  private layout() {
    if (!this.element.isConnected || !this.element.clientWidth) return;
    const focused = document.activeElement as HTMLElement;
    const hadFocus = this.element.contains(focused);
    const wasOverflowOpen = !this.overflow.element.hidden;
    const previousOverflow = [...this.overflow.element.children];
    const allGroups = [...this.groups.values()];
    for (const [index, group] of allGroups.entries()) {
      // Keep unchanged controls attached: moving a pressed button's ancestor
      // between pointerdown and pointerup can swallow the click in WebKit.
      if (group.parentElement !== this.element)
        this.element.insertBefore(group, allGroups.slice(index + 1).find(next => next.parentElement === this.element) ?? this.more);
    }
    const groups = allGroups.filter(group => !group.hidden);
    for (const [index, group] of groups.entries()) {
      group.classList.toggle('first-visible', index === 0);
      for (const button of group.querySelectorAll('button')) button.removeAttribute('role');
    }
    this.more.hidden = true;
    const widths = groups.map(group => group.getBoundingClientRect().width);
    const total = widths.reduce((sum, width) => sum + width, 0);
    const toolbarWidth = this.element.clientWidth - this.menuToggle.getBoundingClientRect().width - this.zoom.getBoundingClientRect().width;
    if (total > toolbarWidth) {
      this.more.hidden = false;
      const available = toolbarWidth - this.more.getBoundingClientRect().width;
      let used = 0, overflow = false;
      groups.forEach((group, index) => {
        used += widths[index]; overflow ||= used > available;
        if (overflow) {
          this.overflow.element.append(group);
        }
      });
    }
    const overflowChanged = previousOverflow.length !== this.overflow.element.children.length ||
      previousOverflow.some((group, index) => group !== this.overflow.element.children[index]);
    if (overflowChanged) this.closeMenus();
    else if (this.more.hidden) this.overflow.close();
    if (hadFocus) {
      if (focused.getClientRects().length) focused.focus({ preventScroll: true });
      else if (!this.more.hidden) this.more.focus({ preventScroll: true });
    }
    if (wasOverflowOpen && !overflowChanged && !this.more.hidden)
      this.overflow.open(this.more, this.overflow.element.contains(focused) ? focused as HTMLButtonElement : undefined);
  }
  private toggleOverflow() {
    if (!this.overflow.element.hidden) this.overflow.close(true);
    else { this.closeMenus(); this.overflow.open(this.more); }
  }
  private toggleZoom() {
    if (!this.zoomMenu.element.hidden) { this.zoomMenu.close(true); return; }
    this.closeMenus();
    this.zoomMenu.element.replaceChildren();
    let selected: HTMLButtonElement | undefined;
    for (const percent of documentZoomLevels) {
      const item = document.createElement('button'); item.type = 'button';
      item.setAttribute('role', 'menuitemradio');
      item.setAttribute('aria-checked', String(percent === this.zoomPercent));
      const check = document.createElement('span'); check.className = 'toolbar-menu-check';
      if (percent === this.zoomPercent) { check.append(icon('check')); selected = item; }
      item.append(check, percent + '%');
      item.onclick = () => {
        this.zoomMenu.close(true);
        this.changeZoom?.(percent);
      };
      this.zoomMenu.element.append(item);
    }
    this.zoomMenu.open(this.zoom, selected);
  }
  private closeMenus() { this.overflow.close(); this.headings.close(); this.zoomMenu.close(); }
  private onKeyDown(event: KeyboardEvent) {
    if (!(event.target instanceof HTMLButtonElement) || event.target.closest('.toolbar-popup')) return;
    const target = event.target;
    if (['ArrowDown', 'ArrowUp'].includes(event.key) && (target === this.more || target === this.zoom || target.dataset.command === 'heading')) {
      event.preventDefault();
      if (target === this.more) this.toggleOverflow(); else if (target === this.zoom) this.toggleZoom(); else this.activate('heading');
    } else if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const buttons = [...this.element.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
        .filter(button => !button.closest('.toolbar-popup') && button.getClientRects().length > 0);
      const current = buttons.indexOf(target);
      const index = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
        : (current + (event.key === 'ArrowRight' ? 1 : buttons.length - 1)) % buttons.length;
      buttons[index]?.focus();
    }
  }
  activate(command: CommandId) {
    if (this.controller.commandState(command).disabled) return;
    if (command === 'heading') return this.popup();
    this.closeMenus();
    const dialog = dialogs[command];
    if (dialog) this.openInsert(dialog); else this.controller.execute(command);
  }
  openInsert(kind:string,id?:string) {
    if (kind === 'folderImage') { this.onFolderImage?.(); return; }
    this.closeMenus();this.inserts.open(kind,id);}
  refresh() {
    for (const [id, button] of this.buttons) {
      if (id === 'find') continue;
      const state = this.controller.commandState(id);
      button.disabled = state.disabled;
      if (id === 'heading')
        button.querySelector('.toolbar-button-label')!.textContent = this.controller.blockLabel();
      if ('state' in commandRegistry[button.dataset.command as CommandId])
        button.setAttribute('aria-pressed', String(state.selected));
    }
    if (this.controller.commandState('heading').disabled) this.headings.close();
  }
  private popup() {
    if (!this.headings.element.hidden) { this.headings.close(true); return; }
    const button = this.buttons.get('heading')!;
    const anchor = button.getClientRects().length && !this.overflow.element.contains(button) ? button : this.more;
    this.closeMenus(); this.inserts.close();
    const context = this.controller.captureSourceContext();
    this.headings.element.replaceChildren();
    let selected: HTMLButtonElement | undefined;
    for (let level = 0; level <= 6; level++) {
      const item = document.createElement('button'); item.type = 'button';
      const label = level ? 'Heading ' + level : 'Paragraph';
      item.setAttribute('role', 'menuitemradio'); item.setAttribute('aria-label', label);
      const active = label === this.controller.blockLabel(); item.setAttribute('aria-checked', String(active));
      const check = document.createElement('span'); check.className = 'toolbar-menu-check';
      if (active) { check.append(icon('check')); selected = item; }
      const text = document.createElement('span'); text.textContent = label; text.dataset.headingLevel = String(level);
      item.append(check, text);
      item.onclick = () => {
        this.headings.close();
        if (!context.valid()) return;
        context.restore(); this.controller.execute('heading', level);
      };
      this.headings.element.append(item);
    }
    this.headings.open(anchor, selected);
  }
  dispose() {
    this.overflow.dispose(); this.headings.dispose(); this.zoomMenu.dispose();
    this.inserts.dispose();
    this.abort.abort();
    this.resize.dispose();
    this.subscriptions.forEach((fn) => fn());
    this.element.remove();
  }
}
