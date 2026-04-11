// viewer.js — single-window layout main logic

const AI_ORDER = ['chatgpt', 'gemini', 'claude'];
const AI_DEFAULTS = {
  chatgpt: 'https://chatgpt.com/',
  gemini: 'https://gemini.google.com/app',
  claude: 'https://claude.ai/'
};

const state = {
  tabId: null,
  frames: {},      // { chatgpt: { frameId, url }, ... }
  activeKeys: ['chatgpt', 'gemini', 'claude'],
  collapsed: false,
  selectedFiles: []
};

// Queue for registerFrame messages that arrive before state.tabId is set
let pendingRegistrations = [];

// ===== i18n =====

const STRINGS = {
  ko: {
    saveSidebar:       '+ 현재 세션 저장',
    placeholder:       '메시지를 입력하면 선택된 AI에 동시 전송됩니다...',
    fileBtn:           '📎 파일',
    dragOverlay:       '파일을 여기에 놓으세요',
    sessionsEmpty:     '저장된 세션이 없습니다',
    langBtn:           'EN',
    sessionNotFound:   '세션을 찾을 수 없습니다.',
    noPageLoaded:      'AI 페이지가 아직 로드되지 않았습니다. 잠시 후 다시 시도하세요.',
    sessionLoading:    name => `세션 로드 중: ${name}`,
    sessionLoaded:     name => `✓ 세션 "${name}" 로드 완료`,
    deleteConfirm:     name => `"${name}" 세션을 삭제하시겠습니까?`,
    fileTooLarge:      name => `${name} — 20MB 초과 파일은 첨부할 수 없습니다.`,
  },
  en: {
    saveSidebar:       '+ Save Session',
    placeholder:       'Type a message to send to all selected AIs...',
    fileBtn:           '📎 File',
    dragOverlay:       'Drop files here',
    sessionsEmpty:     'No saved sessions',
    langBtn:           'KO',
    sessionNotFound:   'Session not found.',
    noPageLoaded:      'AI pages not loaded yet. Please try again.',
    sessionLoading:    name => `Loading: ${name}`,
    sessionLoaded:     name => `✓ Loaded "${name}"`,
    deleteConfirm:     name => `Delete session "${name}"?`,
    fileTooLarge:      name => `${name} — File exceeds the 20 MB limit.`,
  }
};

let currentLang = 'ko';

function t(key, ...args) {
  const val = STRINGS[currentLang][key];
  return typeof val === 'function' ? val(...args) : val;
}

function applyLang(lang) {
  currentLang = lang;
  saveSidebarBtn.textContent = t('saveSidebar');
  input.placeholder = t('placeholder');
  attachBtn.textContent = t('fileBtn');
  document.querySelector('.drag-overlay').textContent = t('dragOverlay');
  langBtn.textContent = t('langBtn');
  renderSidebarSessions();
  chrome.storage.local.set({ lang });
}

// ===== Init =====

async function init() {
  const tabInfo = await chrome.tabs.getCurrent();
  state.tabId = tabInfo.id;

  // Flush any registerFrame messages that arrived before tabId was ready
  for (const { msg, sender } of pendingRegistrations) {
    if (sender.tab?.id === state.tabId && sender.frameId) {
      state.frames[msg.key] = { frameId: sender.frameId, url: sender.url || AI_DEFAULTS[msg.key] };
    }
  }
  pendingRegistrations = [];

  // Also discover existing iframe frames via webNavigation API (most reliable)
  await discoverFrames();

  updatePanelVisibility();
  await loadSessions();
  setupWebNavigation();

  // Restore saved language preference
  const { lang = 'ko' } = await chrome.storage.local.get('lang');
  applyLang(lang);

  input.focus();
}

// ===== Frame registration from content scripts =====

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type !== 'registerFrame' || !sender.frameId) return;

  if (state.tabId === null) {
    // tabId not ready yet — queue for processing in init()
    pendingRegistrations.push({ msg, sender });
    return;
  }

  if (sender.tab?.id === state.tabId) {
    state.frames[msg.key] = { frameId: sender.frameId, url: sender.url || AI_DEFAULTS[msg.key] };
  }
});

