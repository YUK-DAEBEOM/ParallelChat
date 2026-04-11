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

  loadCheckboxState();
  updatePanelVisibility();
  await loadSessions();
  setupWebNavigation();

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
    panel.classList.toggle('hidden', !state.activeKeys.includes(key));
  }
}

function loadCheckboxState() {
  for (const key of AI_ORDER) {
    const cb = document.getElementById(`chk-${key}`);
    if (cb) cb.checked = state.activeKeys.includes(key);
  }
}

// ===== Collapse/expand =====

function toggleCollapse() {
  state.collapsed = !state.collapsed;
  document.getElementById('panels-container').classList.toggle('collapsed', state.collapsed);
  document.getElementById('control-panel').classList.toggle('collapsed', state.collapsed);
  toggleBtn.innerHTML = state.collapsed ? '&#9650;' : '&#9660;';
}

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
  return new Date().toLocaleString('ko-KR', {
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
    alert('AI 페이지가 아직 로드되지 않았습니다. 잠시 후 다시 시도하세요.');
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
    alert('세션을 찾을 수 없습니다.');
    return;
  }

  state.activeKeys = session.activeKeys || [...AI_ORDER];
  loadCheckboxState();
  updatePanelVisibility();

  // Show loading feedback
  const bar = document.getElementById('sendFeedback');
  if (bar) { bar.textContent = `세션 로드 중: ${session.name}`; bar.style.opacity = '1'; }

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
      bar.textContent = `✓ 세션 "${session.name}" 로드 완료`;
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
    list.innerHTML = '<div class="sessions-empty">저장된 세션이 없습니다</div>';
    return;
  }

  sessions.forEach(s => {
    const keys = (s.activeKeys || []).map(k =>
      k === 'chatgpt' ? 'GPT' : k === 'gemini' ? 'Gem' : 'Cla'
    ).join(' + ');
    const date = new Date(s.timestamp).toLocaleString('ko-KR', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });

    const item = document.createElement('div');
    item.className = 'session-item';
    item.dataset.id = s.id;
    item.innerHTML = `
      <div class="session-item-info">
        <span class="session-item-name">${s.name}</span>
        <span class="session-item-meta">${date} · ${keys}</span>
      </div>
      <button class="session-item-delete" title="삭제">&#10005;</button>
    `;

    item.addEventListener('click', async (e) => {
      if (e.target.closest('.session-item-delete')) return;
      await loadSession(s.id);
      closeSidebarPanel();
    });

    item.querySelector('.session-item-delete').addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm(`"${s.name}" 세션을 삭제하시겠습니까?`)) return;
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
      alert(`${f.name} — 20MB 초과 파일은 첨부할 수 없습니다.`);
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
  sendBtn.textContent = 'Send All';
  input.value = '';
  input.style.height = 'auto';
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

// ===== Event listeners =====

sendBtn.addEventListener('click', sendMessage);

input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

// Auto-grow textarea (1 line min, 4 lines max)
input.addEventListener('input', () => {
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 96) + 'px';
});

toggleBtn.addEventListener('click', toggleCollapse);
relaunchBtn.addEventListener('click', () => reloadIframes(false));
newSessionBtn.addEventListener('click', () => reloadIframes(true));

AI_ORDER.forEach(key => {
  const cb = document.getElementById(`chk-${key}`);
  if (!cb) return;
  cb.addEventListener('change', () => {
    const active = AI_ORDER.filter(k => document.getElementById(`chk-${k}`)?.checked);
    if (active.length === 0) { cb.checked = true; return; }
    state.activeKeys = active;
    updatePanelVisibility();
  });
});

saveSidebarBtn.addEventListener('click', async () => {
  const session = await saveSession();
  if (session) await renderSidebarSessions();
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

// ===== Start =====

init();
