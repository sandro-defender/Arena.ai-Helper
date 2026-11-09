/* Arena.ai Helper — main content script.
 * Loads after the feature modules (see manifest.json js array).
 * Coordinates detecting response start/stop and kicking off features.
 */
(function () {
  'use strict';

  const { runtime, settings, emit, ui, features } = window.ArenaHelper;

  // Don't run in tiny/hidden iframes that clearly aren't the main chat view.
  if (window.innerWidth < 400 || window.innerHeight < 300) {
    // Still load so that if the iframe grows it can work, but skip heavy work.
    return;
  }

  function detectHasChatUi() {
    const hasInput = !!ui.findChatInput();
    const hasScroll = !!ui.findChatContainer();
    if (hasInput && hasScroll) {
      runtime.hasChatUi = true;
      return true;
    }
    return false;
  }

  function watchResponseState() {
    setInterval(() => {
      if (!runtime.hasChatUi) {
        detectHasChatUi();
        if (!runtime.hasChatUi) return;
      }
      const currently = ui.detectAssistantResponding();
      if (runtime.isAssistantResponding && !currently) {
        runtime.isAssistantResponding = false;
        runtime.assistantJustFinished = true;
        emit('response:done', {});
      } else if (!runtime.isAssistantResponding && currently) {
        runtime.isAssistantResponding = true;
        runtime.assistantJustFinished = false;
        emit('response:started', {});
      }
    }, 400);
  }

  function observeMutations() {
    const mo = new MutationObserver(() => {
      if (!runtime.hasChatUi) detectHasChatUi();
      if (features && features.scroll) features.scroll.schedule();
    });
    mo.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  function attachAllFeatures() {
    // Order matters: scroll/queue/send first, then niceties.
    const order = [
      'scroll', 'send', 'queue', 'continue', 'toollimit', 'notifications', 'autofocus',
      'copycode', 'timestamps', 'closeprotect', 'quickprompts', 'floatingstatus', 'counter', 'history', 'exportMd', 'debugoverlay'
    ];
    for (const name of order) {
      const f = features && features[name];
      if (f && typeof f.attach === 'function') {
        try { f.attach(); } catch (e) { console.error('[Arena.ai Helper] feature attach failed:', name, e); }
      }
    }
  }

  function init() {
    detectHasChatUi();
    observeMutations();
    attachAllFeatures();
    watchResponseState();

    // Retry detection a couple of times for SPA navigation
    setTimeout(detectHasChatUi, 1000);
    setTimeout(detectHasChatUi, 3000);
    setTimeout(() => {
      if (runtime.hasChatUi && features && features.scroll) features.scroll.forceScroll();
    }, 500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