// ===== Frame discovery via getAllFrames (authoritative source) =====

async function discoverFrames() {
  if (!state.tabId) return;
  try {
    const frames = await chrome.webNavigation.getAllFrames({ tabId: state.tabId });
    for (const frame of frames) {
      // Only consider direct children of viewer.html (parentFrameId === 0).
      // Gemini and other Google services load sub-iframes that also have
      // gemini.google.com URLs — those must NOT overwrite state.frames.
      if (frame.parentFrameId !== 0) continue;
      for (const [key, defaultUrl] of Object.entries(AI_DEFAULTS)) {
        if (frame.url.startsWith(new URL(defaultUrl).origin)) {
          state.frames[key] = { frameId: frame.frameId, url: frame.url };
          break;
        }
      }
    }
  } catch (e) {
    // may fail if tab is not ready yet
  }
}

// ===== URL tracking via webNavigation =====

let autoSaveTimer = null;
function debouncedAutoSave() {
  clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(autoSaveUrls, 1000);
}

function setupWebNavigation() {
  chrome.webNavigation.onCommitted.addListener((details) => {
    if (details.tabId !== state.tabId || details.frameId === 0) return;
    // Ignore sub-frames nested inside Gemini/ChatGPT/Claude pages.
    // Only direct children of viewer.html have parentFrameId === 0.
    if (details.parentFrameId !== 0) return;

    // Update state.frames by frameId match
    for (const [key, frame] of Object.entries(state.frames)) {
      if (frame.frameId === details.frameId) {
        state.frames[key].url = details.url;
        debouncedAutoSave();
        return;
      }
    }

    // Frame not registered yet — try to identify it by URL origin
    for (const [key, defaultUrl] of Object.entries(AI_DEFAULTS)) {
      if (details.url.startsWith(new URL(defaultUrl).origin)) {
        state.frames[key] = { frameId: details.frameId, url: details.url };
        debouncedAutoSave();
        break;
      }
    }
  });
}

// Use getAllFrames as the authoritative URL source (avoids stale state.frames issue)
async function autoSaveUrls() {
  if (!state.tabId) return;
  const urls = {};

  try {
    const frames = await chrome.webNavigation.getAllFrames({ tabId: state.tabId });
    for (const frame of frames) {
      // Only direct children of viewer.html
      if (frame.parentFrameId !== 0) continue;
      for (const [key, defaultUrl] of Object.entries(AI_DEFAULTS)) {
        if (frame.url.startsWith(new URL(defaultUrl).origin)) {
          urls[key] = frame.url;
          // Also keep state.frames in sync
          if (state.frames[key]) state.frames[key].url = frame.url;
          break;
        }
      }
    }
  } catch (e) {
    // Fallback: use state.frames
    for (const key of AI_ORDER) {
      if (state.frames[key]?.url) urls[key] = state.frames[key].url;
    }
  }

  if (Object.keys(urls).length > 0) {
    await chrome.storage.local.set({ lastUrls: urls });
  }
}

// ===== Send All =====

async function sendToAll(text, files, targets) {
  // Refresh frame discovery before sending (handles post-reload state)
  await discoverFrames();

  const keys = targets || state.activeKeys;
  const results = {};

  await Promise.all(keys.map(async (key) => {
    const frame = state.frames[key];
    if (!frame) { results[key] = { error: 'frame not registered' }; return; }
    try {
      const res = await chrome.tabs.sendMessage(
        state.tabId,
        { type: 'inputText', text, files },
        { frameId: frame.frameId }
      );
      results[key] = res || 'ok';
    } catch (err) {
      results[key] = { error: err.message };
    }
  }));

  return results;
}

// ===== Layout: show/hide panels =====

function updatePanelVisibility() {
  for (const key of AI_ORDER) {
    const panel = document.getElementById(`panel-${key}`);
    if (!panel) continue;
    panel.classList.toggle('disabled', !state.activeKeys.includes(key));
  }
  updateSendButton();
}

const AI_LABEL = { chatgpt: 'GPT', gemini: 'Gem', claude: 'Cla' };

