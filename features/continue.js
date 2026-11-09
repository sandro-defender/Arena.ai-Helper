/* Auto-continue: click "continue generating" / "read more" buttons automatically
 * until a response completes naturally (up to a safety cap per response).
 */
(function () {
  'use strict';
  const { settings, runtime, on, emit, ui } = window.ArenaHelper;
  let lastConfirmationButton = null;

  function attemptContinue() {
    if (!settings.autoContinue) return false;
    if (settings.stopAfterThis || runtime.suppressAutoThisTurn || runtime.paused) return false;
    if (runtime.captchaDetected || runtime.isAssistantResponding) return false;
    const maxClicks = Number.isFinite(Number(settings.autoContinueMaxClicks))
      ? Math.max(0, Number(settings.autoContinueMaxClicks)) : 3;
    if (runtime.autoContinueClicksThisResponse >= maxClicks) return false;

    // Some Arena continuation prompts end with a compact Yes/Continue confirmation
    // rather than a button labelled "Continue generating". ui limits this lookup to
    // a short continuation prompt so arbitrary affirmative choices are never clicked.
    const confirmation = ui.findContinueConfirmationButton && ui.findContinueConfirmationButton();
    if (confirmation) {
      if (confirmation === lastConfirmationButton) return false;
      lastConfirmationButton = confirmation;
      runtime.autoContinueClicksThisResponse += 1;
      confirmation.click();
      emit('auto-continue:clicked', { count: runtime.autoContinueClicksThisResponse, confirmation: true });
      return true;
    }

    const btn = ui.findContinueButton();
    if (!btn) return false;

    // Avoid clicking the same "continue" twice — wait for the conversation DOM to change.
    const msgCount = (ui.findMessages() || []).length;
    if (msgCount === runtime.lastMessageCountAtContinue && runtime.autoContinueClicksThisResponse > 0) return false;
    runtime.lastMessageCountAtContinue = msgCount;
    lastConfirmationButton = null;

    runtime.autoContinueClicksThisResponse += 1;
    btn.click();
    emit('auto-continue:clicked', { count: runtime.autoContinueClicksThisResponse });
    return true;
  }

  function onResponseStarted() {
    runtime.autoContinueClicksThisResponse = 0;
    runtime.lastMessageCountAtContinue = 0;
    lastConfirmationButton = null;
  }

  function onResponseDone() {
    // Try to click continue buttons, with retries as new continue buttons may appear.
    let tries = 0;
    const loop = () => {
      tries++;
      if (tries > 6) return;
      if (runtime.isAssistantResponding) return; // already generating again
      const clicked = attemptContinue();
      if (clicked) return; // will re-fire response:started -> response:done when it's done
      setTimeout(loop, 1500);
    };
    setTimeout(loop, 800);
  }

  function attach() {
    on('response:started', onResponseStarted);
    on('response:done', onResponseDone);

    // Arena can render the continuation control after the response-state watcher
    // has already run. Poll lightly while idle so a visible Continue/Read more
    // control is still clicked even if that transition was missed.
    setInterval(() => {
      if (!runtime.isAssistantResponding) attemptContinue();
    }, 1000);

    const observer = new MutationObserver(() => {
      if (!runtime.isAssistantResponding) setTimeout(attemptContinue, 100);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  window.ArenaHelper.features = window.ArenaHelper.features || {};
  window.ArenaHelper.features.continue = { attach };
})();
