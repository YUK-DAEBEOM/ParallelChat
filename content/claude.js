// Claude content script (shared.js loaded first)
registerFrame('claude');


const INPUT_SELECTORS = [
  'div.ProseMirror[contenteditable="true"]',
  'fieldset div[contenteditable="true"]',
  'div[contenteditable="true"][translate="no"]'
];

const SEND_SELECTORS = [
  'button[aria-label="Send Message"]',
  'button[aria-label="Send message"]',
  'button[aria-label="메시지 보내기"]'
];

const FILE_INPUT_SELECTORS = [
  'input[type="file"]'
];

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'setTheme') {
    const html = document.documentElement;
    const dark = message.theme === 'dark';

    // Apply immediately
    html.classList.toggle('dark', dark);
    html.style.colorScheme = dark ? 'dark' : 'light';
    html.setAttribute('data-color-mode', dark ? 'dark' : 'light');

    // Try every known localStorage key Claude might use
    try {
      const val = dark ? 'dark' : 'light';
      ['theme', 'colorScheme', 'color-scheme', 'ui-theme'].forEach(k => localStorage.setItem(k, val));
    } catch (_) {}

    // Keep it applied — Claude's React may re-render and strip the class
    if (window._pcThemeObserver) window._pcThemeObserver.disconnect();
    if (dark) {
      window._pcThemeObserver = new MutationObserver(() => {
        if (!html.classList.contains('dark')) html.classList.add('dark');
      });
      window._pcThemeObserver.observe(html, { attributes: true, attributeFilter: ['class'] });
    }

    sendResponse({ ok: true });
    return;
  }
  if (message.type === 'inputText') {
    handleMessage(message)
      .then(() => sendResponse({ success: true }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
});

async function handleMessage({ text, files }) {
  const input = await waitForElement(INPUT_SELECTORS);
  if (!input) throw new Error('Claude input not found');

  // Upload files first
  if (files && files.length > 0) {
    for (const f of files) {
      const file = base64ToFile(f.data, f.name, f.type);
      const uploaded = await uploadFileViaInput(file, FILE_INPUT_SELECTORS);
      if (!uploaded) {
        await uploadFileViaDrop(file, input);
      }
      await sleep(300);
    }
    await sleep(500);
  }

  // Insert text
  if (text) {
    insertTextIntoElement(input, text);
    await sleep(500);
    clickSendButton(SEND_SELECTORS, input);
  }
}
