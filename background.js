/* Arena.ai Helper - background service worker.
 * Handles keyboard commands from the manifest, routes notifications, and
 * forwards messages to the active tab.
 */

function sendToActiveTab(message) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs || !tabs.length) return;
    const tab = tabs[0];
    if (!tab.id) return;
    try {
      chrome.tabs.sendMessage(tab.id, message, { frameId: 0 }, () => void chrome.runtime.lastError);
    } catch (e) { /* ignore */ }
  });
}

chrome.commands.onCommand.addListener((command) => {
  switch (command) {
    case 'toggle-auto-send':
      sendToActiveTab({ type: 'cmd:toggle-auto-send' });
      break;
    case 'toggle-auto-scroll':
      sendToActiveTab({ type: 'cmd:toggle-auto-scroll' });
      break;
    case 'clear-input':
      sendToActiveTab({ type: 'cmd:clear-input' });
      break;
    case 'stop-after-this':
      sendToActiveTab({ type: 'cmd:stop-after-this' });
      break;
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return;
  if (msg.type === 'notify') {
    try {
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: msg.title || 'Arena.ai Helper',
        message: msg.message || '',
        priority: 1
      });
    } catch (e) { /* ignore */ }
  }
});

chrome.notifications.onClicked.addListener((id) => {
  chrome.notifications.clear(id);
  // Focus the most recent Arena tab
  chrome.tabs.query({ url: ['https://arena.ai/*', 'https://*.arena.ai/*'] }, (tabs) => {
    if (tabs && tabs.length) {
      const t = tabs[tabs.length - 1];
      if (t.id) chrome.tabs.update(t.id, { active: true });
    }
  });
});

// When installed, set default snippets into storage if not present.
chrome.runtime.onInstalled.addListener(() => {
  const defaultSnippets = [
    { id: 'tldr', label: 'TL;DR', body: 'Summarize the above concisely in bullet points.' },
    { id: 'continue', label: 'Continue', body: 'Please continue from where you left off.' },
    { id: 'concise', label: 'Rewrite concisely', body: 'Rewrite your last answer more concisely, keeping the key information.' },
    { id: 'explain', label: 'Explain simply', body: 'Explain this to me as if I were new to the topic. Avoid jargon.' },
    { id: 'critique', label: 'Critique this', body: 'Critique the above answer: point out gaps, risks, and alternative approaches.' }
  ];
  chrome.storage.sync.get({ snippets: null }, (res) => {
    if (!res.snippets) chrome.storage.sync.set({ snippets: defaultSnippets });
  });
});
