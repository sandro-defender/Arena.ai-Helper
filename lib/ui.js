/* Shared DOM helpers used by features. */
(function () {
  'use strict';
  const { runtime } = window.ArenaHelper;

  // Chrome only allows audio contexts to start after a gesture in the page. Keep a
  // single context and unlock it from a real pointer/key gesture; background
  // response-complete events can then play a chime without producing autoplay
  // errors in DevTools.
  let chimeContext = null;
  let chimeUnlocked = false;

  function unlockChime() {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    try {
      if (!chimeContext || chimeContext.state === 'closed') chimeContext = new Ctx();
      const markUnlocked = () => { chimeUnlocked = !!chimeContext && chimeContext.state === 'running'; };
      if (chimeContext.state === 'suspended') {
        const resume = chimeContext.resume();
        if (resume && typeof resume.then === 'function') resume.then(markUnlocked).catch(() => {});
        else markUnlocked();
      } else {
        markUnlocked();
      }
    } catch (e) { /* A browser can still reject audio in an embedded frame. */ }
  }

  document.addEventListener('pointerdown', unlockChime, { capture: true, passive: true });
  document.addEventListener('keydown', unlockChime, true);

  function isVisible(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    const style = window.getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none') return false;
    return true;
  }

  function isControlDisabled(el) {
    if (!el) return true;
    if (el.disabled) return true;
    if (el.getAttribute && el.getAttribute('aria-disabled') === 'true') return true;
    // Tailwind writes variant classes like `disabled:pointer-events-none` on
    // enabled controls too, so substring matching produced false positives.
    // Check exact class tokens and the computed style instead.
    const classList = el.classList;
    if (classList && (classList.contains('opacity-50')
        || classList.contains('pointer-events-none')
        || classList.contains('cursor-not-allowed'))) return true;
    try {
      const style = window.getComputedStyle(el);
      if (style.pointerEvents === 'none') return true;
      if (Number(style.opacity || 1) < 0.5) return true;
    } catch (e) { /* ignore */ }
    return false;
  }

  function isScrollableMessageArea(el) {
    if (!el || el.clientHeight < 160 || el.clientWidth < 240) return false;
    // Require real overflow. Arena's <main> uses overflow-x:auto but is not the
    // transcript scroller; returning it made auto-scroll a no-op.
    return el.scrollHeight > el.clientHeight + 24;
  }

  function findChatContainer() {
    // Arena-specific fast path. The transcript wrapper carries
    // data-perf-target="transcript"; the actual scrollable element is either a
    // child marked data-custom-scrollbar / role="log" (current revision) or an
    // ancestor [data-radix-scroll-area-viewport] (older revision).
    // Arena keeps the previous conversation mounted but hidden during SPA
    // navigation, so prefer the visible transcript rather than the first one.
    const transcripts = document.querySelectorAll('[data-perf-target="transcript"]');
    let transcript = null;
    for (const t of transcripts) {
      if (isVisible(t)) { transcript = t; break; }
    }
    if (!transcript && transcripts.length) transcript = transcripts[0];
    if (transcript) {
      // Current Arena revision: the transcript wrapper is overflow:hidden and the
      // real scroller is a child marked data-custom-scrollbar / role="log".
      const log = transcript.querySelector('[data-custom-scrollbar="true"], [role="log"]');
      if (log && isScrollableMessageArea(log)) return log;
      for (const child of transcript.querySelectorAll(':scope > div')) {
        if (child.closest('pre, code')) continue;
        if (isScrollableMessageArea(child)) return child;
      }
      const viewport = transcript.closest('[data-radix-scroll-area-viewport]');
      if (viewport) return viewport;
      let node = transcript.parentElement;
      while (node && node !== document.body && node !== document.documentElement) {
        if (isScrollableMessageArea(node)) return node;
        node = node.parentElement;
      }
      return transcript;
    }

    // Start at both the send control and the actual composer. The current Arena
    // Tiptap composer does not always share an ancestor with a labelled send button.
    const composer = findChatInput();
    const anchors = [findArenaSendButton(document), composer].filter(Boolean);
    for (const anchor of anchors) {
      let node = anchor.parentElement;
      for (let depth = 0; depth < 11 && node; depth++) {
        // In Arena's layout, the messages are normally a preceding sibling of the
        // composer/control wrapper.
        let sibling = node.previousElementSibling;
        while (sibling) {
          if (isScrollableMessageArea(sibling)) return sibling;
          sibling = sibling.previousElementSibling;
        }
        // Some layouts place the composer and message list in separate children of
        // the same parent instead of preceding siblings.
        for (const child of Array.from(node.children || [])) {
          if (child === node || child.contains(anchor)) continue;
          if (isScrollableMessageArea(child)) return child;
        }
        if (isScrollableMessageArea(node)) return node;
        node = node.parentElement;
      }
    }

    // Generic fallback for layout revisions. Prefer a tall message region and
    // penalize an element that contains the composer itself.
    const candidates = [];
    for (const el of document.querySelectorAll('*')) {
      if (!(el instanceof Element) || !isScrollableMessageArea(el)) continue;
      const blocks = el.querySelectorAll('div, article, li, section');
      let bigChildCount = 0;
      for (const child of blocks) if (child.clientHeight > 40) bigChildCount++;
      let score = el.clientHeight + Math.min(bigChildCount * 10, 800);
      if (composer && el.contains(composer)) score -= 350;
      if (el === document.body || el === document.documentElement) score -= 250;
      candidates.push({ el, score });
    }
    if (!candidates.length) return null;
    candidates.sort((a, b) => b.score - a.score);
    return candidates[0].el;
  }

  function isEditableComposer(el) {
    if (!el || !isVisible(el) || el.clientWidth <= 100) return false;
    if (el.getAttribute && el.getAttribute('aria-disabled') === 'true') return false;
    const tag = (el.tagName || '').toUpperCase();
    if (tag === 'TEXTAREA' || tag === 'INPUT') return el.clientHeight > 20;
    const contenteditable = el.getAttribute && el.getAttribute('contenteditable');
    return el.isContentEditable || contenteditable === 'true' || contenteditable === ''
      || contenteditable === 'plaintext-only' || (el.getAttribute && el.getAttribute('role') === 'textbox');
  }

  function findChatInput() {
    // Arena's current composer is a Tiptap/ProseMirror div. Prefer it explicitly,
    // then fall back to generic text controls for older layouts.
    const composerSelector = [
      '[contenteditable="true"].ProseMirror[aria-disabled="false"]',
      '[contenteditable="true"].ProseMirror',
      '[contenteditable="true"][aria-disabled="false"]',
      '[contenteditable="plaintext-only"]',
      'textarea',
      '[role="textbox"]',
      '[contenteditable="true"]',
      '[contenteditable=""]'
    ].join(', ');

    // Arena-specific: locate a composer in the send button's ancestry first so a
    // code editor or another editable region cannot win the generic search.
    const sendBtn = findArenaSendButton(document);
    if (sendBtn) {
      let container = sendBtn.parentElement;
      for (let i = 0; i < 8 && container; i++) {
        const candidates = container.querySelectorAll(composerSelector);
        for (const candidate of candidates) {
          if (isEditableComposer(candidate)) return candidate;
        }
        container = container.parentElement;
      }
    }

    const candidates = document.querySelectorAll(composerSelector);
    for (const candidate of candidates) {
      if (isEditableComposer(candidate)) return candidate;
    }
    return null;
  }

  // Arena-specific fast-path: button with data-perf-target="send" or aria-label exactly "Send message"
  function findArenaSendButton(root) {
    const scope = root || document;
    // Exact perf-target (from the live Arena markup user shared)
    let btn = scope.querySelector('button[data-perf-target="send"]');
    if (btn && isVisible(btn)) return btn;
    // Exact aria-label match
    const exact = scope.querySelectorAll('button[aria-label]');
    for (const b of exact) {
      if (!isVisible(b)) continue;
      const label = (b.getAttribute('aria-label') || '').trim().toLowerCase();
      if (label === 'send message' || label === 'send') return b;
    }
    return null;
  }

  function findArenaStopButton(root) {
    const scope = root || document;
    const btns = scope.querySelectorAll('button[aria-label]');
    for (const b of btns) {
      if (!isVisible(b)) continue;
      const label = (b.getAttribute('aria-label') || '').trim().toLowerCase();
      // Arena uses these labels while a response is streaming. Avoid a generic
      // "Cancel" button (dialogs have one) which would look like streaming forever.
      if (label === 'stop generating' || label === 'stop response' || label === 'stop' || label === 'cancel generation') {
        return b;
      }
    }
    // Also check for a non-disabled send button with a stop icon (square inside)
    const send = findArenaSendButton(scope);
    if (send && !send.disabled) {
      // When active during generation the send button sometimes becomes a stop; if it's not disabled and there's no stop btn,
      // we'll rely on detectAssistantResponding's other heuristics. This branch stays conservative.
    }
    return null;
  }

  // Arena's native latest-message control varies between app revisions. Clicking
  // it is preferable because Arena owns the correct scroll target and offset.
  function findArenaScrollToBottomButton() {
    const controls = document.querySelectorAll('button, [role="button"]');
    const labels = [
      'scroll to bottom', 'scroll down', 'jump to bottom', 'jump to latest',
      'go to bottom', 'go to latest', 'latest message', 'new messages'
    ];
    for (const control of controls) {
      if (!isVisible(control) || control.disabled || control.getAttribute('aria-disabled') === 'true') continue;
      const text = [
        control.getAttribute('aria-label'), control.getAttribute('title'),
        control.getAttribute('data-perf-target'), control.textContent
      ].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim().toLowerCase();
      if (labels.some((label) => text === label || text.includes(label))) return control;
    }
    return null;
  }

  function findSendButton(inputEl) {
    // Fast Arena-specific path
    const arenaSend = findArenaSendButton(document);
    if (arenaSend && !arenaSend.disabled) return arenaSend;

    if (!inputEl) {
      // No input hint — still return the arena send if it exists and is enabled
      return arenaSend && !arenaSend.disabled ? arenaSend : null;
    }
    let container = inputEl.parentElement;
    for (let i = 0; i < 8 && container; i++) {
      // Arena-send inside container?
      const arenaInContainer = container.querySelector('button[data-perf-target="send"]');
      if (arenaInContainer && isVisible(arenaInContainer) && !arenaInContainer.disabled) return arenaInContainer;

      const buttons = container.querySelectorAll('button');
      for (const btn of buttons) {
        if (!isVisible(btn)) continue;
        if (btn.disabled) continue;
        const label = (btn.getAttribute('aria-label') || btn.textContent || '').toLowerCase();
        if (/(^|\s)(send message|send|submit|enter)(\s|$)/.test(label)) return btn;
        const hasSvg = btn.querySelector('svg');
        if (hasSvg && btn.clientWidth <= 80 && btn.clientHeight <= 80
            && !label.includes('attach') && !label.includes('mic')
            && !label.includes('more') && !label.includes('menu')) {
          // Likely the send icon, especially if it's near a textarea/contenteditable
          if (container.querySelector('textarea, [contenteditable="true"], [role="textbox"]')) {
            return btn;
          }
        }
      }
      const roleBtns = container.querySelectorAll('[role="button"]');
      for (const rb of roleBtns) {
        if (!isVisible(rb)) continue;
        const label = (rb.getAttribute('aria-label') || rb.textContent || '').toLowerCase();
        if (label.includes('send')) return rb;
      }
      container = container.parentElement;
    }
    return null;
  }

  // Find "continue generating" / "read more" / "regenerate" controls after a response stops.
  function findContinueButton() {
    const isUsable = (el) => el && isVisible(el) && !el.disabled && el.getAttribute('aria-disabled') !== 'true';
    const toClickable = (el) => {
      if (!el) return null;
      const tag = (el.tagName || '').toLowerCase();
      if (tag === 'button' || tag === 'a' || el.getAttribute('role') === 'button') return el;
      return el.closest && el.closest('button, a, [role="button"]') || el;
    };
    // The marker can be on Arena's button, icon, or wrapper depending on the UI revision.
    const selectors = [
      '[data-perf-target*="continue" i]',
      '[data-testid*="continue" i]',
      '[aria-label*="continue" i]',
      '[title*="continue" i]',
      '[data-perf-target*="read-more" i]'
    ];
    for (const selector of selectors) {
      const matches = document.querySelectorAll(selector);
      for (const match of matches) {
        const clickable = toClickable(match);
        if (isUsable(clickable)) return clickable;
      }
    }

    const labels = [
      'continue generating', 'continue', 'continue working', 'read more',
      'keep going', 'show more', 'expand', 'regenerate', 'resume generation'
    ];
    const controls = Array.from(document.querySelectorAll('button, a, [role="button"]'));
    for (const control of controls) {
      if (!isUsable(control)) continue;
      const text = (control.getAttribute('aria-label') || control.getAttribute('title') || control.textContent || '')
        .replace(/\s+/g, ' ').toLowerCase().trim();
      if (!text || text.includes('send')) continue;
      if (labels.some((label) => text === label || text.startsWith(label + ' ') || (label.length > 4 && text.includes(label)))) {
        return control;
      }
    }
    return null;
  }

  // Arena sometimes asks for a one-click confirmation before continuing. Only
  // accept an exact affirmative control when it lives in a compact continuation
  // prompt, never a generic "Yes" button elsewhere in a long conversation.
  function findContinueConfirmationButton() {
    const affirmatives = new Set(['yes', 'yes, continue', 'continue', 'continue anyway', 'resume']);
    const contextWords = /\b(continue|continuing|generation|generating|resume|keep going|read more|more response)\b/i;
    const controls = document.querySelectorAll('button, [role="button"]');
    for (const control of controls) {
      if (!isVisible(control) || control.disabled || control.getAttribute('aria-disabled') === 'true') continue;
      const label = (control.getAttribute('aria-label') || control.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
      if (!affirmatives.has(label)) continue;
      let scope = control.parentElement;
      for (let i = 0; i < 5 && scope; i++) {
        const text = (scope.innerText || scope.textContent || '').replace(/\s+/g, ' ').trim();
        if (text.length > 0 && text.length <= 700 && contextWords.test(text)) return control;
        scope = scope.parentElement;
      }
    }
    return null;
  }

  function getInputText(inputEl) {
    if (!inputEl) return '';
    if (inputEl.tagName === 'TEXTAREA' || inputEl.tagName === 'INPUT') return inputEl.value || '';
    // ProseMirror/Tiptap represents a blank composer as an empty paragraph or a
    // trailing zero-width space. Reading textContent as a fallback catches both
    // existing typed prompts and editor updates that do not emit a native input event.
    return String(inputEl.innerText || inputEl.textContent || '')
      .replace(/[\u200B\uFEFF]/g, '')
      .replace(/\u00A0/g, ' ');
  }

  function setInputText(inputEl, text) {
    if (!inputEl) return;
    if (inputEl.tagName === 'TEXTAREA' || inputEl.tagName === 'INPUT') {
      inputEl.value = text;
      inputEl.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    // ProseMirror/Tiptap ignores direct innerText writes in some versions: the
    // DOM changes but the editor state does not, so the send button stays
    // disabled. execCommand('insertText') goes through the browser editing
    // pipeline and updates both. Fall back to innerText if it is unavailable.
    inputEl.focus();
    const sel = window.getSelection();
    if (sel) {
      const range = document.createRange();
      range.selectNodeContents(inputEl);
      sel.removeAllRanges();
      sel.addRange(range);
    }
    let inserted = false;
    try {
      inserted = document.execCommand('insertText', false, text);
    } catch (e) { inserted = false; }
    if (!inserted) {
      inputEl.innerText = text;
      inputEl.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }));
    }
    // Let the editor's input handlers update the send button state.
    inputEl.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }));
  }

  function isNearBottom(el, threshold = 100) {
    if (!el) return true;
    if (el === window || el === document.body || el === document.documentElement) {
      const scrollY = window.scrollY || document.documentElement.scrollTop;
      const viewportH = window.innerHeight;
      const total = document.documentElement.scrollHeight;
      return total - (scrollY + viewportH) < threshold;
    }
    return el.scrollHeight - (el.scrollTop + el.clientHeight) < threshold;
  }

  function scrollToBottom(el, smooth = true) {
    if (!el) {
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
      return;
    }
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  }

  function detectAssistantResponding() {
    // 1) Strong signal: Arena's own stop button is visible (the send button swaps labels while streaming)
    if (findArenaStopButton(document)) return true;

    // 2) Exact "stop generating" / "stop response" button labels only.
    const buttons = document.querySelectorAll('button, [role="button"]');
    for (const b of buttons) {
      if (!isVisible(b)) continue;
      const t = (b.getAttribute('aria-label') || b.textContent || '').toLowerCase().trim();
      if (t === 'stop generating' || t === 'stop response') return true;
    }

    return false;
  }

  // Click the send button (or simulate Enter) for the current input.
  function submitInput(inputEl) {
    // Prefer the real Arena send button (even if not inside the input's container)
    const arenaBtn = findArenaSendButton(document);
    if (arenaBtn && !isControlDisabled(arenaBtn)) {
      arenaBtn.click();
      return true;
    }
    if (inputEl) {
      const btn = findSendButton(inputEl);
      if (btn && !isControlDisabled(btn)) {
        btn.click();
        return true;
      }
      // React-friendly input event dispatch: simulate natural Enter
      const opts = { key: 'Enter', code: 'Enter', which: 13, keyCode: 13, bubbles: true, cancelable: true };
      inputEl.dispatchEvent(new KeyboardEvent('keydown', opts));
      inputEl.dispatchEvent(new KeyboardEvent('keypress', opts));
      inputEl.dispatchEvent(new KeyboardEvent('keyup', opts));
      return true;
    }
    return false;
  }

  // Try to detect chat message elements (best effort, works with most LLM chat UIs).
  function findMessages() {
    // Arena-specific: every transcript message carries [data-chat-message-id] and
    // [data-agent-transcript-message]. Prefer those so export/timestamps/copy work
    // on the current app revision instead of relying on class-name heuristics.
    const arenaMessages = document.querySelectorAll('[data-chat-message-id], [data-agent-transcript-message]');
    if (arenaMessages.length) {
      const out = [];
      for (const m of arenaMessages) {
        if (!isVisible(m)) continue;
        if (m.clientHeight < 20) continue;
        const text = (m.innerText || '').trim();
        if (text.length < 2) continue;
        out.push(m);
      }
      if (out.length) return out;
    }

    // Look for elements that look like messages: role=article, or divs with data-message-id, or grouped in a conversation container
    const chatContainer = findChatContainer();
    const root = chatContainer || document.body;

    // Heuristic: messages are direct/near-direct children of the chat container with a reasonable height and containing text or code.
    const children = root.querySelectorAll(':scope > div, :scope > article, :scope > li, [data-message-id], [data-testid*="message"], [class*="message"]');
    const out = [];
    for (const c of children) {
      if (!isVisible(c)) continue;
      if (c.clientHeight < 20) continue;
      const text = (c.innerText || '').trim();
      if (text.length < 2) continue;
      out.push(c);
    }
    return out;
  }

  function detectHasChatUi() {
    const inp = findChatInput();
    if (inp) { runtime.hasChatUi = true; return true; }
    // Sometimes the textarea isn't there on very first paint; retry lazily
    return false;
  }

  // Simple chime via WebAudio — no external asset required. Do not create an
  // AudioContext here: response-complete callbacks are not user gestures and
  // Chrome would log an autoplay-policy error.
  function playChime() {
    const ctx = chimeContext;
    if (!chimeUnlocked || !ctx || ctx.state !== 'running') return;
    try {
      const now = ctx.currentTime;
      const notes = [ { f: 880, t: 0 }, { f: 1318.5, t: 0.12 } ];
      for (const n of notes) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = n.f;
        gain.gain.setValueAtTime(0.0001, now + n.t);
        gain.gain.exponentialRampToValueAtTime(0.25, now + n.t + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + n.t + 0.25);
        osc.connect(gain); gain.connect(ctx.destination);
        osc.start(now + n.t);
        osc.stop(now + n.t + 0.3);
      }
    } catch (e) { /* ignore audio-device failures */ }
  }

  function formatTime(ts) {
    const d = new Date(ts);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  }

  // Escape HTML for safer innerHTML insertion (used by copy-code / snippets UI)
  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  window.ArenaHelper.ui = {
    isVisible,
    isControlDisabled,
    findChatContainer,
    findChatInput,
    findSendButton,
    findArenaSendButton,
    findArenaStopButton,
    findArenaScrollToBottomButton,
    findContinueButton,
    findContinueConfirmationButton,
    getInputText,
    setInputText,
    isNearBottom,
    scrollToBottom,
    detectAssistantResponding,
    submitInput,
    findMessages,
    detectHasChatUi,
    playChime,
    formatTime,
    escapeHtml
  };
})();
