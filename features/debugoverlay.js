/* Combined debug + status overlay.
 * Merges the floating status pill and the debug log panel into one transparent,
 * always-on-top panel. Shows live status, queue count, safety notices, and a
 * scrollable log of extension activity + console errors. Includes test buttons
 * for manually triggering automation actions.
 */
(function () {
  'use strict';
  const { settings, runtime, on, ui } = window.ArenaHelper;
  const VERSION = '3.0.1';

  const MAX_LOGS = 100;
  let logs = [];
  let panel = null;
  let body = null;
  let statusLine = null;
  let visible = true;
  let dragging = false;
  let dragOffsetX = 0;
  let dragOffsetY = 0;

  function timestamp() {
    const d = new Date();
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  function addLog(level, message) {
    logs.push({ time: timestamp(), level, message: String(message || '') });
    if (logs.length > MAX_LOGS) logs = logs.slice(-MAX_LOGS);
    if (body) renderLogs();
  }

  // Capture console errors and warnings.
  const origError = console.error;
  const origWarn = console.warn;
  console.error = function (...args) {
    addLog('error', args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' '));
    origError.apply(console, args);
  };
  console.warn = function (...args) {
    addLog('warn', args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' '));
    origWarn.apply(console, args);
  };

  // Capture extension activity events.
  on('captcha:entered', (d) => addLog('info', 'Captcha entered: ' + (d && d.reason)));
  on('captcha:exited', (d) => addLog('info', 'Captcha exited: ' + (d && d.reason)));
  on('tool-limit:continued', (d) => addLog('info', 'Tool-limit continued: ' + JSON.stringify(d)));
  on('tool-limit:keep-working', () => addLog('info', 'Clicked "Keep working" in task dialog'));
  on('tool-limit:detected', (d) => addLog('info', 'Limit message detected: ' + (d && d.text)));
  on('prompt:sent', (d) => addLog('info', 'Prompt sent: ' + (d && d.text && d.text.slice(0, 80))));
  on('response:done', () => addLog('info', 'Response finished'));
  on('response:started', () => addLog('info', 'Response started'));
  on('safety:limit', (d) => addLog('warn', 'Safety limit: ' + (d && d.message)));
  on('queue:updated', (d) => addLog('info', 'Queue updated: ' + (d && d.count) + ' remaining'));

  function levelColor(level) {
    if (level === 'error') return '#ff6b6b';
    if (level === 'warn') return '#ffd43b';
    return '#74c0fc';
  }

  function getStatusText() {
    if (runtime.paused) return '⏸ Paused';
    if (runtime.captchaDetected) return '🛑 Captcha — paused';
    if (runtime.safetyNotice) return '🟠 Safety limit reached';
    if (runtime.isAssistantResponding) return '🟣 Generating';
    if (settings.stopAfterThis) return '🟡 Stopping after this';
    if (runtime.queuedPrompts && runtime.queuedPrompts.length > 0) return '🟢 Queued: ' + runtime.queuedPrompts.length;
    return '⚪ Idle';
  }

  function renderStatus() {
    if (!statusLine) return;
    const flags = [];
    if (settings.autoScroll) flags.push('AS');
    if (settings.autoSend) flags.push('ASend');
    if (settings.autoContinue) flags.push('AC');
    if (settings.toolLimitAutoContinue) flags.push('TL');
    if (runtime.userScrolledUp) flags.push('(paused)');
    statusLine.textContent = getStatusText() + '  ·  ' + flags.join(' · ');
  }

  function renderLogs() {
    if (!body) return;
    body.innerHTML = '';
    for (const entry of logs) {
      const line = document.createElement('div');
      line.style.cssText = 'margin:0;padding:2px 0;border-bottom:1px solid rgba(255,255,255,0.08);word-break:break-word;white-space:pre-wrap;';
      const time = document.createElement('span');
      time.style.cssText = 'color:#868e96;margin-right:6px;';
      time.textContent = entry.time;
      const level = document.createElement('span');
      level.style.cssText = 'color:' + levelColor(entry.level) + ';font-weight:600;margin-right:6px;text-transform:uppercase;font-size:10px;';
      level.textContent = entry.level;
      const msg = document.createElement('span');
      msg.style.cssText = 'color:#f8f9fa;';
      msg.textContent = entry.message;
      line.appendChild(time);
      line.appendChild(level);
      line.appendChild(msg);
      body.appendChild(line);
    }
    body.scrollTop = body.scrollHeight;
  }

  function makeBtn(label, handler, color) {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.style.cssText = 'background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.2);color:' + (color || '#f8f9fa') + ';padding:2px 6px;border-radius:4px;cursor:pointer;font-size:10px;';
    btn.addEventListener('click', (ev) => { ev.stopPropagation(); try { handler(); } catch (e) { addLog('error', 'Button error: ' + e.message); } });
    return btn;
  }

  function buildPanel() {
    if (panel) return panel;
    panel = document.createElement('div');
    panel.setAttribute('data-arena-helper', 'debug-overlay');
    Object.assign(panel.style, {
      position: 'fixed',
      bottom: '12px',
      right: '12px',
      width: '440px',
      maxHeight: '400px',
      zIndex: '2147483647',
      background: 'rgba(15, 15, 20, 0.85)',
      color: '#f8f9fa',
      border: '1px solid rgba(255,255,255,0.15)',
      borderRadius: '10px',
      boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      fontSize: '11px',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'auto',
      resize: 'both',
      minWidth: '320px',
      minHeight: '120px',
      backdropFilter: 'blur(10px)'
    });

    // Header
    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:6px 10px;border-bottom:1px solid rgba(255,255,255,0.1);flex-shrink:0;';

    const title = document.createElement('span');
    title.style.cssText = 'font-weight:600;font-size:12px;color:#74c0fc;cursor:move;user-select:none;';
    title.textContent = 'Arena Helper v' + VERSION + ' — Status & Debug';
    header.appendChild(title);

    // Make the panel draggable by the header.
    header.style.cursor = 'move';
    header.addEventListener('mousedown', (ev) => {
      // Don't start drag if clicking a button.
      if (ev.target && ev.target.tagName === 'BUTTON') return;
      dragging = true;
      const rect = panel.getBoundingClientRect();
      dragOffsetX = ev.clientX - rect.left;
      dragOffsetY = ev.clientY - rect.top;
      panel.style.transition = 'none';
      ev.preventDefault();
    });
    document.addEventListener('mousemove', (ev) => {
      if (!dragging || !panel) return;
      let x = ev.clientX - dragOffsetX;
      let y = ev.clientY - dragOffsetY;
      // Keep within viewport.
      x = Math.max(0, Math.min(window.innerWidth - panel.offsetWidth, x));
      y = Math.max(0, Math.min(window.innerHeight - panel.offsetHeight, y));
      panel.style.left = x + 'px';
      panel.style.top = y + 'px';
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
    });
    document.addEventListener('mouseup', () => {
      if (dragging) {
        dragging = false;
        panel.style.transition = '';
        // Persist position.
        try { localStorage.setItem('arenaHelperOverlayPos', JSON.stringify({ left: panel.style.left, top: panel.style.top })); } catch (e) {}
      }
    });

    // Restore saved position.
    try {
      const saved = JSON.parse(localStorage.getItem('arenaHelperOverlayPos') || 'null');
      if (saved && saved.left && saved.top) {
        panel.style.left = saved.left;
        panel.style.top = saved.top;
        panel.style.right = 'auto';
        panel.style.bottom = 'auto';
      }
    } catch (e) {}

    const btnGroup = document.createElement('div');
    btnGroup.style.cssText = 'display:flex;gap:4px;flex-wrap:wrap;';

    const copyBtn = makeBtn('Copy', () => {
      const text = logs.map(l => `[${l.time}] ${l.level.toUpperCase()}: ${l.message}`).join('\n');
      navigator.clipboard.writeText(text).then(() => { copyBtn.textContent = 'Copied!'; setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1200); }).catch(() => { copyBtn.textContent = 'Error'; });
    });
    btnGroup.appendChild(copyBtn);

    const clearBtn = makeBtn('Clear', () => { logs = []; renderLogs(); });
    btnGroup.appendChild(clearBtn);

    const testContinueBtn = makeBtn('Send continue', () => {
      const { ui } = window.ArenaHelper;
      const input = ui.findChatInput();
      if (!input) { addLog('warn', 'No chat input found'); return; }
      ui.setInputText(input, 'continue');
      setTimeout(() => {
        const sent = ui.submitInput(input);
        addLog('info', sent ? 'Sent "continue" manually' : 'Submit returned false');
      }, 300);
    }, '#74c0fc');
    btnGroup.appendChild(testContinueBtn);

    const testKeepWorkingBtn = makeBtn('Click Keep working', () => {
      const { features } = window.ArenaHelper;
      if (features && features.toollimit) {
        features.toollimit.check();
        addLog('info', 'Triggered toollimit.check()');
      } else {
        const btns = document.querySelectorAll('button, [role="button"], a');
        for (const b of btns) {
          if (/keep working/i.test((b.innerText || '').trim())) {
            b.click();
            addLog('info', 'Clicked "Keep working" button directly');
            return;
          }
        }
        addLog('warn', 'No "Keep working" button found');
      }
    }, '#51cf66');
    btnGroup.appendChild(testKeepWorkingBtn);

    const testCheckBtn = makeBtn('Run toollimit check', () => {
      const { features } = window.ArenaHelper;
      if (features && features.toollimit) {
        features.toollimit.check();
        addLog('info', 'toollimit.check() called');
      } else {
        addLog('warn', 'toollimit feature not loaded');
      }
    }, '#ffd43b');
    btnGroup.appendChild(testCheckBtn);

    const testScrollBtn = makeBtn('Force scroll', () => {
      const { features } = window.ArenaHelper;
      if (features && features.scroll) {
        features.scroll.forceScroll();
        addLog('info', 'Force scroll triggered');
      }
    }, '#da77f2');
    btnGroup.appendChild(testScrollBtn);

    const stopBtn = makeBtn('Stop after this', () => {
      const { features } = window.ArenaHelper;
      if (features && features.queue) {
        features.queue.stopAfterThis();
        addLog('info', 'Stop-after-this triggered');
      }
    }, '#ff6b6b');
    btnGroup.appendChild(stopBtn);

    const pauseBtn = makeBtn('Pause', () => {
      runtime.paused = !runtime.paused;
      pauseBtn.textContent = runtime.paused ? 'Resume' : 'Pause';
      pauseBtn.style.color = runtime.paused ? '#ffd43b' : '#f8f9fa';
      addLog('info', runtime.paused ? 'Automation paused' : 'Automation resumed');
    }, '#ffd43b');
    btnGroup.appendChild(pauseBtn);

    const clearInputBtn = makeBtn('Clear input', () => {
      const { ui, features } = window.ArenaHelper;
      const inp = ui.findChatInput();
      if (inp) ui.setInputText(inp, '');
      if (features && features.queue) features.queue.clearQueue();
      addLog('info', 'Input and queue cleared');
    }, '#868e96');
    btnGroup.appendChild(clearInputBtn);

    const toggleBtn = makeBtn('Hide', () => {
      visible = !visible;
      body.style.display = visible ? '' : 'none';
      statusLine.style.display = visible ? '' : 'none';
      toggleBtn.textContent = visible ? 'Hide' : 'Show';
    });
    btnGroup.appendChild(toggleBtn);

    header.appendChild(btnGroup);
    panel.appendChild(header);

    // Status line
    statusLine = document.createElement('div');
    statusLine.style.cssText = 'padding:4px 10px;font-size:11px;font-weight:600;color:#ffd43b;border-bottom:1px solid rgba(255,255,255,0.1);flex-shrink:0;';
    panel.appendChild(statusLine);

    // Log body
    body = document.createElement('div');
    body.style.cssText = 'flex:1;overflow-y:auto;padding:6px 10px;min-height:80px;max-height:220px;';
    panel.appendChild(body);

    document.body.appendChild(panel);
    renderStatus();
    renderLogs();

    // Keep panel within viewport on window resize.
    function clampPanel() {
      if (!panel) return;
      const rect = panel.getBoundingClientRect();
      let x = rect.left;
      let y = rect.top;
      if (x + rect.width > window.innerWidth) x = Math.max(0, window.innerWidth - rect.width - 8);
      if (y + rect.height > window.innerHeight) y = Math.max(0, window.innerHeight - rect.height - 8);
      if (x < 0) x = 0;
      if (y < 0) y = 0;
      panel.style.left = x + 'px';
      panel.style.top = y + 'px';
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
    }
    window.addEventListener('resize', clampPanel);

    // Update status every 500ms
    setInterval(() => { renderStatus(); }, 500);

    return panel;
  }

  function attach() {
    if (!settings.showDebugOverlay) {
      // Still capture console errors silently.
      return;
    }
    setTimeout(buildPanel, 1500);
    addLog('info', 'Combined overlay attached. URL: ' + location.href);
  }

  window.ArenaHelper.features = window.ArenaHelper.features || {};
  window.ArenaHelper.features.debugoverlay = { attach, addLog };
})();
