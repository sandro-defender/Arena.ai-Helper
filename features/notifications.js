/* Done notification + optional chime. Fires when the assistant finishes responding
 * AND the input box is empty AND the queue is empty (i.e. chain finished).
 */
(function () {
  'use strict';
  const { settings, runtime, on, ui } = window.ArenaHelper;

  let lastNotifiedAt = 0;

  function onResponseDone() {
    if (!runtime.hasChatUi) return;
    // Only notify if no more work is queued
    const hasQueued = runtime.queuedPrompts && runtime.queuedPrompts.length > 0;
    const input = ui.findChatInput();
    const hasInputText = input ? ui.getInputText(input).trim().length > 0 : false;
    const stopping = settings.stopAfterThis === true || runtime.suppressAutoThisTurn === true;
    // Notify only when the chain has fully stopped (no queued, no text in box, or stop-after-this is set).
    const chainDone = !hasQueued && !hasInputText;
    if (!chainDone && !stopping) return;

    const now = Date.now();
    if (now - lastNotifiedAt < 3000) return; // debounce
    lastNotifiedAt = now;

    if (settings.doneSound) {
      ui.playChime();
    }
    if (settings.doneNotification) {
      try {
        chrome.runtime.sendMessage({ type: 'notify', title: 'Arena.ai Helper', message: stopping ? 'Stopped after this response.' : 'Response finished.' });
      } catch (e) { /* ignore */ }
    }
  }

  function attach() {
    on('response:done', onResponseDone);
    on('queue:empty', () => {
      // If also idle when queue empties, we're done. (response:done handles it normally; this is a safety net.)
      if (!runtime.isAssistantResponding) onResponseDone();
    });
  }

  window.ArenaHelper.features = window.ArenaHelper.features || {};
  window.ArenaHelper.features.notifications = { attach };
})();
