# Design: Extension Publish Ready

**Feature**: extension-publish-ready  
**Date**: 2026-04-11  
**Phase**: Design  
**Architecture**: Option C — Pragmatic Balance (기존 구조 최대한 유지)

---

## Context Anchor (from Plan)

| 항목 | 내용 |
|------|------|
| **WHY** | Chrome 웹 스토어 배포를 위해 품질·심사 요건 충족 |
| **WHO** | 신규 사용자, 재방문 사용자, 스토어 심사 담당자 |
| **RISK** | storage 복원 타이밍 이슈, 오버레이-iframe 충돌 |
| **SUCCESS** | 5가지 항목 모두 구현 + 기존 기능 회귀 없음 |
| **SCOPE** | viewer.js, viewer.html, viewer.css, privacy.html (신규) |

---

## 1. 아키텍처 개요

기존 단일 파일 구조(`viewer.js`) 유지. 각 기능을 명확히 분리된 섹션으로 추가.

```
viewer.js (수정)
  ├── [기존] state, i18n, init, sendToAll, ...
  ├── [추가 FR-01~03] loadPersistedState() — init() 최상단에서 호출
  ├── [수정 FR-04] updatePanelVisibility() — divider 처리 추가
  ├── [추가 FR-05] initOnboarding(), dismissOnboarding()
  └── [추가 FR-06] startEditingSessionName() + renderSidebarSessions() 수정

viewer.html (수정)
  ├── [추가 FR-05] .panel-onboarding div (각 패널 내)
  └── [추가 FR-07] Privacy Policy 링크 (control panel 하단)

viewer.css (수정)
  ├── [추가 FR-04] .panel-divider.hidden
  ├── [추가 FR-05] .panel-onboarding 오버레이 스타일
  ├── [추가 FR-06] .session-name-input 스타일
  └── [추가 FR-07] .privacy-link 스타일

viewer/privacy.html (신규)
  └── Privacy Policy 페이지
```

---

## 2. 상태 영속성 설계 (FR-01~03)

### 2.1 저장 키 정의

| 키 | 타입 | 기본값 | 저장 시점 |
|----|------|--------|---------|
| `activeKeys` | `string[]` | `['chatgpt','gemini','claude']` | 패널 토글 즉시 |
| `controlHeight` | `number` | `130` | resize mouseup 시 |
| `theme` | `'light'│'dark'` | `'light'` | 테마 버튼 클릭 시 |

### 2.2 init() 수정 흐름

```
init()
  ├── chrome.tabs.getCurrent() → state.tabId
  ├── loadPersistedState()          ← 신규 (storage 복원)
  │     ├── activeKeys 복원 → state.activeKeys
  │     ├── controlHeight 복원 → controlHeight 변수 + cp.style.height
  │     └── theme 복원 → currentTheme + body.classList + themeBtn.textContent
  ├── pendingRegistrations flush
  ├── discoverFrames()
  ├── updatePanelVisibility()       ← activeKeys 복원 후 호출
  ├── loadSessions()
  ├── setupWebNavigation()
  └── applyLang(lang)               ← 기존 lang 복원과 병합
```

### 2.3 loadPersistedState() 구현

```js
async function loadPersistedState() {
  const { activeKeys, controlHeight: savedHeight, theme } =
    await chrome.storage.local.get(['activeKeys', 'controlHeight', 'theme']);

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
}
```

### 2.4 저장 위치 변경

- **패널 토글** (`AI_ORDER.forEach`): `state.activeKeys` 갱신 직후 `chrome.storage.local.set({ activeKeys: state.activeKeys })`
- **resize mouseup**: `drag = null` 직전에 `chrome.storage.local.set({ controlHeight })`
- **테마 변경** (`themeBtn.addEventListener`): `currentTheme` 갱신 직후 `chrome.storage.local.set({ theme: currentTheme })`

---

## 3. Divider 버그 수정 (FR-04)

### 3.1 규칙

| 왼쪽 패널 | 오른쪽 패널 | Divider |
|---------|---------|---------|
| 활성 | 활성 | 표시 |
| 활성 | 비활성 | 표시 (thin strip 경계) |
| 비활성 | 활성 | 표시 (thin strip 경계) |
| 비활성 | 비활성 | **숨김** |

### 3.2 updatePanelVisibility() 수정

