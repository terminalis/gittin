import type { Preferences } from '../preferences';
import { icon } from '../ui/icons';
import { proseRanges } from './source-language';
import { automaticSubstitution, proseTypedCharacter, spellcheckEnabled, sourceLinks } from './prose-preferences';
import {
  insertElement, tableCell, tableContext, transformTable, imageContext, transformImage, linkContext,
  type ElementRequest, type TableOperation, type ImageTransform,
} from './markdown-elements';
import { lineDiff } from './diff';
import { renderPreview } from './preview';
import { resolveImages, isRelative, type ImageResolver, type LinkOpener } from './relative-images';
import { renderPreviewExtras, textNodes } from './preview-extras';
import { headingAnchors } from './heading-anchors';
import { appendSource, coloredSpans, renderDiff, defaultDisplay, type DisplaySettings } from './display';
import {
  applySourceCommand as transformSource, continuation, sourceCommands, sourceCommandAvailable,
  type SourceCommand, type SourceSelection, type SourceCommandResult,
} from './source-commands';
import type { FileType } from '../documents/file-types';
import { Decoration, DecorationSet } from 'prosemirror-view';
import type { FindSnapshot, Match } from './find';
import { keymap } from 'prosemirror-keymap';
import { splitBlock } from 'prosemirror-commands';
import { Fragment, Slice, type Node as PMNode } from 'prosemirror-model';
import {
  AllSelection, Plugin, TextSelection, Selection, type EditorState, type Transaction,
} from 'prosemirror-state';
import type { Bookmark, DocumentSession, EditKind, Mode, SourceVersion } from '../documents/types';
import {
  createProjection, markdownNodes, bounds, newlineStyle, splice, textEdit, replaceDisplay,
  markdownOffset, markdownStepEdits,
} from './source-projection';
import { findNodeAtPosition, type HeadingMdNode, type ListItemMdNode, type MdNode } from './parser';
import MarkdownEditor from './markdown-editor';
import { commandRegistry, type CommandId } from './commands';
import { shortcutCommand } from '../ui/shortcuts';
import { sanitizeHTML } from './sanitizer/htmlSanitizer';
import { safeURL } from './safe-url';
import { signal } from '../signal';
/** Toolbar states that hold wherever their node encloses the caret; lists are handled apart. */
const caretStateTypes = [
  'taskList', 'strong', 'emph', 'strike', 'heading', 'thematicBreak', 'blockQuote', 'code', 'codeBlock',
];
/** Keeps an event from its default action and from other handlers. */
function stop(event: Event) { event.preventDefault(); event.stopPropagation(); }
/** A dialog's capture of the source and selection, valid until either changes. */
export interface SourceContext {
  readonly source: string;
  readonly selection: Readonly<SourceSelection>;
  readonly type: FileType;
  valid(): boolean;
  restore(): void;
  apply(transform: (source: string, selection: SourceSelection, type: FileType) =>
    SourceCommandResult | null): boolean;
}
export class GittinController {
  private preferences: Preferences = {};
  private linkDetails?: HTMLDivElement;
  private fileType: FileType = 'markdown';
  private display = { ...defaultDisplay };
  private previewDescription?: { source: string; fileType: FileType; display: DisplaySettings; text: string };
  private baseline: SourceVersion | null = null;
  private comparison: { source: string; label: string } | null = null;
  private imageResolver: ImageResolver | null = null;
  private linkOpener: LinkOpener | null = null;
  private displayEpoch = 0;
  private contextEpoch = 0;
  private session!: DocumentSession;
  private container!: HTMLElement;
  private markdown!: MarkdownEditor;
  private modeChanged = signal<Mode>();
  private mode: Mode = 'markdown';
  private projecting = false;
  private unsubscribe?: () => void;
  private abort?: AbortController;
  private caretMoved = signal();
  /** The toolbar states that hold at the caret, such as "strong" or "bulletList". */
  private caretState = new Set<string>();
  private notices = signal<string>();
  private popups = signal<CommandId>();
  private mounted = false;
  private restricted!: HTMLElement;
  private editKind?: EditKind;
  private composing = false;
  private compositionEnded = false;
  private compositionTimer?: ReturnType<typeof setTimeout>;
  private pendingMode?: Mode;
  private projectedSource = '';
  mount(container: HTMLElement, session: DocumentSession, mode: Mode, fileType: FileType = 'markdown') {
    this.dispose();
    this.baseline=null;this.comparison=null;
    this.fileType = fileType;
    this.container = container;
    container.dataset.sourceLanguage=fileType;
    this.session = session;
    this.abort = new AbortController();
    this.markdown = new MarkdownEditor({
      plugins: [
        new Plugin({
          filterTransaction: (tr) => !tr.docChanged || this.projecting || this.mode === 'markdown',
          props: { decorations: state => this.displayDecorations(state) },
        }),
        // Ahead of ProseMirror's base key bindings.
        keymap({
          Enter: (state, dispatch) => this.enter(state, dispatch),
          Tab: () => this.tab(1), 'Shift-Tab': () => this.tab(-1),
          // Ctrl+D runs Delete lines from the command table and Ctrl+Shift+D has no command; neither
          // reaches the browser, even with nothing to delete. Caps Lock swaps the keys' case.
          'Mod-d': () => true, 'Mod-D': () => true, 'Shift-Mod-d': () => true,
        }),
      ],
      // The caret's toolbar state reads the source, which an edit reaches only once accepted.
      onSettled: (before, transactions) => {
        this.acceptChange(before, transactions);
        if (transactions.some(tr => tr.docChanged || tr.selectionSet)) this.caretChanged();
      },
      onNotice: message => this.notices.emit(message),
    });
    this.setPreferences(this.preferences);
    this.mounted = true;
    this.restricted = Object.assign(document.createElement('section'),
      { className: 'gittin-unsupported ww-mode', tabIndex: 0 });
    container.replaceChildren(this.markdown.el, this.restricted);
    const capture = true;
    const handlers: [EventTarget, string, (event: any) => void, boolean?][] = [
      [container, 'keydown', this.keyDown, capture],
      [container, 'mouseover', this.pointAtLink, capture],
      [container, 'focusin', this.pointAtLink, capture],
      [container, 'mouseleave', this.leaveLink],
      [container, 'beforeinput', this.beforeInput, capture],
      [container, 'drop', this.drop, capture],
      [container, 'paste', this.paste, capture],
      [container, 'compositionstart', this.compositionStart, capture],
      [container, 'compositionend', this.compositionEnd, capture],
      [container, 'copy', this.copy, capture],
      [container, 'cut', this.copy, capture],
      [this.restricted, 'toggle', this.displayChanged, capture],
      [this.restricted, 'click', this.followAnchor],
      [this.restricted, 'click', this.followRelativeLink],
      [this.restricted, 'auxclick', this.followRelativeLink],
    ];
    const signal = this.abort.signal;
    for (const [target, type, handler, capture] of handlers)
      target.addEventListener(type, event => handler.call(this, event), { capture, signal });
    this.unsubscribe = session.subscribe(() => {
      if (!this.projecting) this.project(this.session.bookmark);
    });
    this.mode = mode;
    this.session.endGroup();
    this.project(session.bookmark);
    this.session.setBookmark(this.getSelection());
  }
  private keyDown(event: KeyboardEvent) {
    const target = event.target as Element;
    if (target.closest('input,textarea,dialog,button') || !target.closest('.ProseMirror,.gittin-unsupported'))
      return;
    if (this.linkTargetKey(event)) return;
    if (target.closest('a[href],summary') && !event.ctrlKey && !event.metaKey) return;
    if (this.composing) return;
    // Outside editable content WebKit goes back in history on Backspace.
    if (!this.isEditable() && ['Backspace', 'Delete', 'Enter'].includes(event.key)) return stop(event);
    const selectAll = (event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey &&
      event.key.toLowerCase() === 'a';
    if (!this.isEditable() && selectAll) { stop(event); this.selectAll(); return; }
    const command = shortcutCommand(event);
    // Alt+arrows move no lines in Preview or Diff, so they keep their native meaning there.
    if (command && !this.isEditable()) { if (!event.altKey) stop(event); }
    else if (command === 'addLink') { this.popups.emit(command); stop(event); }
    else if (command && (this.execute(command) || command === 'undo' || command === 'redo'))
      stop(event);
  }
  private beforeInput(event: InputEvent) {
    const target = event.target as Element;
    if (!target.closest('.ProseMirror') || target.closest('input,textarea,dialog')) return;
    if (!this.isEditable()) return stop(event);
    const typing = event.inputType === 'insertText' && event.cancelable && !event.isComposing &&
      !this.composing;
    if (typing && event.data) {
      const source = this.session.current.source, selection = this.getSourceSelection();
      const typed = proseTypedCharacter(source, selection, this.fileType, event.data, this.preferences);
      if (typed !== event.data) {
        stop(event);
        const view = this.markdown.view;
        this.editKind = 'typing';
        view.dispatch(view.state.tr.insertText(typed));
        this.editKind = undefined;
        return;
      }
    }
    const command = event.inputType === 'historyUndo' ? 'undo'
      : event.inputType === 'historyRedo' ? 'redo' : undefined;
    if (command && event.cancelable) { stop(event); this.execute(command); }
    else if (!command) {
      const deleting = event.inputType.startsWith('delete');
      this.editKind = deleting ? 'delete' : event.inputType === 'insertFromPaste' ? 'paste' : 'typing';
    }
  }
  /** Preview isn't editable, but a drop would still insert into it. */
  private drop(event: DragEvent) {
    const content = (event.target as Element).closest('.ProseMirror,.gittin-unsupported');
    if (!this.isEditable() && content) stop(event);
  }
  private paste() { if (this.isEditable()) { this.editKind = 'paste'; this.session.endGroup(); } }
  /** Copy and Cut in Edit take the file's exact text, line endings included; Preview and Diff copy what
   * they show. */
  private copy(event: ClipboardEvent) {
    const cut = event.type === 'cut';
    if (!event.clipboardData || cut && (this.composing || !this.isEditable())) return;
    if (this.isEditable()) {
      const source = this.session.current.source, { from, to } = bounds(this.getSourceSelection());
      event.clipboardData.setData('text/plain', source.slice(from, to));
      stop(event);
      if (cut) this.spliceSource(source, from, to);
      return;
    }
    const selection = window.getSelection();
    const within = (node: Node | null) => this.restricted.contains(node);
    if (!selection?.rangeCount || !within(selection.anchorNode) || !within(selection.focusNode)) return;
    const holder = document.createElement('div'); holder.append(selection.getRangeAt(0).cloneContents());
    for (const details of holder.querySelectorAll('details:not([open])')) {
      const summary = details.querySelector('summary');
      details.replaceChildren(...(summary ? [summary] : []));
    }
    event.clipboardData.setData('text/plain', this.selectedReadableText());
    const html = sanitizeHTML(holder.innerHTML).replace(/<br\s*\/?>\n/g, '<br>');
    event.clipboardData.setData('text/html', html);
    stop(event);
  }
  /** A link to a heading in Preview moves to the heading. */
  private followAnchor(event: MouseEvent) {
    const link = (event.target as Element).closest<HTMLAnchorElement>('a[href^="#"]');
    if (!link) return;
    event.preventDefault();
    let id: string;
    try { id = decodeURIComponent(link.getAttribute('href')!.slice(1)); } catch { return; }
    const target = this.byId(id);
    if (!target) return;
    target.tabIndex = -1;
    target.focus({ preventScroll: true });
    target.scrollIntoView({ block: 'start' });
  }
  /** A relative link names a file beside this one, not a Gittin page; the workspace opens it. */
  private followRelativeLink(event: MouseEvent) {
    const href = (event.target as Element).closest<HTMLAnchorElement>('a[href]')?.getAttribute('href');
    this.followRelative(event, href ?? '');
  }
  // Link details: a note under the link the pointer or focus is on, with its address and an Open link.
  private pointAtLink(event: Event) {
    if (this.preferences.showLinkDetails === false || this.mode === 'diff') return;
    const link = (event.target as Element).closest<HTMLElement>('[data-link-url],a[href]');
    const url = link && safeURL(link.dataset.linkUrl || link.getAttribute('href') || '');
    if (link && url) this.showLinkDetails(link, url);
  }
  private leaveLink() {
    const details = this.linkDetails;
    if (!details?.matches(':hover') && !details?.contains(document.activeElement)) details?.remove();
  }
  /** Keys on a link's icon in Edit: Escape closes its details; Enter, Space and Down move into them. */
  private linkTargetKey(event: KeyboardEvent) {
    const plain = !event.ctrlKey && !event.metaKey && !event.altKey;
    if (!(event.target as Element).closest('.source-link-target') || !plain) return false;
    if (!['Enter', ' ', 'ArrowDown', 'Escape'].includes(event.key)) return false;
    stop(event);
    if (event.key === 'Escape') this.linkDetails?.remove();
    else this.linkDetails?.querySelector<HTMLAnchorElement>('a')?.focus();
    return true;
  }
  private showLinkDetails(link: HTMLElement, url: string) {
    this.linkDetails?.remove();
    const details = this.linkDetails =
      Object.assign(document.createElement('div'), { className: 'link-details' });
    details.setAttribute('role', 'note'); details.setAttribute('aria-label', 'Link details');
    const destination = Object.assign(document.createElement('span'), { textContent: url });
    const open = Object.assign(document.createElement('a'),
      { textContent: 'Open link', href: url, target: '_blank', rel: 'noopener noreferrer' });
    for (const type of ['click', 'auxclick'])
      open.addEventListener(type, event => this.followRelative(event as MouseEvent, url));
    details.append(destination, open); document.body.append(details);
    const bounds = link.getBoundingClientRect();
    const left = Math.min(bounds.left, window.innerWidth - details.offsetWidth - 8);
    details.style.left = Math.max(8, left) + 'px';
    details.style.top = Math.min(bounds.bottom + 4, window.innerHeight - details.offsetHeight - 8) + 'px';
    const leave = (to: EventTarget | null) => { if (!details.contains(to as Node)) details.remove(); };
    details.addEventListener('mouseleave', () => leave(document.activeElement));
    details.addEventListener('focusout', event => leave(event.relatedTarget));
    details.addEventListener('keydown', event => {
      if (event.key === 'Escape') { stop(event); this.focusDocument(); details.remove(); }
    });
  }
  /** Keeps the browser from loading a relative link: a plain or middle click hands it to the opener. */
  private followRelative(event:MouseEvent,href:string) {
    if(!isRelative(href)) return;
    event.preventDefault();
    if(event.button!==0&&event.button!==1) return;
    // As for Escape: focus leaves link details before it goes, or its focusout removes it mid-removal.
    const details=this.linkDetails;
    if(details?.contains(document.activeElement)) this.focusDocument();
    details?.remove();
    this.linkOpener?.(href);
  }
  // IME composition: the session holds composed text back until the composition ends.
  private compositionStart() {
    if (!this.isEditable()) return;
    clearTimeout(this.compositionTimer);
    if (this.composing) this.finishComposition();
    this.composing = true;
    this.compositionEnded = false;
    this.session.beginComposition();
  }
  private compositionEnd() {
    if (!this.composing) return;
    this.compositionEnded = true;
    // ProseMirror flushes final DOM composition mutations after the end event.
    this.compositionTimer = setTimeout(() => {
      this.composing = false;
      this.finishComposition();
      const mode = this.pendingMode;
      this.pendingMode = undefined;
      if (mode) this.setMode(mode);
    }, 30);
  }
  /** A committed composition publishes its text; an interrupted candidate is provisional and goes. */
  private finishComposition() {
    this.projecting = true;
    try {
      if (this.compositionEnded) this.session.endComposition();
      else this.session.cancelComposition();
    } finally { this.projecting = false; }
  }
  /** Let an ended native composition publish before capturing a draft or file copy.
   * Active candidates remain provisional; ordinary navigation waits for completion. */
  async settleForPersistence(): Promise<boolean> {
    if (this.composing && !this.compositionEnded) return false;
    if (this.composing) await new Promise<void>((resolve) => setTimeout(resolve, 40));
    return !this.composing;
  }
  private project(bookmark?: Bookmark) {
    this.projecting = true;
    try {
      const source = this.session.current.source;
      this.projectedSource = source;
      const projection = createProjection(source);
      if (this.mode === 'markdown') this.markdown.setMarkdown(projection.text);
      else this.showReadOnly(source);
      if (bookmark) this.restoreSelection(bookmark);
    } finally {
      this.projecting = false;
      this.markdown.el.hidden = this.mode !== 'markdown';
      this.restricted.hidden = this.mode === 'markdown';
    }
  }
  private showReadOnly(source: string) {
    this.restricted.replaceChildren();
    this.restricted.setAttribute('aria-label',this.mode==='diff'?'Document comparison':'Document preview');
    this.restricted.setAttribute('aria-readonly','true');
    const content=document.createElement('div');content.dataset.readable='';content.className='ProseMirror';content.setAttribute('contenteditable','false');content.tabIndex=0;content.setAttribute('aria-readonly','true');content.setAttribute('aria-label',this.mode==='diff'?'Document comparison text':'Document preview');
    content.classList.add(this.mode==='diff' ? 'document-diff' : this.fileType==='markdown' ? 'document-markdown' : 'document-source');
    const notice=document.createElement('p');notice.className='view-notice';
    if(this.mode==='diff') {
      const baseline=this.comparison ?? this.baseline;
      const diff=baseline?lineDiff(baseline.source,source):null;
      const unchanged=!!diff&&diff.lines.every(line=>line.kind==='same');
      notice.textContent=this.comparison ? `Temporary comparison: ${this.comparison.label} versus current draft. Normal opened/saved baseline is retained.${unchanged?' No changes.':''}` : baseline ? unchanged ? 'No changes since the file was opened or saved.' : '' : 'No baseline yet. Open a file or explicitly save this file to compare versions. Recovery autosave does not create a baseline.';
      if(this.comparison) {const clear=document.createElement('button');clear.textContent='Clear temporary comparison';clear.onclick=()=>this.clearComparison();notice.append(' ',clear);}
      if(baseline && diff) {
        if(diff.coarse) notice.append(' Coarse comparison: input exceeds the exact line-diff limit; complete old and new versions are shown as removed and added, subject to Show comments; token colors are unavailable in this fallback.');
        renderDiff(content,diff,baseline.source,source,this.fileType,this.display);
      } else {const empty=document.createElement('p');empty.textContent='No comparison available.';content.append(empty);}
    } else if(this.fileType==='markdown') {
      const { warnings, extras } = this.renderMarkdown(source, content);
      // Maths, emoji and diagrams replace text nodes, so find offsets taken earlier are stale.
      void extras.then(() => { if (content.isConnected) this.displayChanged(); });
      this.cachePreviewDescription(source, warnings);
    } else {
      this.cachePreviewDescription(source);
      const pre=document.createElement('pre');appendSource(pre,source,this.fileType,this.display);content.append(pre);
    }
    if(this.mode==='diff' && notice.hasChildNodes()) this.restricted.append(notice);
    this.restricted.append(content);
  }
  private cachePreviewDescription(source: string, warnings: string[] = []) {
    let text = 'Readable ' + this.fileType + ' source. Code and HTML are never executed.';
    if (this.fileType === 'unknown')
      text = 'Unknown language: readable uncolored source. Code is never executed.';
    if (this.fileType === 'markdown') text = 'Preview is read-only.';
    if (warnings.length)
      text = 'Preview qualification: ' + warnings.join('; ') + '. Use Edit to change the source.';
    this.previewDescription = { source, fileType: this.fileType, display: this.display, text };
    return text;
  }
  /** Compute the tooltip on demand, including before Preview is first opened. */
  getPreviewDescription() {
    const source = this.session.current.source, cached = this.previewDescription;
    if(cached?.source === source && cached.fileType === this.fileType && cached.display === this.display) return cached.text;
    const warnings = this.fileType === 'markdown' ? renderPreview(source, document.createElement('div'), this.display) : [];
    return this.cachePreviewDescription(source, warnings);
  }
  setBaseline(version: SourceVersion | null) {
    if(this.baseline?.source===version?.source && this.baseline?.revision===version?.revision) return;
    this.baseline=version ? {...version}:null;
    if(this.mounted && this.mode==='diff') this.refreshDisplay();
  }
  setComparison(source:string,label:string) {this.comparison={source,label:label.trim()||'Comparison source'};if(this.mounted) this.setMode('diff');}
  setLinkOpener(open:LinkOpener|null) {this.linkOpener=open;}
  setImageResolver(resolver:ImageResolver|null) {this.imageResolver=resolver;if(this.mounted&&this.mode==='preview')this.refreshDisplay();}
  /** Replace the whole source as one undoable edit. */
  replaceSource(source:string) {this.session.applyWriteSource(source,'replace',this.getSelection());}
  clearComparison() {this.comparison=null;if(this.mounted && this.mode==='diff')this.refreshDisplay();}
  setPreferences(preferences: Preferences) {
    this.preferences = preferences;
    if (!this.markdown) return;
    this.markdown.view.setProps({attributes:{'aria-label':'Markdown source editor', spellcheck:String(spellcheckEnabled(preferences,this.fileType)), autocorrect:'off', autocapitalize:'off'}});
    if (preferences.showLinkDetails === false) this.linkDetails?.remove();
    if (this.mounted) this.redraw();
  }
  setDisplaySettings(patch:Partial<DisplaySettings>) {
    this.display={...this.display,...patch};
    if(!this.mounted) return;
    this.container.classList.toggle('syntax-off',!this.display.syntaxHighlighting);
    this.container.classList.toggle('wrap-off',!this.display.wordWrap);
    if(this.mode==='markdown') this.redraw();
    else this.refreshDisplay();
  }
  /** Redraws Edit's decorations. */
  private redraw() { this.drawn = undefined; this.markdown.view.dispatch(this.markdown.view.state.tr); }
  private refreshDisplay() { this.showReadOnly(this.session.current.source); this.displayChanged(); }
  /** What Preview or Diff shows changed, so find offsets taken earlier are stale. */
  private displayChanged() { this.displayEpoch++; this.clearFind(); this.modeChanged.emit(this.mode); }
  /** The decorations last drawn, kept while the document is the same: a caret move reuses them.
   * Preferences, display settings and file type change them through redraw(). */
  private drawn?: { doc: PMNode; set: DecorationSet };
  private displayDecorations(state:EditorState) {
    if(!this.mounted) return DecorationSet.empty;
    if (this.drawn?.doc === state.doc) return this.drawn.set;
    // The text being drawn: an edit reaches the session's source only after the view draws it.
    const source=state.doc.textBetween(0,state.doc.content.size,'\n'), p=createProjection(source);
    const decorations:Decoration[]=[], native=p.toNative;
    for(const span of coloredSpans(source,this.fileType)) {
      const classes=[];
      // Markdown source stays neutral; document styling belongs to Preview.
      if(this.fileType!=='markdown'&&this.display.syntaxHighlighting)classes.push('syntax-'+span.kind);
      if(span.kind==='comment'&&!this.display.showComments)classes.push('hidden-comment');
      if(classes.length)decorations.push(Decoration.inline(native(span.from),native(span.to),{class:classes.join(' ')}));
    }
    if (this.fileType === 'markdown') {
      decorations.push(...this.emphasis(source, p));
      let at = 0;
      for (const span of proseRanges(source,this.fileType)) {
        if (at < span.from) decorations.push(Decoration.inline(native(at),native(span.from),{spellcheck:'false'}));
        at = span.to;
      }
      if (at < source.length) decorations.push(Decoration.inline(native(at),native(source.length),{spellcheck:'false'}));
      if (this.preferences.showLinkDetails !== false) for (const link of sourceLinks(source)) {
        decorations.push(Decoration.inline(native(link.from),native(link.to),{'data-link-url':link.url,class:'source-link'}));
        // A noneditable display widget keeps keyboard focus outside the editing host.
        decorations.push(Decoration.widget(native(link.to),()=>{
          const target=document.createElement('span');target.contentEditable='false';target.tabIndex=0;
          target.className='source-link-target';target.dataset.linkUrl=link.url;target.setAttribute('role','link');target.setAttribute('aria-label','Link to '+link.url);target.title=link.url+' — Arrow down for Open link';target.append(icon('external-link'));return target;
        },{key:'link-'+link.from+'-'+link.url}));
      }
    }
    if(this.display.whitespace) {
      for(const match of source.matchAll(/[ \t]/g)) decorations.push(Decoration.inline(native(match.index!),native(match.index!+1),{class:match[0]===' '?'visible-space':'visible-tab'}));
      state.doc.forEach((node,pos,index)=>{if(index<state.doc.childCount-1)decorations.push(Decoration.node(pos,pos+node.nodeSize,{class:'visible-newline'}));});
    }
    this.drawn = { doc: state.doc, set: DecorationSet.create(state.doc, decorations) };
    return this.drawn.set;
  }
  /** Markdown emphasis in Edit: bold, italic and struck text inside its delimiters, with heading lines,
   * list markers and a checked task's x bold too. The classes are the stylesheet's. */
  private emphasis(source: string, p: ReturnType<typeof createProjection>) {
    const decorations: Decoration[] = [];
    const add = (from: number, to: number, kind: string) => decorations.push(
      Decoration.inline(p.toNative(from), p.toNative(to), { class: 'gittin-editor-md-' + kind }));
    for (const node of markdownNodes(source)) {
      const { type } = node;
      if (!['strong', 'emph', 'strike', 'heading', 'item'].includes(type)) continue;
      const { from, to } = p.rangeOf(node.sourcepos!);
      if (type === 'heading') add(from, to, 'heading');
      else if (type === 'item') {
        const { padding, task, checked } = (node as ListItemMdNode).listData;
        add(from, from + padding, 'list-item-style');
        if (task && checked) add(from + padding + 1, from + padding + 2, 'list-item-style');
      } else {
        // The delimiters stay plain: two characters for bold, one for italic, one or two tildes.
        const size = type === 'strong' || type === 'strike' && source[from + 1] === '~' ? 2 : 1;
        add(from + size, to - size, type);
      }
    }
    return decorations;
  }
  private acceptChange(before: EditorState, transactions: readonly Transaction[]) {
    if (this.projecting || this.mode !== 'markdown' || !transactions.length) return;
    if (!transactions.some(tr => tr.docChanged)) return this.session.setBookmark(this.getSelection());
    const beforeBookmark = this.bookmarkFor(before.doc, before.selection.anchor, before.selection.head);
    this.session.setBookmark(beforeBookmark);
    this.projecting = true;
    try {
      let source = this.projectedSource;
      // Reconcile each accepted step independently: separated edits cannot normalize the raw text between them.
      for (const tr of transactions)
        for (let i = 0; i < tr.steps.length; i++) {
          const step = tr.steps[i];
          const oldDoc = tr.docs[i], newDoc = i + 1 < tr.docs.length ? tr.docs[i + 1] : tr.doc;
          const rawPaste = tr.getMeta('rawPaste');
          if (i === 0 && typeof rawPaste === 'string' && typeof step.from === 'number' &&
            typeof step.to === 'number') {
            const from = markdownOffset(oldDoc, step.from), to = markdownOffset(oldDoc, step.to);
            const candidate = replaceDisplay(source, from, to, rawPaste, true);
            if (createProjection(candidate).text === newDoc.textBetween(0, newDoc.content.size, '\n')) {
              source = candidate;
              continue;
            }
          }
          const edits = markdownStepEdits(oldDoc, newDoc, step.getMap());
          // Maps use the pre-step coordinates. Apply from the end so an earlier
          // range cannot be shifted by an insertion/deletion in a later range.
          for (const edit of edits.reverse())
            source = replaceDisplay(source, edit.from, edit.to, edit.insert);
        }
      const accepted = this.markdown.view.state.doc;
      if (createProjection(source).text !== accepted.textBetween(0, accepted.content.size, '\n'))
        throw Error('Accepted Markdown does not match the canonical projection');
      const pasted = transactions.some(tr => tr.getMeta('uiEvent') === 'paste');
      const shorter = source.length < this.projectedSource.length;
      const kind: EditKind = this.composing ? 'composition'
        : this.editKind ?? (pasted ? 'paste' : shorter ? 'delete' : 'typing');
      if (source !== this.projectedSource) {
        const edit = textEdit(this.projectedSource, source)!;
        let substitution: SourceCommandResult | null = null;
        const nativeSelection = this.markdown.view.state.selection;
        const { automaticSubstitution: automatic, substitutions } = this.preferences;
        if (kind === 'typing' && before.selection.empty && nativeSelection.empty &&
            automatic !== false && substitutions?.some(rule => rule.enabled) &&
            !pasted) {
          // Use the actual caret, not the minimal diff, when adjacent spaces repeat.
          const at = beforeBookmark.sourceAnchor, added = source.length - this.projectedSource.length;
          const insert = source.slice(at, at + added);
          if (added > 0 && splice(this.projectedSource, at, at, insert) === source) {
            const caret = createProjection(source).toRaw(markdownOffset(accepted, nativeSelection.head));
            const typed = { from: at, to: at, insert }, selection = { anchor: caret, head: caret };
            substitution = automaticSubstitution(source, selection, this.fileType, typed, this.preferences);
          }
        }
        this.projectedSource = source;
        this.session.applySourceEdit(edit, kind, this.getSelection());
        if (substitution) {
          // Keep the literal typing in history: one Undo rejects the expansion.
          const bookmark = this.sourceBookmark(substitution.source, substitution.selection);
          this.session.applyWriteSource(substitution.source, 'command', bookmark);
          this.project(bookmark);
        }
      }
    } catch {
      this.notices.emit('The edit could not be converted. Your original source is still available.');
      this.project(beforeBookmark);
    } finally {
      this.projecting = false;
      this.editKind = undefined;
    }
  }
  setMode(mode: Mode) {
    this.contextEpoch++;
    if (!this.mounted) return;
    if (this.composing) { this.pendingMode = mode; return; }
    const current = this.projectedSource === this.session.current.source;
    const bookmark = current ? this.getSelection() : this.session.bookmark;
    this.session.endGroup();
    this.clearFind();
    this.mode = mode;
    this.project(bookmark);
    this.modeChanged.emit(mode);
    this.session.setBookmark(this.getSelection());
  }
  /** The commands that are neither source commands nor table operations. */
  private routes: Partial<Record<CommandId, () => boolean>> = {
    selectAll: () => { this.selectAll(); return true; },
    copy: () => { void this.clipboard('copy'); return true; },
    cut: () => { void this.clipboard('cut'); return true; },
    paste: () => { void this.clipboard('paste'); return true; },
    undo: () => this.session.undo(),
    redo: () => this.session.redo(),
    hr: () => this.insertElement({ kind: 'hr' }),
    codeBlock: () => this.insertElement({ kind: 'codeBlock' }),
  };
  /** Runs a command; `level` is Heading's, 0 for a paragraph. */
  execute(command: CommandId, level = 0) {
    if (!this.mounted || this.composing || !(command in commandRegistry)) return false;
    // Copy and Select all also work in Preview and Diff.
    const readOnly = command === 'copy' || command === 'selectAll';
    if (!readOnly && (!this.isEditable() || this.commandState(command).disabled)) return false;
    if ((sourceCommands as readonly string[]).includes(command))
      return this.applySourceCommand(command as SourceCommand, level);
    if ('writeOnly' in commandRegistry[command]) return this.transformTable(command as TableOperation);
    return this.routes[command]?.() ?? false;
  }
  setFileType(type: FileType) {
    if (this.fileType === type) return;
    this.contextEpoch++;
    this.fileType = type;
    this.setPreferences(this.preferences);
    if(this.mounted)this.container.dataset.sourceLanguage=type;
    if (this.mounted) { if (!this.composing) this.project(this.getSelection()); this.caretChanged(); }
  }
  getFileType() { return this.fileType; }
  getSourceSelection(): SourceSelection {
    const { anchor, head } = this.markdown.view.state.selection;
    const doc = this.markdown.view.state.doc, projection = createProjection(this.session.current.source);
    return { anchor: projection.toRaw(markdownOffset(doc, anchor)), head: projection.toRaw(markdownOffset(doc, head)) };
  }
  private sourceBookmark(source: string, selection: SourceSelection): Bookmark {
    const p = createProjection(source);
    return { mode: 'markdown', anchor: p.toNative(selection.anchor), head: p.toNative(selection.head),
      sourceAnchor: selection.anchor, scrollTop: this.markdown.getScrollTop() };
  }
  /** For tests: selects raw source offsets in Edit and focuses it. */
  selectSource(anchor: number, head = anchor) {
    this.restoreSelection(this.sourceBookmark(this.session.current.source, { anchor, head }));
    this.markdown.view.focus();
  }
  /** Enter is typing: the next item on a Markdown list item, if lists continue; otherwise a new line. */
  private enter(state: EditorState, dispatch?: (tr: Transaction) => void) {
    const result = this.fileType === 'markdown' && this.preferences.continueLists !== false
      ? continuation(this.session.current.source, this.getSourceSelection()) : null;
    if (result) this.typeSource(result);
    else {
      this.editKind = 'typing';
      splitBlock(state, dispatch);
      this.editKind = undefined;
    }
    return true;
  }
  /** Tab and Shift+Tab: the next or previous cell in a Markdown table, else indent or outdent. */
  private tab(step: 1 | -1) {
    const source = this.session.current.source;
    const cell = this.fileType === 'markdown' ? tableCell(source, this.getSourceSelection(), step) : null;
    if (cell) this.restoreSelection(this.sourceBookmark(source, cell));
    else this.applySourceCommand(step > 0 ? 'indent' : 'outdent');
    return true;
  }
  /** Applies a source result as one typing transaction, so substitutions and undo grouping still apply. */
  private typeSource(result: SourceCommandResult): void {
    const view = this.markdown.view, { schema } = view.state, tr = view.state.tr;
    const before = createProjection(this.session.current.source), after = createProjection(result.source);
    const edit = textEdit(before.text, after.text);
    if (edit) {
      const lines = edit.insert.split('\n')
        .map(text => schema.nodes.paragraph.create(null, text ? schema.text(text) : null));
      const native = (offset: number) => before.toNative(before.toRaw(offset));
      tr.replace(native(edit.from), native(edit.to), new Slice(Fragment.from(lines), 1, 1));
    }
    const { anchor, head } = result.selection;
    tr.setSelection(TextSelection.create(tr.doc, after.toNative(anchor), after.toNative(head)));
    this.editKind = 'typing';
    view.dispatch(tr.scrollIntoView());
    this.editKind = undefined;
  }
  /** A single canonical source transaction, shared with typing and Find history. */
  applySourceCommand(command: SourceCommand, level = 0) {
    if (!this.mounted || this.composing || !this.isEditable()) return false;
    if (command === 'heading' && (!Number.isInteger(level) || level < 0 || level > 6)) return false;
    const result = transformSource(this.session.current.source, this.getSourceSelection(), command, this.fileType, level);
    return result ? this.applySourceResult(result) : false;
  }
  /** Dialog captures are invalid after a source revision, mode/type/navigation or lifetime change. */
  captureSourceContext(): SourceContext {
    const version=this.session.current,epoch=this.contextEpoch;
    const type=this.fileType,bookmark=this.getSelection();
    const selection=Object.freeze(this.getSourceSelection());
    // The epoch changes with the session, mode, file type and mount.
    const stable=()=>
      this.contextEpoch===epoch&&!this.composing&&this.isEditable()&&this.session.current===version;
    const same=({anchor,head}:SourceSelection)=>anchor===selection.anchor&&head===selection.head;
    const valid=()=>stable()&&same(this.getSourceSelection());
    return {source:version.source,selection,type,valid,
      restore:()=>{if(stable()){this.restoreSelection(bookmark);this.markdown.view.focus();}},
      apply:(transform:(source:string,selection:SourceSelection,type:FileType)=>SourceCommandResult|null)=>{if(!valid())return false;const result=transform(version.source,selection,type);if(!result||!valid())return false;this.restoreSelection(bookmark);return this.applySourceResult(result);}
    };
  }
  insertElement(request:ElementRequest) { return this.captureSourceContext().apply((source,selection,type)=>insertElement(source,selection,type,request)); }
  transformTable(operation:TableOperation,align?:'left'|'center'|'right') {return this.captureSourceContext().apply((source,selection,type)=>type==='markdown'?transformTable(source,selection,operation,align):null);}
  transformImage(request:ImageTransform) {return this.captureSourceContext().apply((source,selection,type)=>type==='markdown'?transformImage(source,selection,request):null);}
  sourceTableContext() {return this.isEditable()&&this.fileType==='markdown'?tableContext(this.session.current.source,this.getSourceSelection()):null;}
  sourceImageContext() {return this.isEditable()&&this.fileType==='markdown'?imageContext(this.session.current.source,this.getSourceSelection()):null;}
  private applySourceResult(result: SourceCommandResult) {
    if (!this.mounted || this.composing || !this.isEditable() || result.source === this.session.current.source) return false;
    this.session.endGroup();
    this.session.setBookmark(this.getSelection());
    this.session.applyWriteSource(result.source, 'command', this.sourceBookmark(result.source,result.selection));
    this.session.endGroup();
    this.markdown.view.focus();
    return true;
  }
  private selectAll() {
    if (this.mode !== 'markdown') {
      const range = document.createRange(); range.selectNodeContents(this.readable!);
      window.getSelection()?.removeAllRanges(); window.getSelection()?.addRange(range);
    } else { const view = this.markdown.view; view.dispatch(view.state.tr.setSelection(new AllSelection(view.state.doc))); view.focus(); }
  }
  private selectedReadableText() {
    const selection=window.getSelection(),content=this.readable;
    if(!selection?.rangeCount || !content || !content.contains(selection.anchorNode) || !content.contains(selection.focusNode))return '';
    let text=selection.toString();
    const full=document.createRange();full.selectNodeContents(content);
    const selected=selection.getRangeAt(0);
    // WebKit includes paragraph layout gaps at the end of a full DOM selection.
    // Only remove those gaps for rendered prose; source/code and partial selections retain whitespace.
    if(this.mode==='preview' && this.fileType==='markdown' && content.lastElementChild?.tagName!=='PRE' &&
      selected.compareBoundaryPoints(Range.START_TO_START,full)===0 && selected.compareBoundaryPoints(Range.END_TO_END,full)===0)
      text=text.replace(/\n+$/,'');
    return text;
  }
  async clipboard(action: 'copy' | 'cut' | 'paste') {
    if (!this.mounted || this.composing || action !== 'copy' && !this.isEditable()) return false;
    const { source, selection, valid } = this.captureSourceContext(), { from, to } = bounds(selection);
    try {
      if (action === 'paste') {
        const text = await navigator.clipboard.readText();
        return valid() && this.spliceSource(source, from, to, text);
      }
      const text = this.mode === 'markdown' ? source.slice(from, to) : this.selectedReadableText();
      if (!text) return false;
      await navigator.clipboard.writeText(text);
      return action === 'copy' || valid() && this.spliceSource(source, from, to);
    } catch {
      this.notices.emit(
        'Clipboard access is unavailable. Use the device keyboard shortcut to ' + action + ' plain text.');
      return false;
    }
  }
  /** Replaces from..to of the source with text as one command step, leaving the caret after it. */
  private spliceSource(source: string, from: number, to: number, text = '') {
    const caret = from + text.length, selection = { anchor: caret, head: caret };
    return this.applySourceResult({ source: splice(source, from, to, text), selection });
  }
  private bookmarkFor(doc: PMNode, anchor: number, head: number): Bookmark {
    const sourceAnchor = createProjection(this.projectedSource).toRaw(markdownOffset(doc, anchor));
    return { mode: this.mode, anchor, head, sourceAnchor, scrollTop: this.markdown.getScrollTop() };
  }
  getSelection(): Bookmark {
    const bookmark = this.session.bookmark ?? { anchor: 0, head: 0, sourceAnchor: 0 };
    if (this.mode !== 'markdown')
      return { ...bookmark, mode: this.mode, scrollTop: this.restricted.scrollTop };
    const { selection, doc } = this.markdown.view.state;
    return this.bookmarkFor(doc, selection.anchor, selection.head);
  }
  private restoreSelection(bookmark: Bookmark) {
    if (this.mode !== 'markdown') { this.restricted.scrollTop = bookmark.scrollTop; return; }
    const view = this.markdown.view, doc = view.state.doc, near = (at: number) =>
      Selection.near(doc.resolve(Math.max(0, Math.min(doc.content.size, at))));
    let { anchor, head } = bookmark;
    if (bookmark.mode !== this.mode)
      anchor = head = createProjection(this.projectedSource).toNative(bookmark.sourceAnchor);
    const a = near(anchor), h = near(head);
    const both = a instanceof TextSelection && h instanceof TextSelection;
    view.dispatch(view.state.tr.setSelection(both ? TextSelection.create(doc, a.head, h.head) : a));
    this.markdown.setScrollTop(bookmark.scrollTop);
  }
  /** 1-based caret line and column in Edit. The Markdown document holds one paragraph per source line. */
  caretPosition(): { line: number; column: number } | null {
    if (!this.mounted || this.mode !== 'markdown') return null;
    const { doc, selection } = this.markdown.view.state;
    const head = doc.resolve(selection.head);
    return { line: head.index(0) + 1, column: head.parentOffset + 1 };
  }
  /** Viewport top of the caret in Edit, for Focus mode's typewriter scrolling. */
  caretTop(): number | null {
    if (!this.mounted || this.mode !== 'markdown') return null;
    const view = this.markdown.view;
    return view.coordsAtPos(view.state.selection.head).top;
  }
  focusDocument() {
    if(this.mode==='markdown')this.markdown.view.focus();else this.readable?.focus();
  }
  /** Preview's or Diff's content. */
  private get readable() {
    return this.restricted.querySelector<HTMLElement>('[data-readable]');
  }
  private byId(id: string) {
    return [...this.restricted.querySelectorAll<HTMLElement>('[id]')].find(el => el.id === id);
  }
  captureSelection() {
    if(!this.isEditable()) return () => this.restricted.focus();
    return this.captureSourceContext().restore;
  }
  getLinkValues(): { linkText: string; linkUrl?: string } {
    if(!this.isEditable())return {linkText:''};
    const source=this.session.current.source,selection=this.getSourceSelection(),link=linkContext(source,selection);
    if(link){this.restoreSelection(this.sourceBookmark(source,{anchor:link.from,head:link.to}));return {linkText:link.alt,linkUrl:link.url};}
    const {from,to}=bounds(selection);return {linkText:source.slice(from,to)};
  }

  subscribeMode(listener: (mode: Mode) => void) { return this.modeChanged.on(listener); }
  isEditable() { return this.mode === 'markdown'; }
  commandState(command: CommandId) {
    const entry = commandRegistry[command];
    if (command === 'copy' || command === 'selectAll') return { selected:false, disabled:this.composing };
    if (command === 'convertToComment' || command === 'convertToText') {
      return { selected:false, disabled:this.composing || !this.mounted || !this.isEditable() || !this.conversionAvailable(command) };
    }
    if ('writeOnly' in entry) {
      const c=this.sourceTableContext();
      const disabled=!c||this.composing||(command==='removeColumn'&&c.columnCount<=1)||(command==='removeRow'&&(c.row<2||c.rows.length<=3));
      return {selected:false,disabled};
    }
    const applicable = (sourceCommands as readonly string[]).includes(command)
      ? sourceCommandAvailable(command, this.fileType)
      : ['undo', 'redo', 'cut', 'paste'].includes(command) || this.fileType === 'markdown';
    const stats = this.session.historyStats;
    const nothingToDo =
      command === 'undo' ? stats.undoGroups === 0 : command === 'redo' && stats.redoGroups === 0;
    // Markdown state means nothing in a code file: a YAML "# comment" line is not a heading.
    // Nor in Preview or Diff, where the controls are disabled and Edit's last state would linger.
    return {
      selected: applicable && this.isEditable() && 'state' in entry &&
        this.caretState.has(entry.state),
      disabled: this.composing || !applicable || !this.isEditable() || nothingToDo,
    };
  }
  private conversions: Partial<Record<'convertToComment' | 'convertToText', { source: string; anchor: number; head: number; fileType: FileType; available: boolean }>> = {};
  private conversionAvailable(command: 'convertToComment' | 'convertToText') {
    const source=this.session.current.source,{anchor,head}=this.getSourceSelection(),last=this.conversions[command];
    if(last&&last.source===source&&last.anchor===anchor&&last.head===head&&last.fileType===this.fileType)return last.available;
    const available=!!transformSource(source,{anchor,head},command,this.fileType);
    this.conversions[command]={source,anchor,head,fileType:this.fileType,available};
    return available;
  }
  blockLabel() {
    let node = this.caretNode();
    while (node && node.type !== 'heading') node = node.parent;
    return node ? 'Heading ' + (node as HeadingMdNode).level : 'Paragraph';
  }
  /** The parsed node at the caret: the character before it, or at a line start the first one. */
  private caretNode(): MdNode | null {
    if (!this.mounted || this.mode !== 'markdown' || this.fileType !== 'markdown') return null;
    const { $from } = this.markdown.view.state.selection;
    const root = markdownNodes(this.session.current.source)[0];
    return findNodeAtPosition(root, [$from.index(0) + 1, Math.max(1, $from.parentOffset)]);
  }
  /** Toolbar states at the caret: of its node and the node's ancestors, and of the nearest list only. */
  private caretStates() {
    const states = new Set<string>();
    let inList = false;
    for (let node = this.caretNode(); node && node.type !== 'document'; node = node.parent) {
      const data = node.type === 'list' || node.type === 'item' ? (node as ListItemMdNode).listData : null;
      const list = data && (data.task ? 'taskList' : data.type === 'ordered' ? 'orderedList' : 'bulletList');
      const type = list || node.type;
      if (type === 'bulletList' || type === 'orderedList') {
        if (!inList) states.add(type);
        inList = true;
      } else if (caretStateTypes.includes(type)) states.add(type);
    }
    return states;
  }
  private caretChanged() {
    this.caretState = this.caretStates();
    this.caretMoved.emit();
  }
  /** The text Preview or Diff shows: none hidden, nor in a closed details outside its summary. */
  private readableTextNodes() {
    const content = this.readable, closed = 'details:not([open])';
    return content ? textNodes(content, `[hidden], ${closed} > :not(summary)`)
      .filter(node => !node.parentElement!.matches(closed)) : [];
  }
  visibleText() {
    if (this.mode !== 'markdown') return this.readableTextNodes().map(node => node.data).join('');
    const { doc } = this.markdown.view.state;
    return doc.textBetween(0, doc.content.size, '\n');
  }
  findSnapshot(): FindSnapshot {
    const starts: number[] = [], ends: number[] = [], markdown = this.mode === 'markdown';
    const text = markdown ? this.session.current.source : this.visibleText();
    if (markdown) {
      const p = createProjection(text);
      for (let i = 0; i < text.length; i++) { starts.push(p.toNative(i)); ends.push(p.toNative(i + 1)); }
    }
    const { id, current: { revision } } = this.session;
    return { id, revision, mode: this.mode, text, starts, ends, editable: this.isEditable(),
      displayEpoch: this.displayEpoch };
  }
  validFind(snapshot: FindSnapshot) {
    const { id, revision, mode, displayEpoch } = snapshot;
    return this.mounted && !this.composing && id === this.session.id && mode === this.mode &&
      revision === this.session.current.revision && displayEpoch === this.displayEpoch;
  }
  clearFind() {
    if (!this.mounted) return;
    this.markdown.view.setProps({ decorations: () => DecorationSet.empty });
    for (const mark of this.restricted.querySelectorAll('mark[data-find]'))
      mark.replaceWith(...mark.childNodes);
    this.restricted.normalize();
  }
  highlightFind(snapshot: FindSnapshot, matches: Match[], current: number, scroll = false) {
    this.clearFind();
    if (!this.validFind(snapshot)) return;
    const kind = (i: number) => (i === current ? 'find-current' : 'find-match');
    if (this.mode !== 'markdown') {
      let offset = 0;
      for (const node of this.readableTextNodes()) {
        const start = offset;
        offset += node.length;
        const ranges = matches
          .map((m, i) => ({ i, from: Math.max(0, m.from - start), to: Math.min(node.length, m.to - start) }))
          .filter(m => m.to > m.from);
        for (const m of ranges.reverse()) {
          const part = node.splitText(m.from), mark = document.createElement('mark');
          part.splitText(m.to - m.from);
          mark.dataset.find = ''; mark.className = kind(m.i);
          part.replaceWith(mark); mark.append(part);
        }
      }
      if (scroll) this.restricted.querySelector('.find-current')?.scrollIntoView({ block: 'center' });
      return;
    }
    const view = this.markdown.view, last = view.state.doc.content.size - 1;
    const ranges = matches.map((m, i) => {
      const from = snapshot.starts[m.from] ?? last;
      return { i, from, to: m.to === m.from ? from : snapshot.ends[m.to - 1] };
    });
    // DecorationSet.create takes over the array it is given, so each call builds its own.
    const marks = () =>
      ranges.filter(m => m.to > m.from).map(m => Decoration.inline(m.from, m.to, { class: kind(m.i) }));
    view.setProps({ decorations: state => DecorationSet.create(state.doc, marks()) });
    if (scroll && ranges[current]) {
      const { from, to } = ranges[current];
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)));
      view.dom.querySelector('.find-current')?.scrollIntoView({ block: 'center' });
    }
  }
  replaceFind(snapshot: FindSnapshot, matches: Match[], replacement: string) {
    if (!this.validFind(snapshot) || !this.isEditable() || !snapshot.editable || !matches.length) return false;
    this.session.endGroup();
    this.clearFind();
    const source = this.session.current.source, parts: string[] = [];
    const insert = replacement.replace(/\r\n|\r|\n/g, newlineStyle(source));
    let offset = 0;
    for (const m of matches) { parts.push(source.slice(offset, m.from), insert); offset = m.to; }
    parts.push(source.slice(offset));
    this.session.applyWriteSource(parts.join(''), 'replace', this.getSelection());
    this.session.endGroup();
    return true;
  }
  goToSource(offset: number) {
    if(this.mode==='preview') {
      const heading=headingAnchors(this.session.current.source).find(h=>h.from===offset);
      if(heading) {
        const target=this.byId(heading.id);
        target?.scrollIntoView({block:'start'});target?.focus();return;
      }
    }
    if(this.mode!=='markdown')this.setMode('markdown');
    this.restoreSelection({...this.getSelection(),mode:'preview',sourceAnchor:offset});
    this.markdown.view.focus();this.markdown.view.dispatch(this.markdown.view.state.tr.scrollIntoView());
  }
  getMode() { return this.mode; }
  /** Calls the listener now and whenever the caret's toolbar state may have changed. */
  subscribeToolbar(listener: () => void) {
    const off = this.caretMoved.on(listener);
    listener();
    return off;
  }
  subscribeNotice(listener: (message: string) => void) { return this.notices.on(listener); }
  subscribePopup(listener: (command: CommandId) => void) { return this.popups.on(listener); }
  /** Markdown as Preview shows it: the warnings, and the extras still loading. */
  private renderMarkdown(source: string, container: HTMLElement) {
    const warnings = renderPreview(source, container, this.display);
    resolveImages(container, this.imageResolver);
    return { warnings, extras: renderPreviewExtras(container) };
  }
  renderReadOnly(source: string, container: HTMLElement) {
    return this.renderMarkdown(source, container).extras;
  }
  /** Redraws Preview's diagrams in the current appearance, leaving the rest of Preview where it is. */
  async redrawDiagrams() {
    if (this.mode !== 'preview') return;
    const figures = [...this.restricted.querySelectorAll<HTMLElement>('.preview-diagram[data-mermaid]')];
    if (!figures.length) return;
    await (await import('./preview-diagrams')).renderDiagrams(figures);
    // As after the first render: the diagrams' text changed, so find offsets taken earlier are stale.
    if (figures[0].isConnected) this.displayChanged();
  }
  dispose() {
    this.linkDetails?.remove();
    this.contextEpoch++;
    clearTimeout(this.compositionTimer);
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    // A committed composition awaiting its timer must flush; an interrupted IME
    // candidate is provisional and must never become a saved source revision.
    if (this.composing) this.finishComposition();
    this.composing = false;
    this.pendingMode = undefined;
    this.session?.endGroup();
    this.abort?.abort();
    if (this.mounted) {
      this.markdown.destroy();
      this.container.replaceChildren();
    }
    this.mounted = false;
  }
}
