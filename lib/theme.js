/* Theme detection: returns 'dark' or 'light' based on Arena's background color
 * or prefers-color-scheme. Caches result but watches for changes (SPA theme toggles).
 */
(function () {
  'use strict';

  let cached = null;
  let lastProbe = 0;
  const TTL_MS = 1000;

  function probe() {
    const now = Date.now();
    if (cached && now - lastProbe < TTL_MS) return cached;
    lastProbe = now;

    // 1. Check background color of <body> / <html>
    const samples = [document.body, document.documentElement];
    for (const el of samples) {
      if (!el) continue;
      const bg = window.getComputedStyle(el).backgroundColor;
      const m = bg.match(/rgba?\(([^)]+)\)/);
      if (m) {
        const parts = m[1].split(',').map(s => parseFloat(s.trim()));
        if (parts.length >= 3) {
          // Perceived luminance (ITU-R BT.601)
          const [r, g, b] = parts;
          const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
          cached = lum < 0.5 ? 'dark' : 'light';
          return cached;
        }
      }
    }
    // 2. Prefer-color-scheme fallback
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      cached = 'dark';
    } else {
      cached = 'light';
    }
    return cached;
  }

  function themeColors() {
    const t = probe();
    if (t === 'dark') {
      return {
        bg: 'rgba(31, 41, 55, 0.92)',
        bgSolid: '#1f2937',
        fg: '#f3f4f6',
        fgMuted: '#9ca3af',
        border: 'rgba(255,255,255,0.1)',
        accent: '#818cf8',
        accentBg: 'rgba(99,102,241,0.25)',
        danger: '#f87171',
        buttonBg: 'rgba(255,255,255,0.08)',
        buttonHover: 'rgba(255,255,255,0.16)'
      };
    }
    return {
      bg: 'rgba(255,255,255,0.92)',
      bgSolid: '#ffffff',
      fg: '#111827',
      fgMuted: '#6b7280',
      border: 'rgba(0,0,0,0.08)',
      accent: '#6366f1',
      accentBg: 'rgba(99,102,241,0.1)',
      danger: '#ef4444',
      buttonBg: 'rgba(0,0,0,0.06)',
      buttonHover: 'rgba(0,0,0,0.12)'
    };
  }

  function onThemeChange(cb) {
    if (window.matchMedia) {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      const handler = () => { cached = null; cb && cb(probe()); };
      if (mq.addEventListener) mq.addEventListener('change', handler);
      else if (mq.addListener) mq.addListener(handler); // Safari compat
    }
    // Also re-sample periodically because Arena's theme toggle can change classes
    // without a media query change.
    setInterval(() => {
      const old = cached;
      cached = null;
      const fresh = probe();
      if (old && fresh !== old) cb && cb(fresh);
    }, 2000);
  }

  window.ArenaHelper = window.ArenaHelper || {};
  window.ArenaHelper.theme = { probe, themeColors, onThemeChange };
})();
