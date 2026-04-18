# Plan: Single Window Layout

**Feature**: single-window-layout  
**Date**: 2026-04-09  
**Phase**: Plan  
**Status**: Draft

---

## Executive Summary

| 관점 | 내용 |
|------|------|
| **Problem** | 현재 4개의 독립 Chrome 창(ChatGPT + Gemini + Claude + 컨트롤 패널)이 따로 열려, 창 전환/배치 문제 발생 |
| **Solution** | 단일 Chrome 확장 페이지 안에 3개 AI를 iframe 패널로 나란히 표시하고, 컨트롤 패널을 하단에 통합 |
| **UX Effect** | 4개 창 → 1개 창: Alt+Tab 혼란 없음, 창 배치 자동화 불필요, 전체화면 지원 가능 |
| **Core Value** | 브라우저 하나의 탭 안에서 3개 AI 동시 채팅 + 일괄 메시지 전송 완성 |

---

## Context Anchor

| 항목 | 내용 |
|------|------|
| **WHY** | 멀티 모니터 없이도, 창 배치 없이도 3개 AI 동시 사용 경험 제공 |
| **WHO** | 단일 모니터 사용자, 창 관리가 불편한 사용자 |
| **RISK** | AI 사이트들의 iframe 차단(X-Frame-Options / CSP frame-ancestors) |
| **SUCCESS** | 단일 창에서 3개 AI 동시 표시 + Send All 동작 확인 |
| **SCOPE** | Chrome 확장 + declarativeNetRequest 헤더 우회 + viewer.html 단일 페이지 |

---

## 1. 문제 정의

### 현재 상태 (As-Is)

```
창 1: ChatGPT  (chrome 독립 창, left=0)
창 2: Gemini   (chrome 독립 창, left=width/3)
창 3: Claude   (chrome 독립 창, left=width*2/3)
창 4: Control  (chrome popup, bottom)
```

**문제점:**
- 4개의 창이 taskbar에 각각 표시 → Alt+Tab 혼란
- 화면 크기/위치를 OS 수준에서 강제로 배치 → 사용자가 창 이동 시 레이아웃 깨짐
- 듀얼 모니터 환경에서만 실용적
- 단일 모니터에서 3분할 시 각 창이 너무 좁음

### 목표 상태 (To-Be)

```
┌─────────────────────────────────────────────────┐  
│  Chrome 탭 1: viewer.html (확장 페이지)          │  
│  ┌─────────────┬─────────────┬─────────────┐    │  
│  │  ChatGPT    │   Gemini    │   Claude    │    │  
│  │  (iframe)   │  (iframe)   │  (iframe)   │    │  
│  │             │             │             │    │  
│  ├─────────────┴─────────────┴─────────────┤    │  
│  │  컨트롤 패널: 메시지 입력 + Send All     │    │  
│  └─────────────────────────────────────────┘    │  
└─────────────────────────────────────────────────┘
```

---

## 2. 기능 요구사항

### FR-01: 단일 뷰어 페이지 (`viewer/viewer.html`)
- Chrome 확장 아이콘 클릭 시 `viewer.html`을 새 탭으로 열거나 포커스
- 3개 AI가 iframe으로 나란히 표시 (기본: 동등 분할)
- 반응형: 창 너비에 따라 패널 너비 자동 조정

### FR-02: iframe 차단 헤더 우회
- `declarativeNetRequest` 규칙으로 AI 도메인의 응답에서 `X-Frame-Options` 및 `Content-Security-Policy` 헤더 제거
- 대상 도메인: `chatgpt.com`, `chat.openai.com`, `gemini.google.com`, `claude.ai`
- 규칙은 확장 페이지(`chrome-extension://`)에서 발생하는 요청에만 적용

### FR-03: content script iframe 주입
- `manifest.json`의 content_scripts에 `"all_frames": true` 추가
- iframe 내 AI 페이지에도 content script 정상 주입

### FR-04: 프레임 ID 기반 메시지 라우팅
- 각 AI content script가 로드 시 background.js에 `{ type: 'registerFrame', key }` 전송
- background.js가 `sender.frameId` + `sender.tab.id`를 `state.frames[key]`에 저장
- `sendToAll` 시 `chrome.tabs.sendMessage(tabId, msg, { frameId })` 사용

### FR-05: 컨트롤 패널 하단 통합
- 기존 `control/control.html`을 viewer.html 하단에 `<iframe>`으로 임베드
- 또는 control UI를 viewer.html에 직접 포함 (권장: 직접 포함으로 cross-origin 이슈 방지)
- 패널 높이 토글(접기/펼치기) 유지

### FR-06: 기존 기능 완전 호환
- Send All (파일 포함) 동작 유지
- 세션 저장/불러오기 동작 유지
- AI 체크박스로 패널 표시/숨김 유지 (iframe 숨김/표시)
- 모니터 선택 기능 → 불필요(단일 창이므로 제거 또는 유지 선택)

### FR-07: URL 동기화
- iframe 내 AI 페이지 URL 변경 시 autoSave 유지
- `chrome.webNavigation.onCommitted` 이벤트로 iframe URL 감지

---

## 3. 비기능 요구사항

