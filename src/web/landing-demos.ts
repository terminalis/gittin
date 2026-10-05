import shots from './landing-shots.json';

/**
 * Landing demonstrations: screenshots of the real app, made by scripts/landing-shots.ts (npm run landing-shots).
 * Each shot comes in light and dark, for desktop and for phones (760px and narrower); only the one in view loads.
 * Each root is hidden from assistive technology and inert.
 */
type Shot = keyof typeof shots;

const demo = (className: string, body: string) =>
  `<div class="demo ${className}" aria-hidden="true" inert>${body}</div>`;

const picture = (name: Shot, theme: 'light' | 'dark') => {
  const { desktop: [width, height], phone: [phoneWidth, phoneHeight] } = shots[name];
  return `<picture class="shot-${theme}"><source media="(max-width: 760px)" `
    + `srcset="/landing/${name}-${theme}-phone.webp" width="${phoneWidth}" height="${phoneHeight}">`
    + `<img src="/landing/${name}-${theme}-desktop.webp" width="${width}" height="${height}" alt="" `
    + 'loading="lazy" decoding="async"></picture>';
};

const shot = (name: Shot, place = '') =>
  `<div class="shot ${place}" data-shot="${name}">${picture(name, 'light')}${picture(name, 'dark')}</div>`;

export const writeDemo = () => demo('demo-write demo-pair',
  shot('write-edit', 'shot-back') + shot('write-preview', 'shot-front'));
export const filesDemo = () => demo('demo-files', shot('files'));
export const folderDemo = () => demo('demo-folder', shot('folder'));
export const historyDemo = () => demo('demo-history demo-pair',
  shot('history-diff', 'shot-back') + shot('history-versions', 'shot-front'));
