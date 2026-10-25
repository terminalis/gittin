// Which card leads on the install page, and how the web version installs where the browser makes no offer of its own.
// Kept apart from the page, so tests can feed it real browsers' user agents.
export type Lead = 'windows' | 'linux' | 'web';
export type Hint = 'add-to-dock' | 'add-to-home-screen' | 'cannot-install';
/** What a browser says about itself: its user agent, Chromium's platform hint, and whether the screen takes touch. */
export interface Visitor { userAgent: string; platform?: string; touch: boolean }

// iPadOS Safari presents itself as a Mac; Macs have no touch screen.
const iPhoneOrIPad = ({ userAgent, touch }: Visitor) =>
  /iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && touch);

/** Windows and x86_64 Linux lead with their desktop app; a Mac, iPhone, iPad, Android, ChromeOS and Linux on ARM with
 * the web version. Undefined when the platform can't be told, so the page keeps its own order. */
export function lead({ userAgent, platform }: Visitor): Lead | undefined {
  if (platform ? platform === 'Windows' : /Windows/.test(userAgent)) return 'windows';
  // Android and ChromeOS also report Linux, and the Flatpak is built for x86_64 only.
  if ((platform && platform !== 'Linux') || /Android|CrOS|Macintosh|iPhone|iPad|iPod|aarch64|arm/i.test(userAgent))
    return 'web';
  return /Linux/.test(userAgent) ? 'linux' : undefined;
}

/** Safari on an iPhone, iPad or Mac installs from its own menus; Firefox on a Mac or Linux can't install at all. Elsewhere
 * there is no hint: Chromium browsers make their offer (or have installed Gittin already), and Firefox has web apps on
 * Windows and Android. */
export function hint(visitor: Visitor): Hint | undefined {
  const { userAgent } = visitor;
  if (iPhoneOrIPad(visitor)) return 'add-to-home-screen';
  if (/Macintosh/.test(userAgent) && /Version\/[\d.]+ Safari\//.test(userAgent)) return 'add-to-dock';
  if (/Firefox\//.test(userAgent) && !/Android|Windows/.test(userAgent)) return 'cannot-install';
  return undefined;
}
