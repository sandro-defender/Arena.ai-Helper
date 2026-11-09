/* Auto-scroll feature. Scrolls the chat container to the latest message.
 * A real scroll event is the source of truth for a manual pause. Arena's own
 * "Scroll to bottom" button is an action we can use, not proof on its own that
 * auto-scroll should stop (the button may appear while new content streams).
 */
(function () {
  'use strict';
  const { settings, runtime, on, ui } = window.ArenaHelper;
  let chatContainer = null;
  let scheduled = false;
  let scrollListenerContainer = null;
  let autoScrollUntil = 0;
  let lastUrl = location.href;

  function visibleTranscript() {
    const all = document.querySelectorAll('[data-perf-target="transcript"]');
    for (const t of all) {
      if (ui.isVisible(t)) return t;
    }
    return all.length ? all[0] : null;
  }

  function containerStillValid() {
    if (!chatContainer || !document.contains(chatContainer)) return false;
    // Arena is an SPA: after navigation a new transcript/scroll viewport is
    // mounted, while the old element can still be attached in a hidden view.
    const transcript = visibleTranscript();
    if (transcript) {
      const log = transcript.querySelector('[data-custom-scrollbar="true"], [role="log"]');
      if (log) return log === chatContainer;
      const viewport = transcript.closest('[data-radix-scroll-area-viewport]');
      if (viewport) return viewport === chatContainer;
    }
    return true;
  }

  function refreshForNavigation() {
    if (location.href === lastUrl) return false;
    lastUrl = location.href;
    chatContainer = null;
    runtime.userScrolledUp = false;
    ensureContainer();
    return true;
  }

  function ensureContainer() {
    refreshForNavigation();
    if (!containerStillValid()) {
      chatContainer = ui.findChatContainer();
      attachContainerScroll();
    }
    return chatContainer;
  }

  function schedule() {
    refreshForNavigation();
    if (runtime.paused) return;
    if (!settings.autoScroll || scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      run();
    });
  }

  function markAutoScrolling(smooth) {
    // Smooth scrolling emits intermediate scroll events. Do not mistake those for
    // a reader manually moving away from the latest message.
    autoScrollUntil = Date.now() + (smooth ? 1400 : 300);
    runtime.userScrolledUp = false;
  }

  function run(smooth = true) {
    if (runtime.paused) return;
    if (!settings.autoScroll) return;
    if (settings.scrollPauseOnManualScroll && runtime.userScrolledUp) return;

    const nativeBtn = ui.findArenaScrollToBottomButton();
    markAutoScrolling(smooth);
    if (nativeBtn && !nativeBtn.disabled) {
      nativeBtn.click();
      return;
    }

    const container = ensureContainer();
    if (container) {
      ui.scrollToBottom(container, smooth);
    } else {
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
    }
  }

  function onScroll() {
    const container = ensureContainer();
    const target = container && container !== document.body && container !== document.documentElement
      ? container : null;

    if (Date.now() < autoScrollUntil) {
      if (ui.isNearBottom(target)) runtime.userScrolledUp = false;
      return;
    }

    // Any user-positioned scroll away from the end pauses auto-scroll. Previously
    // the page's native button was treated as a pause signal, which prevented the
    // helper from ever clicking it during a streaming response.
    runtime.userScrolledUp = !ui.isNearBottom(target);
    if (!runtime.userScrolledUp) schedule();
  }

  function attachContainerScroll() {
    const container = chatContainer;
    if (scrollListenerContainer === container) return;
    if (scrollListenerContainer) scrollListenerContainer.removeEventListener('scroll', onScroll);
    scrollListenerContainer = null;
    if (container && container !== document.body && container !== document.documentElement) {
      container.addEventListener('scroll', onScroll, { passive: true });
      scrollListenerContainer = container;
    }
  }

  function attach() {
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('popstate', () => {
      lastUrl = '';
      refreshForNavigation();
    });
    ensureContainer();
    setTimeout(ensureContainer, 1500);
    setTimeout(ensureContainer, 5000);

    // Schedule a run when Arena adds message content or its native scroll control.
    // Respect a genuine manual pause; otherwise the new control is clicked by run().
    const observer = new MutationObserver(() => {
      refreshForNavigation();
      if (!runtime.paused && settings.autoScroll && !runtime.userScrolledUp) schedule();
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  function forceScroll() {
    runtime.userScrolledUp = false;
    run(false);
  }

  on('response:started', () => { if (!runtime.paused) schedule(); });
  on('response:done', () => { if (!runtime.paused) run(false); });

  window.ArenaHelper.features = window.ArenaHelper.features || {};
  window.ArenaHelper.features.scroll = { schedule, run, forceScroll, attach };
})();
