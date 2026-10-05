import { change, get } from './documents/database';
import type { Theme } from './documents/types';
import { notice } from './ui/dom';
import { signal } from './signal';
export interface SubstitutionRule { replace: string; with: string; enabled: boolean; }
export interface Preferences {
  capitalise?: boolean;
  smartQuotes?: boolean;
  continueLists?: boolean;
  showLinkDetails?: boolean;
  showStatsWhileTyping?: boolean;
  spellcheck?: Partial<Record<'markdown' | 'code', boolean>>;
  substitutions?: SubstitutionRule[];
  automaticSubstitution?: boolean;
  toolbarGroups?: Record<string, boolean>;
  toolbarItems?: Record<string, boolean>;
  documentZoom?: number;
  menusHidden?: boolean;
  theme?: Theme;
  /** Home: whether Favourites and the recent folders show, and how many recent files are listed (all when unset). */
  homeFavourites?: boolean;
  homeFolders?: boolean;
  homeRecentLimit?: 10 | 25 | 'all';
  lineNumbers?: boolean;
  showComments?: boolean;
  syntaxHighlighting?: boolean;
  whitespace?: boolean;
  wordWrap?: boolean;
}
export async function loadPreferences(): Promise<Preferences> {
  return (await get<Preferences>('preferences', 'device')) ?? {};
}
/** Merge the patch into the stored preferences, in one transaction. */
export function savePreferences(patch: Preferences): Promise<void> {
  return change(['preferences'], tx => {
    const store = tx.objectStore('preferences'), request = store.get('device');
    request.onsuccess = () => store.put({ ...request.result, ...patch }, 'device');
  });
}
// A copy of the saved choice that public/theme.js reads synchronously, so the first paint already has the right palette.
const themeCopy = 'gittin-theme';
export class DevicePreferences {
  value: Preferences = { theme: 'system' };
  private changed = signal();
  /** Calls the listener now and after every change, the system appearance's under "system" too. */
  subscribe(listener: () => void) { const off = this.changed.on(listener); listener(); return off; }
  private system = matchMedia('(prefers-color-scheme: dark)');
  constructor() {
    this.system.addEventListener('change', () => {
      if (this.value.theme !== 'system') return;
      this.applyTheme();
      this.changed.emit();
    });
    try {
      const copy = localStorage.getItem(themeCopy);
      if (copy === 'light' || copy === 'dark') this.value = { theme: copy };
    } catch { /* system appearance until load() */ }
    this.applyTheme();
  }
  async load() {
    try {
      const preferences = await loadPreferences();
      this.value = { theme: 'system', ...preferences };
      this.copyTheme();
    } catch (e) {
      notice(e);
    }
    this.applyTheme();
    this.changed.emit();
  }
  async save(patch: Preferences) {
    this.value = { ...this.value, ...patch };
    if (patch.theme) this.copyTheme();
    this.applyTheme();
    this.changed.emit();
    try {
      await savePreferences(patch);
    } catch (e) {
      notice('Preferences could not be saved on this device. ' + String(e));
    }
  }
  private copyTheme() {
    try { localStorage.setItem(themeCopy, this.value.theme!); } catch { /* the copy is only an optimisation */ }
  }
  /** The appearance in use: the chosen one, or the system's. */
  get appearance() {
    const { theme } = this.value;
    return theme === 'system' || !theme ? (this.system.matches ? 'dark' : 'light') : theme;
  }
  private applyTheme() {
    document.documentElement.dataset.theme = this.appearance;
    const background = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
    document.querySelector('meta[name="theme-color"]')!.setAttribute('content', background);
  }
}
