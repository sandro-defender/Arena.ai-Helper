/* Shared state + settings loaded from chrome.storage.
 * All feature files read from / write to window.ArenaHelper.
 */
(function () {
  'use strict';

  const defaults = Object.freeze({
    autoScroll: true,
    autoSend: true,
    scrollPauseOnManualScroll: true,
    autoSendDelayMs: 600,

    // Queue and response safety
    multiQueueEnabled: true,
    queueDelimiter: '---',
    maxQueueLength: 10,
    autoContinue: true,
    autoContinueMaxClicks: 3,
    toolLimitAutoContinue: true,

    // Feedback and interface
    doneNotification: true,
    doneSound: true,
    autoFocus: true,
    stopAfterThis: false,
    showTimestamps: false,
    showCopyCode: true,
    closeProtect: true,
    showFloatingStatus: true,
    showDebugOverlay: true,

    // Preferences
    perConversationSettings: false,
    popupTheme: 'system'
  });

  const globalOnlyKeys = new Set(['perConversationSettings', 'popupTheme', 'stopAfterThis']);
  const settings = { ...defaults };

  // Runtime state (not persisted with sync settings)
  const runtime = {
    userScrolledUp: false,
    isAssistantResponding: false,
    assistantJustFinished: false,
    sendCooldownUntil: 0,
    lastSendHandledForText: '',
    autoSendArmed: false,
    suppressAutoThisTurn: false,
    paused: false,
    queuedPrompts: [],
    autoContinueClicksThisResponse: 0,
    lastMessageCountAtContinue: 0,
    conversationStartTs: Date.now(),
    conversationKey: getConversationKey(),
    seenMessageIds: new WeakSet(),
    inIframe: window.top !== window.self,
    hasChatUi: false,
    activityHistory: [],
    safetyNotice: ''
  };

  const listeners = [];
  const eventListeners = new Map();

  function getConversationKey() {
    // Arena conversation IDs live in the path. Keeping the origin prevents a preview
    // and the main Arena site from sharing settings accidentally.
    return `${location.origin}${location.pathname}`;
  }

  function onSettingsChange(fn) { listeners.push(fn); }

  function notifySettings(key, value) {
    for (const fn of listeners) {
      try { fn(key, value); } catch (e) { console.error('[Arena.ai Helper] settings listener error', e); }
    }
  }

  function isScopedKey(key) {
    return key in defaults && !globalOnlyKeys.has(key);
  }

  function sanitizeSetting(key, value) {
    if (key === 'autoSendDelayMs') return Math.min(30000, Math.max(0, Number(value) || 0));
    if (key === 'maxQueueLength') return Math.min(50, Math.max(1, Math.round(Number(value) || defaults.maxQueueLength)));
    if (key === 'autoContinueMaxClicks') return Math.min(20, Math.max(0, Math.round(Number(value) || 0)));
    if (key === 'popupTheme') return ['system', 'light', 'dark'].includes(value) ? value : 'system';
    if (typeof defaults[key] === 'boolean') return !!value;
    return value;
  }

  function getScopedValues(values) {
    const out = {};
    for (const [key, value] of Object.entries(values || {})) {
      if (isScopedKey(key)) out[key] = sanitizeSetting(key, value);
    }
    return out;
  }

  function saveConversationValues(values) {
    const scoped = getScopedValues(values);
    if (!Object.keys(scoped).length) return;
    try {
      chrome.storage.local.get({ conversationSettings: {} }, (res) => {
        const all = res.conversationSettings && typeof res.conversationSettings === 'object'
          ? res.conversationSettings : {};
        const key = getConversationKey();
        all[key] = { ...(all[key] || {}), ...scoped };
        chrome.storage.local.set({ conversationSettings: all });
      });
    } catch (e) { /* ignore storage failures */ }
  }

  function loadConversationValues(done) {
    try {
      chrome.storage.local.get({ conversationSettings: {}, activityHistory: [] }, (res) => {
        runtime.activityHistory = Array.isArray(res.activityHistory) ? res.activityHistory.slice(0, 50) : [];
        const all = res.conversationSettings && typeof res.conversationSettings === 'object'
          ? res.conversationSettings : {};
        const values = all[getConversationKey()] || {};
        for (const [key, value] of Object.entries(values)) {
          if (isScopedKey(key)) settings[key] = sanitizeSetting(key, value);
        }
        if (done) done();
      });
    } catch (e) {
      if (done) done();
    }
  }

  function loadGlobalValues(done) {
    try {
      chrome.storage.sync.get(defaults, (items) => {
        for (const key of Object.keys(defaults)) settings[key] = sanitizeSetting(key, items[key]);
        if (done) done();
      });
    } catch (e) {
      if (done) done();
    }
  }

  function loadSettings() {
    loadGlobalValues(() => {
      const complete = () => notifySettings('__all__', settings);
      if (settings.perConversationSettings) loadConversationValues(complete);
      else {
        try {
          chrome.storage.local.get({ activityHistory: [] }, (res) => {
            runtime.activityHistory = Array.isArray(res.activityHistory) ? res.activityHistory.slice(0, 50) : [];
            complete();
          });
        } catch (e) { complete(); }
      }
    });
  }

  function setSetting(key, value) {
    if (!(key in defaults)) return;
    const normalized = sanitizeSetting(key, value);
    settings[key] = normalized;

    if (key === 'perConversationSettings') {
      try { chrome.storage.sync.set({ [key]: normalized }); } catch (e) {}
      if (normalized) {
        loadConversationValues(() => notifySettings('__all__', settings));
      } else {
        loadGlobalValues(() => notifySettings('__all__', settings));
      }
      notifySettings(key, normalized);
      return;
    }

    if (settings.perConversationSettings && isScopedKey(key)) saveConversationValues({ [key]: normalized });
    else {
      try { chrome.storage.sync.set({ [key]: normalized }); } catch (e) {}
    }
    notifySettings(key, normalized);
  }

  function applySettings(values) {
    if (!values || typeof values !== 'object') return;
    const clean = {};
    for (const [key, value] of Object.entries(values)) {
      if (key in defaults) clean[key] = sanitizeSetting(key, value);
    }
    if (!Object.keys(clean).length) return;

    const requestedScope = Object.prototype.hasOwnProperty.call(clean, 'perConversationSettings')
      ? clean.perConversationSettings : settings.perConversationSettings;
    Object.assign(settings, clean);

    const globalValues = {};
    const scopedValues = {};
    for (const [key, value] of Object.entries(clean)) {
      if (key === 'perConversationSettings' || !requestedScope || !isScopedKey(key)) globalValues[key] = value;
      else scopedValues[key] = value;
    }
    try { if (Object.keys(globalValues).length) chrome.storage.sync.set(globalValues); } catch (e) {}
    if (requestedScope) saveConversationValues(scopedValues);

    if (Object.prototype.hasOwnProperty.call(clean, 'perConversationSettings')) {
      if (requestedScope) loadConversationValues(() => notifySettings('__all__', settings));
      else loadGlobalValues(() => notifySettings('__all__', settings));
    }
    notifySettings('__all__', settings);
  }

  // In-memory only override set by features (e.g. captcha pauses).
  function overrideSettingTemp(key, value) {
    if (!(key in defaults)) return;
    settings[key] = sanitizeSetting(key, value);
    notifySettings(key, settings[key]);
  }

  function on(event, fn) {
    if (!eventListeners.has(event)) eventListeners.set(event, new Set());
    eventListeners.get(event).add(fn);
  }

  function off(event, fn) {
    const set = eventListeners.get(event);
    if (set) set.delete(fn);
  }

  function emit(event, payload) {
    const set = eventListeners.get(event);
    if (!set) return;
    for (const fn of Array.from(set)) {
      try { fn(payload); } catch (e) { console.error('[Arena.ai Helper] event handler error', event, e); }
    }
  }

  function recordActivity(action, detail) {
    const entry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      at: Date.now(),
      action: String(action || 'Activity').slice(0, 80),
      detail: String(detail || '').replace(/\s+/g, ' ').trim().slice(0, 180)
    };
    runtime.activityHistory.unshift(entry);
    runtime.activityHistory = runtime.activityHistory.slice(0, 50);
    try { chrome.storage.local.set({ activityHistory: runtime.activityHistory }); } catch (e) {}
    emit('activity:updated', { entries: runtime.activityHistory });
  }

  function clearActivity() {
    runtime.activityHistory = [];
    try { chrome.storage.local.set({ activityHistory: [] }); } catch (e) {}
    emit('activity:updated', { entries: [] });
  }

  function statusSnapshot() {
    let state = 'Idle';
    if (runtime.captchaDetected) state = 'Paused for captcha';
    else if (runtime.isAssistantResponding) state = 'Generating';
    else if (settings.stopAfterThis) state = 'Stopping after this response';
    else if (runtime.queuedPrompts.length) state = `Queue ready (${runtime.queuedPrompts.length})`;
    return {
      state,
      hasChatUi: runtime.hasChatUi,
      responding: runtime.isAssistantResponding,
      captchaDetected: !!runtime.captchaDetected,
      captchaReason: runtime.captchaReason || '',
      queue: runtime.queuedPrompts.slice(),
      queueCount: runtime.queuedPrompts.length,
      safetyNotice: runtime.safetyNotice || '',
      conversationKey: getConversationKey(),
      scoped: !!settings.perConversationSettings,
      settings: { ...settings },
      activity: runtime.activityHistory.slice(0, 12)
    };
  }

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'sync') {
        for (const key in changes) {
          if (!(key in defaults)) continue;
          if (settings.perConversationSettings && isScopedKey(key)) continue;
          settings[key] = sanitizeSetting(key, changes[key].newValue);
          notifySettings(key, settings[key]);
        }
      } else if (area === 'local') {
        if (changes.activityHistory) {
          runtime.activityHistory = Array.isArray(changes.activityHistory.newValue)
            ? changes.activityHistory.newValue.slice(0, 50) : [];
          emit('activity:updated', { entries: runtime.activityHistory });
        }
        if (changes.conversationSettings && settings.perConversationSettings) {
          loadConversationValues(() => notifySettings('__all__', settings));
        }
      }
    });

    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (!msg || !msg.type) return;
      if (msg.type === 'helper:get-status') {
        sendResponse(statusSnapshot());
      } else if (msg.type === 'helper:set-setting' && msg.key in defaults) {
        setSetting(msg.key, msg.value);
        sendResponse({ ok: true, settings: { ...settings } });
      } else if (msg.type === 'helper:apply-settings') {
        applySettings(msg.values);
        sendResponse({ ok: true, settings: { ...settings } });
      } else if (msg.type === 'helper:clear-activity') {
        clearActivity();
        sendResponse({ ok: true });
      }
    });
  } catch (e) { /* ignore non-extension contexts */ }

  loadSettings();

  window.ArenaHelper = {
    defaults,
    settings,
    runtime,
    setSetting,
    applySettings,
    overrideSettingTemp,
    onSettingsChange,
    on, off, emit,
    recordActivity,
    clearActivity,
    statusSnapshot
  };
})();