```js
function updatePanelVisibility() {
  // 기존 패널 토글 로직 유지
  for (const key of AI_ORDER) {
    const panel = document.getElementById(`panel-${key}`);
    if (!panel) continue;
    panel.classList.toggle('disabled', !state.activeKeys.includes(key));
  }

  // 신규: divider 숨김 처리
  document.querySelectorAll('.panel-divider').forEach(divider => {
    const leftActive  = state.activeKeys.includes(divider.dataset.left);
    const rightActive = state.activeKeys.includes(divider.dataset.right);
    divider.classList.toggle('hidden', !leftActive && !rightActive);
  });

  updateSendButton();
}
```

### 3.3 CSS 추가

```css
.panel-divider.hidden { display: none; }
```

---

## 4. 첫 실행 안내 오버레이 (FR-05)

### 4.1 HTML 구조 (각 패널 내부, iframe 위에 위치)

```html
<div class="panel" id="panel-chatgpt">
  <div class="panel-header">...</div>
  <!-- 신규 -->
  <div class="panel-onboarding" id="onboarding-chatgpt" data-key="chatgpt">
    <button class="onboarding-close" aria-label="안내 닫기">×</button>
    <div class="onboarding-body">
      <span class="onboarding-icon">🤖</span>
      <strong class="onboarding-name">ChatGPT</strong>
      <ol class="onboarding-steps">
        <li data-i18n="onboardingStep1">먼저 로그인하세요</li>
        <li data-i18n="onboardingStep2">입력하고 Send All 클릭</li>
      </ol>
      <button class="onboarding-link-btn" data-url="https://chatgpt.com/">
        chatgpt.com으로 이동
      </button>
    </div>
  </div>
  <iframe id="iframe-chatgpt" ...></iframe>
</div>
```

(Gemini, Claude도 동일 구조)

### 4.2 CSS

```css
/* 패널은 이미 position: relative(추가 필요) */
.panel { position: relative; }

.panel-onboarding {
  display: none;          /* JS로 제어 */
  position: absolute;
  top: 32px;              /* panel-header 높이 */
  inset-inline: 0;
  bottom: 0;
  background: rgba(255, 255, 255, 0.96);
  z-index: 100;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 20px;
  backdrop-filter: blur(4px);
}

.panel-onboarding.visible { display: flex; }

.onboarding-close {
  position: absolute;
  top: 10px; right: 12px;
  background: none; border: none;
  font-size: 18px; color: #aaa;
  cursor: pointer; padding: 4px;
}
.onboarding-close:hover { color: #555; }

.onboarding-icon { font-size: 36px; }
.onboarding-name { font-size: 16px; font-weight: 700; color: #2a2a4a; }

.onboarding-steps {
  text-align: left;
  font-size: 13px;
  color: #5a5a7a;
  padding-left: 18px;
  line-height: 1.8;
}

.onboarding-link-btn {
  background: #6c63ff;
  color: white;
  border: none;
  border-radius: 8px;
  padding: 8px 16px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  margin-top: 4px;
  transition: background 0.15s;
}
.onboarding-link-btn:hover { background: #5a52e8; }

/* Dark mode */
body.dark .panel-onboarding {
  background: rgba(15, 18, 40, 0.96);
}
body.dark .onboarding-name { color: #ccccee; }
body.dark .onboarding-steps { color: #8888aa; }
body.dark .onboarding-close { color: #555; }
body.dark .onboarding-close:hover { color: #aaa; }
```

### 4.3 JS 로직

```js
const AI_INFO = {
  chatgpt: { name: 'ChatGPT', icon: '🤖', url: 'https://chatgpt.com/' },
  gemini:  { name: 'Gemini',  icon: '✨', url: 'https://gemini.google.com/app' },
  claude:  { name: 'Claude',  icon: '🔶', url: 'https://claude.ai/' },
};

async function initOnboarding() {
  const { onboardingDone } = await chrome.storage.local.get('onboardingDone');
  if (onboardingDone) return;

  for (const key of AI_ORDER) {
    const overlay = document.getElementById(`onboarding-${key}`);
    if (!overlay) continue;
    overlay.classList.add('visible');

    overlay.querySelector('.onboarding-close').addEventListener('click', () => {
      overlay.classList.remove('visible');
      checkAllOnboardingClosed();
    });

    overlay.querySelector('.onboarding-link-btn').addEventListener('click', () => {
      chrome.tabs.create({ url: AI_INFO[key].url });
    });
  }
}

function dismissOnboarding() {
  document.querySelectorAll('.panel-onboarding').forEach(el => el.classList.remove('visible'));
  chrome.storage.local.set({ onboardingDone: true });
}

function checkAllOnboardingClosed() {
  const anyVisible = [...document.querySelectorAll('.panel-onboarding')]
    .some(el => el.classList.contains('visible'));
  if (!anyVisible) chrome.storage.local.set({ onboardingDone: true });
}
```

