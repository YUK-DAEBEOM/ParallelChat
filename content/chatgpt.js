// ChatGPT content script (shared.js loaded first)
registerFrame('chatgpt');

// Suppress ChatGPT's own sidebar — prevents layout shifts when typing in iframe
(function injectSidebarSuppressor() {
  const style = document.createElement('style');
  style.textContent = `
    nav { display: none !important; }
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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'inputText') {
    handleMessage(message)
      .then(() => sendResponse({ success: true }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
});

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
