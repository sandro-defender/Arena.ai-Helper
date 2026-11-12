/* Combined debug + status overlay.
 * Merges the floating status pill and the debug log panel into one transparent,
 * always-on-top panel. Shows live status, queue count, safety notices, and a
 * scrollable log of extension activity + console errors. Includes test buttons
 * for manually triggering automation actions.
 */
(function () {
  'use strict';
  const { settings, runtime, on, ui } = window.ArenaHelper;
  const VERSION = '3.1.5';

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
  on('tool-limit:reconnect', () => addLog('info', 'Clicked "Reconnect" to resume chat'));
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
      minWidth: '320px',
      minHeight: '120px',
      backdropFilter: 'blur(10px)'
    });

    // Header
    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:6px 10px;border-bottom:1px solid rgba(255,255,255,0.1);flex-shrink:0;';

    // Animated status indicator + version label.
    const titleWrap = document.createElement('div');
    titleWrap.style.cssText = 'display:flex;flex-direction:column;gap:2px;cursor:move;user-select:none;';
    header.appendChild(titleWrap);

    const animRow = document.createElement('div');
    animRow.style.cssText = 'display:flex;align-items:center;gap:8px;';
    titleWrap.appendChild(animRow);

    // Radar + version column.
    const radarCol = document.createElement('div');
    radarCol.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:1px;flex-shrink:0;';
    animRow.appendChild(radarCol);

    // Radar container — bigger.
    const radar = document.createElement('div');
    radar.style.cssText = 'width:48px;height:48px;border-radius:50%;position:relative;overflow:hidden;background:rgba(0,0,0,0.5);border:1px solid rgba(255,255,255,0.2);flex-shrink:0;';
    radarCol.appendChild(radar);

    // Radar grid rings.
    for (let i = 1; i <= 3; i++) {
      const ring = document.createElement('div');
      ring.style.cssText = 'position:absolute;border:1px solid rgba(255,255,255,0.1);border-radius:50%;top:50%;left:50%;transform:translate(-50%,-50%);width:' + (i * 14) + 'px;height:' + (i * 14) + 'px;';
      radar.appendChild(ring);
    }

    // Crosshairs.
    const hLine = document.createElement('div');
    hLine.style.cssText = 'position:absolute;top:50%;left:0;width:100%;height:1px;background:rgba(255,255,255,0.06);';
    radar.appendChild(hLine);
    const vLine = document.createElement('div');
    vLine.style.cssText = 'position:absolute;left:50%;top:0;height:100%;width:1px;background:rgba(255,255,255,0.06);';
    radar.appendChild(vLine);

    // Radar sweep beam.
    const beam = document.createElement('div');
    beam.style.cssText = 'position:absolute;top:50%;left:50%;width:50%;height:2px;transform-origin:0 50%;background:linear-gradient(90deg, rgba(81,207,102,0.9), rgba(81,207,102,0));border-radius:1px;';
    radar.appendChild(beam);

    // Center dot.
    const centerDot = document.createElement('span');
    centerDot.style.cssText = 'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:6px;height:6px;border-radius:50%;background:#51cf66;display:inline-block;transition:background 0.3s;box-shadow:0 0 6px rgba(81,207,102,0.8);z-index:2;';
    radar.appendChild(centerDot);

    // Blips (detected contacts).
    const blips = [];
    for (let i = 0; i < 5; i++) {
      const blip = document.createElement('div');
      blip.style.cssText = 'position:absolute;width:4px;height:4px;border-radius:50%;background:#ff6b6b;opacity:0;transition:opacity 0.3s;box-shadow:0 0 6px rgba(255,107,107,0.9);';
      radar.appendChild(blip);
      blips.push(blip);
    }

    // Status text next to radar (no "Arena Helper" title).
    const statusText = document.createElement('div');
    statusText.style.cssText = 'display:flex;flex-direction:column;gap:1px;';
    animRow.appendChild(statusText);

    const statusLabel = document.createElement('span');
    statusLabel.style.cssText = 'font-weight:600;font-size:12px;color:#74c0fc;';
    statusLabel.textContent = '';
    statusText.appendChild(statusLabel);

    // Version under the radar.
    const versionLabel = document.createElement('span');
    versionLabel.style.cssText = 'font-size:9px;color:#868e96;text-align:center;';
    versionLabel.textContent = 'v' + VERSION;
    radarCol.appendChild(versionLabel);

    // Inject keyframes.
    if (!document.getElementById('arena-helper-radar-style')) {
      const style = document.createElement('style');
      style.id = 'arena-helper-radar-style';
      style.textContent = [
        '@keyframes radarSweep { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }',
        '@keyframes blipFade { 0% { opacity: 0.9; transform: scale(1.3); } 100% { opacity: 0; transform: scale(0.3); } }',
      ].join(' ');
      document.head.appendChild(style);
    }

    beam.style.animation = 'radarSweep 2s linear infinite';

    // Update radar colors/state based on runtime.
    function updateAnim() {
      let color = '#51cf66';
      let beamColor = 'rgba(81,207,102,0.9)';
      let speed = '2s';
      let showBlips = false;
      let statusMsg = 'Idle';
      if (runtime.paused) { color = '#ffd43b'; beamColor = 'rgba(255,212,59,0.9)'; speed = '4s'; statusMsg = 'Paused'; }
      else if (runtime.captchaDetected) { color = '#ff6b6b'; beamColor = 'rgba(255,107,107,0.9)'; speed = '0.8s'; showBlips = true; statusMsg = 'Captcha!'; }
      else if (runtime.safetyNotice) { color = '#ff922b'; beamColor = 'rgba(255,146,43,0.9)'; speed = '1.2s'; statusMsg = 'Safety'; }
      else if (runtime.isAssistantResponding) { color = '#74c0fc'; beamColor = 'rgba(116,192,252,0.9)'; speed = '0.6s'; statusMsg = 'Generating'; }
      else if (runtime.queuedPrompts && runtime.queuedPrompts.length > 0) { color = '#51cf66'; beamColor = 'rgba(81,207,102,0.9)'; speed = '1.5s'; statusMsg = 'Queued: ' + runtime.queuedPrompts.length; }
      else { statusMsg = 'Idle'; }
      centerDot.style.background = color;
      centerDot.style.boxShadow = '0 0 6px ' + color;
      beam.style.background = 'linear-gradient(90deg, ' + beamColor + ', transparent)';
      beam.style.animation = 'radarSweep ' + speed + ' linear infinite';
      statusLabel.textContent = statusMsg;
      statusLabel.style.color = color;
      for (const blip of blips) {
        if (showBlips) {
          blip.style.left = (6 + Math.random() * 36) + 'px';
          blip.style.top = (6 + Math.random() * 36) + 'px';
          blip.style.opacity = '0.9';
          blip.style.animation = 'blipFade 1.5s ease-out infinite';
        } else {
          blip.style.opacity = '0';
          blip.style.animation = 'none';
        }
      }
    }
    updateAnim();
    setInterval(updateAnim, 500);

    // Inject keyframes for radar sweep and blip animation.
    if (!document.getElementById('arena-helper-radar-style')) {
      const style = document.createElement('style');
      style.id = 'arena-helper-radar-style';
      style.textContent = [
        '@keyframes radarSweep { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }',
        '@keyframes blipFade { 0% { opacity: 0.9; transform: scale(1.2); } 100% { opacity: 0; transform: scale(0.3); } }',
      ].join(' ');
      document.head.appendChild(style);
    }

    beam.style.animation = 'radarSweep 2s linear infinite';

    // Update radar colors/state based on runtime.
    function updateAnim() {
      let color = '#51cf66'; // idle green
      let beamColor = 'rgba(81,207,102,0.9)';
      let speed = '2s';
      let showBlips = false;
      if (runtime.paused) { color = '#ffd43b'; beamColor = 'rgba(255,212,59,0.9)'; speed = '4s'; }
      else if (runtime.captchaDetected) { color = '#ff6b6b'; beamColor = 'rgba(255,107,107,0.9)'; speed = '0.8s'; showBlips = true; }
      else if (runtime.safetyNotice) { color = '#ff922b'; beamColor = 'rgba(255,146,43,0.9)'; speed = '1.2s'; }
      else if (runtime.isAssistantResponding) { color = '#74c0fc'; beamColor = 'rgba(116,192,252,0.9)'; speed = '0.6s'; }
      else if (runtime.queuedPrompts && runtime.queuedPrompts.length > 0) { color = '#51cf66'; beamColor = 'rgba(81,207,102,0.9)'; speed = '1.5s'; }
      centerDot.style.background = color;
      centerDot.style.boxShadow = '0 0 4px ' + color;
      beam.style.background = 'linear-gradient(90deg, ' + beamColor + ', transparent)';
      beam.style.animation = 'radarSweep ' + speed + ' linear infinite';
      // Show blips when there's an alert (captcha or safety).
      for (const blip of blips) {
        if (showBlips) {
          blip.style.left = (4 + Math.random() * 20) + 'px';
          blip.style.top = (4 + Math.random() * 20) + 'px';
          blip.style.opacity = '0.9';
          blip.style.animation = 'blipFade 1.5s ease-out infinite';
        } else {
          blip.style.opacity = '0';
          blip.style.animation = 'none';
        }
      }
    }
    updateAnim();
    setInterval(updateAnim, 500);

    // Make the panel draggable by the header.
    header.style.cursor = 'move';
    header.addEventListener('mousedown', (ev) => {
      // Don't start drag if clicking a button or resize handle.
      if (ev.target && ev.target.tagName === 'BUTTON') return;
      if (ev.target === resizeHandle) return;
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
      if (saved && saved.left && saved.bottom) {
        panel.style.left = saved.left;
        panel.style.bottom = saved.bottom;
        panel.style.right = 'auto';
        panel.style.top = 'auto';
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

    // Toggle switches for key features.
    function makeSwitch(label, settingKey, color) {
      const wrap = document.createElement('div');
      wrap.style.cssText = 'display:flex;align-items:center;gap:4px;';
      const lbl = document.createElement('span');
      lbl.style.cssText = 'font-size:10px;color:#f8f9fa;';
      lbl.textContent = label;
      wrap.appendChild(lbl);
      const btn = document.createElement('button');
      btn.style.cssText = 'width:36px;height:18px;border-radius:9px;border:1px solid rgba(255,255,255,0.2);cursor:pointer;font-size:9px;font-weight:600;transition:background 0.2s;';
      function update() {
        const on = !!settings[settingKey];
        btn.style.background = on ? (color || '#51cf66') : 'rgba(255,255,255,0.1)';
        btn.textContent = on ? 'ON' : 'OFF';
        btn.style.color = on ? '#fff' : '#868e96';
      }
      update();
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        settings[settingKey] = !settings[settingKey];
        const { setSetting } = window.ArenaHelper;
        if (setSetting) setSetting(settingKey, settings[settingKey]);
        update();
        addLog('info', label + ' ' + (settings[settingKey] ? 'enabled' : 'disabled'));
      });
      if (window.ArenaHelper.onSettingsChange) {
        window.ArenaHelper.onSettingsChange((key) => { if (key === settingKey || key === '__all__') update(); });
      }
      wrap.appendChild(btn);
      return wrap;
    }

    const swAutoScroll = makeSwitch('Auto-scroll', 'autoScroll', '#74c0fc');
    btnGroup.appendChild(swAutoScroll);
    const swAutoSend = makeSwitch('Auto-send', 'autoSend', '#74c0fc');
    btnGroup.appendChild(swAutoSend);
    const swAutoContinue = makeSwitch('Auto-continue', 'autoContinue', '#74c0fc');
    btnGroup.appendChild(swAutoContinue);
    const swToolLimit = makeSwitch('Tool-limit', 'toolLimitAutoContinue', '#51cf66');
    btnGroup.appendChild(swToolLimit);
    const swDebug = makeSwitch('Debug overlay', 'showDebugOverlay', '#da77f2');
    btnGroup.appendChild(swDebug);
    const swAutoReload = makeSwitch('Auto-reload', 'autoReloadOnIdle', '#ffd43b');
    btnGroup.appendChild(swAutoReload);

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

    const resetPosBtn = makeBtn('Reset pos', () => {
      try { localStorage.removeItem('arenaHelperOverlayPos'); } catch (e) {}
      try { localStorage.removeItem('arenaHelperOverlaySize'); } catch (e) {}
      panel.style.width = '440px';
      panel.style.height = '';
      panel.style.right = '12px';
      panel.style.bottom = '12px';
      panel.style.left = 'auto';
      panel.style.top = 'auto';
      addLog('info', 'Panel position and size reset to default');
    }, '#868e96');
    btnGroup.appendChild(resetPosBtn);

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

    // Custom resize handle at top-left corner.
    const resizeHandle = document.createElement('div');
    resizeHandle.style.cssText = 'position:absolute;top:0;left:0;width:16px;height:16px;cursor:nwse-resize;z-index:10;background:transparent;';
    // Visual indicator lines.
    const h1 = document.createElement('div');
    h1.style.cssText = 'position:absolute;top:4px;left:4px;width:8px;height:1px;background:rgba(255,255,255,0.3);transform:rotate(45deg);transform-origin:0 0;';
    resizeHandle.appendChild(h1);
    const h2 = document.createElement('div');
    h2.style.cssText = 'position:absolute;top:7px;left:4px;width:5px;height:1px;background:rgba(255,255,255,0.3);transform:rotate(45deg);transform-origin:0 0;';
    resizeHandle.appendChild(h2);
    panel.appendChild(resizeHandle);

    // Resize logic: anchor bottom-left, resize from top-left.
    let resizing = false;
    let startMouseX = 0;
    let startMouseY = 0;
    let startWidth = 0;
    let startHeight = 0;
    let startBottom = 0;
    let startRight = 0;

    resizeHandle.addEventListener('mousedown', (ev) => {
      ev.stopPropagation();
      ev.preventDefault();
      resizing = true;
      const rect = panel.getBoundingClientRect();
      startMouseX = ev.clientX;
      startMouseY = ev.clientY;
      startWidth = rect.width;
      startHeight = rect.height;
      startLeft = rect.left;
      startTop = rect.top;
      panel.style.transition = 'none';
    });

    document.addEventListener('mousemove', (ev) => {
      if (!resizing || !panel) return;
      // Dragging handle left/up increases size; handle right/down decreases.
      const dx = startMouseX - ev.clientX;
      const dy = startMouseY - ev.clientY;
      let newW = Math.max(320, startWidth + dx);
      let newH = Math.max(120, startHeight + dy);
      // Keep within viewport.
      newW = Math.min(newW, window.innerWidth - 8);
      newH = Math.min(newH, window.innerHeight - 8);
      // Keep bottom-right anchored: adjust top/left.
      const newLeft = Math.max(0, startLeft - dx);
      const newTop = Math.max(0, startTop - dy);
      panel.style.width = newW + 'px';
      panel.style.height = newH + 'px';
      panel.style.left = newLeft + 'px';
      panel.style.top = newTop + 'px';
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
    });

    document.addEventListener('mouseup', () => {
      if (resizing) {
        resizing = false;
        panel.style.transition = '';
        try { localStorage.setItem('arenaHelperOverlaySize', JSON.stringify({ width: panel.style.width, height: panel.style.height })); } catch (e) {}
        // Also persist position.
        try { localStorage.setItem('arenaHelperOverlayPos', JSON.stringify({ left: panel.style.left, top: panel.style.top })); } catch (e) {}
      }
    });

    // Restore saved size.
    try {
      const savedSize = JSON.parse(localStorage.getItem('arenaHelperOverlaySize') || 'null');
      if (savedSize && savedSize.width && savedSize.height) {
        panel.style.width = savedSize.width;
        panel.style.height = savedSize.height;
      }
    } catch (e) {}

    // Restore saved position (bottom-left anchored).
    // Restore saved position if user manually dragged.
    let userDragged = false;
    try {
      const savedPos = JSON.parse(localStorage.getItem('arenaHelperOverlayPos') || 'null');
      if (savedPos && savedPos.left && savedPos.top) {
        panel.style.left = savedPos.left;
        panel.style.top = savedPos.top;
        panel.style.right = 'auto';
        panel.style.bottom = 'auto';
        userDragged = true;
      }
    } catch (e) {}

    // Always anchor at the bottom-right corner unless the user has dragged it.
    if (!userDragged) {
      panel.style.right = '12px';
      panel.style.bottom = '12px';
      panel.style.left = 'auto';
      panel.style.top = 'auto';
    }

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
