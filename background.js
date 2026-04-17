const VIEWER_URL = chrome.runtime.getURL('viewer/viewer.html');
const STORAGE_KEY_VIEWER_TAB = 'viewerTabId';

// --- declarativeNetRequest 규칙 등록 함수 ---

function setupRules() {
  chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [1, 2, 3, 4, 5],
    addRules: [
      {
        // 규칙 1: 확장이 직접 로드하는 AI 최상위 iframe만 허용
        id: 1,
        priority: 1,
        action: {
          type: 'modifyHeaders',
          responseHeaders: [
            { header: 'X-Frame-Options', operation: 'remove' },
            { header: 'Content-Security-Policy', operation: 'remove' }
          ]
        },
        condition: {
          initiatorDomains: [chrome.runtime.id],
          regexFilter: '^https://(?:chatgpt\\.com|chat\\.openai\\.com|gemini\\.google\\.com|claude\\.ai)/',
          resourceTypes: ['sub_frame']
        }
      },
      {
        // 규칙 2: 임베드된 Claude 페이지가 여는 인증용 하위 iframe만 허용
        id: 2,
        priority: 2,
        action: {
          type: 'modifyHeaders',
          responseHeaders: [
            { header: 'X-Frame-Options', operation: 'remove' },
            { header: 'Content-Security-Policy', operation: 'remove' }
          ]
        },
        condition: {
          initiatorDomains: ['claude.ai'],
          urlFilter: '||a.claude.ai^',
          resourceTypes: ['sub_frame']
        }
      },
      {
        // 규칙 3: 임베드된 Gemini 페이지가 여는 쿠키 갱신 iframe만 허용
        id: 3,
        priority: 2,
        action: {
          type: 'modifyHeaders',
          responseHeaders: [
            { header: 'X-Frame-Options', operation: 'remove' },
            { header: 'Content-Security-Policy', operation: 'remove' }
          ]
        },
        condition: {
          initiatorDomains: ['gemini.google.com'],
          urlFilter: '||accounts.google.com^',
          resourceTypes: ['sub_frame']
        }
      }
    ]
  });
}

chrome.runtime.onInstalled.addListener(setupRules);
chrome.runtime.onStartup.addListener(setupRules);

// --- Icon click: open or focus the viewer tab ---

chrome.action.onClicked.addListener(async () => {
  const { [STORAGE_KEY_VIEWER_TAB]: savedTabId } = await chrome.storage.session.get(STORAGE_KEY_VIEWER_TAB);

  if (savedTabId) {
    try {
      const tab = await chrome.tabs.get(savedTabId);
      await chrome.tabs.update(tab.id, { active: true });
      await chrome.windows.update(tab.windowId, { focused: true });
      return;
    } catch (e) {
      // Tab no longer exists
    }
  }

  const tab = await chrome.tabs.create({ url: VIEWER_URL });
  await chrome.storage.session.set({ [STORAGE_KEY_VIEWER_TAB]: tab.id });
});

// --- Clean up stored tab ID when viewer tab is closed ---

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const { [STORAGE_KEY_VIEWER_TAB]: savedTabId } = await chrome.storage.session.get(STORAGE_KEY_VIEWER_TAB);
  if (tabId === savedTabId) {
    await chrome.storage.session.remove(STORAGE_KEY_VIEWER_TAB);
  }
});
