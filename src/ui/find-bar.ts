import { FindRequests, type FindSnapshot, type Match } from '../editor/find';
import type { GittinController } from '../editor/controller';
import { button, el, errorText, iconButton } from './dom';
import { icon } from './icons';
import { PopupMenu } from './popup-menu';
const REGEX_SEARCH_DELAY_MS = 250;
const name = 'Find in current document';
/** Tags a button for styling: data-action="close" and so on. */
const tagged = (action: string, b: HTMLButtonElement) => { b.dataset.action = action; return b; };
type Option = 'caseSensitive' | 'wholeWord' | 'regex';
const optionLabels: [Option, string][] = [
  ['caseSensitive', 'Match case'], ['wholeWord', 'Whole word'], ['regex', 'Regular expression'],
];
/**
 * Find and replace as Windows 11 Notepad lays it out: a card over the top centre of the text. The first row holds the
 * chevron that shows Replace, the find field with the count inside it, ↓ and ↑, the options and ✕; Replace takes the
 * second row.
 * Replace and regular expressions work on the source, so Preview and Diff grey them out.
 */
export class FindBar {
  readonly element = el('section', { className: 'find-bar', hidden: true, ariaLabel: name });
  private requests = new FindRequests();
  private snapshot?: FindSnapshot;
  private matches: Match[] = [];
  private current = 0;
  private generation = 0;
  private timer?: number;
  private pending = false;
  /** Next or previous pressed while the search was still running. */
  private requested?: number;
  private options: Record<Option, boolean> = { caseSensitive: false, wholeWord: false, regex: false };
  /** Whether the Replace row is open; Preview and Diff hide it whatever this says. */
  private replacing = false;
  /** Whether the view is Edit, where Replace and regular expressions work. */
  private edit = true;
  private query = el('input', { type: 'search', placeholder: 'Find', ariaLabel: name });
  private replacement = el('input', { placeholder: 'Replace with (as typed)', ariaLabel: 'Replace with' });
  private count = el('output', { className: 'find-count' });
  /** Why there is no count: an invalid pattern, a search over one second, too many matches. */
  private message = el('p', { className: 'find-message', role: 'status' });
  private chevron = tagged('chevron', iconButton('chevron-right', 'Toggle Replace', () => this.toggleReplace()));
  private optionsButton = tagged('options',
    iconButton('adjustments-horizontal', 'Find options', () => this.toggleOptions()));
  private menu = new PopupMenu('Find options', 'find-options-menu', { alignEnd: true });
  private moves = [
    tagged('next', iconButton('arrow-down', 'Next match', () => this.navigate(1))),
    tagged('previous', iconButton('arrow-up', 'Previous match', () => this.navigate(-1))),
  ];
  private replaces = [
    tagged('replace', button('Replace', () => this.replace(false))),
    tagged('all', button('Replace all', () => this.replace(true))),
  ];
  private replaceRow = el('div', { className: 'find-row find-replace', hidden: true },
    this.replacement, ...this.replaces);
  constructor(private controller: GittinController) {
    this.chevron.setAttribute('aria-expanded', 'false');
    this.optionsButton.setAttribute('aria-haspopup', 'menu');
    this.optionsButton.setAttribute('aria-expanded', 'false');
    this.element.append(el('div', { className: 'find-card' },
      el('div', { className: 'find-row' }, this.chevron,
        el('div', { className: 'find-field' }, this.query, icon('search'), this.count), ...this.moves,
        this.optionsButton, tagged('close', iconButton('x', 'Close find', () => this.close()))),
      this.replaceRow, this.message), this.menu.element);
    this.query.addEventListener('input', () => this.searchSoon());
    this.element.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.close();
      } else if (e.key === 'Enter' && e.target === this.query) {
        e.preventDefault();
        this.navigate(e.shiftKey ? -1 : 1);
      }
    });
  }
  open() {
    this.element.hidden = false;
    void this.search();
    this.query.focus();
  }
  close() {
    this.menu.close();
    this.element.hidden = true;
    this.invalidate();
    this.controller.captureSelection()();
  }
  invalidate() {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.generation++;
    this.pending = false;
    this.requested = undefined;
    this.requests.invalidate();
    this.snapshot = undefined;
    this.matches = [];
    this.controller.clearFind();
    this.update();
  }
  changed() {
    if (!this.element.hidden) void this.search();
  }
  /** Searches again; a regular expression waits until typing pauses. */
  private searchSoon() {
    if (!this.options.regex) return void this.search();
    this.invalidate();
    this.timer = window.setTimeout(() => void this.search(), REGEX_SEARCH_DELAY_MS);
    this.update();
  }
  /** The count, "2 of 5" or "No matches", once a search has finished; `message` instead when one stopped. */
  private update(message = '') {
    const waiting = this.pending || this.timer !== undefined || !this.query.value || !!message;
    this.count.textContent = waiting ? ''
      : this.matches.length ? `${this.current + 1} of ${this.matches.length}` : 'No matches';
    this.message.textContent = message;
    for (const b of this.replaces) b.disabled = !this.matches.length || !this.snapshot?.editable;
    for (const b of this.moves) b.disabled = !this.matches.length;
  }
  /** Edit allows Replace and regular expressions; Preview and Diff grey out the chevron and the option. */
  private showView(edit: boolean) {
    this.edit = edit;
    if (!edit) this.options.regex = false;
    this.chevron.disabled = !edit;
    this.chevron.title = edit ? 'Toggle Replace' : 'Replace works in Edit';
    this.replaceRow.hidden = !edit || !this.replacing;
    this.optionsButton.classList.toggle('options-on', Object.values(this.options).some(Boolean));
  }
  private toggleReplace() {
    this.replacing = !this.replacing;
    this.chevron.replaceChildren(icon(this.replacing ? 'chevron-down' : 'chevron-right'));
    this.chevron.setAttribute('aria-expanded', String(this.replacing));
    this.showView(this.edit);
    if (this.replacing) this.replacement.focus();
  }
  private toggleOptions() {
    if (this.optionsButton.getAttribute('aria-expanded') === 'true') return this.menu.close(true);
    this.menu.element.replaceChildren(...optionLabels.map(([option, label]) => {
      const item = button('', () => {
        this.options[option] = !this.options[option];
        this.menu.close(true);
        this.showView(this.edit);
        this.searchSoon();
      });
      item.setAttribute('role', 'menuitemcheckbox');
      item.setAttribute('aria-checked', String(this.options[option]));
      item.append(el('span', { className: 'toolbar-menu-check' }, ...(this.options[option] ? [icon('check')] : [])),
        el('span', { textContent: label }));
      if (option === 'regex' && !this.edit)
        Object.assign(item, { disabled: true, title: 'Regular expressions work in Edit' });
      return item;
    }));
    this.menu.open(this.optionsButton);
  }
  private async search(scroll = false, direction = 1) {
    this.invalidate();
    const generation = this.generation;
    this.pending = true;
    const snapshot = this.controller.findSnapshot();
    this.showView(snapshot.mode === 'markdown');
    this.update();
    try {
      const matches = await this.requests.search(
        snapshot,
        this.query.value,
        this.options.caseSensitive,
        this.options.regex,
        this.options.wholeWord
      );
      if (generation !== this.generation) return;
      this.pending = false;
      if (this.requested !== undefined) {
        direction = this.requested;
        scroll = true;
        this.requested = undefined;
      }
      if (matches === null || !this.controller.validFind(snapshot)) return;
      this.snapshot = snapshot;
      this.matches = matches;
      this.current = direction < 0 ? Math.max(0, matches.length - 1) : 0;
      this.update();
      this.controller.highlightFind(snapshot, matches, this.current, scroll);
    } catch (e) {
      if (generation === this.generation) {
        this.pending = false;
        this.update(errorText(e));
      }
    }
  }
  private navigate(direction: number) {
    if (this.timer !== undefined) return void this.search(true, direction);
    if (this.pending) return void (this.requested = direction);
    if (!this.snapshot || !this.matches.length) return;
    this.current = (this.current + direction + this.matches.length) % this.matches.length;
    this.update();
    this.controller.highlightFind(this.snapshot, this.matches, this.current, true);
  }
  private replace(all: boolean) {
    if (!this.snapshot) return;
    const snapshot = this.snapshot,
      matches = all ? this.matches : [this.matches[this.current]];
    if (!matches[0]) return;
    this.requests.invalidate();
    if (this.controller.replaceFind(snapshot, matches, this.replacement.value))
      void this.search();
    else this.changed();
  }
  dispose() {
    this.invalidate();
    this.menu.dispose();
    this.element.remove();
  }
}
