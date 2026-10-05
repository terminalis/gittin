/// <reference types="vite/client" />
import { button } from '../ui/dom';
/** Production only: offline startup after the first visit, and user-approved updates that save drafts first. */
export function registerOffline(saveDrafts: () => Promise<boolean>) {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  // `ready` resolves only once a worker is active, i.e. after every file was cached.
  void navigator.serviceWorker.ready.then(() => { document.documentElement.dataset.offline = 'ready'; });
  void navigator.serviceWorker.register('/sw.js').then(registration => {
    const offer = (worker: ServiceWorker) => updateNotice(async () => {
      if (!(await saveDrafts())) return;
      // Another tab already applied this update, so this tab has missed its controllerchange.
      if (worker.state !== 'installed') return location.reload();
      navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true });
      worker.postMessage('skip-waiting');
    });
    if (registration.waiting && navigator.serviceWorker.controller) offer(registration.waiting);
    registration.addEventListener('updatefound', () => {
      const worker = registration.installing!;
      worker.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) offer(worker);
      });
    });
  });
}
function updateNotice(reload: () => void) {
  const host = document.querySelector<HTMLElement>('#notice')!, text = document.createElement('span');
  text.textContent = 'A new version of Gittin is ready.';
  host.replaceChildren(text, button('Reload to update', reload, 'primary'), button('Later', () => host.replaceChildren()));
}
