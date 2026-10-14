(function () {
  'use strict';
  const key = 'forma-theme-v1';
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  let preference = null;
  try {
    const saved = localStorage.getItem(key);
    if (saved === 'light' || saved === 'dark') preference = saved;
  } catch (_) { /* Theme selection also works when browser storage is unavailable. */ }

  function apply(theme, notify = true) {
    document.documentElement.dataset.theme = theme;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = theme === 'dark' ? '#18221b' : '#f4f3ee';
    if (notify) window.dispatchEvent(new CustomEvent('forma:themechange', {detail:{theme}}));
  }

  window.FormaTheme = {
    getTheme: () => document.documentElement.dataset.theme,
    toggle() {
      preference = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem(key, preference); } catch (_) {}
      apply(preference);
    }
  };
  media.addEventListener('change', event => {
    if (preference === null) apply(event.matches ? 'dark' : 'light');
  });
  // Run in the document head so the first frame already uses the chosen theme.
  apply(preference || (media.matches ? 'dark' : 'light'), false);
})();
