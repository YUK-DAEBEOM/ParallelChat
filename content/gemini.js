// Gemini content script (shared.js loaded first)
registerFrame('gemini');


// --- Input selectors: ordered from most to least specific ---
const INPUT_SELECTORS = [
  // Quill editor (older Gemini)
  'div.ql-editor[contenteditable="true"]',
  // Angular rich-textarea (light DOM)
  'rich-textarea [contenteditable="true"]',
  'rich-textarea div[contenteditable]',
  // Generic contenteditable with common Gemini aria attributes
  'div[contenteditable="true"][aria-label*="prompt"]',
  'div[contenteditable="true"][aria-label*="Enter"]',
  'div[contenteditable="true"][aria-label*="message"]',
  'div[contenteditable="true"][aria-label*="메시지"]',
  'div[contenteditable="true"][aria-label*="Gemini"]',
  // Plain textarea fallback
  'textarea[placeholder]',
  '.text-input-field textarea',
  // Very broad fallback: any visible contenteditable
  'div[contenteditable="true"]'
];

const SEND_SELECTORS = [
  'button.send-button',
  'button[aria-label="Send message"]',
  'button[aria-label="메시지 보내기"]',
  'button[aria-label*="Send"]',
  'button[aria-label*="send"]',
  'button[data-mat-icon-name="send"]',
  '.send-button-container button',
  'button[jsname*="send"]',
  'button[class*="send"]'
];

const FILE_INPUT_SELECTORS = ['input[type="file"]'];

// --- Shadow DOM piercing querySelector ---
function deepQuerySelector(root, selector) {
  const el = root.querySelector(selector);
  if (el) return el;
  for (const node of root.querySelectorAll('*')) {
    if (node.shadowRoot) {
      const found = deepQuerySelector(node.shadowRoot, selector);
      if (found) return found;
    }
  }
  return null;
}

// --- Find Gemini input: tries regular DOM + shadow DOM + broad fallback ---
async function findGeminiInput(timeout = 8000) {
  const start = Date.now();

  while (Date.now() - start < timeout) {
    // 1. Try each specific selector (regular DOM)
    for (const sel of INPUT_SELECTORS) {
      const el = document.querySelector(sel);
      if (el && isVisibleInput(el)) return el;
    }

    // 2. Try shadow DOM of rich-textarea
    const richTextarea = document.querySelector('rich-textarea');
    if (richTextarea?.shadowRoot) {
      const el = richTextarea.shadowRoot.querySelector('[contenteditable="true"]');
      if (el && isVisibleInput(el)) return el;
    }

    // 3. Broad fallback: find any visible contenteditable that looks like a chat input
    const allEditable = document.querySelectorAll('[contenteditable="true"]');
    for (const el of allEditable) {
      if (isVisibleInput(el) && looksLikeChatInput(el)) return el;
    }

    await sleep(200);
  }
  return null;
}

function isVisibleInput(el) {
  if (!el) return false;
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return false;
  const style = window.getComputedStyle(el);
  return style.display !== 'none' && style.visibility !== 'hidden';
}

function looksLikeChatInput(el) {
  // Prefer elements near the bottom of the page (chat inputs are typically at the bottom)
  const rect = el.getBoundingClientRect();
  const viewportHeight = window.innerHeight;
  return rect.bottom > viewportHeight * 0.4;
}

