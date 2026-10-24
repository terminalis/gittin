import type { GittinController } from '../editor/controller';
import type { DevicePreferences } from '../preferences';
import type { FileType } from '../documents/file-types';
import { attributionText, type AttributionFormat, type Attribution } from '../editor/attributions';
import { decodeSource, newlineStyle } from '../editor/source-projection';
import { markdownLinks } from '../editor/prose-preferences';
import { safeURL } from '../editor/safe-url';
import { syntaxSpans } from '../editor/source-language';
import { headingAnchors } from '../editor/heading-anchors';
import { fragment } from '../sources/paths';
import {
  button, checkbox, choiceRow, copyText, dropDown, el, errorText, fileDialog, listRow, notice, textField,
} from './dom';
export function fileStatistics(source: string) {
  return {
    words: source.trim() ? source.trim().split(/\s+/).length : 0,
    characters: Array.from(source).length,
    lines: source ? source.split(/\r\n|\r|\n/).length : 0,
    bytes: new TextEncoder().encode(source).length,
  };
}
export function emailURL(title: string, source: string) {
  return 'mailto:?subject=' + encodeURIComponent(title) + '&body=' + encodeURIComponent(source);
}
// Client/OS limits vary. A conservative launch bound keeps the full copy fallback visible.
export const mailtoLaunchLimit = 1800;
const paragraph = (text: string) => el('p', { textContent: text });
const preview = (text: string) => el('pre', { className: 'utility-preview', textContent: text });
export function openStatistics(source: string, preferences: DevicePreferences) {
  fileDialog('File statistics', body => {
    const table = el('table', { ariaLabel: 'Current file statistics' });
    table.setAttribute('aria-describedby', 'statistics-help');
    const help = el('p', { id: 'statistics-help', className: 'statistics-help',
      textContent: 'Counts use the full source text. File size is measured in UTF-8 bytes.' });
    const stats = fileStatistics(source);
    for (const [label, value, description] of [
      ['Words', String(stats.words), 'Whitespace-separated words in the current source.'],
      ['Characters', String(stats.characters), 'Unicode characters, including line endings and any BOM.'],
      ['Lines', String(stats.lines), 'Source lines, including a trailing empty line.'],
      ['File size', `${stats.bytes} bytes`, 'UTF-8 encoded size, including any BOM.'],
    ]) {
      const row = table.insertRow();
      row.append(el('th', { scope: 'row', textContent: label, title: description }));
      row.insertCell().textContent = value;
    }
    const display = checkbox('Display stats while typing',
      preferences.value.showStatsWhileTyping ?? false, 'statistics-option');
    display.onchange = () => void preferences.save({ showStatsWhileTyping: display.checked });
    body.append(table, help, display.parentElement!);
  }, { className: 'statistics-dialog', info: true });
}
/** Tools › Compare files…: the system's file picker, then Diff shows the chosen file against this one. */
export function openComparison(controller: GittinController) {
  const input = el('input', { type: 'file' });
  input.onchange = () => {
    const file = input.files?.[0];
    if (file) void file.arrayBuffer()
      .then(buffer => controller.setComparison(decodeSource(new Uint8Array(buffer)), file.name)).catch(notice);
  };
  input.click();
}
/** Email `source` under the subject `title`: the saved file's text, or with `draft`, the current text. */
export function openEmail(title: string, source: string, draft: boolean) {
  const url = emailURL(title, source), long = url.length > mailtoLaunchLimit;
  fileDialog(draft ? 'Email this draft' : 'Email this file', (body, _close, footer) => {
    body.append(el('p', {}, el('strong', { textContent: 'Subject: ' }), title), preview(source));
    if (long) body.append(el('p', { className: 'dialog-hint',
      textContent: 'Too long for a mail link. Copy the text into your mail app instead; nothing was cut.' }));
    const open = button('Open in mail app', () => { window.location.href = url; }, 'primary');
    open.disabled = long;
    footer.append(open, button('Copy text', () =>
      copyText(source, 'Text copied.', 'Select the text above and copy it with your device shortcut.')));
  });
}
/** How Linked resources opens relative targets; given only for a file opened from a folder. */
export type FolderLinks = {
  resolve(url: string): string | null;
  open(path: string, section?: string): Promise<string | null>;
  image(url: string): Promise<string | null>;
};
const newTab = (href: string) => el('a', {
  className: 'action', href, target: '_blank', rel: 'noopener noreferrer', textContent: 'Open target',
});
// A page of its own that shows one image. src is a blob: or data: URL Gittin made, with no quote;
// no file name goes in.
const imagePage = (src: string) =>
  URL.createObjectURL(new Blob([`<!doctype html><img src="${src}" alt="">`], { type: 'text/html' }));
