// viewer.js — single-window layout main logic

const AI_ORDER = ['chatgpt', 'gemini', 'claude'];
const AI_DEFAULTS = {
  chatgpt: 'https://chatgpt.com/',
  gemini: 'https://gemini.google.com/app',
  claude: 'https://claude.ai/new'
};
const AI_INFO = {
  chatgpt: { name: 'ChatGPT', icon: '🤖', url: 'https://chatgpt.com/' },
  gemini:  { name: 'Gemini',  icon: '✨', url: 'https://gemini.google.com/app' },
  claude:  { name: 'Claude',  icon: '🔶', url: 'https://claude.ai/new' },
};

// Claude URL에서 incognito 파라미터를 제거해 "임시 채팅" 기본 진입을 차단
function stripClaudeIncognito(url) {
  if (!url || !url.includes('claude.ai')) return url;
  try {
    const u = new URL(url);
    if (u.searchParams.has('incognito')) u.searchParams.delete('incognito');
    // 빈 쿼리 제거로 깔끔하게
    const qs = u.searchParams.toString();
    return u.origin + u.pathname + (qs ? ('?' + qs) : '') + u.hash;
  } catch { return url; }
}

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
    saveSidebar:        '+ 현재 세션 저장',
    placeholder:        '메시지를 입력하면 선택된 AI에 동시 전송됩니다...',
    fileBtn:            '📎 파일',
    dragOverlay:        '파일을 여기에 놓으세요',
    sessionsEmpty:      '저장된 세션이 없습니다',
    langBtn:            'EN',
    sessionNotFound:    '세션을 찾을 수 없습니다.',
    noPageLoaded:       'AI 페이지가 아직 로드되지 않았습니다. 잠시 후 다시 시도하세요.',
    sessionLoading:     name => `세션 로드 중: ${name}`,
    sessionLoaded:      name => `✓ 세션 "${name}" 로드 완료`,
    deleteConfirm:      name => `"${name}" 세션을 삭제하시겠습니까?`,
    fileTooLarge:       name => `${name} — 20MB 초과 파일은 첨부할 수 없습니다.`,
    onboardingStep1:    '먼저 로그인하세요',
    onboardingStep2:    '입력하고 Send All 클릭',
    onboardingGoBtn:    name => `${name} 사이트로 이동`,
    clickToHide:        '클릭하여 끄기',
    clickToShow:        '클릭하여 켜기',
  },
  en: {
    saveSidebar:        '+ Save Session',
    placeholder:        'Type a message to send to all selected AIs...',
    fileBtn:            '📎 File',
    dragOverlay:        'Drop files here',
    sessionsEmpty:      'No saved sessions',
    langBtn:            'KO',
    sessionNotFound:    'Session not found.',
    noPageLoaded:       'AI pages not loaded yet. Please try again.',
    sessionLoading:     name => `Loading: ${name}`,
    sessionLoaded:      name => `✓ Loaded "${name}"`,
    deleteConfirm:      name => `Delete session "${name}"?`,
    fileTooLarge:       name => `${name} — File exceeds the 20 MB limit.`,
    onboardingStep1:    'Sign in first',
    onboardingStep2:    'Type and click Send All',
    onboardingGoBtn:    name => `Go to ${name}`,
    clickToHide:        'Click to hide',
    clickToShow:        'Click to show',
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
  updateOnboardingText();
  updatePanelToggleHints();
  chrome.storage.local.set({ lang });
}

// ===== Onboarding =====

// 각 AI의 로그인 페이지 URL 패턴
const LOGIN_URL_PATTERNS = {
  chatgpt: ['auth.openai.com', 'chatgpt.com/auth', 'openai.com/account'],
  gemini:  ['accounts.google.com'],
  claude:  ['claude.ai/login', 'auth.claude.ai', 'claude.ai/upgrade'],
};

function isLoginUrl(key, url) {
  return LOGIN_URL_PATTERNS[key]?.some(p => url.includes(p)) ?? false;
}

function showOnboarding(key) {
  const overlay = document.getElementById(`onboarding-${key}`);
  if (overlay) overlay.classList.add('visible');
}

function hideOnboarding(key) {
  const overlay = document.getElementById(`onboarding-${key}`);
  if (overlay) overlay.classList.remove('visible');
}

