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
    if (message.theme === 'dark') {
      html.classList.add('dark');
      html.style.colorScheme = 'dark';
      try { localStorage.setItem('theme', 'dark'); } catch (_) {}
    } else {
      html.classList.remove('dark');
      html.style.colorScheme = 'light';
      try { localStorage.setItem('theme', 'light'); } catch (_) {}
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