// One row per resource, laid out like Version history: what and where on the left, the actions on
// the right, and any reason a target cannot open under its address.
function resourceRow(kind: string, url: string) {
  const label = el('span', { className: 'version-label' },
    el('strong', { textContent: kind === 'image' ? 'Image' : 'Link' }),
    el('small', { className: 'resource-url', textContent: url }));
  const actions = el('span', { className: 'version-actions' });
  const note = (text: string) =>
    label.append(el('small', { className: 'resource-note', textContent: text }));
  return { item: listRow(label, actions), actions, note };
}
type Resource = { kind: string; url: string; from: number };
/** The links and images in Markdown or HTML source, in source order. */
function linkedResources(source: string, type: FileType) {
  const resources: Resource[] = type === 'markdown' ? markdownLinks(source) : [];
  // The existing lexer excludes comments/code. Detached template content is inert;
  // browser attribute decoding is reused without attaching or fetching resources.
  for (const span of syntaxSpans(source, type).filter(span => span.kind === 'html')) {
    const raw = source.slice(span.from, span.to);
    if (!/^<(a|img)\b/i.test(raw)) continue;
    const element = el('template', { innerHTML: raw }).content.firstElementChild;
    if (!element) continue;
    const image = element.tagName === 'IMG', url = element.getAttribute(image ? 'src' : 'href');
    if (url !== null) resources.push({ kind: image ? 'image' : 'link', url, from: span.from });
  }
  return resources.sort((a, b) => a.from - b.from);
}
export function openResources(controller: GittinController, source: string, folder?: FolderLinks) {
  fileDialog('Linked resources', (body, close) => {
    body.append(paragraph('Current Markdown and HTML links and images only. '
      + 'No background fetching or code import scan. '
      + (folder ? 'Relative targets open from this file’s folder.'
        : 'Relative targets can be opened only for a file opened from a folder.')));
    const type = controller.getFileType();
    if (!['markdown', 'html'].includes(type)) {
      body.append(paragraph('This file type has no supported document link or image syntax.'));
      return;
    }
    const resources = linkedResources(source, type);
    const list = el('ul', { className: 'version-list resource-list' });
    for (const { kind, url, from } of resources) {
      const { item, actions, note } = resourceRow(kind, url);
      list.append(item);
      actions.append(button('Jump to reference', () => { close(); controller.goToSource(from); }));
      const safe = safeURL(url, kind === 'image');
      const heading = type === 'markdown' && url.startsWith('#')
        ? headingAnchors(source).find(h => '#' + h.id === url || '#' + encodeURIComponent(h.id) === url)
        : undefined;
      if (heading) actions.append(button('Open target', () => {
        close();
        controller.setMode('preview');
        controller.goToSource(heading.from);
      }));
      else if (safe && /^(https?:|mailto:|tel:)/i.test(safe)) actions.append(newTab(safe));
      else if (!safe) note('Unsafe or unsupported target.');
      else if (url.startsWith('#')) note('No matching heading in this file.');
      else if (!folder) note('Target unavailable without a file opened from a folder.');
      else {
        const path = folder.resolve(url);
        if (path === null) note('Target is outside this folder.');
        // A relative image opens as a picture in a page of its own, so a script inside an SVG or other
        // file never runs as Gittin; a relative link opens its file in Gittin.
        else if (kind === 'image') void folder.image(url).then(found => found
          ? actions.append(newTab(imagePage(found)))
          : note(`Could not read ${path} from this folder.`));
        else {
          const open = button('Open target', async () => {
            open.disabled = true;
            const failure = await folder.open(path, fragment(url));
            if (failure === null) return close();
            open.remove();
            note(failure);
            actions.querySelector('button')?.focus();
          });
          actions.append(open);
        }
      }
    }
    body.append(resources.length ? list : paragraph('No supported links or images in this file.'));
  }, { info: true });
}
/** What Attributions makes: its format, its name, what it is, and its button. */
const kinds: { format: AttributionFormat; name: string; what: string; action: string }[] = [
  { format: 'markdown', name: 'Credit line',
    what: 'A line naming the work, who made it, where it comes from and its licence.', action: 'Insert' },
  { format: 'comment', name: 'Code comment', what: "The same credit as a comment in this file's language.",
    action: 'Insert' },
  { format: 'spdx', name: 'Licence header', what: 'SPDX copyright and licence lines, as a comment.',
    action: 'Insert' },
  { format: 'cff', name: 'Citation file', what: 'A CITATION.cff file, opened as a new file.',
    action: 'Create CITATION.cff' },
];
const blank: Attribution = { project: '', author: '', authorKind: 'entity', given: '', family: '', url: '',
  licence: '', copyright: '', modifications: '' };
