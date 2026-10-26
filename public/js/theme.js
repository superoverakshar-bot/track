// Apply the saved theme before first paint to avoid a flash. A classic script
// (not a module) so it runs before the page renders; it lives in a file so the
// Content Security Policy can forbid inline scripts.
try {
  var t = JSON.parse(localStorage.getItem('track.v1') || '{}').settings?.theme;
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
} catch (e) { /* storage unavailable */ }
