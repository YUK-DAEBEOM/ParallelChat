# Plan: Extension Publish Ready

**Feature**: extension-publish-ready  
**Date**: 2026-04-11  
**Phase**: Plan  
**Status**: Draft

---

## Executive Summary

| 관점 | 내용 |
|------|------|
| **Problem** | Chrome 웹 스토어 배포에 앞서 상태 영속성 버그, 레이아웃 버그, UX 부재, 스토어 심사 요구사항 미충족 등 5가지 결함 존재 |
| **Solution** | 영속성 저장(3종) + Divider 버그 수정 + 첫 실행 오버레이 + 세션 인라인 편집 + Privacy Policy 페이지 |
| **UX Effect** | 재시작 시 사용자 설정 유지, 패널 전환 시 레이아웃 정상화, 신규 사용자 혼란 최소화 |
| **Core Value** | 스토어 심사 통과 + 실사용 품질 확보 |

---

## Context Anchor

| 항목 | 내용 |
|------|------|
| **WHY** | Chrome 웹 스토어 배포를 위해 품질·심사 요건을 모두 충족 |
| **WHO** | 신규 사용자 (첫 실행), 재방문 사용자 (설정 유지), 스토어 심사 담당자 (Privacy Policy) |
| **RISK** | chrome.storage 저장/복원 타이밍 이슈, 오버레이가 iframe 로딩과 충돌 가능 |
| **SUCCESS** | 5가지 항목 모두 구현 + 기존 기능 회귀 없음 |
| **SCOPE** | viewer.js, viewer.html, viewer.css, manifest.json, privacy.html (신규) |

---

## 1. 문제 정의

### 현재 결함 목록

| # | 유형 | 현상 | 심각도 |
|---|------|------|--------|
| B-01 | 버그 | `activeKeys` 재시작 시 항상 3개 전부로 초기화 | High |
| B-02 | 버그 | `controlHeight` 재시작 시 기본값(130px)으로 초기화 | Medium |
| B-03 | 버그 | `currentTheme` 재시작 시 항상 Light로 초기화 | Medium |
| B-04 | 버그 | 패널 비활성화 시 인접 divider가 그대로 표시 | Medium |
| U-01 | UX | 첫 실행 시 각 AI에 로그인 필요하다는 안내 없음 | High |
| U-02 | UX | 저장된 세션 이름 수정 불가 | Low |
| S-01 | 스토어 | Privacy Policy 페이지 없음 (storage 권한 사용으로 필수) | High |

---

## 2. 기능 요구사항

### FR-01: 상태 영속성 — activeKeys
- `chrome.storage.local`에 `activeKeys` 배열 저장
- init() 시 복원: 없으면 `['chatgpt', 'gemini', 'claude']` 기본값
- 패널 토글 시 즉시 저장

### FR-02: 상태 영속성 — controlHeight
- `chrome.storage.local`에 `controlHeight` 숫자 저장
- 리사이즈 핸들 `mouseup` 시 저장 (drag 중 저장 X, 성능 고려)
- init() 시 복원 후 `cp.style.height` 적용

### FR-03: 상태 영속성 — currentTheme
- `chrome.storage.local`에 `theme` 키로 저장 (기존 `lang` 패턴과 동일)
- init() 시 복원: 없으면 `'light'` 기본값
- 복원 시 `document.body.classList`, `themeBtn.textContent` 모두 갱신

### FR-04: Divider 비활성 패널 처리
- `updatePanelVisibility()` 내에서 각 divider의 표시 여부 결정
- 규칙: `data-left` 또는 `data-right` 패널이 비활성이면 divider 숨김
- CSS: `.panel-divider.hidden { display: none; }`

### FR-05: 첫 실행 안내 오버레이
- `chrome.storage.local`의 `onboardingDone` 플래그로 한 번만 표시
- 각 AI 패널 iframe 위에 오버레이 div 표시:
  - AI 이름 + 아이콘
  - ① 먼저 로그인하세요
  - ② 입력하고 Send All 클릭
  - `[{AI} 사이트로 이동]` 버튼 → 새 탭으로 열기
  - 우상단 `×` 버튼으로 개별 닫기
- 오버레이를 모두 닫으면(또는 처음 Send All 클릭 시) `onboardingDone = true` 저장
- i18n 지원 (KO/EN)

### FR-06: 세션 이름 인라인 편집
- 세션 아이템의 이름 영역 클릭 시 `<span>` → `<input type="text">` 전환
- Enter 또는 blur 시 저장, Escape 시 취소
- 저장 시 `chrome.storage.local`의 sessions 배열 업데이트
- i18n 불필요 (사용자 입력값)

### FR-07: Privacy Policy 페이지
- `viewer/privacy.html` 신규 생성
- 수집 데이터: 세션 URL, 사용자 설정(lang, theme, controlHeight, activeKeys)
- 저장 위치: 브라우저 로컬 (chrome.storage.local, 외부 전송 없음)
- manifest.json의 `action.default_title` 또는 링크로 접근 가능하도록 연결
- 컨트롤 패널 하단 푸터에 "Privacy Policy" 링크 추가

---

## 3. 비기능 요구사항

| 항목 | 요구사항 |
|------|---------|
| **기존 기능 호환** | Send All, 세션 저장/불러오기, 테마, 언어 전환 모두 회귀 없음 |
| **성능** | storage 저장은 사용자 동작 완료 시점에만 (drag 중 X, resize mouseup에 저장) |
| **접근성** | 오버레이 닫기 버튼에 aria-label 추가 |

---

## 4. 구현 범위 (파일 변경 목록)

| 파일 | 변경 유형 | 내용 |
|------|---------|------|
| `viewer/viewer.js` | 수정 | FR-01~06 모두 포함 (영속성, divider, 오버레이, 세션 편집) |
| `viewer/viewer.html` | 수정 | 오버레이 div 추가, Privacy Policy 링크 추가 |
| `viewer/viewer.css` | 수정 | 오버레이 스타일, divider 숨김 스타일, 세션 편집 input 스타일 |
| `viewer/privacy.html` | 신규 | Privacy Policy 페이지 |

---

## 5. 위험 분석

| 위험 | 심각도 | 대응 방안 |
|------|-------|---------|
| activeKeys 복원 후 divider 상태 불일치 | Medium | init() 순서: storage 복원 → updatePanelVisibility() 호출 |
| 오버레이가 iframe 위에 올바로 표시 안 됨 | Medium | z-index 및 pointer-events 주의; 패널 relative + 오버레이 absolute |
| 세션 편집 중 blur 이벤트가 삭제 버튼 클릭 시도에 의해 먼저 발생 | Low | mousedown 시 `editing` 플래그 설정, blur 처리 시 체크 |

---

## 6. 성공 기준

- [ ] B-01: 확장 재시작 후 `activeKeys` 유지
- [ ] B-02: 확장 재시작 후 `controlHeight` 유지
- [ ] B-03: 확장 재시작 후 `theme` 유지
- [ ] B-04: 패널 비활성 시 인접 divider 숨김
- [ ] U-01: 첫 실행 시 각 패널에 오버레이 표시, 두 번째 실행부터 미표시
- [ ] U-02: 세션 이름 클릭 → 편집 → 저장 정상 동작
- [ ] S-01: `viewer/privacy.html` 존재 + 컨트롤 패널에 링크

---

## 7. 스코프 제외 (Out of Scope)

- Grok/Perplexity 등 추가 AI 지원
- 세션 export/import
- Firefox 지원
- manifest.json keyboard_commands (별도 작업)
