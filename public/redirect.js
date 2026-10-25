// Addresses from before the web app moved to /use/: Home, a document, and installed apps that still open /#/home.
// A file rather than an inline script, so the Content Security Policy can refuse every inline script.
if (/^#\/(home|document\/)/.test(location.hash)) location.replace('/use/' + location.hash);
