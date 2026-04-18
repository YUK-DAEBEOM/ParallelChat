// --- Shared utilities for all content scripts ---

// Respond to title requests from viewer.js
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type !== 'getTitle') return;
  const raw = document.title || '';
  // Strip trailing AI brand names (e.g. "My chat - ChatGPT" → "My chat")
  const clean = raw
    .replace(/\s*[-|–]\s*(ChatGPT|Gemini|Claude\.?ai?|Claude)\s*$/i, '')
    .trim();
  // Reject generic/empty titles (no real conversation yet)
  const isGeneric = /^(chatgpt|gemini|claude\.?ai?|claude|new chat|새 채팅|새 대화|new conversation)$/i.test(clean);
  sendResponse({ title: isGeneric ? '' : clean });
  return true;
});

function registerFrame(key) {
  try {
    chrome.runtime.sendMessage({ type: 'registerFrame', key });
  } catch (e) {
    // Extension context may not be ready yet; retry once
    setTimeout(() => {
      try { chrome.runtime.sendMessage({ type: 'registerFrame', key }); } catch (_) {}
    }, 500);
  }
}

// Notify viewer that this content script is ready to receive setTheme
function announceReady() {
  try {
    chrome.runtime.sendMessage({ type: 'themeReady' });
  } catch (_) {
    setTimeout(() => {
      try { chrome.runtime.sendMessage({ type: 'themeReady' }); } catch (_) {}
    }, 500);
  }
}

// Applies theme via `apply`, then watches html attrs for host-React overwrites
// and re-applies once (throttle 500ms). observerPaused suppresses feedback
// loops from our own mutations.
function createThemeApplicator({ apply, attributeFilter }) {
  let lastAppliedTheme = null;
  let observerPaused = false;
  let reapplyTimer = null;

  function applyTheme(theme) {
    observerPaused = true;
    apply(theme);
    lastAppliedTheme = theme;
    queueMicrotask(() => { observerPaused = false; });
  }

  new MutationObserver(() => {
    if (observerPaused || reapplyTimer || !lastAppliedTheme) return;
    reapplyTimer = setTimeout(() => {
      reapplyTimer = null;
      const currentlyDark = document.documentElement.classList.contains('dark');
      if (lastAppliedTheme === 'dark' && !currentlyDark) applyTheme('dark');
      else if (lastAppliedTheme === 'light' && currentlyDark) applyTheme('light');
    }, 500);
  }).observe(document.documentElement, { attributes: true, attributeFilter });

  return applyTheme;
}

function waitForElement(selectors, timeout = 5000) {
  return new Promise((resolve) => {
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) return resolve(el);
    }

    const observer = new MutationObserver(() => {
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el) {
          observer.disconnect();
          return resolve(el);
        }
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => { observer.disconnect(); resolve(null); }, timeout);
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function base64ToFile(b64, name, type) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new File([bytes], name, { type });
}

function insertTextIntoElement(el, text) {
  el.focus();

  if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype, 'value'
    ).set;
    setter.call(el, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  } else {
    // contenteditable / ProseMirror
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(el);
    sel.removeAllRanges();
    sel.addRange(range);
    document.execCommand('insertText', false, text);
  }
}

function clickSendButton(selectors, inputEl) {
  for (const sel of selectors) {
    const btn = document.querySelector(sel);
    if (btn && !btn.disabled) {
      btn.click();
      return true;
    }
  }
  // Fallback: Enter key
  inputEl.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true
  }));
  return false;
}

async function uploadFileViaInput(file, fileInputSelectors) {
  for (const sel of fileInputSelectors) {
    const fileInput = document.querySelector(sel);
    if (fileInput) {
      const dt = new DataTransfer();
      dt.items.add(file);
      fileInput.files = dt.files;
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
  }
  return false;
}

async function uploadFileViaDrop(file, dropTarget) {
  if (!dropTarget) return false;

  const dt = new DataTransfer();
  dt.items.add(file);

  dropTarget.dispatchEvent(new DragEvent('dragenter', {
    bubbles: true, cancelable: true, dataTransfer: dt
  }));
  dropTarget.dispatchEvent(new DragEvent('dragover', {
    bubbles: true, cancelable: true, dataTransfer: dt
  }));
  dropTarget.dispatchEvent(new DragEvent('drop', {
    bubbles: true, cancelable: true, dataTransfer: dt
  }));

  return true;
}