// --- Text insertion: tries multiple strategies ---
async function insertTextForGemini(el, text) {
  el.focus();
  await sleep(150);

  // Strategy 1: execCommand (works for most Angular contenteditable)
  const sel = window.getSelection();
  if (el.isContentEditable) {
    const range = document.createRange();
    range.selectNodeContents(el);
    sel.removeAllRanges();
    sel.addRange(range);

    const ok = document.execCommand('insertText', false, text);

    if (ok && el.textContent.trim()) {
      // execCommand succeeded — dispatch additional events for Angular
      el.dispatchEvent(new InputEvent('input', {
        bubbles: true, cancelable: true,
        inputType: 'insertText', data: text
      }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }
  }

  // Strategy 2: Clipboard paste simulation (Angular handles paste events reliably)
  try {
    const dt = new DataTransfer();
    dt.setData('text/plain', text);
    const pasteOk = el.dispatchEvent(new ClipboardEvent('paste', {
      clipboardData: dt,
      bubbles: true,
      cancelable: true
    }));
    await sleep(100);
    if (el.textContent.trim()) return; // paste worked
  } catch (_) {}

  // Strategy 3: Direct textContent + events
  if (el.tagName === 'TEXTAREA') {
    const nativeSetter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype, 'value'
    ).set;
    nativeSetter.call(el, text);
  } else {
    el.textContent = text;
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(range);
  }

  el.dispatchEvent(new InputEvent('input', {
    bubbles: true, cancelable: true,
    inputType: 'insertText', data: text
  }));
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

// --- Wait for send button to become enabled (Gemini enables it async) ---
async function waitForSendButton(maxWaitMs = 4000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    for (const sel of SEND_SELECTORS) {
      const btn = document.querySelector(sel);
      if (btn && !btn.disabled && !btn.hasAttribute('disabled')) return btn;
    }
    // Also try shadow DOM
    const richTextarea = document.querySelector('rich-textarea');
    if (richTextarea?.shadowRoot) {
      for (const sel of SEND_SELECTORS) {
        const btn = richTextarea.shadowRoot.querySelector(sel);
        if (btn && !btn.disabled && !btn.hasAttribute('disabled')) return btn;
      }
    }
    await sleep(150);
  }
  return null;
}

// --- Message handler ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'setTheme') {
    const html = document.documentElement;
    const isDark = message.theme === 'dark';
    html.style.colorScheme = isDark ? 'dark' : 'light';
    // Toggle Material Design 3 override style
    const existing = document.getElementById('parallelchat-theme');
    if (existing) existing.remove();
    if (isDark) {
      const style = document.createElement('style');
      style.id = 'parallelchat-theme';
      style.textContent = `
        :root {
          color-scheme: dark !important;
          --md-sys-color-background: #1c1b1f !important;
          --md-sys-color-surface: #141218 !important;
          --md-sys-color-surface-container: #201f23 !important;
          --md-sys-color-surface-container-low: #1d1c1f !important;
          --md-sys-color-surface-container-high: #2b2930 !important;
          --md-sys-color-surface-container-highest: #36343b !important;
          --md-sys-color-on-background: #e6e1e5 !important;
          --md-sys-color-on-surface: #e6e1e5 !important;
          --md-sys-color-on-surface-variant: #c8c5cb !important;
          --md-sys-color-outline: #938f99 !important;
          --md-sys-color-outline-variant: #49454f !important;
          --md-sys-color-secondary-container: #4a4458 !important;
        }
        html, body,
        .conversation-container,
        .side-navigation-v2,
        bard-sidenav,
        bard-sidenav-content,
        bard-mode-switcher,
        rich-textarea,
        input-area-v2,
        toolbox-drawer,
        chat-window,
        [class*="chat-history"],
        [class*="input-container"],
        [class*="mat-drawer"] {
          background-color: var(--md-sys-color-background, #141218) !important;
          color: var(--md-sys-color-on-background, #e6e1e5) !important;
        }
      `;
      document.head.appendChild(style);
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

announceReady();

async function handleMessage({ text, files }) {
  const input = await findGeminiInput(8000);
  if (!input) throw new Error('Gemini input not found');

  // Upload files first
  if (files && files.length > 0) {
    for (const f of files) {
      const file = base64ToFile(f.data, f.name, f.type);
      const uploaded = await uploadFileViaInput(file, FILE_INPUT_SELECTORS);
      if (!uploaded) await uploadFileViaDrop(file, input);
      await sleep(300);
    }
    await sleep(500);
  }

  // Insert text and verify it actually appeared
  if (text) {
    await insertTextForGemini(input, text);
    await sleep(300);

    // Verify text was inserted
    const inserted = input.value || input.textContent || '';
    if (!inserted.trim()) {
      throw new Error('Gemini text insertion failed — input remains empty');
    }

    const sendBtn = await waitForSendButton(4000);
    if (sendBtn) {
      sendBtn.click();
    } else {
      input.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
        bubbles: true, cancelable: true
      }));
    }
  }
}