| 항목 | 요구사항 |
|------|---------|
| **성능** | iframe 3개 로드 후 첫 Send All까지 기존 대비 +2초 이내 |
| **호환성** | Chrome 120+ (Manifest V3, declarativeNetRequest modifyHeaders) |
| **안정성** | iframe 중 1개 로드 실패해도 나머지 2개는 정상 동작 |
| **보안** | declarativeNetRequest 규칙은 확장 페이지 origin에서만 적용 |

---

## 4. 기술 접근 방식

### 핵심 기술: `declarativeNetRequest` 헤더 제거

```json
// rules/remove-iframe-blocks.json
[
  {
    "id": 1,
    "priority": 1,
    "action": {
      "type": "modifyHeaders",
      "responseHeaders": [
        { "header": "X-Frame-Options", "operation": "remove" },
        { "header": "Content-Security-Policy", "operation": "remove" }
      ]
    },
    "condition": {
      "initiatorDomains": ["<extension-id>"],  // 확장 페이지에서만
      "resourceTypes": ["sub_frame"],
      "domains": ["chatgpt.com", "gemini.google.com", "claude.ai"]
    }
  }
]
```

> **주의**: CSP 헤더 전체를 제거하면 해당 페이지의 보안이 약화될 수 있음. 단, 이는 확장이 이미 content script를 주입하는 신뢰된 도메인에 한정.

### 메시지 라우팅 변경

```
[AS-IS] background.js → chrome.tabs.sendMessage(state.tabs[key], msg)
                                     ↑ 독립 탭 ID

[TO-BE] background.js → chrome.tabs.sendMessage(
                           state.frames[key].tabId,
                           msg,
                           { frameId: state.frames[key].frameId }
                         )
```

### Frame 등록 흐름

```
viewer.html 탭 열림
  → iframe src="https://chatgpt.com" 로드
    → content/chatgpt.js 주입 (all_frames: true)
      → chrome.runtime.sendMessage({ type: 'registerFrame', key: 'chatgpt' })
        → background.js: state.frames.chatgpt = { tabId, frameId }
```

---

## 5. 구현 범위 (파일 변경 목록)

| 파일 | 변경 유형 | 내용 |
|------|---------|------|
| `manifest.json` | 수정 | `declarativeNetRequest` 권한, `webNavigation`, `rules` 파일, `all_frames` 추가 |
| `background.js` | 수정 | `launchWindows` → viewer 탭 열기로 변경, frame 등록 처리, URL 추적 변경 |
| `viewer/viewer.html` | 신규 | 3분할 iframe + 컨트롤 패널 통합 레이아웃 |
| `viewer/viewer.js` | 신규 | iframe URL 관리, 패널 표시/숨김, 레이아웃 토글 |
| `viewer/viewer.css` | 신규 | 분할 패널 스타일, 반응형, 컨트롤 패널 스타일 |
| `rules/remove-iframe-blocks.json` | 신규 | declarativeNetRequest 헤더 제거 규칙 |
| `content/shared.js` | 수정 | `registerFrame` 메시지 추가 |
| `content/chatgpt.js` | 수정 | frame 등록 코드 추가 |
| `content/gemini.js` | 수정 | frame 등록 코드 추가 |
| `content/claude.js` | 수정 | frame 등록 코드 추가 |
| `control/control.html` | 수정 (또는 통합) | viewer.html에 직접 통합 시 불필요 |
| `control/control.js` | 수정 | embedded 모드 지원, 모니터 선택 UI 제거 |

---

## 6. 위험 분석

| 위험 | 심각도 | 가능성 | 대응 방안 |
|------|-------|-------|---------|
| **AI 사이트 iframe 차단 우회 실패** | High | Medium | `declarativeNetRequest`로 X-Frame-Options + CSP 제거; 실패 시 각 사이트별 대안 검토 |
| **content script iframe 내 미동작** | High | Low | `all_frames: true` 설정 + `match_about_blank` 추가 |
| **frameId 등록 타이밍 이슈** | Medium | Medium | content script에서 로드 완료 후 재시도 로직 |
| **세션 URL 추적 누락** | Medium | Low | `chrome.webNavigation.onCommitted` with frameId 필터링 |
| **Claude.ai CSP 특히 엄격** | High | High | CSP 헤더 전체 제거로 대응; 그래도 실패 시 claude.ai 전용 규칙 추가 |

---

## 7. 성공 기준

- [ ] 확장 아이콘 클릭 → viewer.html 탭 1개만 열림 (기존 4창 → 1탭)
- [ ] 3개 AI iframe 모두 정상 로드 (로그인 상태 유지)
- [ ] Send All → 3개 iframe에 동시 메시지 전송 성공
- [ ] 파일 첨부 후 Send All 성공
- [ ] AI 체크박스 토글 → 해당 iframe 표시/숨김
- [ ] 세션 저장/불러오기 정상 동작
- [ ] 컨트롤 패널 접기/펼치기 동작

---

## 8. 스코프 제외 (Out of Scope)

- iframe 패널 드래그로 너비 조절 (2차 작업)
- 모니터 선택 기능 (단일 창이므로 불필요)
- 다중 탭/세션 동시 뷰 (2차 작업)
- Firefox 지원 (Chrome MV3만)
