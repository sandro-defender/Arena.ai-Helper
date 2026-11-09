/* Multi-prompt queue.
 * If the input contains the configured delimiter (default `---`) on a line by itself,
 * everything before the first delimiter is the next prompt; anything after is split
 * on the delimiter into a queue. When a response finishes and the input is empty,
 * the next queued item is placed into the input (which triggers auto-send).
 * Also exposes Alt+Shift+X "stop after this response" behaviour.
 */
(function () {
  'use strict';
  const { settings, runtime, setSetting, on, emit, ui } = window.ArenaHelper;

  function splitIntoPromptAndQueue(text) {
    const delim = (settings.queueDelimiter || '---').trim();
    if (!delim) return { next: text.trim(), rest: [] };
    const lines = text.split(/\r?\n/);
    // Find first index where a trimmed line exactly matches the delimiter
    const idx = lines.findIndex((l) => l.trim() === delim);
    if (idx === -1) {
      return { next: text.trim(), rest: [] };
    }
    const next = lines.slice(0, idx).join('\n').trim();
    const remaining = lines.slice(idx + 1).join('\n');
    // Split remainder by same delimiter
    const rest = remaining
      .split(new RegExp('\\s*\\n?\\s*' + escapeRegex(delim) + '\\s*\\n?\\s*'))
      .map((s) => s.trim())
      .filter(Boolean);
    return { next, rest };
  }

  function escapeRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // Before send, parse the input. If there is more after the delimiter, stash it
  // so we can refill the input after the response comes back.
  function onBeforeSend(ev) {
    if (!settings.multiQueueEnabled) return;
    const input = ev.input || ui.findChatInput();
    if (!input) return;
    const text = ui.getInputText(input);
    const { next, rest } = splitIntoPromptAndQueue(text);
    const maxQueueLength = Math.max(1, Number(settings.maxQueueLength) || 10);
    if (rest.length + runtime.queuedPrompts.length > maxQueueLength) {
      // Keep the original composer text untouched. This deliberately requires an
      // explicit edit rather than silently dropping prompts beyond the guardrail.
      ev.cancel = true;
      runtime.safetyNotice = `Queue limit reached: keep at most ${maxQueueLength} pending prompts.`;
      emit('safety:limit', { message: runtime.safetyNotice });
      emit('queue:updated', { count: runtime.queuedPrompts.length, blocked: true });
      return;
    }
    runtime.safetyNotice = '';
    if (rest.length > 0) {
      ui.setInputText(input, next);
      runtime.queuedPrompts = [...runtime.queuedPrompts, ...rest];
      emit('queue:updated', { count: runtime.queuedPrompts.length });
    } else if (next && next !== text) {
      ui.setInputText(input, next);
    }
  }

  function onResponseDone() {
    // "Stop after this" must work even when the multi-prompt queue is disabled.
    if (settings.stopAfterThis) {
      // Consume the one-shot setting immediately, but keep a runtime marker so
      // every post-response automation (send, continue, tool-limit) is suppressed
      // for this turn. The marker clears when the next response starts.
      runtime.suppressAutoThisTurn = true;
      setSetting('stopAfterThis', false);
      runtime.queuedPrompts = [];
      emit('queue:updated', { count: 0 });
      return;
    }
    if (!settings.multiQueueEnabled) return;
    // If input is empty (because the previous prompt was sent) and queue has items, push next one.
    const input = ui.findChatInput();
    if (!input) return;
    const current = ui.getInputText(input).trim();
    if (current) return; // user typed something themselves; don't overwrite
    if (runtime.queuedPrompts.length === 0) {
      emit('queue:empty');
      return;
    }
    const next = runtime.queuedPrompts.shift();
    ui.setInputText(input, next);
    emit('queue:updated', { count: runtime.queuedPrompts.length });
    // send.features.send will pick it up via tryAutoSend
    const { features } = window.ArenaHelper;
    if (features && features.send) {
      setTimeout(() => features.send.tryAutoSend({ force: true }), 150);
    }
  }

  function clearQueue() {
    runtime.queuedPrompts = [];
    runtime.safetyNotice = '';
    setSetting('stopAfterThis', false);
    emit('queue:updated', { count: 0 });
  }

  function replaceQueue(items) {
    const cleaned = Array.isArray(items)
      ? items.map((item) => String(item || '').trim()).filter(Boolean)
      : [];
    const maxQueueLength = Math.max(1, Number(settings.maxQueueLength) || 10);
    if (cleaned.length > maxQueueLength) {
      runtime.safetyNotice = `Queue limit reached: keep at most ${maxQueueLength} pending prompts.`;
      emit('safety:limit', { message: runtime.safetyNotice });
      return { ok: false, error: runtime.safetyNotice, queue: runtime.queuedPrompts.slice() };
    }
    runtime.queuedPrompts = cleaned;
    runtime.safetyNotice = '';
    emit('queue:updated', { count: cleaned.length, edited: true });
    return { ok: true, queue: cleaned.slice() };
  }

  function stopAfterThis() {
    setSetting('stopAfterThis', true);
    // Also remove pending queued items after the in-flight one
    runtime.queuedPrompts = [];
    emit('queue:updated', { count: 0, stopping: true });
  }

  function attach() {
    on('prompt:prepare', onBeforeSend);
    on('response:done', onResponseDone);
    on('response:started', () => {
      // A new turn (usually the user's own prompt) re-enables automation.
      runtime.suppressAutoThisTurn = false;
    });

    // Listen for messages from background (shortcut commands)
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (!msg || !msg.type) return;
      if (msg.type === 'cmd:clear-input') {
        const inp = ui.findChatInput();
        if (inp) ui.setInputText(inp, '');
        clearQueue();
      } else if (msg.type === 'cmd:stop-after-this') {
        stopAfterThis();
      } else if (msg.type === 'cmd:toggle-auto-send') {
        setSetting('autoSend', !settings.autoSend);
      } else if (msg.type === 'cmd:toggle-auto-scroll') {
        setSetting('autoScroll', !settings.autoScroll);
      } else if (msg.type === 'cmd:export-markdown') {
        const { features } = window.ArenaHelper;
        if (features && features.exportMd) features.exportMd.exportConversation();
      } else if (msg.type === 'cmd:captcha-resume') {
        const { features } = window.ArenaHelper;
        if (features && features.captcha) {
          // Captcha handling is intentionally local to the content page.
          window.dispatchEvent(new CustomEvent('arena-helper:captcha-resume'));
        }
      } else if (msg.type === 'helper:get-queue') {
        sendResponse({ queue: runtime.queuedPrompts.slice(), maxQueueLength: Number(settings.maxQueueLength) || 10 });
      } else if (msg.type === 'helper:replace-queue') {
        sendResponse(replaceQueue(msg.queue));
      }
    });
    window.addEventListener('arena-helper:captcha-resume', () => {
      // Captcha feature listens for this to force exit safe mode.
    });
  }

  window.ArenaHelper.features = window.ArenaHelper.features || {};
  window.ArenaHelper.features.queue = { attach, clearQueue, replaceQueue, stopAfterThis };
})();
