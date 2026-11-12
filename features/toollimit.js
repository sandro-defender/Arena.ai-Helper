/* Tool-call limit auto-continue.
 * Arena's agent sometimes stops with:
 *   "The agent reached the tool-call limit for this turn. Send a message to continue where it left off."
 * When that message appears in the chat and the assistant is idle, put "continue"
 * in the composer and submit it so the agent can keep working.
 */
(function () {
  'use strict';
  const { settings, runtime, on, emit, ui, recordActivity } = window.ArenaHelper;

  // Change this if you want a different automatic reply (for example "continiue").
  const REPLY_TEXT = 'continue';

  // Tolerate whitespace/newlines, non-breaking spaces, and the different hyphen
  // characters Arena may use when rendering "tool-call".
  const TOOL_LIMIT_RE = /the\s+agent\s+reached\s+the\s+tool[\s\u2010-\u2015-]*call\s+limit\s+for\s+this\s+turn\.?\s*send\s+a\s+message\s+to\s+continue\s+where\s+it\s+left\s+off\.?/gi;
  // Arena's other "turn paused" notice uses the same instruction: send a message
  // to continue. Handle it the same way so a long turn does not stall the queue.
  const TURN_BUDGET_RE = /this\s+turn\s+ran\s+long,?\s*so\s+the\s+agent\s+paused\.?\s*send\s+a\s+message\s+to\s+continue\.?/gi;
  const PHRASE_PROBE_RE = /the\s+agent\s+reached\s+the\s+tool[\s\u2010-\u2015-]*call\s+limit\s+for\s+this\s+turn|this\s+turn\s+ran\s+long,?\s*so\s+the\s+agent\s+paused/i;

  let primedContainer = null;
  let handledOccurrences = new WeakMap();
  let handledTotalCount = 0;
  let phraseWasPresent = false;
  let lastSentAt = 0;
  let failedSendRetries = 0;
  let sending = false;
  let checkTimer = null;
  let lastKeepWorkingButton = null;
  let lastKeepWorkingAt = 0;

  function normalizeText(value) {
    return String(value || '')
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .replace(/\u00A0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function countLimitPhrases(text) {
    const toolMatches = text.match(TOOL_LIMIT_RE);
    const turnMatches = text.match(TURN_BUDGET_RE);
    return (toolMatches ? toolMatches.length : 0) + (turnMatches ? turnMatches.length : 0);
  }

  function visibleText(el, fallback) {
    if (el && typeof el.innerText === 'string') return el.innerText;
    return String(fallback || '');
  }

  function canSendNow() {
    return !!settings.toolLimitAutoContinue
      && !runtime.isAssistantResponding
      && !runtime.captchaDetected
      && !settings.stopAfterThis
      && !runtime.suppressAutoThisTurn
      && !runtime.paused;
  }

  function scheduleCheck(delay) {
    if (checkTimer) return;
    checkTimer = setTimeout(() => {
      checkTimer = null;
      check();
    }, typeof delay === 'number' ? delay : 500);
  }

  // Find the deepest/last element that contains the whole limit phrase. The last
  // match in document order belongs to the most recent occurrence, which is what
  // we care about when older limit messages are still visible in the history.
  function findLastOccurrence(container, containerText) {
    if (!countLimitPhrases(containerText)) return null;
    const elements = container.querySelectorAll('*');
    let last = null;
    for (let i = 0; i < elements.length; i++) {
      const el = elements[i];
      const raw = el.textContent || '';
      if (raw.length < 30 || raw.length > 10000) continue;
      if (!PHRASE_PROBE_RE.test(raw)) continue;
      if (!ui.isVisible(el)) continue;
      // Use visible text so an aria-live copy or another hidden duplicate cannot
      // make one limit message look like two.
      const text = normalizeText(visibleText(el, raw));
      const count = countLimitPhrases(text);
      if (count) last = { element: el, count, text };
    }
    return last;
  }

  function markHandled(total, occurrence) {
    handledTotalCount = total;
    if (!occurrence) return;
    handledOccurrences.set(occurrence.element, occurrence.count);
  }

  // Arena shows a task-result dialog at the end of a task. It appears in two
  // variants:
  //   "Was this task successful?"  -> Yes / No / Keep working
  //   "Does this complete your task?" -> Yes / No / Making progress
  // Click the "keep going" action so the agent continues instead of stopping.
  const DIALOG_QUESTION_RE = /(was this task successful|does this complete your task|does this complete the task)/i;

  // Arena sometimes shows "Reconnect to continue this chat." with a
  // "Reconnect" button. Click it automatically so the chat resumes.
  const RECONNECT_RE = /reconnect\s+to\s+continue\s+this\s+chat/i;
  const DIALOG_ACTIONS = ['keep working', 'making progress'];

  function dialogActionLabel(control) {
    const label = normalizeText(control.innerText || control.textContent).toLowerCase();
    if (!label) return null;
    for (const action of DIALOG_ACTIONS) {
      if (label === action || label.startsWith(action + ' ')) return action;
    }
    return null;
  }

  function findTaskDialogButton() {
    for (const control of document.querySelectorAll('button, [role="button"], a')) {
      if (!ui.isVisible(control) || ui.isControlDisabled(control)) continue;
      if (!dialogActionLabel(control)) continue;

      // Only click inside the task-result dialog, never a random button elsewhere.
      let scope = control.parentElement;
      for (let i = 0; i < 12 && scope; i++) {
        const text = normalizeText(scope.innerText || scope.textContent);
        if (text.length <= 1200 && DIALOG_QUESTION_RE.test(text)) return control;
        if (scope === document.body) break;
        scope = scope.parentElement;
      }
    }
    return null;
  }

  // True while a task-result dialog is on screen, even if its action button has
  // not been rendered yet. Used to avoid sending "continue" on top of the dialog.
  function isTaskDialogOpen() {
    // Radix-style dialog variants.
    for (const root of document.querySelectorAll('[role="dialog"], dialog, [data-state="open"], [data-radix-portal]')) {
      if (!ui.isVisible(root)) continue;
      const text = normalizeText(root.innerText || root.textContent);
      if (text.length <= 2000 && DIALOG_QUESTION_RE.test(text)) return true;
    }
    // Arena also renders this prompt inline as a compact panel (no role=dialog),
    // so look for a short visible block that contains both the question and one
    // of the action labels. This cannot match a model reply that merely mentions
    // the question, because the action label must be present too.
    for (const el of document.querySelectorAll('div, section, p')) {
      if (!ui.isVisible(el)) continue;
      const text = normalizeText(el.innerText || el.textContent);
      if (!text || text.length > 300) continue;
      if (!DIALOG_QUESTION_RE.test(text)) continue;
      const lower = text.toLowerCase();
      if (DIALOG_ACTIONS.some((action) => lower.includes(action))) return true;
    }
    return false;
  }

  // Mark the currently visible limit message as handled. Clicking "Keep working"
  // continues the agent, so the old limit notice must not also trigger "continue".
  function markCurrentLimitHandled() {
    const container = ui.findChatContainer() || document.body;
    if (!container) return;
    const text = normalizeText(visibleText(container, container.textContent || ''));
    const total = countLimitPhrases(text);
    if (!total) return;
    handledTotalCount = total;
    phraseWasPresent = true;
    const occurrence = findLastOccurrence(container, text);
    if (occurrence) handledOccurrences.set(occurrence.element, occurrence.count);
  }

  function clickKeepWorking(button) {
    if (!settings.toolLimitAutoContinue) return false;
    if (runtime.captchaDetected || settings.stopAfterThis || runtime.suppressAutoThisTurn || runtime.paused) return false;

    if (!button) {
      lastKeepWorkingButton = null;
      return false;
    }

    // Do not hammer the same button if the dialog takes a moment to close.
    if (button === lastKeepWorkingButton && Date.now() - lastKeepWorkingAt < 3000) return false;

    lastKeepWorkingButton = button;
    lastKeepWorkingAt = Date.now();
    try { button.click(); } catch (e) { return false; }
    markCurrentLimitHandled();
    runtime.sendCooldownUntil = Date.now() + 1500;
    emit('tool-limit:keep-working', {});
    recordActivity('Tool-limit auto-continue', 'Clicked the continue action in the task-result popup.');
    return true;
  }

  // Arena sometimes shows "Reconnect to continue this chat." with a
  // "Reconnect" button. Click it automatically so the chat resumes.
  let lastReconnectAt = 0;
  function clickReconnect() {
    if (!settings.toolLimitAutoContinue) return false;
    if (runtime.captchaDetected || settings.stopAfterThis || runtime.suppressAutoThisTurn || runtime.paused) return false;
    if (Date.now() - lastReconnectAt < 5000) return false;

    const controls = document.querySelectorAll('button, [role="button"], a');
    for (const control of controls) {
      if (!ui.isVisible(control) || ui.isControlDisabled(control)) continue;
      const label = normalizeText(control.innerText || control.textContent).toLowerCase();
      if (label !== 'reconnect' && !label.startsWith('reconnect')) continue;

      // Only click inside a "Reconnect to continue this chat" context.
      let scope = control.parentElement;
      for (let i = 0; i < 12 && scope; i++) {
        const text = normalizeText(scope.innerText || scope.textContent);
        if (text.length <= 500 && RECONNECT_RE.test(text)) {
          lastReconnectAt = Date.now();
          try { control.click(); } catch (e) { return false; }
          emit('tool-limit:reconnect', {});
          recordActivity('Tool-limit auto-continue', 'Clicked "Reconnect" to resume the chat.');
          return true;
        }
        if (scope === document.body) break;
        scope = scope.parentElement;
      }
    }
    return false;
  }

  function primeContainer(container, raw) {
    primedContainer = container;
    handledOccurrences = new WeakMap();
    handledTotalCount = 0;
    phraseWasPresent = PHRASE_PROBE_RE.test(raw);
    if (!phraseWasPresent) return;

    const text = normalizeText(visibleText(container, raw));
    const total = countLimitPhrases(text);
    phraseWasPresent = total > 0;
    if (!total) return;

    // Treat messages already on screen when the extension loads as old history.
    markHandled(total, findLastOccurrence(container, text));
  }

  function clearReplyDraft() {
    const composer = ui.findChatInput();
    if (!composer) return;
    if (ui.getInputText(composer).trim() !== REPLY_TEXT) return;
    try { ui.setInputText(composer, ''); } catch (e) { /* ignore */ }
  }

  // Prefer a native-looking insertion so Tiptap/ProseMirror updates its internal
  // state and enables the send button. Fall back to the helper's setter.
  function insertReply(composer) {
    if (!composer) return false;
    try {
      composer.focus();
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(composer);
      selection.removeAllRanges();
      selection.addRange(range);
      if (document.execCommand('insertText', false, REPLY_TEXT)) return true;
    } catch (e) { /* fall through */ }
    try { ui.setInputText(composer, REPLY_TEXT); } catch (e) { /* ignore */ }
    return ui.getInputText(composer).trim() === REPLY_TEXT;
  }

  function sendContinue(total, occurrence) {
    const input = ui.findChatInput();
    if (!input) return;

    sending = true;

    if (!insertReply(input)) {
      sending = false;
      return;
    }

    const trySubmit = (attempt) => {
      if (!settings.toolLimitAutoContinue) {
        sending = false;
        return;
      }
      if (!canSendNow()) {
        // Captcha or another response started before we could send. Remove only
        // our own untouched reply so a later check can retry cleanly.
        clearReplyDraft();
        sending = false;
        return;
      }

      const composer = ui.findChatInput();
      if (!composer) {
        sending = false;
        return;
      }

      const text = ui.getInputText(composer).trim();
      if (!text) {
        // Some editors ignore the first programmatic insert while they re-render.
        if (attempt < 5) {
          insertReply(composer);
          setTimeout(() => trySubmit(attempt + 1), 2000);
        } else {
          sending = false;
        }
        return;
      }

      // The user started typing over our draft. Never clobber their text.
      if (text !== REPLY_TEXT) {
        sending = false;
        return;
      }

      // Wait for the send button to become enabled before submitting.
      const sendBtn = ui.findArenaSendButton(document);
      if (sendBtn && ui.isControlDisabled(sendBtn)) {
        if (attempt < 5) {
          setTimeout(() => trySubmit(attempt + 1), 2000);
        } else {
          sending = false;
        }
        return;
      }

      let sent = false;
      // Primary: simulate pressing Enter (most reliable for Tiptap/ProseMirror).
      try {
        composer.focus();
        const opts = { key: 'Enter', code: 'Enter', which: 13, keyCode: 13, bubbles: true, cancelable: true };
        composer.dispatchEvent(new KeyboardEvent('keydown', opts));
        composer.dispatchEvent(new KeyboardEvent('keypress', opts));
        composer.dispatchEvent(new KeyboardEvent('keyup', opts));
        sent = true;
      } catch (e) { sent = false; }

      if (!sent) {
        // Fallback: try the send button.
        try { sent = ui.submitInput(composer); } catch (e) { sent = false; }
      }
      if (!sent) {
        // Last resort: click the send button directly.
        try {
          const btn = ui.findArenaSendButton(document);
          if (btn) { btn.click(); sent = true; }
        } catch (e) { sent = false; }
      }
      if (!sent) {
        // Fallback: dispatch Enter key event.
        try {
          const opts = { key: 'Enter', code: 'Enter', which: 13, keyCode: 13, bubbles: true, cancelable: true };
          composer.dispatchEvent(new KeyboardEvent('keydown', opts));
          composer.dispatchEvent(new KeyboardEvent('keypress', opts));
          composer.dispatchEvent(new KeyboardEvent('keyup', opts));
          sent = true;
        } catch (e) { sent = false; }
      }
      if (!sent) {
        if (attempt < 5) {
          setTimeout(() => trySubmit(attempt + 1), 2000);
        } else {
          sending = false;
        }
        return;
      }

      markHandled(total, occurrence);
      lastSentAt = Date.now();
      runtime.sendCooldownUntil = Date.now() + 2000;
      emit('tool-limit:continued', { text: REPLY_TEXT, count: total });
      recordActivity('Tool-limit auto-continue', `Detected the tool-call limit message and sent "${REPLY_TEXT}".`);

      // If Arena did not actually accept the submit (the composer still contains
      // our text), forget the handled marker so the next check can retry.
      setTimeout(() => {
        const still = ui.findChatInput();
        if (still && ui.getInputText(still).trim() === REPLY_TEXT) {
          failedSendRetries += 1;
          if (failedSendRetries <= 3) {
            handledTotalCount = 0;
            handledOccurrences = new WeakMap();
            scheduleCheck(2000);
          } else {
            // Stop retrying this occurrence; the user can send manually.
            markHandled(total, occurrence);
          }
        } else {
          failedSendRetries = 0;
        }
        sending = false;
      }, 2000);
    };

    setTimeout(() => trySubmit(0), 2000);
  }

  function check() {
    if (!settings.toolLimitAutoContinue) return;

    // This dialog is separate from the limit text and may appear at the end of a
    // task. Click it whenever it is visible and we are otherwise allowed to act.
    const dialogButton = findTaskDialogButton();
    if (dialogButton) {
      clickKeepWorking(dialogButton);
      // The dialog is still on screen; never also send "continue" underneath it.
      return;
    }
    if (isTaskDialogOpen()) return;

    // Reconnect prompt: click "Reconnect" if present.
    if (clickReconnect()) return;

    if (sending) return;

    const container = ui.findChatContainer() || document.body;
    if (!container) return;

    const raw = container.textContent || '';

    if (container !== primedContainer) {
      primeContainer(container, raw);
      return;
    }

    // While the agent is streaming, only track whether the message is still on
    // screen. This keeps a transient limit notice from being treated as handled
    // after it disappears and later reappears.
    if (runtime.isAssistantResponding) {
      phraseWasPresent = PHRASE_PROBE_RE.test(raw);
      return;
    }

    if (!canSendNow()) return;

    const cheapPresent = PHRASE_PROBE_RE.test(raw);
    const text = cheapPresent ? normalizeText(visibleText(container, raw)) : '';
    const total = countLimitPhrases(text);
    const present = total > 0;
    const newAppearance = present && !phraseWasPresent;
    phraseWasPresent = present;

    if (!present) return;
    if (Date.now() - lastSentAt < 4000) return;

    const occurrence = findLastOccurrence(container, text);
    if (!occurrence) return;

    const handledInElement = handledOccurrences.get(occurrence.element) || 0;
    const isKnownElement = handledOccurrences.has(occurrence.element);
    const shouldContinue = newAppearance
      || total > handledTotalCount
      || (isKnownElement && occurrence.count > handledInElement);
    if (!shouldContinue) return;

    emit('tool-limit:detected', { count: total, text: occurrence.text.slice(0, 80) });
    if (window.ArenaHelper.features && window.ArenaHelper.features.debugoverlay) {
      window.ArenaHelper.features.debugoverlay.addLog('info', 'Limit detected, sending "' + REPLY_TEXT + '" (attempt ' + (failedSendRetries + 1) + ')');
    }

    const input = ui.findChatInput();
    if (!input) return;
    if (ui.getInputText(input).trim()) return; // user is composing; leave it alone

    sendContinue(total, occurrence);
  }

  function attach() {
    on('response:done', () => scheduleCheck(600));

    const observer = new MutationObserver(() => {
      if (!runtime.isAssistantResponding) scheduleCheck(500);
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });

    // Lightweight fallback for transitions the observer might miss.
    setInterval(() => {
      if (!runtime.isAssistantResponding) check();
    }, 2000);

    // Prime the current chat after the page settles.
    setTimeout(check, 1200);
  }

  window.ArenaHelper.features = window.ArenaHelper.features || {};
  window.ArenaHelper.features.toollimit = { attach, check };
})();
