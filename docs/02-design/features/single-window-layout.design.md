# Design: Single Window Layout (Option B — Full Refactor)

**Feature**: single-window-layout  
**Date**: 2026-04-09  
**Phase**: Design  
**Architecture**: Option B — 완전 리팩터

---

## Context Anchor (from Plan)

| 항목 | 내용 |
|------|------|
| **WHY** | 멀티 모니터 없이 단일 창에서 3개 AI 동시 사용 |
| **WHO** | 단일 모니터 사용자 |
| **RISK** | AI 사이트 iframe 차단 우회 실패 |
| **SUCCESS** | 단일 탭에서 3개 AI iframe 로드 + Send All 동작 |
| **SCOPE** | Chrome 확장, declarativeNetRequest, viewer.html |

---

## 1. 아키텍처 개요

```
[아이콘 클릭]
     │
     ▼
background.js (경량)
  • chrome.action.onClicked → viewer 탭 열기/포커스
  • chrome.runtime.onInstalled → dynamic declarativeNetRequest 규칙 설치
     │
     ▼
viewer/viewer.html (신규 메인 창)
  ┌─────────────────────────────────────┐
  │  panels-container (flex)            │
  │  ┌──────────┬──────────┬──────────┐ │
  │  │ ChatGPT  │  Gemini  │  Claude  │ │
  │  │ iframe   │  iframe  │  iframe  │ │
  │  └──────────┴──────────┴──────────┘ │
  │  control-panel (embedded)           │
  │  ┌──────────────────────────────┐   │
  │  │ 입력창 + Send All + 세션 등  │   │
  │  └──────────────────────────────┘   │
  └─────────────────────────────────────┘
     │  (viewer.js handles everything)
     │
     ▼
content scripts (all_frames: true)
  • chatgpt.js, gemini.js, claude.js
  • 로드 시 registerFrame { key } 전송
  • inputText 메시지 수신 → DOM 조작
```

---

## 2. 파일 구조

```
multi-chat/
├── manifest.json          ← 수정 (declarativeNetRequest, webNavigation, host_permissions)
├── background.js          ← 대폭 축소 (아이콘 + 규칙 설치만)
├── rules/
│   └── (동적 규칙, 파일 불필요 — background.js에서 runtime 설치)
├── viewer/
│   ├── viewer.html        ← 신규 (메인 단일 창)
│   ├── viewer.css         ← 신규 (분할 레이아웃 + 컨트롤 스타일)
│   └── viewer.js          ← 신규 (모든 상태/로직)
└── content/
    ├── shared.js          ← 수정 (registerFrame 추가)
    ├── chatgpt.js         ← 수정 (등록 코드 추가)
    ├── gemini.js          ← 수정 (등록 코드 추가)
    └── claude.js          ← 수정 (등록 코드 추가)
```

---

## 3. 메시지 프로토콜

| 방향 | 타입 | 페이로드 | 설명 |
|------|------|---------|------|
| content→viewer | `registerFrame` | `{ key: 'chatgpt' }` | content script 로드 시 frameId 등록 |
| viewer→content | `inputText` | `{ text, files }` | chrome.tabs.sendMessage + frameId |

`sendToAll` 경로:
```
viewer.js.sendToAll()
  → chrome.tabs.sendMessage(state.tabId, msg, { frameId: state.frames[key].frameId })
  → content script의 onMessage 수신
```

---

## 4. 상태 모델 (viewer.js)

```javascript
const state = {
  tabId: null,          // viewer 자신의 탭 ID
  frames: {},           // { chatgpt: { frameId, url }, ... }
  activeKeys: ['chatgpt', 'gemini', 'claude'],
  collapsed: false,
  selectedFiles: []
};

const AI_DEFAULTS = {
  chatgpt: 'https://chatgpt.com/',
  gemini: 'https://gemini.google.com/app',
  claude: 'https://claude.ai/'
};
```

---

## 5. iframe 차단 우회 (declarativeNetRequest)

background.js의 `onInstalled`에서 동적 규칙 설치:

```javascript
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
      initiatorDomains: [chrome.runtime.id],  // 확장 페이지에서만
      resourceTypes: ['sub_frame']
    }
  }]
});
```

---

## 6. URL 추적 (webNavigation)

iframe 내 페이지 이동 감지 → autoSave:

```javascript
chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.tabId !== state.tabId || details.frameId === 0) return;
  for (const [key, frame] of Object.entries(state.frames)) {
    if (frame.frameId === details.frameId) {
      state.frames[key].url = details.url;
      debouncedAutoSave();
      break;
    }
  }
});
```

---

## 7. 구현 가이드 (세션 플랜)

| 순서 | 파일 | 작업 |
|------|------|------|
| 1 | `manifest.json` | 권한 업데이트, host_permissions 추가, all_frames 추가 |
| 2 | `background.js` | 경량화 (아이콘 클릭 + 규칙 설치) |
| 3 | `viewer/viewer.html` | 레이아웃 + 컨트롤 패널 통합 |
| 4 | `viewer/viewer.css` | 분할 패널 스타일 |
| 5 | `viewer/viewer.js` | 상태관리 + 메시지 + 세션 + 레이아웃 |
| 6 | `content/shared.js` | registerFrame 헬퍼 추가 |
| 7 | `content/chatgpt.js` | frame 등록 추가 |
| 8 | `content/gemini.js` | frame 등록 추가 |
| 9 | `content/claude.js` | frame 등록 추가 |
