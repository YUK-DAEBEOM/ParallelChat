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

// Theme application with React-overwrite defense
let lastAppliedTheme = null;
let observerPaused = false;

function applyThemeClaude(theme) {
  const html = document.documentElement;
  const dark = theme === 'dark';
  observerPaused = true;
  html.classList.toggle('dark', dark);
  html.style.colorScheme = dark ? 'dark' : 'light';
  html.setAttribute('data-color-mode', dark ? 'dark' : 'light');
  try {
    ['theme', 'colorScheme', 'color-scheme', 'ui-theme'].forEach(k =>
      localStorage.setItem(k, dark ? 'dark' : 'light')
    );
  } catch (_) {}
  lastAppliedTheme = theme;
  queueMicrotask(() => { observerPaused = false; });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'setTheme') {
    applyThemeClaude(message.theme);
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

// React 덮어쓰기 감지 → 1회 재적용 (throttle 500ms)
let reapplyTimer = null;
new MutationObserver(() => {
  if (observerPaused || reapplyTimer || !lastAppliedTheme) return;
  reapplyTimer = setTimeout(() => {
    reapplyTimer = null;
    const html = document.documentElement;
    const currentlyDark = html.classList.contains('dark');
    if (lastAppliedTheme === 'dark' && !currentlyDark) applyThemeClaude('dark');
    else if (lastAppliedTheme === 'light' && currentlyDark) applyThemeClaude('light');
  }, 500);
}).observe(document.documentElement, {
  attributes: true,
  attributeFilter: ['class', 'data-color-mode']
});

announceReady();

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