async function initOnboarding() {
  // 닫기 / 링크 버튼 이벤트만 등록 — 기본은 숨김 상태
  for (const key of AI_ORDER) {
    const overlay = document.getElementById(`onboarding-${key}`);
    if (!overlay) continue;

    overlay.querySelector('.onboarding-close').addEventListener('click', () => {
      hideOnboarding(key);
    });

    overlay.querySelector('.onboarding-link-btn').addEventListener('click', () => {
      chrome.tabs.create({ url: AI_INFO[key].url });
    });
  }

  updateOnboardingText();

  // 초기 로드된 iframe URL 확인 — 이미 로그인 페이지면 즉시 오버레이 표시
  if (!state.tabId) return;
  try {
    const frames = await chrome.webNavigation.getAllFrames({ tabId: state.tabId });
    for (const frame of frames) {
      if (frame.parentFrameId !== 0) continue;
      for (const key of AI_ORDER) {
        if (isLoginUrl(key, frame.url)) showOnboarding(key);
      }
    }
  } catch (_) {}
}

function updateOnboardingText() {
  for (const key of AI_ORDER) {
    const overlay = document.getElementById(`onboarding-${key}`);
    if (!overlay) continue;
    const steps = overlay.querySelectorAll('.onboarding-steps li');
    if (steps[0]) steps[0].textContent = t('onboardingStep1');
    if (steps[1]) steps[1].textContent = t('onboardingStep2');
    const linkBtn = overlay.querySelector('.onboarding-link-btn');
    if (linkBtn) linkBtn.textContent = t('onboardingGoBtn', AI_INFO[key].name);
  }
}

function dismissOnboarding() {
  document.querySelectorAll('.panel-onboarding').forEach(el => el.classList.remove('visible'));
}

// ===== Init =====

async function loadPersistedState() {
  const { activeKeys, controlHeight: savedHeight, theme, panelOrder } =
    await chrome.storage.local.get(['activeKeys', 'controlHeight', 'theme', 'panelOrder']);

  if (activeKeys) state.activeKeys = activeKeys;

  if (savedHeight) {
    controlHeight = savedHeight;
    const cp = document.getElementById('control-panel');
    if (cp) cp.style.height = controlHeight + 'px';
  }

  if (theme === 'dark') {
    currentTheme = 'dark';
    document.body.classList.add('dark');
    themeBtn.textContent = '🌙 Dark';
  }

  // 저장된 패널 순서 복원 (storage 재저장 없이 DOM만 재정렬)
  if (panelOrder && panelOrder.length === AI_ORDER.length) {
    applyPanelOrder(panelOrder);
  }
}

// ===== Panel reorder =====

function applyPanelOrder(newOrder) {
  const container = document.getElementById('panels-container');
  const dividers  = [...document.querySelectorAll('.panel-divider')];

  // 패널과 divider를 새 순서로 DOM 재배치
  newOrder.forEach((key, i) => {
    container.appendChild(document.getElementById(`panel-${key}`));
    if (i < newOrder.length - 1) {
      const d = dividers[i];
      d.dataset.left  = key;
      d.dataset.right = newOrder[i + 1];
      container.appendChild(d);
    }
  });

  // AI_ORDER를 제자리에서 갱신 (기존 참조 유지)
  AI_ORDER.splice(0, AI_ORDER.length, ...newOrder);

  // 너비 리셋 → 균등 분배
  document.querySelectorAll('.panel').forEach(p => { p.style.flex = ''; });
}

function reorderPanels(newOrder) {
  applyPanelOrder(newOrder);
  updatePanelVisibility();
  chrome.storage.local.set({ panelOrder: newOrder });
}

async function init() {
  const tabInfo = await chrome.tabs.getCurrent();
  state.tabId = tabInfo.id;

  // 저장된 상태 복원 (activeKeys, controlHeight, theme)
  await loadPersistedState();

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

  setupLoadingSpinners();
  await initOnboarding();
  initClaudeNotice();
  input.focus();
}

// Claude 패널 사이드바 안내 배너 — 닫으면 로컬 저장해 다시 표시 안함
async function initClaudeNotice() {
  const notice = document.getElementById('claude-notice');
  if (!notice) return;
  const { claudeNoticeDismissed } = await chrome.storage.local.get('claudeNoticeDismissed');
  if (claudeNoticeDismissed) {
    notice.classList.add('hidden');
    return;
  }
  const closeBtn = notice.querySelector('.claude-notice-close');
  closeBtn?.addEventListener('click', async () => {
    notice.classList.add('hidden');
    await chrome.storage.local.set({ claudeNoticeDismissed: true });
  });
}

// ===== Loading spinners =====

