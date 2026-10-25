import { hint, lead, type Visitor } from '../../src/site/platform';

// User agents as these browsers send them: Chromium's reduced form with its platform hint, Safari's and Firefox's own.
const chrome = 'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const macSafari = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) '
  + 'Version/18.6 Safari/605.1.15';
const browsers: [string, Visitor, ReturnType<typeof lead>, ReturnType<typeof hint>][] = [
  ['Chrome on Windows', { userAgent: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) ${chrome}`, platform: 'Windows', touch: false }, 'windows', undefined],
  ['Firefox on Windows', { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:144.0) Gecko/20100101 Firefox/144.0', touch: false }, 'windows', undefined],
  ['Chrome on Linux', { userAgent: `Mozilla/5.0 (X11; Linux x86_64) ${chrome}`, platform: 'Linux', touch: false }, 'linux', undefined],
  ['Firefox on Ubuntu', { userAgent: 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:144.0) Gecko/20100101 Firefox/144.0', touch: false }, 'linux', 'cannot-install'],
  ['Firefox on ARM Linux', { userAgent: 'Mozilla/5.0 (X11; Linux aarch64; rv:144.0) Gecko/20100101 Firefox/144.0', touch: false }, 'web', 'cannot-install'],
  ['Safari on a Mac', { userAgent: macSafari, touch: false }, 'web', 'add-to-dock'],
  ['Chrome on a Mac', { userAgent: `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ${chrome}`, platform: 'macOS', touch: false }, 'web', undefined],
  ['Firefox on a Mac', { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:144.0) Gecko/20100101 Firefox/144.0', touch: false }, 'web', 'cannot-install'],
  ['Safari on an iPhone', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1', touch: true }, 'web', 'add-to-home-screen'],
  ['Safari on an iPad', { userAgent: macSafari, touch: true }, 'web', 'add-to-home-screen'],
  ['Chrome on Android', { userAgent: `Mozilla/5.0 (Linux; Android 10; K) ${chrome.replace('Safari', 'Mobile Safari')}`, platform: 'Android', touch: true }, 'web', undefined],
  ['Firefox on Android', { userAgent: 'Mozilla/5.0 (Android 15; Mobile; rv:144.0) Gecko/144.0 Firefox/144.0', touch: true }, 'web', undefined],
  ['Chrome on ChromeOS', { userAgent: `Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) ${chrome}`, platform: 'Chrome OS', touch: false }, 'web', undefined],
  ['a browser that names no platform', { userAgent: 'Mozilla/5.0', touch: false }, undefined, undefined],
];

for (const [name, visitor, leads, hints] of browsers)
  it(`${name}: ${leads ?? 'the page order'} leads, with ${hints ?? 'no'} hint`, () => {
    expect(lead(visitor)).toBe(leads);
    expect(hint(visitor)).toBe(hints);
  });
