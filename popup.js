(function () {
  'use strict';

  const defaults = {
    autoScroll: true,
    scrollPauseOnManualScroll: true,
    autoSend: true,
    autoSendDelayMs: 600,
    multiQueueEnabled: true,
    queueDelimiter: '---',
    maxQueueLength: 10,
    autoContinue: true,
    autoContinueMaxClicks: 3,
    toolLimitAutoContinue: true,
    doneNotification: true,
    doneSound: true,
    autoFocus: true,
    showFloatingStatus: true,
    showDebugOverlay: true,
    showCopyCode: true,
    showTimestamps: false,
    closeProtect: true,
    perConversationSettings: false,
    popupTheme: 'system'
  };

  const fallbackDefaults = [
    { id: 'continue', label: 'Continue', category: 'General', autoSend: true, body: 'Please continue from where you left off.' },
    { id: 'tldr', label: 'TL;DR', category: 'General', autoSend: true, body: 'Summarize the above concisely in bullet points.' },
    { id: 'fixcode', label: 'Fix bugs', category: 'Code', autoSend: true, body: 'Find and fix any bugs in the code above.' }
  ];

  const profiles = {
    handsfree: {
      desc: 'All automation on: auto-scroll, auto-send, queue, auto-continue, notifications, focus, and close-protect. Captcha detection still pauses automation safely.',
      settings: {
        autoScroll: true, scrollPauseOnManualScroll: true, autoSend: true,
        multiQueueEnabled: true, autoContinue: true, toolLimitAutoContinue: true,
        doneNotification: true, doneSound: true, autoFocus: true, showFloatingStatus: true, showDebugOverlay: true,
        showCopyCode: true, showTimestamps: false, closeProtect: true
      }
    },
    chat: {
      desc: 'Normal chat mode: scrolling, copy-code, focus, and close protection on; sending, queueing, and auto-continue off.',
      settings: {
        autoScroll: true, scrollPauseOnManualScroll: true, autoSend: false,
        multiQueueEnabled: false, autoContinue: false, toolLimitAutoContinue: false,
        doneNotification: false, doneSound: false, autoFocus: true, showFloatingStatus: true, showDebugOverlay: true,
        showCopyCode: true, showTimestamps: false, closeProtect: true
      }
    },
    off: {
      desc: 'All helper features off. Pure Arena experience.',
      settings: {
        autoScroll: false, scrollPauseOnManualScroll: false, autoSend: false,
        multiQueueEnabled: false, autoContinue: false, toolLimitAutoContinue: false,
        doneNotification: false, doneSound: false, autoFocus: false, showFloatingStatus: false, showDebugOverlay: false,
        showCopyCode: false, showTimestamps: false, closeProtect: false
      }
    }
  };

  const boolIds = [
    'autoScroll', 'scrollPauseOnManualScroll', 'autoSend', 'multiQueueEnabled',
    'autoContinue', 'toolLimitAutoContinue', 'doneNotification', 'doneSound', 'autoFocus',
    'showFloatingStatus', 'showDebugOverlay', 'showCopyCode', 'showTimestamps', 'closeProtect',
    'perConversationSettings'
  ];
  const numberIds = ['autoSendDelayMs', 'maxQueueLength', 'autoContinueMaxClicks'];
  const controlLabels = {
    autoScroll: 'Auto-scroll to bottom',
    scrollPauseOnManualScroll: 'Pause auto-scroll on manual scroll',
    autoSend: 'Auto-send prompts',
    multiQueueEnabled: 'Enable multi-prompt queue',
    autoContinue: 'Auto-continue responses',
    toolLimitAutoContinue: 'Auto-continue after tool-call limit',
    doneNotification: 'Show done notification',
    doneSound: 'Play done sound',
    autoFocus: 'Auto-focus chat input',
    showFloatingStatus: 'Show floating status pill',
    showDebugOverlay: 'Show debug overlay (v3.0.1)',
    showCopyCode: 'Show copy-code buttons',
    showTimestamps: 'Show message timestamps',
    closeProtect: 'Protect against accidental close',
    perConversationSettings: 'Use settings for this conversation only'
  };

  let snippets = [];
  let queueItems = [];
  let currentSettings = { ...defaults };
  let latestStatus = null;
  let noticeTimer = null;

  function sendToActiveTab(message, callback) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs || !tabs[0] || !tabs[0].id) {
        if (callback) callback(null, new Error('No active tab.'));
        return;
      }
      try {
        chrome.tabs.sendMessage(tabs[0].id, message, { frameId: 0 }, (response) => {
          const err = chrome.runtime.lastError;
          if (callback) callback(response || null, err || null);
        });
      } catch (e) {
        if (callback) callback(null, e);
      }
    });
  }

  function showNotice(message, isError) {
    const el = document.getElementById('notice');
    if (!el) return;
    clearTimeout(noticeTimer);
    el.textContent = message || '';
    el.classList.toggle('error', !!isError);
    if (message) {
      noticeTimer = setTimeout(() => {
        el.textContent = '';
        el.classList.remove('error');
      }, 6500);
    }
  }

  function normalizeSnippet(s, i) {
    return {
      id: (s.id || ('p' + i)).toString().toLowerCase().replace(/[^a-z0-9_-]/g, '-'),
      label: s.label || s.id || ('Prompt ' + (i + 1)),
      body: s.body || '',
      category: s.category || 'General',
      autoSend: s.autoSend === undefined ? true : !!s.autoSend
    };
  }

  function getBuiltinDefaults() { return fallbackDefaults.slice(); }

  function applyPopupTheme() {
    const preference = currentSettings.popupTheme || 'system';
    const dark = preference === 'dark' || (preference === 'system'
      && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.body.dataset.theme = dark ? 'dark' : 'light';
  }

  function hydrateControls() {
    for (const id of boolIds) {
      const el = document.getElementById(id);
      if (el) el.checked = !!currentSettings[id];
    }
    for (const id of numberIds) {
      const el = document.getElementById(id);
      if (el) el.value = currentSettings[id];
    }
    const delim = document.getElementById('queueDelimiter');
    if (delim) delim.value = currentSettings.queueDelimiter || '---';
    const theme = document.getElementById('popupTheme');
    if (theme) theme.value = currentSettings.popupTheme || 'system';
    applyPopupTheme();
    updateActiveProfile();
  }

  function loadSettings() {
    chrome.storage.sync.get({ ...defaults, snippets: null }, (items) => {
      currentSettings = { ...defaults, ...items };
      snippets = Array.isArray(items.snippets) && items.snippets.length
        ? items.snippets.map(normalizeSnippet)
        : getBuiltinDefaults();
      hydrateControls();
      renderSnippets();
      const ver = document.getElementById('verLabel');
      try {
        const m = chrome.runtime.getManifest();
        if (ver) ver.textContent = 'v' + m.version;
      } catch (e) {}
      refreshStatus(false);
    });
  }

  function saveSetting(key, value, quiet) {
    currentSettings[key] = value;
    if (key === 'popupTheme') applyPopupTheme();
    updateActiveProfile();
    sendToActiveTab({ type: 'helper:set-setting', key, value }, (response, err) => {
      if (response && response.settings) {
        currentSettings = { ...currentSettings, ...response.settings };
        hydrateControls();
      } else if (err) {
        // The popup can also be opened away from Arena; preserve global settings then.
        chrome.storage.sync.set({ [key]: value });
        if (!quiet) showNotice('Saved as a global setting. Open an Arena conversation for per-conversation settings.', false);
      }
      if (key === 'perConversationSettings') setTimeout(() => refreshStatus(true), 120);
    });
  }

  function applySettings(values) {
    Object.assign(currentSettings, values);
    hydrateControls();
    sendToActiveTab({ type: 'helper:apply-settings', values }, (response, err) => {
      if (response && response.settings) {
        currentSettings = { ...currentSettings, ...response.settings };
        hydrateControls();
        showNotice('Profile applied.', false);
      } else if (err) {
        chrome.storage.sync.set(values);
        showNotice('Profile saved as global settings.', false);
      }
      setTimeout(() => refreshStatus(true), 120);
    });
  }

  function bindSettingControls() {
    for (const id of boolIds) {
      const el = document.getElementById(id);
      if (!el) continue;
      el.setAttribute('aria-label', controlLabels[id] || id);
      el.addEventListener('change', () => saveSetting(id, el.checked));
    }
    for (const id of numberIds) {
      const el = document.getElementById(id);
      if (!el) continue;
      el.addEventListener('change', () => {
        const n = Number(el.value);
        const min = Number(el.min || 0);
        const max = Number(el.max || 30000);
        const value = Math.min(max, Math.max(min, Number.isFinite(n) ? n : currentSettings[id]));
        el.value = value;
        saveSetting(id, value);
      });
    }
    const delim = document.getElementById('queueDelimiter');
    if (delim) {
      delim.addEventListener('change', () => {
        const value = delim.value.trim() || '---';
        delim.value = value;
        saveSetting('queueDelimiter', value);
      });
    }
    const theme = document.getElementById('popupTheme');
    if (theme) theme.addEventListener('change', () => saveSetting('popupTheme', theme.value, true));
    if (window.matchMedia) {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      const update = () => { if ((currentSettings.popupTheme || 'system') === 'system') applyPopupTheme(); };
      if (mq.addEventListener) mq.addEventListener('change', update);
      else if (mq.addListener) mq.addListener(update);
    }
  }

  function detectActiveProfile() {
    for (const name of Object.keys(profiles)) {
      const settings = profiles[name].settings;
      if (Object.keys(settings).every((key) => currentSettings[key] === settings[key])) return name;
    }
    return null;
  }

  function updateActiveProfile() {
    const active = detectActiveProfile();
    document.querySelectorAll('.profile').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.profile === active);
      btn.setAttribute('aria-pressed', btn.dataset.profile === active ? 'true' : 'false');
    });
    const desc = document.getElementById('profileDesc');
    if (!desc) return;
    desc.textContent = active ? profiles[active].desc : 'Custom settings (mix of toggles).';
  }

  function renderSnippets() {
    const list = document.getElementById('snippetsList');
    list.innerHTML = '';
    const categories = ['General', 'Code', 'Writing', 'Agent'];
    snippets.forEach((snippet, index) => {
      const row = document.createElement('div');
      row.className = 'snippet-item';

      const label = document.createElement('input');
      label.type = 'text'; label.className = 'lbl'; label.placeholder = 'Label'; label.value = snippet.label || '';
      label.setAttribute('aria-label', `Quick prompt ${index + 1} label`);
      const body = document.createElement('input');
      body.type = 'text'; body.className = 'bdy body'; body.placeholder = 'Prompt text…'; body.value = snippet.body || '';
      body.setAttribute('aria-label', `Quick prompt ${index + 1} text`);
      const autoLabel = document.createElement('label');
      autoLabel.className = 'as-lbl'; autoLabel.title = 'Auto-send when clicked';
      const auto = document.createElement('input');
      auto.type = 'checkbox'; auto.className = 'as'; auto.checked = !!snippet.autoSend;
      auto.setAttribute('aria-label', `Auto-send ${snippet.label || `prompt ${index + 1}`}`);
      autoLabel.append(auto, document.createTextNode(' ⏎ send'));
      const remove = document.createElement('button');
      remove.type = 'button'; remove.className = 'del'; remove.textContent = '✕';
      remove.title = 'Remove quick prompt'; remove.setAttribute('aria-label', `Remove ${snippet.label || `prompt ${index + 1}`}`);
      const meta = document.createElement('div'); meta.className = 'meta';
      const category = document.createElement('select'); category.className = 'cat'; category.setAttribute('aria-label', `Category for ${snippet.label || `prompt ${index + 1}`}`);
      [...categories, 'Other'].forEach((name) => {
        const option = document.createElement('option'); option.value = name; option.textContent = name;
        option.selected = (snippet.category || 'General') === name;
        category.appendChild(option);
      });
      const slash = document.createElement('span'); slash.textContent = '/'; slash.style.marginLeft = 'auto';
      const id = document.createElement('input'); id.type = 'text'; id.className = 'id'; id.placeholder = 'slash id'; id.value = snippet.id || '';
      id.style.width = '90px'; id.setAttribute('aria-label', `Slash command for ${snippet.label || `prompt ${index + 1}`}`);
      meta.append(category, slash, id);
      row.append(label, body, autoLabel, remove, meta);

      const update = () => {
        snippets[index].label = label.value;
        snippets[index].body = body.value;
        snippets[index].autoSend = auto.checked;
        snippets[index].category = category.value;
        const idValue = (id.value || label.value || ('p' + index)).toLowerCase().replace(/[^a-z0-9_-]/g, '-');
        snippets[index].id = idValue || ('p' + index);
        saveSnippets();
      };
      [label, body, auto, category, id].forEach((el) => el.addEventListener('change', update));
      remove.addEventListener('click', () => { snippets.splice(index, 1); renderSnippets(); saveSnippets(); });
      list.appendChild(row);
    });
  }

  function saveSnippets() {
    const cleaned = snippets.map(normalizeSnippet).filter((snippet) => snippet.label.trim() || snippet.body.trim());
    snippets = cleaned;
    chrome.storage.sync.set({ snippets: cleaned });
  }

  function renderQueue(queue) {
    if (Array.isArray(queue)) queueItems = queue.map((item) => String(item || ''));
    const list = document.getElementById('queueList');
    const count = document.getElementById('queueCount');
    if (count) count.textContent = `(${queueItems.length} pending)`;
    list.innerHTML = '';
    if (!queueItems.length) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = 'No prompts are waiting in this tab.';
      list.appendChild(empty);
      return;
    }
    queueItems.forEach((text, index) => {
      const item = document.createElement('div'); item.className = 'queue-item';
      const textarea = document.createElement('textarea'); textarea.value = text;
      textarea.setAttribute('aria-label', `Queued prompt ${index + 1}`);
      textarea.addEventListener('input', () => { queueItems[index] = textarea.value; });
      const actions = document.createElement('div'); actions.className = 'queue-item-actions';
      const up = queueButton('↑', `Move queued prompt ${index + 1} up`, () => moveQueueItem(index, -1));
      up.disabled = index === 0;
      const down = queueButton('↓', `Move queued prompt ${index + 1} down`, () => moveQueueItem(index, 1));
      down.disabled = index === queueItems.length - 1;
      const remove = queueButton('✕', `Remove queued prompt ${index + 1}`, () => {
        queueItems.splice(index, 1); renderQueue();
      });
      remove.classList.add('remove');
      actions.append(up, down, remove);
      item.append(textarea, actions);
      list.appendChild(item);
    });
  }

  function queueButton(text, label, action) {
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'queue-icon-btn'; btn.textContent = text; btn.setAttribute('aria-label', label);
    btn.addEventListener('click', action);
    return btn;
  }

  function moveQueueItem(index, direction) {
    const target = index + direction;
    if (target < 0 || target >= queueItems.length) return;
    [queueItems[index], queueItems[target]] = [queueItems[target], queueItems[index]];
    renderQueue();
  }

  function saveQueue() {
    const cleaned = queueItems.map((item) => String(item || '').trim()).filter(Boolean);
    sendToActiveTab({ type: 'helper:replace-queue', queue: cleaned }, (response, err) => {
      if (response && response.ok) {
        renderQueue(response.queue);
        showNotice('Queue saved for this tab.', false);
        refreshStatus(false);
      } else {
        showNotice((response && response.error) || (err && err.message) || 'Open an Arena conversation to edit its queue.', true);
      }
    });
  }

  function formatTime(timestamp) {
    try { return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; }
  }

  function renderActivity(entries) {
    const list = document.getElementById('historyList');
    list.innerHTML = '';
    if (!Array.isArray(entries) || !entries.length) {
      const empty = document.createElement('div'); empty.className = 'empty-state'; empty.textContent = 'No activity has been recorded yet.';
      list.appendChild(empty);
      return;
    }
    entries.forEach((entry) => {
      const item = document.createElement('div'); item.className = 'history-item';
      const action = document.createElement('div'); action.className = 'history-action'; action.textContent = entry.action || 'Activity';
      const detail = document.createElement('div'); detail.className = 'history-detail'; detail.textContent = entry.detail || '';
      const time = document.createElement('div'); time.className = 'history-time'; time.textContent = formatTime(entry.at);
      item.append(action, detail, time); list.appendChild(item);
    });
  }

  function applyStatus(status) {
    latestStatus = status;
    if (status && status.settings) {
      currentSettings = { ...currentSettings, ...status.settings };
      hydrateControls();
    }
    const title = document.getElementById('statusTitle');
    const meta = document.getElementById('statusMeta');
    if (!status) {
      title.textContent = 'No active Arena conversation';
      meta.textContent = 'Open or refresh an Arena tab, then press Refresh.';
      renderQueue([]);
      return;
    }
    if (!status.hasChatUi) {
      title.textContent = 'No active chat detected';
      meta.textContent = 'Open an Arena conversation, then refresh this panel.';
    } else {
      title.textContent = status.state || 'Idle';
      const scope = status.scoped ? 'this conversation' : 'global settings';
      meta.textContent = `${status.queueCount || 0} queued · ${scope}${status.captchaReason ? ` · ${status.captchaReason}` : ''}`;
    }
    renderQueue(status.queue || []);
    renderActivity(status.activity || []);
    if (status.safetyNotice) showNotice(status.safetyNotice, true);
  }

  function refreshStatus(showFailure) {
    sendToActiveTab({ type: 'helper:get-status' }, (response, err) => {
      if (response) applyStatus(response);
      else if (showFailure) {
        applyStatus(null);
        showNotice((err && err.message) || 'No Arena Helper content script found in this tab.', true);
      }
    });
  }

  function exportSettings() {
    const payload = {
      format: 'arena-ai-helper-settings',
      version: 1,
      exportedAt: new Date().toISOString(),
      settings: { ...currentSettings },
      snippets: snippets.map(normalizeSnippet)
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = 'arena-ai-helper-settings.json';
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showNotice('Settings export downloaded.', false);
  }

  function importSettings(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const payload = JSON.parse(String(reader.result || ''));
        if (!payload || payload.format !== 'arena-ai-helper-settings' || !payload.settings) throw new Error('Not an Arena.ai Helper settings file.');
        const valid = {};
        Object.keys(defaults).forEach((key) => {
          if (Object.prototype.hasOwnProperty.call(payload.settings, key)) valid[key] = payload.settings[key];
        });
        if (!Object.keys(valid).length) throw new Error('This settings file has no usable preferences.');
        if (Array.isArray(payload.snippets)) snippets = payload.snippets.map(normalizeSnippet);
        chrome.storage.sync.set({ ...valid, snippets });
        Object.assign(currentSettings, valid);
        renderSnippets(); hydrateControls();
        sendToActiveTab({ type: 'helper:apply-settings', values: valid }, () => refreshStatus(false));
        showNotice('Settings and quick prompts imported.', false);
      } catch (e) {
        showNotice(e.message || 'Could not import that settings file.', true);
      }
    };
    reader.readAsText(file);
  }

  function bindActions() {
    document.querySelectorAll('.profile').forEach((btn) => {
      btn.addEventListener('click', () => applySettings(profiles[btn.dataset.profile].settings));
    });
    document.getElementById('refreshStatus').addEventListener('click', () => refreshStatus(true));
    document.getElementById('reloadQueueBtn').addEventListener('click', () => refreshStatus(true));
    document.getElementById('saveQueueBtn').addEventListener('click', saveQueue);
    document.getElementById('exportBtn').addEventListener('click', () => {
      sendToActiveTab({ type: 'cmd:export-markdown' });
      window.close();
    });
    document.getElementById('clearQueueBtn').addEventListener('click', () => {
      sendToActiveTab({ type: 'cmd:clear-input' }, () => {
        renderQueue([]); showNotice('Queue cleared and input stopped.', false); refreshStatus(false);
      });
    });
    document.getElementById('addSnippet').addEventListener('click', () => {
      snippets.push({ id: `p${Date.now()}`, label: 'New prompt', body: '', category: 'General', autoSend: true });
      renderSnippets(); saveSnippets();
      const last = document.querySelector('#snippetsList .snippet-item:last-child .lbl');
      if (last) last.focus();
    });
    document.getElementById('resetSnippets').addEventListener('click', () => {
      if (!confirm('Reset quick prompts to defaults? Your custom prompts will be replaced.')) return;
      snippets = getBuiltinDefaults(); renderSnippets(); saveSnippets(); showNotice('Quick prompts reset.', false);
    });
    document.getElementById('exportSettingsBtn').addEventListener('click', exportSettings);
    document.getElementById('importSettingsBtn').addEventListener('click', () => document.getElementById('importSettingsInput').click());
    document.getElementById('importSettingsInput').addEventListener('change', (event) => importSettings(event.target.files && event.target.files[0]));
    document.getElementById('clearHistoryBtn').addEventListener('click', () => {
      sendToActiveTab({ type: 'helper:clear-activity' }, (response) => {
        if (!response) chrome.storage.local.set({ activityHistory: [] });
        renderActivity([]); showNotice('Activity history cleared.', false);
      });
    });
    document.addEventListener('keydown', (event) => {
      if (event.altKey && event.key.toLowerCase() === 'r') {
        event.preventDefault(); refreshStatus(true);
      }
      if (event.key === 'Escape' && document.activeElement && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) {
        document.activeElement.blur();
      }
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    bindSettingControls();
    bindActions();
    renderQueue([]);
    renderActivity([]);
    loadSettings();
    // Keep the compact status and queue count useful while the popup remains open.
    setInterval(() => refreshStatus(false), 1200);
  });
})();
