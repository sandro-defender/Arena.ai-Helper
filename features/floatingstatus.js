/* Floating status pill in the bottom-right corner showing what the helper is doing.
 * Theme-aware (light/dark) and includes clickable Stop / Clear actions when appropriate.
 */
(function () {
  'use strict';
  const { settings, runtime, on } = window.ArenaHelper;
  const { themeColors } = window.ArenaHelper.theme;

  let pill = null;
  let btnStop = null;
  let btnClear = null;

  function ensurePill() {
    if (pill && document.contains(pill)) return pill;
    const c = themeColors();
    pill = document.createElement('div');
    pill.setAttribute('data-arena-helper', 'status-pill');
    Object.assign(pill.style, {
      position: 'fixed',
      right: '16px',
      bottom: '16px',
      zIndex: 2147483000,
      padding: '6px 8px 6px 10px',
      borderRadius: '999px',
      background: c.bg,
      color: c.fg,
      fontSize: '12px',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      boxShadow: '0 4px 14px rgba(0,0,0,0.25)',
      backdropFilter: 'blur(8px)',
      userSelect: 'none',
      transition: 'opacity 0.2s, background 0.2s',
      opacity: '0.92',
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      border: `1px solid ${c.border}`
    });

    const label = document.createElement('span');
    label.setAttribute('data-arena-helper', 'status-label');
    label.style.paddingRight = '4px';
    pill.appendChild(label);

    btnStop = document.createElement('button');
    btnStop.type = 'button';
    btnStop.title = 'Stop after this response (Alt+Shift+X)';
    btnStop.textContent = '■';
    Object.assign(btnStop.style, {
      border: 'none',
      background: c.buttonBg,
      color: c.danger,
      width: '22px', height: '22px',
      borderRadius: '999px',
      cursor: 'pointer',
      fontSize: '10px',
      lineHeight: '1',
      padding: 0,
      display: 'none'
    });
    btnStop.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const { features } = window.ArenaHelper;
      if (features && features.queue) features.queue.stopAfterThis();
    });
    pill.appendChild(btnStop);

    btnClear = document.createElement('button');
    btnClear.type = 'button';
    btnClear.title = 'Clear input & queue (Alt+Shift+C)';
    btnClear.textContent = '✕';
    Object.assign(btnClear.style, {
      border: 'none',
      background: c.buttonBg,
      color: c.fgMuted,
      width: '22px', height: '22px',
      borderRadius: '999px',
      cursor: 'pointer',
      fontSize: '12px',
      lineHeight: '1',
      padding: 0
    });
    btnClear.addEventListener('mouseenter', () => { btnClear.style.background = c.buttonHover; });
    btnClear.addEventListener('mouseleave', () => { btnClear.style.background = c.buttonBg; });
    btnClear.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const { features, ui } = window.ArenaHelper;
      const inp = ui.findChatInput();
      if (inp) ui.setInputText(inp, '');
      if (features && features.queue) features.queue.clearQueue();
    });
    pill.appendChild(btnClear);

    pill.addEventListener('mouseenter', () => { pill.style.opacity = '1'; });
    pill.addEventListener('mouseleave', () => { pill.style.opacity = '0.92'; });

    document.body.appendChild(pill);
    return pill;
  }

  function applyTheme() {
    if (!pill) return;
    const c = themeColors();
    Object.assign(pill.style, { background: c.bg, color: c.fg, border: `1px solid ${c.border}` });
    if (btnStop) {
      btnStop.style.background = c.buttonBg;
      btnStop.style.color = c.danger;
    }
    if (btnClear) {
      btnClear.style.background = c.buttonBg;
      btnClear.style.color = c.fgMuted;
    }
  }

  function render() {
    if (!settings.showFloatingStatus) { if (pill) pill.style.display = 'none'; return; }
    if (!runtime.hasChatUi) { if (pill) pill.style.display = 'none'; return; }
    ensurePill();
    applyTheme();
    pill.style.display = '';

    const label = pill.querySelector('[data-arena-helper="status-label"]');
    if (!label) return;

    let state;
    if (runtime.paused) state = '⏸ Paused';
    else if (runtime.captchaDetected) state = '🛑 Captcha — paused';
    else if (runtime.safetyNotice) state = '🟠 Safety limit reached';
    else if (runtime.isAssistantResponding) state = '🟣 Generating';
    else if (settings.stopAfterThis) state = '🟡 Stopping after this';
    else if (runtime.queuedPrompts && runtime.queuedPrompts.length > 0) state = `🟢 Queued: ${runtime.queuedPrompts.length}`;
    else state = '⚪ Idle';

    const flags = [];
    if (settings.autoScroll) flags.push('AS');
    if (settings.autoSend) flags.push('ASend');
    if (settings.autoContinue) flags.push('AC');
    if (runtime.userScrolledUp) flags.push('(paused)');
    label.textContent = `${state} · ${flags.join(' · ')}`;

    // Show Stop button only while generating or when queue has items
    const showStop = !runtime.captchaDetected && (runtime.isAssistantResponding || (runtime.queuedPrompts && runtime.queuedPrompts.length > 0) || settings.stopAfterThis);
    if (btnStop) btnStop.style.display = showStop ? '' : 'none';
  }

  function attach() {
    render();
    setInterval(render, 600);
    on('queue:updated', render);
    on('response:started', render);
    on('response:done', render);
    window.ArenaHelper.onSettingsChange(() => render());
    window.ArenaHelper.theme.onThemeChange(() => applyTheme());
  }

  window.ArenaHelper.features = window.ArenaHelper.features || {};
  window.ArenaHelper.features.floatingstatus = { attach };
})();
