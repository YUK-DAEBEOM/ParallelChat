const VIEWER_URL = chrome.runtime.getURL('viewer/viewer.html');
const STORAGE_KEY_VIEWER_TAB = 'viewerTabId';

// --- Install: set up dynamic declarativeNetRequest rules ---

chrome.runtime.onInstalled.addListener(() => {
  chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [1],
    addRules: [{
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
        resourceTypes: ['sub_frame']
      }
    }]
  });
});

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