function setupLoadingSpinners() {
  for (const key of AI_ORDER) {
    const iframe  = document.getElementById(`iframe-${key}`);
    const spinner = document.getElementById(`loading-${key}`);
    if (!iframe || !spinner) continue;

    // iframe이 로드 완료되면 스피너 숨김
    iframe.addEventListener('load', () => {
      spinner.classList.add('done');
    });
  }
}

function showSpinner(key) {
  const spinner = document.getElementById(`loading-${key}`);
  if (spinner) spinner.classList.remove('done');
}

function showAllSpinners() {
  AI_ORDER.forEach(showSpinner);
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
        // 로그인 페이지 여부에 따라 오버레이 표시/숨김
        if (isLoginUrl(key, details.url)) {
          showOnboarding(key);
        } else {
          hideOnboarding(key);
        }
        return;
      }
    }

    // Frame not registered yet — try to identify it by URL origin
    for (const [key, defaultUrl] of Object.entries(AI_DEFAULTS)) {
      if (details.url.startsWith(new URL(defaultUrl).origin)) {
        state.frames[key] = { frameId: details.frameId, url: details.url };
        debouncedAutoSave();
        if (isLoginUrl(key, details.url)) showOnboarding(key);
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

function normalizeSessionUrls(urls = {}) {
  const normalized = {};
  for (const key of AI_ORDER) {
    normalized[key] = urls[key] || null;
  }
  return normalized;
}

function areSessionUrlsEqual(a = {}, b = {}) {
  const left = normalizeSessionUrls(a);
  const right = normalizeSessionUrls(b);
  return AI_ORDER.every(key => left[key] === right[key]);
}

function isConversationUrl(key, url) {
  try {
    const current = new URL(url);
    const fallback = new URL(AI_DEFAULTS[key]);
    return (
      current.origin === fallback.origin &&
      current.pathname.replace(/\/$/, '') !== fallback.pathname.replace(/\/$/, '')
    );
  } catch {
    return false;
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

    // 상단 토글 버튼 active 상태 동기화
    const toggleBtn = document.getElementById(`toggle-${key}`);
    if (toggleBtn) toggleBtn.classList.toggle('active', state.activeKeys.includes(key));
  }

  // 인접 패널 중 하나라도 비활성이면 divider 숨김 (disabled 패널이 자체 border로 구분)
  document.querySelectorAll('.panel-divider').forEach(divider => {
    const leftActive  = state.activeKeys.includes(divider.dataset.left);
    const rightActive = state.activeKeys.includes(divider.dataset.right);
    divider.classList.toggle('hidden', !leftActive || !rightActive);
  });

  updatePanelToggleHints();
  updateSendButton();
}

function togglePanel(key) {
  const isActive = state.activeKeys.includes(key);
  if (isActive && state.activeKeys.length === 1) return; // 최소 1개 유지
  if (isActive) {
    state.activeKeys = state.activeKeys.filter(k => k !== key);
  } else {
    state.activeKeys = [...state.activeKeys, key]
      .sort((a, b) => AI_ORDER.indexOf(a) - AI_ORDER.indexOf(b));
  }
  updatePanelVisibility();
  chrome.storage.local.set({ activeKeys: state.activeKeys });
}

function updatePanelToggleHints() {
  for (const key of AI_ORDER) {
    const header = document.getElementById(`panel-header-${key}`);
    const hint   = header?.querySelector('.panel-toggle-hint');
    if (!header || !hint) continue;
    const isActive = state.activeKeys.includes(key);
    header.title   = isActive ? t('clickToHide') : t('clickToShow');
    hint.textContent = isActive ? t('clickToHide') : t('clickToShow');
  }
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
    chrome.storage.local.set({ controlHeight });
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
    if (iframe) {
      showSpinner(key);
      let target = urls[key] || AI_DEFAULTS[key];
      if (key === 'claude') target = stripClaudeIncognito(target);
      iframe.src = target;
    }
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
  showAllSpinners();
  await chrome.storage.local.set({
    activeKeys: state.activeKeys,
    lastUrls: { ...session.urls }
  });

  // Show loading feedback
  const bar = document.getElementById('sendFeedback');
  if (bar) { bar.textContent = t('sessionLoading', session.name); bar.style.opacity = '1'; }

  // Force iframe navigation (blank first ensures reload even if URL is identical)
  for (const key of AI_ORDER) {
    const iframe = document.getElementById(`iframe-${key}`);
    if (!iframe) continue;
    let url = session.urls[key] || AI_DEFAULTS[key];
    if (key === 'claude') url = stripClaudeIncognito(url);
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

  // Only save if at least one iframe has navigated away from its default landing page
  const hasConvo = Object.entries(urls).some(([key, url]) => isConversationUrl(key, url));
  if (!hasConvo) return;

  // Skip only if the full saved URL set is identical
  const sessions = await getSessions();
  const alreadySaved = sessions.some(s => areSessionUrlsEqual(s.urls, urls));
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
      if (e.target.closest('.session-item-name')) return; // 이름 편집 클릭은 세션 로드 금지
      await loadSession(s.id);
    });

    // 세션 이름 클릭 → 인라인 편집
    const nameSpan = item.querySelector('.session-item-name');
    nameSpan.addEventListener('click', (e) => {
      e.stopPropagation();
      startEditingSessionName(nameSpan, s);
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

// ===== Session name inline editing =====

function startEditingSessionName(span, session) {
  const oldName = session.name;
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'session-name-input';
  input.value = oldName;
  span.replaceWith(input);
  input.focus();
  input.select();

  let saved = false;

  async function save() {
    if (saved) return;
    saved = true;
    const newName = input.value.trim() || oldName;
    const sessions = await getSessions();
    const idx = sessions.findIndex(s => s.id === session.id);
    if (idx !== -1) {
      sessions[idx].name = newName;
      await chrome.storage.local.set({ sessions });
    }
    await renderSidebarSessions();
  }

  input.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') { e.preventDefault(); await save(); }
    if (e.key === 'Escape') { saved = true; await renderSidebarSessions(); }
  });

  // blur는 삭제 버튼 mousedown 이후 발생 가능 — 짧은 지연으로 방지
  input.addEventListener('blur', () => setTimeout(save, 120));
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

  dismissOnboarding(); // 첫 전송 시 안내 오버레이 자동 닫기
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
    togglePanel(key);
  });

  // 상단 토글 버튼 클릭
  const topToggleBtn = document.getElementById(`toggle-${key}`);
  if (topToggleBtn) topToggleBtn.addEventListener('click', () => togglePanel(key));
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
  chrome.storage.local.set({ theme: currentTheme });

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
    let url = lastUrls[key] || AI_DEFAULTS[key];
    if (key === 'claude') url = stripClaudeIncognito(url);
    iframe.src = url;
  });
});

