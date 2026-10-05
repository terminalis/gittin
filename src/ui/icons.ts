import { tablerIcons } from './tabler-icons';

export type IconName = keyof typeof tablerIcons;

/** Trusted, bundled Tabler SVGs shared by every application surface. */
export function iconMarkup(name: IconName) {
  const paint = name.endsWith('-filled') ? 'fill="currentColor" stroke="none"' : 'fill="none" stroke="currentColor"';
  return `<svg class="app-icon" data-icon="${name}" xmlns="http://www.w3.org/2000/svg" width="20" height="20" `
    + `viewBox="0 0 24 24" ${paint} stroke-width="2" stroke-linecap="round" stroke-linejoin="round" `
    + `aria-hidden="true" focusable="false">${tablerIcons[name]}</svg>`;
}

export function icon(name: IconName): SVGSVGElement {
  const template = document.createElement('template');
  template.innerHTML = iconMarkup(name);
  return template.content.firstElementChild as SVGSVGElement;
}
