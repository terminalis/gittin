import type { DevicePreferences } from '../preferences';
import type { GittinController } from '../editor/controller';
import { ruleError, spellcheckCategory, spellcheckEnabled } from '../editor/prose-preferences';
import { button, checkbox, dialogShell, el, iconButton, showDialog } from './dom';

/** A checkbox row that hands each change to `change`. */
function option(label: string, checked: boolean, change: (checked: boolean) => void) {
  const box = checkbox(label, checked, 'preference-option');
  box.onchange = () => change(box.checked);
  return box.parentElement!;
}
const typing = [
  ['capitalise', 'Automatically capitalise words', false],
  ['smartQuotes', 'Use smart quotes', false],
  ['continueLists', 'Continue lists when pressing Enter', true],
  ['showLinkDetails', 'Show link details', true],
] as const;
/** Spellcheck for this kind of file, typing aids and link details. */
function generalPanel(preferences: DevicePreferences, controller: GittinController) {
  const fileType = controller.getFileType(), category = spellcheckCategory(fileType);
  const spellcheck = option('Spellcheck', spellcheckEnabled(preferences.value, fileType), checked =>
    void preferences.save({ spellcheck: { ...preferences.value.spellcheck, [category]: checked } }));
  spellcheck.querySelector('input')!.title = category === 'markdown'
    ? 'Spellcheck for Markdown and plain text files' : 'Spellcheck for other files';
  const hint = 'Capitalisation and smart quotes apply as you type Markdown text. '
    + 'Pasted text and code stay unchanged. Spellcheck uses your browser’s dictionary.';
  return el('section', {}, spellcheck,
    ...typing.map(([key, label, fallback]) => option(label, preferences.value[key] ?? fallback,
      checked => void preferences.save({ [key]: checked }))),
    el('p', { className: 'preferences-hint', textContent: hint }));
}
/** Automatic substitution and its rules: a row to compose a rule, then one row per rule. */
function substitutionsPanel(preferences: DevicePreferences) {
  const rules = () => preferences.value.substitutions ?? [];
  const automatic = option('Automatic substitution', preferences.value.automaticSubstitution !== false,
    checked => void preferences.save({ automaticSubstitution: checked }));
  const table = el('table', { className: 'substitution-table', ariaLabel: 'Substitution rules',
    innerHTML: '<colgroup><col class="substitution-toggle"><col><col><col class="substitution-action">'
      + '</colgroup><thead><tr><th scope="col" aria-label="Enabled"></th><th scope="col">Replace</th>'
      + '<th scope="col">With</th><th scope="col" aria-label="Actions"></th></tr></thead>' });
  const compose = table.createTBody().insertRow();
  compose.className = 'substitution-compose';
  compose.insertCell();
  const replace = el('input', { type: 'text', ariaLabel: 'Replace' });
  const withText = el('input', { type: 'text', ariaLabel: 'With' });
  compose.insertCell().append(replace);
  compose.insertCell().append(withText);
  const addCell = compose.insertCell(), list = table.createTBody();
  const error = el('p', { className: 'preferences-error', role: 'alert' });
  const render = () => {
    list.replaceChildren();
    if (!rules().length) Object.assign(list.insertRow().insertCell(),
      { colSpan: 4, className: 'substitution-empty', textContent: 'No substitution rules.' });
    rules().forEach((rule, index) => {
      const row = list.insertRow();
      row.className = 'substitution-rule';
      const enabled = el('input',
        { type: 'checkbox', checked: rule.enabled, ariaLabel: 'Enable rule ' + (index + 1) });
      enabled.onchange = () => void preferences.save({ substitutions:
        rules().map((r, i) => (i === index ? { ...r, enabled: enabled.checked } : r)) });
      row.insertCell().append(enabled);
      row.insertCell().textContent = rule.replace;
      row.insertCell().textContent = rule.with;
      row.insertCell().append(iconButton('x', 'Delete rule ' + (index + 1), () => {
        void preferences.save({ substitutions: rules().filter((_, i) => i !== index) });
        render();
      }, 'preferences-icon-button'));
    });
  };
  addCell.append(iconButton('plus', 'Add rule', () => {
    error.textContent = ruleError(replace.value, rules());
    if (error.textContent) return;
    const rule = { replace: replace.value, with: withText.value, enabled: true };
    void preferences.save({ substitutions: [...rules(), rule] });
    replace.value = '';
    withText.value = '';
    render();
  }, 'preferences-icon-button'));
  render();
  const explanation = el('p', { className: 'preferences-hint', textContent: 'Enabled rules replace '
    + 'shortcuts in Markdown text after a space, punctuation, or Enter. '
    + 'Undo restores the original text.' });
  return el('section', {}, automatic, explanation, table, error);
}
export function openPreferences(preferences: DevicePreferences, controller: GittinController) {
  document.querySelector('.preferences-dialog')?.remove();
  const context = controller.captureSourceContext();
  const { dialog, body: content, footer } = dialogShell('Preferences', 'preferences-dialog');
  const panels = [generalPanel(preferences, controller), substitutionsPanel(preferences)];
  const triggers = ['General', 'Substitutions'].map((name, index) => {
    const trigger = Object.assign(button('', () => select(index)),
      { id: 'preferences-tab-' + index, role: 'tab' });
    trigger.append(el('span', { textContent: name }));
    const panel = Object.assign(panels[index], { id: 'preferences-panel-' + index, role: 'tabpanel' });
    panel.setAttribute('aria-labelledby', trigger.id);
    trigger.setAttribute('aria-controls', panel.id);
    trigger.onkeydown = event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? 1 : 1 - index;
      select(next);
      triggers[next].focus();
    };
    return trigger;
  });
  function select(index: number) {
    panels.forEach((panel, i) => {
      panel.hidden = i !== index;
      triggers[i].ariaSelected = String(i === index);
      triggers[i].tabIndex = i === index ? 0 : -1;
    });
  }
  const tabs = el('div', { role: 'tablist', ariaLabel: 'Preferences' }, ...triggers);
  select(0);
  const close = () => { dialog.close(); dialog.remove(); context.restore(); };
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  content.classList.add('preferences-content');
  content.append(...panels);
  footer.append(button('Close', close));
  content.before(tabs);
  document.body.append(dialog);
  showDialog(dialog);
  return dialog;
}
