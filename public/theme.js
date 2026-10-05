// Sets the saved appearance before first paint; DevicePreferences keeps this copy (same key) up to date.
// A file rather than an inline script, so the Content Security Policy can refuse every inline script.
try {
  const theme = localStorage.getItem('gittin-theme');
  document.documentElement.dataset.theme =
    theme === 'light' || theme === 'dark' ? theme : matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
} catch (e) {}