function updateSendButton() {
  if (sendBtn.disabled) return;
  if (state.activeKeys.length === 3) {
    sendBtn.innerHTML = '&#9650; Send All';
  } else {
    const names = state.activeKeys.map(k => AI_LABEL[k]).join(' · ');
    sendBtn.innerHTML = `&#9650; ${names}`;
  }
}


// ===== Collapse/expand =====

let controlHeight = 130; // px, user-adjustable

function toggleCollapse() {
  state.collapsed = !state.collapsed;
  const cp = document.getElementById('control-panel');
  cp.classList.toggle('collapsed', state.collapsed);
  if (!state.collapsed) cp.style.height = controlHeight + 'px';
  toggleBtn.innerHTML = state.collapsed ? '&#9650;' : '&#9660;';
}

// ===== Control panel vertical resize =====

(function initControlResize() {
  const resizer = document.getElementById('control-resizer');
  const cp      = document.getElementById('control-panel');
  if (!resizer || !cp) return;

  // Set initial height
  cp.style.height = controlHeight + 'px';

  let drag = null;

  resizer.addEventListener('mousedown', e => {
    if (state.collapsed) return;
    e.preventDefault();
    drag = { startY: e.clientY, startH: cp.offsetHeight };
    resizer.classList.add('dragging');
    document.body.classList.add('resizing-v');
  });

  document.addEventListener('mousemove', e => {
    if (!drag) return;
    const delta  = drag.startY - e.clientY; // drag up = taller
    controlHeight = Math.max(60, Math.min(500, drag.startH + delta));
    cp.style.height = controlHeight + 'px';
  });

  document.addEventListener('mouseup', () => {
    if (!drag) return;
    resizer.classList.remove('dragging');
    document.body.classList.remove('resizing-v');
    drag = null;
  });
})();

// ===== Reload iframes =====

async function reloadIframes(forceNew = false) {
  let urls;
  if (forceNew) {
    urls = { ...AI_DEFAULTS };
    await chrome.storage.local.remove('lastUrls');
  } else {
    const { lastUrls = {} } = await chrome.storage.local.get('lastUrls');
    urls = { ...AI_DEFAULTS, ...lastUrls };
  }

  // Do NOT clear state.frames — frameIds remain the same when an iframe navigates.
  // Content scripts will re-register on load, updating the entries.
  for (const key of AI_ORDER) {
    const iframe = document.getElementById(`iframe-${key}`);
    if (iframe) iframe.src = urls[key] || AI_DEFAULTS[key];
  }
}

// ===== Session management =====

async function getSessions() {
  const { sessions = [] } = await chrome.storage.local.get('sessions');
  return sessions;
}

function autoSessionName() {
  const locale = currentLang === 'ko' ? 'ko-KR' : 'en-US';
  return new Date().toLocaleString(locale, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
  });
}

// Ask each active iframe for its current conversation title
async function getSessionTitle() {
  await discoverFrames();
  for (const key of state.activeKeys) {
    const frame = state.frames[key];
    if (!frame) continue;
    try {
      const res = await chrome.tabs.sendMessage(
        state.tabId,
        { type: 'getTitle' },
        { frameId: frame.frameId }
      );
      if (res?.title) return res.title;
    } catch (_) {}
  }
  return null;
}

async function saveSession(name) {
  // autoSaveUrls uses getAllFrames — most reliable source of current URLs
  await autoSaveUrls();
  const { lastUrls = {} } = await chrome.storage.local.get('lastUrls');

  if (Object.keys(lastUrls).length === 0) {
    alert(t('noPageLoaded'));
    return null;
  }

  const sessionName = name || await getSessionTitle() || autoSessionName();
  const session = {
    id: Date.now(),
    name: sessionName,
    timestamp: Date.now(),
    urls: { ...lastUrls },
    activeKeys: [...state.activeKeys]
  };

  const sessions = await getSessions();
  sessions.unshift(session);
  if (sessions.length > 20) sessions.length = 20;
  await chrome.storage.local.set({ sessions });
  return session;
}