/** Tools › Attributions…: first what to make, then only that kind's fields, its preview and its button. */
export function openAttributions(controller: GittinController,
  create: (source: string, title: string) => void) {
  if (!controller.isEditable()) return;
  const context = controller.captureSourceContext();
  // What was typed, by field, kept when Back leads to another kind.
  const typed = new Map<string, string>();
  fileDialog('Attributions', (body, close, footer) => {
    const choose = () => {
      footer.querySelectorAll('.attribution-step').forEach(step => step.remove());
      body.replaceChildren(paragraph('Gittin formats only what you enter. Check it before you use it.'),
        ...kinds.map(kind => choiceRow(kind.name, kind.what, () => form(kind))));
      body.querySelector('button')?.focus();
    };
    const form = (kind: typeof kinds[number]) => {
      const fields = el('div');
      const entry = (label: string, placeholder = '') => {
        const input = textField(fields, label, { type: 'text', placeholder, value: typed.get(label) ?? '' });
        input.addEventListener('input', () => typed.set(label, input.value));
        return input;
      };
      let data: () => Attribution;
      if (kind.format === 'spdx') {
        const copyright = entry('Copyright', '2026 Ada Lovelace');
        const licence = entry('Licence (SPDX identifier)', 'MIT');
        data = () => ({ ...blank, copyright: copyright.value, licence: licence.value });
      } else if (kind.format === 'cff') {
        const project = entry('Title of the work');
        const who = dropDown(fields, 'The author is', ['A person', 'An organisation or project']);
        const family = entry('Family name'), given = entry('Given names (optional)'), name = entry('Name');
        const url = entry('Source address (optional)');
        const licence = entry('Licence (optional, kept as a comment)'), changes = entry('Your changes (optional)');
        const person = () => who.selectedIndex === 0;
        const showWho = () => {
          family.parentElement!.hidden = given.parentElement!.hidden = !person();
          name.parentElement!.hidden = person();
        };
        who.addEventListener('input', showWho);
        showWho();
        data = () => ({ project: project.value, author: name.value, authorKind: person() ? 'person' : 'entity',
          given: given.value, family: family.value, url: url.value, licence: licence.value, copyright: '',
          modifications: changes.value });
      } else {
        const project = entry('Title of the work'), author = entry('Author (optional)');
        const url = entry('Source address (optional)'), licence = entry('Licence (optional)');
        const changes = entry('Your changes (optional)');
        data = () => ({ ...blank, project: project.value, author: author.value, url: url.value,
          licence: licence.value, modifications: changes.value });
      }
      const output = preview(''), error = el('p', { role: 'alert' });
      let generated = '';
      const changed = () => { error.textContent = 'Source, mode or selection changed. Reopen Attributions.'; };
      const apply = button(kind.action, () => {
        refresh();
        if (!generated) return;
        if (kind.format === 'cff') {
          if (!context.valid()) return changed();
          close();
          create(generated, 'CITATION.cff');
          return;
        }
        const inserted = context.apply((source, selection) => {
          const text = generated.replace(/\n/g, newlineStyle(source)), at = selection.head;
          const end = at + text.length;
          return { source: source.slice(0, at) + text + source.slice(at), selection: { anchor: end, head: end } };
        });
        if (inserted) close();
        else changed();
      }, 'primary attribution-step');
      const refresh = () => {
        generated = '';
        error.textContent = '';
        try {
          generated = attributionText(data(), kind.format, context.type);
          output.textContent = generated;
          apply.disabled = false;
        } catch (e) {
          output.textContent = '';
          error.textContent = errorText(e);
          apply.disabled = true;
        }
      };
      footer.prepend(apply, button('Back', choose, 'attribution-step'));
      body.replaceChildren(el('h3', { textContent: kind.name }), fields, output, error);
      fields.querySelectorAll('input, select').forEach(input => input.addEventListener('input', refresh));
      refresh();
      fields.querySelector<HTMLElement>('input, select')?.focus();
    };
    choose();
  });
}
