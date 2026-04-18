// ChatGPT content script (shared.js loaded first)
registerFrame('chatgpt');


// Prevent layout shifts when typing in iframe (keep sidebar visible)
(function injectSidebarSuppressor() {
  const style = document.createElement('style');
  style.textContent = `
    main, [role="main"], .main-content {
      margin-left: 0 !important;
      padding-left: 0 !important;
      max-width: 100% !important;
    }
  `;
  (document.head || document.documentElement).appendChild(style);
})();

const INPUT_SELECTORS = [
  '#prompt-textarea',
  'div[contenteditable="true"].ProseMirror',
  'textarea[placeholder]'
];

const SEND_SELECTORS = [
  'button[data-testid="send-button"]',
  'button[aria-label="Send prompt"]',
  'button[aria-label="Send message"]'
];

const FILE_INPUT_SELECTORS = [
  'input[type="file"]'
];

// Theme application with React-overwrite defense
let lastAppliedTheme = null;
let observerPaused = false;

function applyThemeCGPT(theme) {
  const html = document.documentElement;
  observerPaused = true;
  if (theme === 'dark') {
    html.classList.add('dark');
    html.setAttribute('data-theme', 'dark');
    html.style.colorScheme = 'dark';
  } else {
    html.classList.remove('dark');
    html.setAttribute('data-theme', 'light');
    html.style.colorScheme = 'light';
  }
  try { localStorage.setItem('theme', theme); } catch (_) {}
  lastAppliedTheme = theme;
  queueMicrotask(() => { observerPaused = false; });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'setTheme') {
    applyThemeCGPT(message.theme);
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
    if (lastAppliedTheme === 'dark' && !currentlyDark) applyThemeCGPT('dark');
    else if (lastAppliedTheme === 'light' && currentlyDark) applyThemeCGPT('light');
  }, 500);
}).observe(document.documentElement, {
  attributes: true,
  attributeFilter: ['class', 'data-theme']
});

announceReady();

async function handleMessage({ text, files }) {
  const input = await waitForElement(INPUT_SELECTORS);
  if (!input) throw new Error('ChatGPT input not found');

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