attachBtn.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', (e) => {
  addFiles(Array.from(e.target.files));
  fileInput.value = '';
});

document.addEventListener('dragover', (e) => {
  e.preventDefault();
  // 패널 재정렬 드래그(text/plain)일 때는 파일 드롭 오버레이 표시 안 함
  if ([...e.dataTransfer.types].includes('Files')) {
    document.body.classList.add('dragging');
  }
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

// ===== Panel drag-and-drop reorder =====

(function initPanelDragDrop() {
  let draggingKey = null;

  ['chatgpt', 'gemini', 'claude'].forEach(key => {
    const header = document.getElementById(`panel-header-${key}`);
    const panel  = document.getElementById(`panel-${key}`);
    if (!header || !panel) return;

    header.draggable = true;

    header.addEventListener('dragstart', (e) => {
      // 새로고침(↺) 버튼 위에서 드래그 시작하면 무시
      if (e.target.closest('.panel-reload-btn')) { e.preventDefault(); return; }
      draggingKey = key;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', key); // Firefox 호환 필수
      setTimeout(() => panel.classList.add('panel-dragging'), 0);
    });

    header.addEventListener('dragend', () => {
      document.querySelectorAll('.panel').forEach(p =>
        p.classList.remove('panel-dragging', 'panel-drag-over')
      );
      draggingKey = null;
    });

    panel.addEventListener('dragover', (e) => {
      if (!draggingKey || draggingKey === key) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      document.querySelectorAll('.panel').forEach(p => p.classList.remove('panel-drag-over'));
      panel.classList.add('panel-drag-over');
    });

    panel.addEventListener('dragleave', (e) => {
      if (!panel.contains(e.relatedTarget)) panel.classList.remove('panel-drag-over');
    });

    panel.addEventListener('drop', (e) => {
      e.preventDefault();
      panel.classList.remove('panel-drag-over');
      if (!draggingKey || draggingKey === key) return;

      const newOrder = [...AI_ORDER];
      const fi = newOrder.indexOf(draggingKey);
      const ti = newOrder.indexOf(key);
      [newOrder[fi], newOrder[ti]] = [newOrder[ti], newOrder[fi]];
      reorderPanels(newOrder);
    });
  });
})();

// ===== Start =====

init();