async function deleteSession(id) {
  let sessions = await getSessions();
  sessions = sessions.filter(s => s.id !== id);
  await chrome.storage.local.set({ sessions });
}

async function loadSession(id) {
  const sessions = await getSessions();
  const session = sessions.find(s => s.id === id);
  if (!session) {
    alert(t('sessionNotFound'));
    return;
  }

  state.activeKeys = session.activeKeys || [...AI_ORDER];
  updatePanelVisibility();

  // Show loading feedback
  const bar = document.getElementById('sendFeedback');
  if (bar) { bar.textContent = t('sessionLoading', session.name); bar.style.opacity = '1'; }

  // Force iframe navigation (blank first ensures reload even if URL is identical)
  for (const key of AI_ORDER) {
    const iframe = document.getElementById(`iframe-${key}`);
    if (!iframe) continue;
    const url = session.urls[key] || AI_DEFAULTS[key];
    iframe.src = 'about:blank';
    // Small delay prevents race with blank page
    await new Promise(r => setTimeout(r, 30));
    iframe.src = url;
  }

  // Confirm to user
  if (bar) {
    setTimeout(() => {
      bar.textContent = t('sessionLoaded', session.name);
      setTimeout(() => { bar.style.opacity = '0'; }, 2500);
    }, 500);
  }
}

async function loadSessions() {
  await renderSidebarSessions();
}

// Auto-save: fires after each send, saves only if a new conversation URL is detected
async function autoSaveIfNew() {
  await new Promise(r => setTimeout(r, 2500)); // wait for URL to update

  const urls = {};
  try {
    const frames = await chrome.webNavigation.getAllFrames({ tabId: state.tabId });
    for (const frame of frames) {
      if (frame.parentFrameId !== 0) continue;
      for (const [key, defaultUrl] of Object.entries(AI_DEFAULTS)) {
        if (frame.url.startsWith(new URL(defaultUrl).origin)) {
          urls[key] = frame.url;
          break;
        }
      }
    }
  } catch { return; }

  // Only save if at least one iframe has a real conversation URL (non-root path)
  const hasConvo = Object.values(urls).some(url => {
    try { return new URL(url).pathname.replace(/\/$/, '').length > 1; } catch { return false; }
  });
  if (!hasConvo) return;

  // Skip if this URL set is already saved
  const sessions = await getSessions();
  const alreadySaved = sessions.some(s =>
    Object.entries(urls).some(([k, url]) => s.urls?.[k] === url)
  );
  if (alreadySaved) return;

  await saveSession();
  await renderSidebarSessions();
}

async function renderSidebarSessions() {
  const sessions = await getSessions();
  const list = document.getElementById('sessionsList');
  if (!list) return;

  list.innerHTML = '';

  if (sessions.length === 0) {
    list.innerHTML = `<div class="sessions-empty">${t('sessionsEmpty')}</div>`;
    return;
  }

  const locale = currentLang === 'ko' ? 'ko-KR' : 'en-US';
  sessions.forEach(s => {
    const AI_DOT_COLOR = { chatgpt: '#10a37f', gemini: '#4285f4', claude: '#d97706' };
    const dots = (s.activeKeys || []).map(k =>
      `<span class="session-ai-dot" style="background:${AI_DOT_COLOR[k] || '#888'}"></span>`
    ).join('');
    const date = new Date(s.timestamp).toLocaleString(locale, {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });

    const item = document.createElement('div');
    item.className = 'session-item';
    item.dataset.id = s.id;
    item.innerHTML = `
      <div class="session-item-info">
        <span class="session-item-name">${s.name}</span>
        <span class="session-item-meta"><span class="session-ai-dots">${dots}</span>${date}</span>
      </div>
      <button class="session-item-delete" title="&#10005;">&#10005;</button>
    `;

    item.addEventListener('click', async (e) => {
      if (e.target.closest('.session-item-delete')) return;
      await loadSession(s.id);
    });

    item.querySelector('.session-item-delete').addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm(t('deleteConfirm', s.name))) return;
      await deleteSession(s.id);
      await renderSidebarSessions();
    });

    list.appendChild(item);
  });
}

// ===== File handling =====

