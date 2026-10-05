import { load, FAILSAFE_SCHEMA } from 'js-yaml';
type Nested = Record<string, unknown> | unknown[];
/** Nested YAML front matter as nested tables, as GitHub shows it. The failsafe schema keeps every value as written;
 * aliases are refused, since expanding them into tables can grow without limit. YAML that does not parse to keys
 * and values stays readable as text. */
export function renderFrontMatter(pre: HTMLElement) {
  let data: unknown;
  try { data = load(pre.textContent ?? '', { schema: FAILSAFE_SCHEMA, maxAliases: 0 }); } catch { return; }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return;
  const result = table(data as Nested);
  result.className = 'front-matter';
  pre.replaceWith(result);
}
function table(value: Nested): HTMLTableElement {
  const result = document.createElement('table'), row = result.createTBody().insertRow();
  if (Array.isArray(value)) value.forEach(item => cell(row.insertCell(), item));
  else {
    const head = result.createTHead().insertRow();
    for (const [key, item] of Object.entries(value)) {
      const th = document.createElement('th');
      th.textContent = key;
      head.append(th);
      cell(row.insertCell(), item);
    }
  }
  return result;
}
function cell(td: HTMLTableCellElement, value: unknown) {
  if (value && typeof value === 'object') td.append(table(value as Nested));
  else td.textContent = value == null ? '' : String(value);
}
