/* Export conversation to Markdown. Adds a right-click (popup) triggered download
 * by walking the detected message elements and extracting role/text.
 */
(function () {
  'use strict';
  const { on, ui } = window.ArenaHelper;

  function guessRole(el) {
    // Arena's current transcript marks user turns explicitly.
    if (el.querySelector && el.querySelector('[data-user-message-layout], [data-user-message-body-row]')) return 'user';
    if (el.hasAttribute && el.hasAttribute('data-agent-transcript-message')) return 'assistant';

    const text = (el.getAttribute('data-role') || el.getAttribute('role') || '').toLowerCase();
    if (text.includes('user')) return 'user';
    if (text.includes('assistant') || text.includes('bot') || text.includes('ai')) return 'assistant';
    const cls = (el.className || '').toString().toLowerCase();
    if (cls.includes('user')) return 'user';
    if (cls.includes('assistant') || cls.includes('bot') || cls.includes('agent')) return 'assistant';
    // Alt heuristic: messages tend to alternate. The first non-ignored child after the header is usually "user" if it's short, but safer:
    // If it contains a code block (pre > code), it's likely assistant.
    if (el.querySelector('pre, code')) return 'assistant';
    // Otherwise alternate based on index — caller handles.
    return null;
  }

  function elementToMarkdown(el) {
    // Clone to avoid mutating the page
    const node = el.cloneNode(true);
    // Remove obvious UI chrome
    node.querySelectorAll('button, [role="button"], svg, .copy, [class*="toolbar"], [class*="action"]').forEach(n => n.remove());
    // Convert <pre><code> blocks into fenced code blocks
    const pres = node.querySelectorAll('pre');
    pres.forEach(pre => {
      const code = pre.querySelector('code');
      const lang = code ? Array.from(code.classList).find(c => c.startsWith('language-')) : null;
      const langName = lang ? lang.replace('language-', '') : '';
      const body = (code || pre).innerText || '';
      const replacement = document.createElement('div');
      replacement.innerText = '\n```' + langName + '\n' + body.replace(/\n$/, '') + '\n```\n';
      pre.replaceWith(replacement);
    });
    let text = (node.innerText || '').replace(/\u00a0/g, ' ');
    // Collapse 3+ blank lines
    text = text.replace(/\n{3,}/g, '\n\n').trim();
    return text;
  }

  function buildMarkdown() {
    const msgs = ui.findMessages();
    if (!msgs.length) return '';
    const lines = [];
    lines.push('# Arena.ai Conversation Export');
    lines.push('');
    lines.push(`_Exported: ${new Date().toISOString()}_`);
    lines.push('');
    let lastRole = null;
    let fallbackIdx = 0;
    for (const m of msgs) {
      let role = guessRole(m);
      if (!role) {
        // Alternate: assume first message is user if it's short and not code-heavy
        if (fallbackIdx === 0) role = 'user';
        else role = lastRole === 'user' ? 'assistant' : 'user';
      }
      const body = elementToMarkdown(m);
      if (!body) { fallbackIdx++; continue; }
      lines.push(`## ${role === 'user' ? 'User' : 'Assistant'}`);
      lines.push('');
      lines.push(body);
      lines.push('');
      lastRole = role;
      fallbackIdx++;
    }
    return lines.join('\n');
  }

  function downloadMarkdown() {
    const md = buildMarkdown();
    if (!md) {
      alert('No messages detected to export.');
      return;
    }
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    a.href = url;
    a.download = `arena-conversation-${stamp}.md`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 200);
  }

  function attach() {
    on('export:now', downloadMarkdown);
  }

  window.ArenaHelper.features = window.ArenaHelper.features || {};
  window.ArenaHelper.features.exportMd = { attach, exportConversation: downloadMarkdown };
})();
