/* Quick Prompts — one-click preset prompts that insert (or append) text into the
 * composer and optionally auto-send. Shows up as:
 *   1. A ✦ button in the composer (opens a popover of all prompts by category)
 *   2. Slash command: type "/name" + Tab to insert
 *   3. Optional compact row of favorite quick-insert chips above the composer
 *
 * Default prompts ship on install; user can edit/add/remove from the popup.
 * Prompts are stored in chrome.storage.sync under "snippets" (legacy key name
 * kept for backwards compatibility with earlier versions).
 */
(function () {
  'use strict';
  const defaults = [
    // General
    { id: 'continue',  label: 'Continue',       category: 'General',  autoSend: true,  body: 'Please continue from where you left off.' },
    { id: 'tldr',      label: 'TL;DR',          category: 'General',  autoSend: true,  body: 'Summarize the above concisely in bullet points.' },
    { id: 'explain',   label: 'Explain simply', category: 'General',  autoSend: true,  body: 'Explain this to me as if I were new to the topic. Avoid jargon.' },
    { id: 'concise',   label: 'Concise',        category: 'General',  autoSend: true,  body: 'Rewrite your last answer more concisely, keeping all key information.' },
    { id: 'expand',    label: 'Expand',         category: 'General',  autoSend: true,  body: 'Expand your last answer with more detail, examples, and reasoning.' },
    { id: 'critique',  label: 'Critique',       category: 'General',  autoSend: true,  body: 'Critique the above answer: point out gaps, risks, edge cases, and alternative approaches.' },
    { id: 'stepbystep', label: 'Step by step',  category: 'General',  autoSend: true,  body: 'Walk through this step by step, and explain your reasoning at each step.' },
    { id: 'examples',  label: 'Examples',       category: 'General',  autoSend: true,  body: 'Give 3 concrete examples illustrating the point.' },

    // Code
    { id: 'fixcode',   label: 'Fix bugs',       category: 'Code',     autoSend: true,  body: 'Find and fix any bugs in the code above. Return the corrected code with a brief explanation of each fix.' },
    { id: 'review',    label: 'Code review',    category: 'Code',     autoSend: true,  body: 'Review the code above for correctness, performance, security, and style. Provide actionable suggestions.' },
    { id: 'explaincode', label: 'Explain code', category: 'Code',     autoSend: true,  body: 'Explain what the code above does, step by step, as if you were walking a teammate through it.' },
    { id: 'tests',     label: 'Write tests',    category: 'Code',     autoSend: true,  body: 'Write comprehensive unit tests for the code above. Include edge cases.' },
    { id: 'refactor',  label: 'Refactor',       category: 'Code',     autoSend: true,  body: 'Refactor the code above to be cleaner and more maintainable. Explain what you changed and why.' },
    { id: 'doc',       label: 'Add docs',       category: 'Code',     autoSend: true,  body: 'Add clear docstrings/comments to the code above without changing its behavior.' },
    { id: 'types',     label: 'Add types',      category: 'Code',     autoSend: true,  body: 'Add type annotations to the code above and note any type mismatches you find.' },

    // Writing
    { id: 'procon',    label: 'Pros & cons',    category: 'Writing',  autoSend: true,  body: 'List the pros and cons of the approach above.' },
    { id: 'rewriteformal', label: 'Formalize',  category: 'Writing',  autoSend: true,  body: 'Rewrite the above in a more formal, professional tone suitable for a document/email.' },
    { id: 'rewritecasual', label: 'Casual',     category: 'Writing',  autoSend: true,  body: 'Rewrite the above in a short, casual, conversational tone.' },
    { id: 'grammar',   label: 'Proofread',      category: 'Writing',  autoSend: true,  body: 'Proofread the text above for grammar, spelling, and clarity. Return corrected text.' },
    { id: 'outline',   label: 'Outline',        category: 'Writing',  autoSend: true,  body: 'Create a structured outline for the topic above.' },

    // Agent / automation (Arena specific)
    { id: 'nextstep',  label: 'Next step',      category: 'Agent',    autoSend: true,  body: 'What is the single most important next step I should take? Be specific.' },
    { id: 'commands',  label: 'Commands',       category: 'Agent',    autoSend: false, body: 'List every shell command I should run next in order. Just the commands, one per line, no extra explanation.' },
    { id: 'verifymod', label: 'Verify mods',    category: 'Agent',    autoSend: true,  body: 'Read back every file you just modified and verify the changes are correct and consistent. If anything looks wrong, fix it now.' },
    { id: 'status',    label: 'Status',         category: 'Agent',    autoSend: true,  body: 'Give me a short status update: what did you just do, what is still pending, and what do you need from me?' },
    { id: 'done',      label: 'Mark done',      category: 'Agent',    autoSend: true,  body: 'Stop here. Summarize what you did and any remaining work.' }
  ];

  // Keep built-ins available immediately; storage replaces them once it has loaded.
  // This avoids a race where the first /command is entered before chrome.storage replies.
  let prompts = defaults.slice();
  let popover = null;
  let button = null;

  function loadPrompts() {
    try {
      chrome.storage.sync.get({ snippets: defaults }, (res) => {
        // Accept legacy shape {id,label,body} -> fill missing fields
        const loaded = Array.isArray(res.snippets) ? res.snippets : defaults.slice();
        prompts = loaded.map((p, i) => ({
          id: (p.id || ('p' + i)).toLowerCase().replace(/[^a-z0-9_-]/g, '-'),
          label: p.label || p.id || 'Prompt',
          body: p.body || '',
          category: p.category || 'General',
          autoSend: p.autoSend === undefined ? true : !!p.autoSend
        }));
      });
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'sync' && changes.snippets) {
          prompts = (changes.snippets.newValue || []).map((p, i) => ({
            id: (p.id || ('p' + i)).toLowerCase().replace(/[^a-z0-9_-]/g, '-'),
            label: p.label || p.id || 'Prompt',
            body: p.body || '',
            category: p.category || 'General',
            autoSend: p.autoSend === undefined ? true : !!p.autoSend
          }));
        }
      });
    } catch (e) {
      prompts = defaults.slice();
    }
  }

  function savePrompts() {
    chrome.storage.sync.set({ snippets: prompts });
  }

  function findInput() { return window.ArenaHelper.ui.findChatInput(); }

  function ensureButton() {
    const inp = findInput();
    if (!inp) return;
    if (button && document.contains(button)) return;
    let target = inp.parentElement;
    for (let i = 0; i < 4 && target; i++) {
      if (target.querySelector('button')) break;
      target = target.parentElement;
    }
    if (!target) target = inp.parentElement;
    button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('data-arena-helper', 'quickprompts-btn');
    button.title = 'Arena.ai Helper — quick prompts (/)';
    button.textContent = '✦';
    const c = window.ArenaHelper.theme.themeColors();
    Object.assign(button.style, {
      position: 'absolute',
      bottom: '8px',
      left: '8px',
      width: '28px',
      height: '28px',
      borderRadius: '6px',
      border: `1px solid ${c.border}`,
      background: c.accent,
      color: '#fff',
      cursor: 'pointer',
      zIndex: 999,
      fontSize: '14px',
      lineHeight: '1',
      padding: 0
    });
    if (target) {
      const ps = window.getComputedStyle(target).position;
      if (ps === 'static') target.style.position = 'relative';
    }
    inp.parentElement.appendChild(button);
    button.addEventListener('click', (ev) => {
      ev.preventDefault(); ev.stopPropagation();
      togglePopover();
    });
  }

  function closePopover() {
    if (popover && popover.parentNode) popover.parentNode.removeChild(popover);
    popover = null;
  }

  function groupByCategory(arr) {
    const groups = new Map();
    for (const p of arr) {
      const cat = p.category || 'General';
      if (!groups.has(cat)) groups.set(cat, []);
      groups.get(cat).push(p);
    }
    return groups;
  }

  function togglePopover() {
    if (popover) { closePopover(); return; }
    const inp = findInput();
    if (!inp) return;
    const c = window.ArenaHelper.theme.themeColors();
    const rect = inp.getBoundingClientRect();
    const width = Math.max(200, Math.min(360, window.innerWidth - 16));
    const maxHeight = Math.max(120, Math.min(360, window.innerHeight - 16));
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
    const spaceAbove = rect.top - 8;
    const top = spaceAbove >= 200
      ? Math.max(8, rect.top - Math.min(maxHeight, spaceAbove) - 8)
      : Math.min(window.innerHeight - maxHeight - 8, rect.bottom + 8);
    popover = document.createElement('div');
    popover.setAttribute('data-arena-helper', 'quickprompts-popover');
    Object.assign(popover.style, {
      position: 'fixed',
      top: `${Math.max(8, top)}px`,
      left: `${left}px`,
      background: c.bgSolid,
      color: c.fg,
      border: `1px solid ${c.border}`,
      borderRadius: '10px',
      boxShadow: '0 10px 30px rgba(0,0,0,0.18)',
      zIndex: 1000,
      padding: '8px',
      minWidth: `${Math.min(280, width)}px`,
      maxWidth: `${width}px`,
      maxHeight: `${maxHeight}px`,
      overflowY: 'auto',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      fontSize: '13px'
    });
    const header = document.createElement('div');
    header.style.padding = '4px 6px 6px';
    header.innerHTML = '<b>Quick prompts</b> <span style="color:' + c.fgMuted + ';font-size:11px;margin-left:6px;">click to insert & send</span>';
    popover.appendChild(header);

    if (prompts.length === 0) {
      const empty = document.createElement('div');
      empty.textContent = 'No quick prompts. Add some from the extension popup.';
      Object.assign(empty.style, { padding: '8px', color: c.fgMuted, fontSize: '12px' });
      popover.appendChild(empty);
    } else {
      const groups = groupByCategory(prompts);
      const order = ['General', 'Code', 'Writing', 'Agent'];
      const categories = [
        ...order.filter(k => groups.has(k)),
        ...Array.from(groups.keys()).filter(k => !order.includes(k))
      ];
      for (const cat of categories) {
        const h = document.createElement('div');
        h.textContent = cat;
        Object.assign(h.style, {
          padding: '6px 6px 3px',
          fontSize: '10px',
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          color: c.fgMuted
        });
        popover.appendChild(h);
        for (const p of groups.get(cat)) {
          const item = document.createElement('button');
          item.type = 'button';
          item.innerHTML = window.ArenaHelper.ui.escapeHtml(p.label) +
            (p.autoSend ? ' <span style="opacity:.5;font-size:10px;margin-left:4px;">⏎</span>' : '');
          Object.assign(item.style, {
            display: 'block',
            width: '100%',
            textAlign: 'left',
            padding: '6px 8px',
            border: 'none',
            background: 'transparent',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '13px',
            color: c.fg
          });
          item.addEventListener('mouseenter', () => { item.style.background = c.accentBg; });
          item.addEventListener('mouseleave', () => { item.style.background = 'transparent'; });
          item.addEventListener('click', (ev) => {
            ev.preventDefault(); ev.stopPropagation();
            applyPrompt(p);
            closePopover();
          });
          popover.appendChild(item);
        }
      }
    }
    document.body.appendChild(popover);
    setTimeout(() => document.addEventListener('click', outsideClick, { once: true }), 0);
  }

  function outsideClick(ev) {
    if (!popover) return;
    if (!popover.contains(ev.target) && ev.target !== button) closePopover();
    else document.addEventListener('click', outsideClick, { once: true });
  }

  function getSelectedText() {
    const active = document.activeElement;
    if (active && (active.tagName === 'TEXTAREA' || active.tagName === 'INPUT')
        && typeof active.selectionStart === 'number' && typeof active.selectionEnd === 'number') {
      return String(active.value || '').slice(active.selectionStart, active.selectionEnd).trim();
    }
    try { return String(window.getSelection ? window.getSelection().toString() : '').trim(); } catch (e) { return ''; }
  }

  async function expandTemplate(body) {
    const template = String(body || '');
    const now = new Date();
    const values = {
      date: now.toLocaleDateString(),
      time: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      selectedtext: getSelectedText(),
      clipboard: ''
    };
    // Clipboard access may be unavailable on a page/browser; leave the variable
    // blank instead of interrupting insertion in that case.
    if (/\{clipboard\}/i.test(template) && navigator.clipboard && navigator.clipboard.readText) {
      try { values.clipboard = await navigator.clipboard.readText(); } catch (e) {}
    }
    return template.replace(/\{(date|time|selectedText|clipboard)\}/gi, (match, key) => values[String(key).toLowerCase()]);
  }

  async function applyPrompt(p) {
    if (window.ArenaHelper.runtime.captchaDetected) return; // don't insert/send during captcha
    const inp = findInput();
    if (!inp) return;
    // Resolve selection-based values before moving focus into the composer.
    const body = await expandTemplate(p.body);
    inp.focus();
    // Append or replace: if the existing input looks like a pre-send instruction (empty), replace;
    // otherwise add a blank line and append.
    const existing = window.ArenaHelper.ui.getInputText(inp);
    const joiner = existing.trim() ? '\n\n' : '';
    const newText = existing.trim() ? existing + joiner + body : body;
    window.ArenaHelper.ui.setInputText(inp, newText);
    // Auto-send if enabled, not during captcha, and not already responding
    if (p.autoSend) {
      setTimeout(() => {
        const { features, runtime, settings } = window.ArenaHelper;
        if (runtime.captchaDetected) return;
        if (runtime.isAssistantResponding) return;
        if (!settings.autoSend) return;
        if (features && features.send) features.send.tryAutoSend({ force: true });
      }, 250);
    } else if (inp.tagName === 'TEXTAREA') {
      // Move caret to end
      const len = inp.value.length;
      inp.setSelectionRange(len, len);
    }
  }

  function normalizeCommand(value) {
    return String(value || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-');
  }

  function findPromptByCommand(key) {
    const command = normalizeCommand(key);
    return prompts.find((prompt) => normalizeCommand(prompt.id) === command
      || normalizeCommand(prompt.label) === command) || null;
  }

  function isComposer(el) {
    if (!el || !el.tagName) return false;
    const tag = el.tagName.toUpperCase();
    if (tag === 'TEXTAREA' || tag === 'INPUT') return true;
    // Arena can use contenteditable="true", contenteditable="plaintext-only",
    // or a role=textbox element depending on the composer variant.
    return !!(el.isContentEditable
      || (el.getAttribute && el.getAttribute('contenteditable') !== null)
      || (el.getAttribute && el.getAttribute('role') === 'textbox'));
  }

  function getComposerFromTarget(target) {
    if (isComposer(target)) return target;
    if (target && typeof target.closest === 'function') {
      const parent = target.closest('textarea, input, [contenteditable], [role="textbox"]');
      if (isComposer(parent)) return parent;
    }
    return null;
  }

  function onKeyDown(ev) {
    if (ev.key !== 'Tab' && ev.keyCode !== 9) return;
    const inp = getComposerFromTarget(ev.target);
    if (!inp) return;
    const text = window.ArenaHelper.ui.getInputText(inp);
    const m = /\/([a-zA-Z0-9_-]+)\s*$/.exec(text);
    if (!m) return;
    const prompt = findPromptByCommand(m[1]);
    if (!prompt) return;
    ev.preventDefault();
    ev.stopPropagation();
    // Replace the slash-command with the expanded prompt body. For Tab we insert
    // only (don't auto-send), matching how snippet completions usually work.
    expandTemplate(prompt.body).then((body) => {
      const latest = window.ArenaHelper.ui.getInputText(inp);
      const newText = latest.replace(/\/([a-zA-Z0-9_-]+)\s*$/, body);
      window.ArenaHelper.ui.setInputText(inp, newText);
    });
  }

  function retheme() {
    if (button) {
      const c = window.ArenaHelper.theme.themeColors();
      button.style.border = `1px solid ${c.border}`;
      button.style.background = c.accent;
    }
    if (popover) closePopover(); // simplest refresh
  }

  function attach() {
    loadPrompts();
    document.addEventListener('keydown', onKeyDown, true);
    setInterval(ensureButton, 1500);
    ensureButton();
    window.ArenaHelper.theme.onThemeChange(retheme);
    // Disable button visually when captcha mode is active
    window.ArenaHelper.on('captcha:entered', () => { if (button) button.style.opacity = '0.4'; });
    window.ArenaHelper.on('captcha:exited', () => { if (button) button.style.opacity = '1'; });
  }

  // Expose defaults for popup's editor "reset to defaults"
  window.ArenaHelper.defaultQuickPrompts = defaults;

  window.ArenaHelper.features = window.ArenaHelper.features || {};
  window.ArenaHelper.features.quickprompts = { attach, applyPrompt, expandTemplate };
})();