function addFiles(files) {
  for (const f of files) {
    if (f.size > 20 * 1024 * 1024) {
      alert(t('fileTooLarge', f.name));
      continue;
    }
    state.selectedFiles.push(f);
  }
  renderFileList();
}

function removeFile(index) {
  state.selectedFiles.splice(index, 1);
  renderFileList();
}

function renderFileList() {
  fileList.innerHTML = '';
  state.selectedFiles.forEach((f, i) => {
    const chip = document.createElement('span');
    chip.className = 'file-chip';
    const name = f.name.length > 20 ? f.name.slice(0, 18) + '...' : f.name;
    const size = f.size < 1024 ? `${f.size}B`
      : f.size < 1024 * 1024 ? `${(f.size / 1024).toFixed(0)}KB`
      : `${(f.size / 1024 / 1024).toFixed(1)}MB`;
    chip.innerHTML = `${name} (${size}) <span class="remove" data-idx="${i}">&times;</span>`;
    fileList.appendChild(chip);
  });
  fileList.querySelectorAll('.remove').forEach(el => {
    el.addEventListener('click', () => removeFile(Number(el.dataset.idx)));
  });
}

async function encodeFiles() {
  return Promise.all(state.selectedFiles.map(f => new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = () => resolve({
      name: f.name, type: f.type, size: f.size,
      data: reader.result.split(',')[1]
    });
    reader.readAsDataURL(f);
  })));
}

// ===== Send message =====

async function sendMessage() {
  const text = input.value.trim();
  if (!text && state.selectedFiles.length === 0) return;

  const targets = state.activeKeys;
  if (targets.length === 0) return;

  sendBtn.disabled = true;
  sendBtn.textContent = 'Sending...';

  const files = await encodeFiles();
  const results = await sendToAll(text, files, targets);
  console.log('Send results:', results);

  sendBtn.disabled = false;
  updateSendButton();
  input.value = '';
  state.selectedFiles = [];
  renderFileList();
  showSendFeedback(results);
  autoSaveIfNew(); // fire-and-forget: auto-save if new conversation detected
  input.focus();
}

// ===== Send feedback (shows which AIs succeeded / failed) =====

let feedbackTimer = null;
function showSendFeedback(results) {
  const bar = document.getElementById('sendFeedback');
  if (!bar) return;

  const parts = Object.entries(results).map(([key, val]) => {
    const label = key === 'chatgpt' ? 'GPT' : key === 'gemini' ? 'Gemini' : 'Claude';
    const ok = !val?.error;
    return `<span style="color:${ok ? '#10a37f' : '#ff6b6b'}">${label}${ok ? ' ✓' : ' ✗'}</span>`;
  });

  bar.innerHTML = parts.join('  ');
  bar.style.opacity = '1';

  clearTimeout(feedbackTimer);
  feedbackTimer = setTimeout(() => { bar.style.opacity = '0'; }, 5000);
}

// ===== DOM Elements =====

const input = document.getElementById('input');
const sendBtn = document.getElementById('sendBtn');
const relaunchBtn = document.getElementById('relaunchBtn');
const newSessionBtn = document.getElementById('newSessionBtn');
const toggleBtn = document.getElementById('toggleBtn');
const attachBtn = document.getElementById('attachBtn');
const fileInput = document.getElementById('fileInput');
const fileList = document.getElementById('fileList');
const saveSidebarBtn = document.getElementById('saveSidebarBtn');
const themeBtn = document.getElementById('themeBtn');
const langBtn = document.getElementById('langBtn');

// ===== Event listeners =====

sendBtn.addEventListener('click', sendMessage);

input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

// textarea는 flex: 1 로 컨테이너를 채우므로 auto-grow 불필요

toggleBtn.addEventListener('click', toggleCollapse);
relaunchBtn.addEventListener('click', () => reloadIframes(false));
newSessionBtn.addEventListener('click', () => reloadIframes(true));

