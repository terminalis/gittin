import { onDocumentClick } from './dom';
/** A keyboard-accessible menu or overflow toolbar anchored to a control. */
export class PopupMenu {
  readonly element = document.createElement('div');
  private anchor?: HTMLElement;
  private abort = new AbortController();
  private removeOutside?: () => void;
  constructor(label: string, className: string, private options: { toolbar?: boolean; alignEnd?: boolean } = {}) {
    this.element.className = 'toolbar-popup ' + className;
    this.element.setAttribute('role', options.toolbar ? 'toolbar' : 'menu');
    this.element.setAttribute('aria-label', label);
    this.element.tabIndex = -1;
    this.element.hidden = true;
    this.element.addEventListener('mousedown', event => event.preventDefault());
    this.element.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation(); this.close(true);
      } else if (event.key === 'Tab') this.close(true);
      else if (['ArrowDown', 'ArrowUp', 'Home', 'End', ...(options.toolbar ? ['ArrowLeft', 'ArrowRight'] : [])].includes(event.key)) {
        event.preventDefault(); event.stopPropagation();
        const items = this.items(), current = items.indexOf(document.activeElement as HTMLButtonElement);
        const index = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
          : (current + (event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : items.length - 1)) % items.length;
        items[index]?.focus();
      }
    });
    document.addEventListener('focusin', event => {
      if (event.target instanceof Node && !this.element.contains(event.target) && !this.anchor?.contains(event.target)) this.close();
    }, { signal: this.abort.signal });
    window.addEventListener('resize', () => this.close(true), { signal: this.abort.signal });
  }
  private items() {
    return [...this.element.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
      .filter(button => !button.hidden && button.getClientRects().length > 0);
  }
  open(anchor: HTMLElement, selected?: HTMLButtonElement) {
    this.anchor = anchor;
    this.removeOutside?.();
    this.removeOutside = onDocumentClick([this.element, anchor], () => this.close());
    anchor.setAttribute('aria-expanded', 'true');
    this.element.hidden = false;
    this.element.scrollTop = 0;
    const bounds = anchor.getBoundingClientRect(), edge = 8;
    const width = this.element.getBoundingClientRect().width;
    const left = this.options.alignEnd ? bounds.right - width : bounds.left;
    this.element.style.left = Math.max(edge, Math.min(left, document.documentElement.clientWidth - width - edge)) + 'px';
    this.element.style.maxHeight = Math.max(64, window.innerHeight - bounds.bottom - edge - 4) + 'px';
    this.element.style.top = bounds.bottom + 4 + 'px';
    (selected ?? this.items()[0] ?? this.element).focus({ preventScroll: true });
  }
  close(focus = false) {
    if (this.element.hidden) return;
    this.removeOutside?.();
    this.element.hidden = true;
    this.anchor?.setAttribute('aria-expanded', 'false');
    if (focus && this.anchor?.getClientRects().length) this.anchor.focus({ preventScroll: true });
  }
  dispose() { this.abort.abort(); this.removeOutside?.(); this.element.remove(); }
}
