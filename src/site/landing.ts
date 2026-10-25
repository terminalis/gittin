// The website's landing page: the slide-in bar, the rings' zoom to the install page, and the screenshots of the app.
import './site.css';
import shots from './landing-shots.json';

type Shot = keyof typeof shots;
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Screenshots of the real app, made by scripts/landing-shots.ts (npm run landing-shots), except the desktop app's,
 * captured by hand. Each comes in light and dark; only the one in view loads, and phones get their own size where
 * the shot has one.
 */
const picture = (name: Shot, theme: 'light' | 'dark') => {
  const { desktop: [width, height], phone } = shots[name] as { desktop: number[]; phone?: number[] };
  const source = phone
    ? `<source media="(max-width: 760px)" srcset="/landing/${name}-${theme}-phone.webp" width="${phone[0]}" `
      + `height="${phone[1]}">`
    : '';
  return `<picture class="shot-${theme}">${source}<img src="/landing/${name}-${theme}-desktop.webp" width="${width}" `
    + `height="${height}" alt="" loading="lazy" decoding="async"></picture>`;
};

// Each demo names its shots; in a pair the second sits over the first, lower right.
for (const demo of document.querySelectorAll<HTMLElement>('.demo[data-shots]')) {
  const names = demo.dataset.shots!.split(' ') as Shot[];
  const place = (i: number) => (names.length < 2 ? '' : i ? ' shot-front' : ' shot-back');
  demo.innerHTML = names.map((name, i) =>
    `<div class="shot${place(i)}" data-shot="${name}">${picture(name, 'light')}${picture(name, 'dark')}</div>`).join('');
}
// Screenshots are not part of the offline copy; without them a section shows its text alone.
for (const image of document.querySelectorAll<HTMLImageElement>('.demo img'))
  image.addEventListener('error', () => image.closest('.demo')!.classList.add('unavailable'));

// The bar slides in once no part of the doorway is on screen.
const bar = document.querySelector<HTMLElement>('.site-bar')!;
new IntersectionObserver(([entry]) => bar.classList.toggle('shown', !entry.isIntersecting))
  .observe(document.querySelector('.doorway')!);

for (const link of document.querySelectorAll<HTMLAnchorElement>('a.brand'))
  link.addEventListener('click', event => {
    event.preventDefault();
    window.scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' });
  });

for (const ring of document.querySelectorAll<HTMLAnchorElement>('.ring'))
  ring.addEventListener('click', event => enter(event, ring));
// Coming back from the browser's history can show the page as it was left, covered by the zoom's circle.
addEventListener('pageshow', () => document.querySelector('.landing-portal')?.remove());

/** Zooms a circle out from the ring to fill the screen, then opens the ring's page; modified clicks and reduced
 * motion keep the plain link. */
function enter(event: MouseEvent, ring: HTMLAnchorElement) {
  if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || reducedMotion()) return;
  event.preventDefault();
  if (document.querySelector('.landing-portal')) return;
  const box = ring.getBoundingClientRect();
  const x = box.left + box.width / 2, y = box.top + box.height / 2;
  const reach = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
  const portal = Object.assign(document.createElement('div'), { className: 'landing-portal' });
  Object.assign(portal.style, { left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px` });
  document.body.append(portal);
  const go = () => location.assign(ring.href);
  portal.animate([{ transform: 'scale(0)' }, { transform: `scale(${(2 * reach) / box.width + 0.1})` }],
    { duration: 700, easing: 'cubic-bezier(.7, 0, .25, 1)', fill: 'forwards' }).finished.then(go, go);
}