// Panel header click = toggle that AI on/off
AI_ORDER.forEach(key => {
  const header = document.querySelector(`#panel-${key} .panel-header`);
  if (!header) return;
  header.addEventListener('click', (e) => {
    if (e.target.closest('.panel-reload-btn')) return;
    const isActive = state.activeKeys.includes(key);
    if (isActive && state.activeKeys.length === 1) return; // 최소 1개는 유지
    if (isActive) {
      state.activeKeys = state.activeKeys.filter(k => k !== key);
    } else {
      state.activeKeys = [...state.activeKeys, key]
        .sort((a, b) => AI_ORDER.indexOf(a) - AI_ORDER.indexOf(b));
    }
    updatePanelVisibility();
  });
});

// ===== Language toggle =====

langBtn.addEventListener('click', () => {
  applyLang(currentLang === 'ko' ? 'en' : 'ko');
});

// ===== Theme toggle =====

let currentTheme = 'light';

themeBtn.addEventListener('click', async () => {
  currentTheme = currentTheme === 'light' ? 'dark' : 'light';
  const isDark = currentTheme === 'dark';

  // Toggle extension UI
  document.body.classList.toggle('dark', isDark);
  themeBtn.textContent = isDark ? '🌙 Dark' : '☀️ Light';

  // Toggle all AI service iframes
  await discoverFrames();
  for (const key of AI_ORDER) {
    const frame = state.frames[key];
    if (!frame) continue;
    chrome.tabs.sendMessage(state.tabId, { type: 'setTheme', theme: currentTheme }, { frameId: frame.frameId })
      .catch(() => {});
  }
});

saveSidebarBtn.addEventListener('click', async () => {
  const session = await saveSession();
  if (session) await renderSidebarSessions();
});

// Per-panel reload buttons
document.querySelectorAll('.panel-reload-btn').forEach(btn => {
  btn.addEventListener('click', async () => {
    const key = btn.dataset.key;
    const iframe = document.getElementById(`iframe-${key}`);
    if (!iframe) return;
    const { lastUrls = {} } = await chrome.storage.local.get('lastUrls');
    iframe.src = lastUrls[key] || AI_DEFAULTS[key];
  });
});

attachBtn.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', (e) => {
  addFiles(Array.from(e.target.files));
  fileInput.value = '';
});

document.addEventListener('dragover', (e) => {
  e.preventDefault();
  document.body.classList.add('dragging');
});

document.addEventListener('dragleave', (e) => {
  if (!e.relatedTarget) document.body.classList.remove('dragging');
});

document.addEventListener('drop', (e) => {
  e.preventDefault();
  document.body.classList.remove('dragging');
  if (e.dataTransfer.files.length) addFiles(Array.from(e.dataTransfer.files));
});

// ===== Panel resize =====

(function initResize() {
  let drag = null;

  document.querySelectorAll('.panel-divider').forEach(divider => {
    divider.addEventListener('mousedown', e => {
      e.preventDefault();
      const leftKey  = divider.dataset.left;
      const rightKey = divider.dataset.right;
      const leftPanel  = document.getElementById(`panel-${leftKey}`);
      const rightPanel = document.getElementById(`panel-${rightKey}`);
      if (!leftPanel || !rightPanel) return;

      // Skip if either adjacent panel is disabled (collapsed)
      if (leftPanel.classList.contains('disabled') || rightPanel.classList.contains('disabled')) return;

      drag = {
        divider,
        leftPanel, rightPanel,
        startX: e.clientX,
        startLeftW:  leftPanel.offsetWidth,
        startRightW: rightPanel.offsetWidth,
      };

      divider.classList.add('dragging');
      document.body.classList.add('resizing');
    });
  });

  document.addEventListener('mousemove', e => {
    if (!drag) return;
    const delta = e.clientX - drag.startX;
    const newLeft  = Math.max(120, drag.startLeftW  + delta);
    const newRight = Math.max(120, drag.startRightW - delta);
    drag.leftPanel.style.flex  = `0 0 ${newLeft}px`;
    drag.rightPanel.style.flex = `0 0 ${newRight}px`;
  });

  document.addEventListener('mouseup', () => {
    if (!drag) return;
    drag.divider.classList.remove('dragging');
    document.body.classList.remove('resizing');
    drag = null;
  });
})();

// ===== Start =====

init();