**i18n 추가 키**:

```js
STRINGS.ko.onboardingStep1  = '먼저 로그인하세요';
STRINGS.ko.onboardingStep2  = '입력하고 Send All 클릭';
STRINGS.ko.onboardingGoBtn  = name => `${name} 사이트로 이동`;

STRINGS.en.onboardingStep1  = 'Sign in first';
STRINGS.en.onboardingStep2  = 'Type and click Send All';
STRINGS.en.onboardingGoBtn  = name => `Go to ${name}`;
```

**언어 전환 시** `applyLang()`에서 오버레이 텍스트도 갱신.

**sendMessage()에서** 첫 전송 시 자동 dismiss:

```js
// sendMessage() 시작부에:
dismissOnboarding();
```

---

## 5. 세션 이름 인라인 편집 (FR-06)

### 5.1 동작 흐름

```
.session-item-name 클릭
  → startEditingSessionName(span, session)
     → span을 <input class="session-name-input">으로 교체
     → focus() + select()
  
Enter / blur → save(newName)
  → sessions 배열에서 해당 id 찾아 name 갱신
  → chrome.storage.local.set({ sessions })
  → renderSidebarSessions() 재렌더링

Escape → renderSidebarSessions() (취소, 재렌더링)
```

### 5.2 blur 이벤트 경쟁 방지

삭제 버튼 클릭 시 blur가 먼저 발생하는 문제를 방지:

```js
let isEditingSession = false;

function startEditingSessionName(span, session) {
  isEditingSession = true;
  // ... input 생성 ...
  
  input.addEventListener('blur', async () => {
    // mousedown이 delete 버튼에서 발생했다면 skip
    setTimeout(async () => {
      if (!isEditingSession) return;
      await save();
      isEditingSession = false;
    }, 100);
  });
}
```

### 5.3 CSS 추가

```css
.session-name-input {
  width: 100%;
  font-size: 13px;
  color: #2a2a4a;
  border: 1.5px solid #8880ee;
  border-radius: 4px;
  padding: 2px 5px;
  background: #fff;
  outline: none;
  font-family: inherit;
  margin-bottom: 2px;
}
body.dark .session-name-input {
  background: #1c1c30;
  color: #ccccee;
  border-color: rgba(108,99,255,0.5);
}
```

---

## 6. Privacy Policy 페이지 (FR-07)

### 6.1 viewer/privacy.html

- 수집 데이터: 세션 URL, 설정(lang, theme, controlHeight, activeKeys)
- 저장 위치: 브라우저 로컬 (chrome.storage.local)
- 외부 전송: 없음
- 제3자 공유: 없음
- 링크: `viewer/privacy.html`

### 6.2 컨트롤 패널에 링크 추가

`viewer.html`의 `.main-content` 하단 (input-container 아래):

```html
<div class="privacy-bar">
  <a href="privacy.html" target="_blank" class="privacy-link">Privacy Policy</a>
</div>
```

CSS:
```css
.privacy-bar {
  text-align: right;
  padding: 2px 2px 0;
  flex-shrink: 0;
}
.privacy-link {
  font-size: 10px;
  color: #aaaacc;
  text-decoration: none;
}
.privacy-link:hover { color: #6c63ff; text-decoration: underline; }
body.dark .privacy-link { color: #4a4a6a; }
body.dark .privacy-link:hover { color: #8880ee; }
```

---

## 7. 구현 순서

| 순서 | 항목 | 파일 | 난이도 |
|------|------|------|--------|
| 1 | FR-04 Divider 버그 | viewer.js + viewer.css | 쉬움 |
| 2 | FR-01~03 상태 영속성 | viewer.js | 쉬움 |
| 3 | FR-06 세션 이름 편집 | viewer.js + viewer.css | 중간 |
| 4 | FR-05 첫 실행 오버레이 | viewer.html + viewer.js + viewer.css | 중간 |
| 5 | FR-07 Privacy Policy | privacy.html + viewer.html + viewer.css | 쉬움 |
