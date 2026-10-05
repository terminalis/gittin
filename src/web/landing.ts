import { iconMarkup } from '../ui/icons';
import { brand, el, legalPages, legalRel } from '../ui/dom';
import { filesDemo, folderDemo, historyDemo, writeDemo } from './landing-demos';

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** The enlarged logo; its ring holds Open Gittin. The logo itself is decorative. */
const door = () =>
  `<div class="door"><img class="door-logo" src="/gittin-logo.svg" alt="" width="900" height="900">`
  + '<a class="ring" href="#/home" aria-label="Open Gittin"><span>Open</span><span>Gittin</span>'
  + `${iconMarkup('arrow-right')}</a></div>`;

const feature = (number: string, title: string, text: string, points: string[], demo: string, alt = false) =>
  `<section class="feature${alt ? ' alt' : ''}" aria-labelledby="feature-${number}"><div class="feature-text">`
  + `<span class="feature-number" aria-hidden="true">${number}</span><h2 id="feature-${number}">${title}</h2><p>${text}</p>`
  + `<ul>${points.map(point => `<li>${point}</li>`).join('')}</ul></div>${demo}</section>`;

const faq: [string, string][] = [
  ['Do I need an account?', 'No. Gittin has no accounts. Your files stay on your device.'],
  ['Where are unsaved changes kept?', 'In this browser on this device, until you save. '
    + 'Browser storage can be cleared, so save to keep them in a file.'],
  ['Does Preview change my Markdown?', 'No. Preview is read-only and shows source snippets for '
    + "anything it can't render fully. Switching views leaves your source and undo history "
    + 'unchanged.'],
  ['Can I work offline?', 'Yes. After Gittin has loaded once on this device, it starts without a '
    + 'connection and opens files and unsaved changes already in this browser.'],
];

const farewell = '<div class="farewell-text"><h2 id="farewell-title">'
  + 'Bring a file. <br>Start writing.</h2><p>No account needed to start.</p></div>';
const legal = legalPages
  .map(([name, href]) => `<a href="${href}" rel="${legalRel}">${name}</a>`).join('');

export function landing() {
  const screen = el('div', { className: 'landing' });
  const header = `<header class="landing-bar">${brand('#/')}`
    + `<a class="primary action" href="#/home">Open Gittin ${iconMarkup('arrow-right')}</a></header>`;
  screen.innerHTML = `${header}
  <main>
    <section class="doorway" aria-labelledby="doorway-title">
      <div class="doorway-stage">
        <div class="doorway-copy">
          <h1 id="doorway-title">Gittin</h1>
          <p class="tagline">An IDE? A word processor? <br>It's just plain text.</p>
        </div>
        ${door()}
      </div>
      <a class="explore" href="#story">${iconMarkup('arrow-down')}How it works</a>
    </section>
    <div id="story">
      ${feature('01', 'Write, then preview.', 'Format Markdown with the toolbar you already know. '
        + 'Switch to Preview to read the finished page.',
        ['Tables, maths, diagrams and emoji render in Preview', 'Preview never changes your source'],
        writeDemo())}
      ${feature('02', 'More than Markdown.',
        'Notes, code and config open just as easily, each with its own syntax colours.',
        ['Plain text, JSON, YAML, HTML, CSS, JavaScript and TypeScript',
          'Any other text file opens as plain text'], filesDemo(), true)}
      ${feature('03', 'Bring the whole folder.',
        'Open a folder, find the file you need and save each one straight back where it came from.',
        ['Unsaved changes wait in this browser', 'A dot marks files with unsaved changes'],
        folderDemo())}
      ${feature('04', 'Nothing gets lost.', 'Diff shows what changed since you last saved. '
        + 'Version history keeps your recent saves, so you can compare or restore them.',
        ['Up to 20 recent saves of each file, kept in this browser',
          'Your file only changes when you save'], historyDemo(), true)}
      <section class="landing-faq" aria-labelledby="faq-title"><h2 id="faq-title">A few things to know</h2>
        <dl>${faq.map(([question, answer]) => `<div><dt>${question}</dt><dd>${answer}</dd></div>`).join('')}</dl>
      </section>
      <section class="farewell" aria-labelledby="farewell-title">
        ${door()}
        ${farewell}
      </section>
    </div>
  </main>
  <footer>${brand('#/')}<nav class="landing-legal" aria-label="Legal">${legal}</nav></footer>`;

  // The bar slides in once no part of the doorway is on screen.
  const bar = screen.querySelector<HTMLElement>('.landing-bar')!;
  const observer = new IntersectionObserver(([entry]) => {
    if (!screen.isConnected) return observer.disconnect();
    bar.classList.toggle('shown', !entry.isIntersecting);
  });
  observer.observe(screen.querySelector('.doorway')!);

  for (const link of screen.querySelectorAll<HTMLAnchorElement>('a.brand'))
    link.addEventListener('click', event => {
      event.preventDefault();
      window.scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' });
    });

  for (const ring of screen.querySelectorAll<HTMLAnchorElement>('.ring'))
    ring.addEventListener('click', event => enter(event, ring, screen));

  // Screenshots are not part of the offline install; without them a demo is left out rather than shown broken.
  for (const image of screen.querySelectorAll<HTMLImageElement>('.demo img'))
    image.addEventListener('error', () => image.closest('.demo')!.classList.add('unavailable'));
  return screen;
}

/** Zooms through the ring into Home; modified clicks and reduced motion keep the plain link. */
function enter(event: MouseEvent, ring: HTMLAnchorElement, screen: HTMLElement) {
  if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || reducedMotion()) return;
  event.preventDefault();
  if (screen.querySelector('.landing-portal')) return;
  const box = ring.getBoundingClientRect();
  const x = box.left + box.width / 2, y = box.top + box.height / 2;
  const reach = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
  const portal = el('div', { className: 'landing-portal' });
  Object.assign(portal.style, { left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px` });
  screen.append(portal);
  const go = () => { location.hash = '#/home'; };
  portal.animate([{ transform: 'scale(0)' }, { transform: `scale(${(2 * reach) / box.width + 0.1})` }],
    { duration: 700, easing: 'cubic-bezier(.7, 0, .25, 1)', fill: 'forwards' }).finished.then(go, go);
}
