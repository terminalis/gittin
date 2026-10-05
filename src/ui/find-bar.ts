import { FindRequests, type FindSnapshot, type Match } from '../editor/find';
import type { GittinController } from '../editor/controller';
import { button, checkbox, el, errorText, iconButton } from './dom';
const REGEX_SEARCH_DELAY_MS = 250;
const name = 'Find in current document';
/** Tags a button for styling: data-action="close" and so on. */
const tagged = (action: string, b: HTMLButtonElement) => { b.dataset.action = action; return b; };
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
  private query = el('input', { type: 'search', placeholder: name, ariaLabel: name });
  private replacement = el('input', { placeholder: 'Replace with', ariaLabel: 'Replace with' });
  private caseSensitive = checkbox('Match case', false);
  private wholeWord = checkbox('Whole word', false);
  private regex = checkbox('Regular expression (Markdown)', false);
  private scope = el('span', { className: 'search-scope' });
  private status = el('output', { role: 'status' });
  private moves = [
    tagged('previous', iconButton('arrow-up', 'Previous match', () => this.navigate(-1))),
    tagged('next', iconButton('arrow-down', 'Next match', () => this.navigate(1))),
  ];
  private replaces = [
    tagged('replace', button('Replace', () => this.replace(false))),
    tagged('all', button('Replace all', () => this.replace(true))),
  ];
  constructor(private controller: GittinController) {
    const options = [this.caseSensitive, this.wholeWord, this.regex].map(box => box.parentElement!);
    this.element.append(
      el('div', {}, el('strong', { textContent: 'Current document' }), this.scope,
        tagged('close', iconButton('x', 'Close find', () => this.close()))),
      el('div', {}, this.query, ...this.moves, this.status),
      el('div', {}, this.replacement, ...this.replaces),
      el('div', { className: 'find-options' }, ...options,
        el('small', { textContent: 'Replacement text is literal.' })));
    for (const input of [this.query, this.regex, this.caseSensitive, this.wholeWord])
      input.addEventListener('input', () => {
        if (!this.regex.checked) return void this.search();
        this.invalidate();
        this.update(this.query.value ? 'Searching…' : 'Enter text to find');
        this.timer = window.setTimeout(() => void this.search(), REGEX_SEARCH_DELAY_MS);
      });
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
  private update(message?: string) {
    this.status.textContent =
      message ??
      (this.matches.length
        ? `${this.current + 1} of ${this.matches.length} matches`
        : 'No matches');
    for (const b of this.replaces) b.disabled = !this.matches.length || !this.snapshot?.editable;
    for (const b of this.moves) b.disabled = !this.matches.length;
  }
  private async search(scroll = false, direction = 1) {
    this.invalidate();
    const generation = this.generation;
    this.pending = true;
    const snapshot = this.controller.findSnapshot();
    this.regex.disabled = snapshot.mode !== 'markdown';
    if (this.regex.disabled) this.regex.checked = false;
    this.scope.textContent =
      snapshot.mode === 'markdown'
        ? 'Source text'
        : snapshot.mode === 'diff' ? 'Displayed comparison · read-only' : 'Visible text · read-only';
    this.update(this.query.value ? 'Searching…' : 'Enter text to find');
    try {
      const matches = await this.requests.search(
        snapshot,
        this.query.value,
        this.caseSensitive.checked,
        this.regex.checked,
        this.wholeWord.checked
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
    this.element.remove();
  }
}
