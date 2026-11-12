/* Core auto-send feature.
 * When the assistant finishes and the Arena composer already has text, submit it.
 * Arena's current composer is a Tiptap/ProseMirror contenteditable div, so this
 * watches both native input events and editor DOM changes.
 *
 * Auto-send must only submit text that was written *while the model was busy*
 * (or inserted programmatically by the queue / quick prompts). Typing at idle
 * must never be submitted out from under the user. The `autoSendArmed` flag is
 * set when a response finishes and cleared by any trusted idle typing.
 */
(function () {
  'use strict';
  const { settings, runtime, on, emit, ui } = window.ArenaHelper;
  let watchedComposer = null;
  let composerObserver = null;

  function canSendNow() {
    if (!settings.autoSend) return false;
    if (runtime.isAssistantResponding) return false;
    if (runtime.captchaDetected) return false;
    if (runtime.paused) return false;
    if (Date.now() < runtime.sendCooldownUntil) return false;
    if (settings.stopAfterThis) return false;
    if (runtime.suppressAutoThisTurn) return false;
    return true;
  }

  // Fire an event that lets queue.js (or other features) trim the input before send.
  function prepareForSend(input) {
    const evt = { input, text: ui.getInputText(input), cancel: false };
    emit('prompt:prepare', evt);
    return evt;
  }

  function retrySubmit(text, attemptsLeft) {
    if (attemptsLeft <= 0) return;
    if (!canSendNow()) return;
    const composer = ui.findChatInput();
    if (!composer) return;
    // Still holding exactly our text means Arena ignored the click (the editor
    // re-rendered, or the button was not ready yet). Try once more.
    if (ui.getInputText(composer).trim() !== text) return;
    const prep = prepareForSend(composer);
    if (prep.cancel) return;
    const finalText = ui.getInputText(composer).trim();
    if (!finalText) return;
    if (ui.submitInput(composer)) {
      emit('prompt:sent', { text: finalText, retry: true });
      setTimeout(() => retrySubmit(finalText, attemptsLeft - 1), 1200);
    }
  }

  // `force` is used by features that deliberately insert a prompt (queue,
  // quick prompts). Normal auto-send additionally requires autoSendArmed.
  function tryAutoSend(options) {
    const force = !!(options && (options.force === true || options === true));
    if (!force && !runtime.autoSendArmed) return false;
    if (!canSendNow()) return false;
    const input = ui.findChatInput();
    if (!input) return false;
    let text = ui.getInputText(input).trim();
    if (!text) {
      runtime.lastSendHandledForText = '';
      return false;
    }
    if (text === runtime.lastSendHandledForText) return false;

    // Let queue.js split off queued items before we check the text.
    const prep = prepareForSend(input);
    if (prep.cancel) return false;
    text = ui.getInputText(input).trim();
    if (!text) return false;

    runtime.lastSendHandledForText = text;
    const delay = Math.max(0, Number(settings.autoSendDelayMs) || 0);
    runtime.sendCooldownUntil = Date.now() + delay + 1500;

    setTimeout(() => {
      if (!canSendNow()) {
        runtime.lastSendHandledForText = '';
        runtime.sendCooldownUntil = Date.now();
        return;
      }
      const composer = ui.findChatInput();
      if (!composer) return;
      const pendingText = ui.getInputText(composer).trim();
      if (!pendingText) return;
      // Final prepare handles a prompt that was turned into a queue while waiting.
      const prep2 = prepareForSend(composer);
      if (prep2.cancel) return;
      const finalText = ui.getInputText(composer).trim();
      if (!finalText) return;
      const sent = ui.submitInput(composer);
      if (sent) {
        emit('prompt:sent', { text: finalText });
        runtime.autoSendArmed = false;
        runtime.lastSendHandledForText = '';
        // Arena occasionally ignores the first programmatic click; retry if the
        // composer still contains exactly the text we just tried to send.
        setTimeout(() => retrySubmit(finalText, 2), 2000);
      } else {
        runtime.lastSendHandledForText = '';
        runtime.sendCooldownUntil = Date.now();
        // Try again shortly in case the editor was mid-render.
        setTimeout(() => retrySubmit(finalText, 2), 800);
      }
    }, delay);
    return true;
  }

  function scheduleAutoSend() {
    if (!runtime.autoSendArmed) return;
    const composer = ui.findChatInput();
    if (!composer || !ui.getInputText(composer).trim()) return;
    clearTimeout(scheduleAutoSend.timer);
    scheduleAutoSend.timer = setTimeout(() => tryAutoSend(), 900);
  }

  function watchComposer() {
    const composer = ui.findChatInput();
    if (composer === watchedComposer) return;
    if (composerObserver) composerObserver.disconnect();
    watchedComposer = composer;
    composerObserver = null;
    if (!composer || !window.MutationObserver) return;
    composerObserver = new MutationObserver(() => {
      // ProseMirror changes can bypass the document-level input listener.
      if (!runtime.isAssistantResponding) scheduleAutoSend();
    });
    composerObserver.observe(composer, { childList: true, subtree: true, characterData: true });
  }

  // When a user types, debounce and try sending if idle. The same handler catches
  // input events dispatched by ui.setInputText for queue and quick-prompt inserts.
  function onInputActivity(ev) {
    const { features } = window.ArenaHelper;
    if (features && features.scroll) features.scroll.schedule();
    watchComposer();

    if (runtime.isAssistantResponding) {
      // Text typed while the model is streaming is the next prompt; it will be
      // sent by the response:done handler.
      return;
    }
    if (ev && ev.isTrusted) {
      // The user is composing at idle. Never auto-submit their in-progress text.
      runtime.autoSendArmed = false;
      return;
    }
    scheduleAutoSend();
  }

  function checkExistingPrompt() {
    watchComposer();
    // Check the actual current composer, including a prompt typed while the model
    // was responding. This is intentionally periodic so an existing Tiptap value
    // cannot be missed if Arena did not emit an input event to the document.
    if (!runtime.isAssistantResponding) tryAutoSend();
  }

  function attach() {
    document.addEventListener('input', onInputActivity, true);
    watchComposer();
    setInterval(checkExistingPrompt, 1000);
    on('response:started', () => {
      runtime.autoSendArmed = false;
      watchComposer();
    });
    on('response:done', () => {
      // Honor "stop after this" at the moment the response ends. queue.js clears
      // the flag shortly after so the next turn behaves normally.
      if (settings.stopAfterThis) {
        runtime.autoSendArmed = false;
        return;
      }
      runtime.autoSendArmed = true;
      watchComposer();
      setTimeout(() => tryAutoSend(), 250);
    });
  }

  window.ArenaHelper.features = window.ArenaHelper.features || {};
  window.ArenaHelper.features.send = { tryAutoSend, attach, canSendNow, checkExistingPrompt };
})();
