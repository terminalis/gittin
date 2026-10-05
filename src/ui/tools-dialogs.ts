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
  button, checkbox, dropDown, el, errorText, fileDialog, listRow, notice, textField,
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
  fileDialog('File statistics', (body, close, footer) => {
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
    body.append(table, help, display.parentElement!);
    const save = () => { void preferences.save({ showStatsWhileTyping: display.checked }); close(); };
    footer.append(button('OK', save, 'primary'));
  }, { className: 'statistics-dialog', closeLabel: 'Cancel' });
}
export function openComparison(controller: GittinController) {
  fileDialog('Compare files', (body, close) => {
    const input = el('input', { type: 'file', ariaLabel: 'Comparison file' });
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      void file.arrayBuffer().then(buffer => {
        if (!input.isConnected) return;
        controller.setComparison(decodeSource(new Uint8Array(buffer)), file.name);
        close();
      }).catch(notice);
    };
    body.append(paragraph('Choose a UTF-8 file for temporary read-only Diff. '
      + 'Your saved baseline and current source stay intact.'), input);
  });
}
/** Email `source` under the subject `title`: the saved file's text, or with `draft`, the current text. */
export function openEmail(title: string, source: string, draft: boolean) {
  const url = emailURL(title, source);
  fileDialog(draft ? 'Email this draft' : 'Email this file', (body, _close, footer) => {
    body.append(
      paragraph(draft ? 'Current source snapshot.' : 'Last opened or explicitly saved source snapshot.'),
      paragraph('Review the complete text below. Open email draft requests your configured device mail '
        + 'app; you choose whether to send. Client and OS length limits vary.'),
      paragraph('Subject: ' + title),
      preview(source));
    const open = button('Open email draft', () => { window.location.href = url; }, 'primary');
    open.disabled = url.length > mailtoLaunchLimit;
    if (open.disabled)
      body.append(paragraph('This text exceeds this app’s conservative 1800-character mailto handoff '
        + 'limit. Copy the complete text into your email app. Nothing has been truncated.'));
    const manual = 'Select and copy the preview text using your device shortcut.';
    const copy = button('Copy preview text', () => {
      void navigator.clipboard?.writeText(source).then(() => notice('Preview text copied.'))
        .catch(() => notice('Clipboard access was declined. ' + manual));
      if (!navigator.clipboard) notice(manual);
    });
    footer.append(copy, open);
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
  });
}
const formats: AttributionFormat[] = ['markdown', 'comment', 'spdx', 'cff'];
export function openAttributions(controller: GittinController,
  create: (source: string, title: string) => void) {
  if (!controller.isEditable()) return;
  const context = controller.captureSourceContext();
  fileDialog('Attributions', (body, close, footer) => {
    body.append(paragraph('Formats supplied information only. Review before applying. This does not '
      + 'select a licence, replace existing notices, install licence texts or validate compliance.'));
    const format = dropDown(body, 'Output format',
      ['Markdown credit', 'Source comment', 'SPDX/REUSE header', 'CITATION.cff']);
    const project = textField(body, 'Project or work title');
    const author = textField(body, 'Author / project or organisation name');
    const kind = dropDown(body, 'CFF author kind', ['Person', 'Project or organisation']);
    const given = textField(body, 'CFF given names (optional)');
    const family = textField(body, 'CFF family names');
    const url = textField(body, 'Source URL (optional)');
    const licence = textField(body, 'Licence information / SPDX expression');
    const copyright = textField(body, 'Copyright text and years (SPDX)');
    const modifications = textField(body, 'Modifications (optional)');
    const output = preview(''), error = el('p', { role: 'alert' });
    let generated = '';
    const stale = 'Source, mode or selection changed. Reopen Attributions.';
    const changed = () => { error.textContent = stale; };
    const apply = button('Insert at cursor', () => {
      refresh();
      if (!generated) return;
      if (format.value === 'CITATION.cff') {
        if (!context.valid()) return changed();
        close();
        create(generated, 'CITATION.cff');
        return;
      }
      const inserted = context.apply((source, selection) => {
        const text = generated.replace(/\n/g, newlineStyle(source)), at = selection.head;
        const end = at + text.length;
        return { source: source.slice(0, at) + text + source.slice(at),
          selection: { anchor: end, head: end } };
      });
      if (inserted) close();
      else changed();
    }, 'primary');
    const refresh = () => {
      generated = '';
      error.textContent = '';
      const cff = format.value === 'CITATION.cff';
      apply.textContent = cff ? 'Create local CITATION.cff' : 'Insert at cursor';
      try {
        const data: Attribution = { project: project.value, author: author.value,
          authorKind: kind.value === 'Person' ? 'person' : 'entity', given: given.value,
          family: family.value, url: url.value, licence: licence.value, copyright: copyright.value,
          modifications: modifications.value };
        generated = attributionText(data, formats[format.selectedIndex], context.type);
        output.textContent = generated;
        apply.disabled = false;
      } catch (e) {
        output.textContent = '';
        error.textContent = errorText(e);
        apply.disabled = true;
      }
    };
    footer.append(apply);
    body.append(paragraph('CFF uses supplied person name fields or an entity name; freeform licence '
      + 'information remains a YAML comment. The new YAML file opens in Edit and does not modify '
      + 'other files.'), output, error);
    body.querySelectorAll('input,select').forEach(input => input.addEventListener('input', refresh));
    refresh();
  });
}
