/** Which version of Gittin is running. Each version's page says so on <html>; the website's says nothing.
 * Only wording depends on it: code that differs lives in each version's own folder. */
export const desktop = globalThis.document?.documentElement.dataset.app === 'desktop';
/** Where unsaved changes and version history are kept, as messages name it. */
export const place = desktop ? 'this app' : 'this browser';
