import { icon, type IconName } from './icons';
import { desktop } from '../platform';

export const brand = (href = '#/home', logoOnly = false) =>
  `<a class="brand" href="${href}" aria-label="Gittin home">`
  + '<img src="/gittin-logo.svg" alt="" width="36" height="36">'
  + `${logoOnly ? '' : '<strong>Gittin</strong>'}</a>`;

/** Phones and small tablets, where side panels become drawers. Unit tests run without a window. */
export const narrow = globalThis.matchMedia?.('screen and (max-width: 760px)');

/** An element with properties, ARIA ones too, and children: el('p', { role: 'note' }, 'Text'). */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { className?: string } = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const element = Object.assign(document.createElement(tag), props);
  element.append(...children);
  return element;
}

export function button(label: string, action: () => void, className = '') {
  return el('button', { type: 'button', textContent: label, className, onclick: action });
}

/** An icon-only button; its name is also its tooltip. */
export function iconButton(name: IconName, label: string, action: () => void, className = '') {
  const props = { type: 'button' as const, className, onclick: action, ariaLabel: label, title: label };
  return el('button', props, icon(name));
}

type Control = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
/** A text field, file picker or drop-down with its label above it. */
export const field = (label: string, control: Control) => el('label', {}, label, control);

/** Adds a labelled text field with `props` to `body` and returns it. */
export function textField(body: HTMLElement, label: string, props: Partial<HTMLInputElement> = {}) {
  const control = el('input', props);
  body.append(field(label, control));
  return control;
}

/** Adds a labelled drop-down of `values` to `body` and returns it. */
export function dropDown(body: HTMLElement, label: string, values: string[]) {
  const control = select(label, values.map(value => [value, value]));
  body.append(field(label, control));
  return control;
}

/** A checkbox inside a label row, the box before its text; append the row, `box.parentElement`. */
export function checkbox(label: string, checked: boolean, className = '') {
  const box = el('input', { type: 'checkbox', checked });
  el('label', className ? { className } : {}, box, el('span', { textContent: label }));
  return box;
}

/** A drop-down named `label`; `field` shows the name above it. */
export function select(label: string, options: [value: string, text: string][]) {
  return el('select', { ariaLabel: label },
    ...options.map(([value, text]) => el('option', { value, textContent: text })));
}

type Option<T> = [value: T, text: string, icon?: IconName];
/**
 * Buttons that choose one of `options`; the one `current` names is pressed, and after a choice
 * the pressed one follows `current` again. An option with an icon shows only the icon, its text
 * becoming the button's name and tooltip.
 */
export function segmented<T extends string>(label: string, options: Option<T>[], current: () => T,
  change: (value: T) => void) {
  const group = el('div', { className: 'segmented', role: 'group', ariaLabel: label });
  const show = () => options.forEach(([option], i) => {
    group.children[i].ariaPressed = String(option === current());
  });
  for (const [option, text, name] of options) {
    const choose = () => { change(option); show(); };
    group.append(name ? iconButton(name, text, choose) : button(text, choose));
  }
  show();
  return group;
}

/** The desktop app opens the legal pages on gittin.app, in the browser. */
const site = desktop ? 'https://gittin.app' : '';
/** Gittin's legal pages, [name, address], as the landing page, Home's menu and Help list them. */
export const legalPages = [
  ['Privacy Policy', site + '/privacy.html'],
  ['Terms of Service', site + '/terms.html'],
  ['Third-party notices', site + '/THIRD_PARTY_NOTICES.txt'],
] as const;
/** Every legal link's rel: the page it opens gets no handle on Gittin and no referrer. */
export const legalRel = 'noopener noreferrer';

/** A row laid out like Version history's: what and where on the left, its actions on the right. */
export function listRow(...children: (Node | string)[]) {
  return el('li', { className: 'version-row' }, ...children);
}

/** A choice laid out as a row: its name in bold and, under it, what it does. */
export function choiceRow(name: string, what: string, action: () => void, className = '') {
  const row = button('', action, ('choice-row ' + className).trim());
  row.append(el('strong', { textContent: name }), el('small', { textContent: what }));
  row.setAttribute('aria-label', name);
  row.setAttribute('aria-description', what);
  return row;
}

export const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/** Says that a folder's listing failed, and why. */
export const unreadable = (error: unknown) => 'This folder could not be read. ' + errorText(error);

/** Calls `close` on a click outside every element of `inside`; returns the removal. */
export function onDocumentClick(inside: Element[], close: () => void) {
  const abort = new AbortController();
  const outside = (event: Event) => {
    const target = event.target;
    if (target instanceof Node && !inside.some(element => element.contains(target))) close();
  };
  // Wait for click so closing an inline submenu cannot move the next target
  // between pointerdown and pointerup. Disabled controls do not emit click.
  document.addEventListener('click', outside, { capture: true, signal: abort.signal });
  document.addEventListener('pointerdown', event => {
    if (event.target instanceof Element && event.target.closest(':disabled')) outside(event);
  }, { capture: true, signal: abort.signal });
  return () => abort.abort();
}

