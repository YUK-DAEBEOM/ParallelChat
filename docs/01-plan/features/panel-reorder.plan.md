# Plan: 패널 순서 변경 (Drag & Drop)

**Feature**: panel-reorder  
**Date**: 2026-04-17  
**Status**: Planning

---

## Executive Summary

| 관점 | 내용 |
|------|------|
| Problem | AI 패널 순서가 ChatGPT → Gemini → Claude로 고정되어 있어 사용자가 자주 쓰는 AI를 원하는 위치에 배치할 수 없음 |
| Solution | 패널 헤더를 드래그 핸들로 활용한 Drag & Drop 순서 변경, chrome.storage.local에 영속 저장 |
| UX Effect | 헤더를 잡고 원하는 위치에 드롭하면 즉시 패널 위치 교체, 새로고침 후에도 순서 유지 |
| Core Value | 사용자 워크플로에 맞게 AI 배치를 개인화할 수 있는 유연성 제공 |

---

## Context Anchor

| 항목 | 내용 |
|------|------|
| WHY | 고정 순서는 모든 사용자에게 동일한 레이아웃을 강제함. 사용자마다 선호하는 AI가 다름 |
| WHO | 특정 AI를 더 자주 참조하고 싶어 왼쪽(주 시야)에 배치하고 싶은 사용자 |
| RISK | 리사이즈 상태(패널 너비)와 divider의 data-left/right 속성이 순서 변경 후 틀어질 수 있음 |
| SUCCESS | 드래그 앤 드롭으로 패널 위치 교체, 재시작 후에도 순서 유지 |
| SCOPE | viewer.html/viewer.js 수정만으로 완결. content script 변경 없음 |

---

## 1. 요구사항

### 1.1 기능 요구사항

| ID | 요구사항 | 우선순위 |
|----|---------|---------|
| FR-01 | 패널 헤더를 드래그 핸들로 사용해 좌우 순서를 변경할 수 있어야 한다 | Must |
| FR-02 | 드래그 중 드롭 대상 패널에 시각적 피드백(하이라이트)을 표시해야 한다 | Must |
| FR-03 | 순서 변경 후 패널 너비를 균등하게 리셋한다 | Must |
| FR-04 | 변경된 순서를 chrome.storage.local에 저장하고 재시작 후에도 복원해야 한다 | Must |
| FR-05 | 비활성화된 패널(토글 꺼짐)도 순서 변경 대상에 포함된다 | Should |
| FR-06 | 패널 divider(resize 핸들)가 순서 변경 후에도 정상 동작해야 한다 | Must |

### 1.2 비기능 요구사항

- 드래그 인터랙션이 부드러워야 함 (CSS transition)
- 기존 resize, toggle, reload 기능과 충돌하지 않아야 함

---

## 2. 현재 상태 분석

### 2.1 관련 코드

```
viewer/
├── viewer.html  — 패널 3개 + divider 2개 정적 렌더링
│                  panel-chatgpt, panel-gemini, panel-claude
│                  panel-divider[data-left/right]
└── viewer.js    — AI_ORDER const 배열, state.activeKeys 관리
                   chrome.storage.local: activeKeys, controlHeight, theme
```

### 2.2 현재 DOM 구조

```html
#panels-container
  .panel#panel-chatgpt
  .panel-divider[data-left="chatgpt"][data-right="gemini"]
  .panel#panel-gemini
  .panel-divider[data-left="gemini"][data-right="claude"]
  .panel#panel-claude
```

### 2.3 변경이 필요한 부분

| 파일 | 변경 내용 |
|------|---------|
| viewer.js | AI_ORDER를 동적으로 관리, D&D 이벤트 핸들러 추가, storage에 panelOrder 저장/로드 |
| viewer.html | 패널 헤더에 `draggable="true"` 속성 또는 JS로 동적 설정 |
| viewer.css | 드래그 중 스타일 (opacity, border highlight) 추가 |

---

## 3. 설계 방향

### 3.1 핵심 선택: DOM 직접 재정렬

패널과 divider를 DOM에서 직접 재정렬한다.  
- 패널 요소(`.panel`)와 divider(`.panel-divider`)를 물리적으로 이동
- 이동 후 divider의 `data-left/right` 속성을 새 순서에 맞게 재계산
- 기존 resize 이벤트 핸들러는 `data-left/right` 기반으로 동작하므로 자동 적용됨

### 3.2 드래그 흐름

```
dragstart (헤더)
  → 드래그 중인 패널 key 기록
dragover (다른 패널)
  → e.preventDefault()
  → 드롭 대상 하이라이트 표시
drop (다른 패널)
  → 두 패널 DOM 위치 교환
  → divider data-left/right 재설정
  → 너비 균등 리셋
  → storage 저장
dragend
  → 하이라이트 제거
```

---

## 4. 성공 기준

- [ ] 드래그 앤 드롭으로 3개 패널의 순서를 임의로 변경 가능
- [ ] 드래그 중 드롭 대상에 시각적 피드백 표시
- [ ] 순서 변경 후 패널 resize(구분선 드래그)가 정상 동작
- [ ] chrome.storage.local에 저장, 탭/브라우저 재시작 후 복원
- [ ] 기존 toggle(활성/비활성), reload, theme 기능 정상 동작

---

## 5. 리스크

| 리스크 | 대응 |
|--------|------|
| resize 핸들이 이동 후 엉킴 | divider data-left/right 재계산으로 해결 |
| 드래그와 헤더 클릭(toggle) 이벤트 충돌 | dragstart와 click 구분 (mousedown 시간 또는 dragstart 플래그) |
| 비활성 패널 포함 시 divider 재계산 복잡도 | activeKeys 무관하게 AI_ORDER 배열만 기준으로 DOM 정렬 |