export function notice(error: unknown) {
  const host = document.querySelector<HTMLElement>('#notice')!;
  const previous = document.activeElement as HTMLElement | null;
  const dismiss = () => {
    // WebKit can leave focus on body when a button is clicked with the pointer.
    const active = document.activeElement;
    const restoreFocus = host.contains(active) || active === document.body;
    host.replaceChildren();
    if (restoreFocus && previous?.isConnected && previous.getClientRects().length) previous.focus();
  };
  const close = Object.assign(button('Dismiss', dismiss), { ariaLabel: 'Dismiss notice' });
  close.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); dismiss(); }
  });
  host.replaceChildren(el('span', { textContent: errorText(error) }), close);
}

/** Copies `text` and says `done`; where the clipboard is missing or refused, says `manual` instead. */
export function copyText(text: string, done: string, manual: string) {
  if (!navigator.clipboard) return notice(manual);
  void navigator.clipboard.writeText(text)
    .then(() => notice(done), () => notice('Clipboard access was declined. ' + manual));
}

/** Shared workspace dialog structure: a title row (the heading, then any ✕), the body and the footer; callers retain
 * their own actions and lifecycle. */
export function dialogShell(title: string, className: string, form?: HTMLFormElement) {
  const dialog = el('dialog', { className: 'workspace-dialog ' + className, ariaLabel: title });
  const heading = el('h2', { textContent: title });
  const titleRow = el('div', { className: 'dialog-title' }, heading);
  const body = el('div', { className: 'dialog-body' });
  const footer = el('footer', { className: 'dialog-actions' });
  if (form) { form.classList.add('dialog-form'); dialog.append(form); }
  (form ?? dialog).append(titleRow, body, footer);
  // Chromium's search box clears its text on the first Escape instead of cancelling the dialog.
  dialog.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !(event.target instanceof HTMLInputElement)) return;
    if (event.target.type !== 'search') return;
    event.preventDefault();
    dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
  });
  return { dialog, heading, titleRow, body, footer };
}

/** The ✕ at the end of the title row of a dialog that only shows information. */
export const closeButton = (close: () => void) => iconButton('x', 'Close', close, 'dialog-close');

export function showDialog(dialog: HTMLDialogElement) {
  dialog.showModal();
  // Scrollable bodies can receive native autofocus before their form controls. The ✕ takes focus only when no other
  // control can.
  const controls = [...dialog.querySelectorAll<HTMLElement>('input, select, textarea, button, a[href], [tabindex]')]
    .filter(control => !control.matches(':disabled, [tabindex="-1"]') && control.getClientRects().length > 0);
  (controls.find(control => !control.matches('.dialog-close')) ?? controls[0])?.focus({ preventScroll: true });
}

interface FileDialogOptions {
  /** Added to `file-dialog`. */
  className?: string;
  /** The footer's last button, which closes the dialog. */
  closeLabel?: string;
  /** A dialog that only shows information: ✕ in its title row closes it, and it has no footer button. */
  info?: boolean;
  onClose?(): void;
}

type Build = (body: HTMLElement, close: () => void, footer: HTMLElement) => void;
/** Focus-restoring dialog for file metadata, utilities and help. Its own actions come first in the footer, then the
 * button that closes it, as in Windows. */
export function fileDialog(title: string, build: Build, options: FileDialogOptions = {}) {
  const { className = '', closeLabel = 'Close', info = false, onClose } = options;
  const previous = document.activeElement as HTMLElement | null;
  const { dialog, titleRow, body, footer } = dialogShell(title, ('file-dialog ' + className).trim());
  const close = () => {
    dialog.close();
    dialog.remove();
    // A rebuilt workspace replaces the control that opened the dialog,
    // so focus returns to its successor by id.
    const successor = previous?.id ? document.getElementById(previous.id) : null;
    (previous?.isConnected ? previous : successor)?.focus();
    onClose?.();
  };
  if (info) titleRow.append(closeButton(close));
  build(body, close, footer);
  if (!info) footer.append(button(closeLabel, close));
  dialog.addEventListener('cancel', e => { e.preventDefault(); close(); });
  document.body.append(dialog);
  showDialog(dialog);
  return dialog;
}

/** A choice: its label, the value it resolves with, and 'danger' when it destroys work. */
type Choice<T> = [label: string, value: T, danger?: 'danger'];
/** Resolve with the chosen button's value; Escape or Cancel resolves with 'cancel'. */
export function ask<T extends string>(title: string, text: string, options: Choice<T>[]) {
  return new Promise<T | 'cancel'>(resolve => {
    let chosen: T | 'cancel' = 'cancel';
    fileDialog(title, (body, close, footer) => {
      body.append(el('p', { textContent: text }));
      // The first choice confirms the question and is filled; a destructive one is red; Cancel comes last.
      options.forEach(([label, value, danger], index) => {
        const choose = () => { chosen = value; close(); };
        footer.append(button(label, choose, [index === 0 ? 'primary' : '', danger ?? ''].join(' ').trim()));
      });
    }, { closeLabel: 'Cancel', onClose: () => resolve(chosen) });
  });
}

/** Marks a file row with unsaved changes: a dot drawn in CSS plus an accessible description, never colour alone. */
export function markUnsaved(target: HTMLElement, unsaved: boolean) {
  target.toggleAttribute('data-unsaved', unsaved);
  if (unsaved) target.setAttribute('aria-description', 'Unsaved changes');
  else target.removeAttribute('aria-description');
}
