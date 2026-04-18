# Plan: Claude iframe 로그아웃(시크릿) 문제 해결

- Feature: `claude-iframe-session`
- 작성일: 2026-04-17
- 방향: **A. iframe 유지 + 우회 강화**

---

## Executive Summary

| 관점 | 내용 |
|------|------|
| **Problem** | Parallel Chat 확장의 Claude 패널만 로그인되지 않은(시크릿) 상태로 표시됨. ChatGPT·Gemini는 정상. |
| **Solution** | Chrome의 3rd-party Storage Partitioning으로 인한 세션 격리 문제를 host_permissions 예외·preload 스푸핑·사용자 플래그 안내로 우회. iframe 구조는 유지. |
| **Function/UX Effect** | Claude 패널에서 브라우저 메인 세션 그대로 로그인 유지, 대화 히스토리 접근 가능, 다크모드/세션 저장 기능 정상 작동. |
| **Core Value** | "한 탭에서 3개 AI 비교"라는 제품 핵심 UX를 Claude까지 100% 완성. 사용자가 별도 로그인·시크릿 모드 오해를 겪지 않음. |

## Context Anchor

| 항목 | 내용 |
|------|------|
| **WHY** | 시크릿처럼 뜨는 Claude는 "확장이 안전하지 않음" 이라는 불신과 재로그인 피로를 유발해 핵심 Value Prop을 깨뜨림. |
| **WHO** | Parallel Chat 사용자 — 평소 claude.ai에 이미 로그인된 일반 브라우저 사용자. |
| **RISK** | Chrome 정책 변경(ThirdPartyStoragePartitioning 기본값, 플래그 제거)으로 우회가 깨질 수 있음. Claude 측 iframe 차단 강화 가능. |
| **SUCCESS** | Claude 패널 최초 로드 시 로그인 상태 유지 비율 ≥ 90% (정상 브라우저 기준). |
| **SCOPE** | 확장 매니페스트, background.js DNR 규칙, claude-preload.js 스푸핑, viewer onboarding 가이드. **포함 안함**: Claude 인증 대체 구현, 자체 프록시 서버. |

---

## 1. 문제 분석

### 1.1 증상
- Claude 패널이 열리면 로그인된 적 없는 상태(랜딩 페이지 또는 로그인 화면)가 표시됨.
- 같은 Chrome에서 `claude.ai`를 새 탭으로 열면 정상 로그인 되어 있음.
- ChatGPT, Gemini는 동일 iframe 구조에서 세션 유지됨 → Claude 고유 문제.

### 1.2 근본 원인
Chrome 115+ 기본 활성화된 **Third-Party Storage Partitioning** (CHIPS 연계).
- 확장의 `chrome-extension://<id>/viewer.html` 이 top-level site가 되어,
- 안에 들어간 `claude.ai` iframe의 **쿠키·IndexedDB·localStorage**가 별도 파티션으로 격리됨.
- Claude는 **IndexedDB + secure cookie + 서비스 워커**에 강하게 의존 → 파티션이 비어 있으면 "새 사용자"로 판정.
- ChatGPT/Gemini는 쿠키 기반 세션 비중이 높고 SameSite 처리가 관대해 상대적으로 영향이 작음.

### 1.3 Chrome 공식 예외
> "If a page with the chrome-extension:// scheme includes an iframe, and the extension has host permissions for the site it is embedding, that site will also have access to its top-level partition."
> — [Storage Partitioning | Chrome for Developers](https://developer.chrome.com/docs/privacy-sandbox/storage-partitioning/)

즉, `host_permissions`에 `https://claude.ai/*` 가 포함되면 **top-level 파티션 접근이 허용**되어야 함. 현재 manifest에는 이미 포함되어 있음에도 문제가 발생 → 다음 중 하나를 의심:

1. `a.claude.ai`(인증용 서브도메인) 이 host_permissions에 있지만 iframe matches에는 없어 서비스 워커 등록 경로가 차단됨.
2. Claude 내부 서비스 워커(`/sw.js`)가 **parentFrame 감지 후 인증 bootstrap을 생략**.
3. claude-preload.js 스푸핑이 **같은 출처 서브 iframe**(로그인 위젯 등)에 전파되지 않음 (manifest `all_frames: true` 이지만 `world: "MAIN"` 이 재귀 주입되는지 확인 필요).
4. `declarativeNetRequest` 규칙이 `X-Frame-Options`/`CSP`만 제거하고 **쿠키·Set-Cookie의 SameSite 속성은 건드리지 않음**.

---

## 2. Requirements

### 2.1 Functional
- **FR-1**: Claude 패널 최초 로드 시 사용자의 기존 claude.ai 세션이 유지되어야 한다.
- **FR-2**: 세션 감지 실패 시 Onboarding 오버레이가 원인·해결법을 한국어/영어로 안내한다.
- **FR-3**: Claude 다크모드·세션 저장·메시지 전송 기존 기능은 회귀 없이 동작한다.

### 2.2 Non-functional
- **NFR-1**: 추가 권한 요청 없이(`cookies` 권한 등) 해결을 1차 시도.
- **NFR-2**: Chrome 120 ~ 최신, Edge 최신에서 동작.
- **NFR-3**: 우회가 막혔을 때 감지하여 degrade 경로(가이드 오버레이) 제공.

### 2.3 Success Criteria
1. Chrome 기본 설정 + 일반 프로필에서 Claude 패널 로그인 상태 유지 확인.
2. 쿠키 3rd-party 차단 강제(설정 > 개인정보 > 3rd-party cookies 차단) 시에도 **명확한 안내 오버레이** 노출.
3. 회귀 테스트 통과: 메시지 전송, 세션 저장/복원, 다크모드 토글.

---

## 3. 해결 전략 (Option A)

### 3.1 1차 — 구조 진단 & 매니페스트 보강
1. `manifest.json`의 `host_permissions`에 `https://*.claude.ai/*` 와일드카드 추가 (현재 `claude.ai`, `a.claude.ai` 각각 나열됨 → 서비스 워커·CDN 서브도메인 누락 가능성).
2. `content_scripts`의 Claude 매칭 패턴을 `https://*.claude.ai/*` 로 확장해 preload가 모든 인증 서브 iframe에도 주입되도록.
3. `web_accessible_resources` 재확인 — 필요 시 preload 스크립트를 MV3 `ExecutionWorld: MAIN` 으로 직접 주입.

### 3.2 2차 — Preload 스푸핑 강화
기존 `claude-preload.js`는 `window.top/parent/frameElement/ancestorOrigins` 만 스푸핑. 아래 추가:
- `document.hasStorageAccess()` → 항상 `true` resolve.
- `document.requestStorageAccess()` → 즉시 resolve (Storage Access API 요구 차단).
- `navigator.cookieEnabled` → 강제 `true`.
- `window.isSecureContext` 유지 (claude.ai는 HTTPS이므로 자동이지만 확인).

### 3.3 3차 — DNR 규칙에 Set-Cookie 보강
`background.js`의 declarativeNetRequest 규칙 3에:
- Claude 응답의 `Set-Cookie` 를 가로채 `SameSite=None; Secure; Partitioned` 이 누락돼 있으면 보강하는 시도.
  (주의: MV3 DNR은 응답 쿠키 재작성에 제약이 있음 — 검증 단계에서 가능 여부 확정.)

### 3.4 4차 — 감지 & 사용자 가이드
- `viewer.js`의 `isLoginUrl(claude, …)` 경로가 잡히거나 Claude iframe이 일정 시간 내 `claude.ai/chats` 로 진입 못하면:
  - Onboarding 오버레이에 "Chrome 설정 → 사이트 설정 → Claude.ai 에서 3rd-party cookies 허용" 안내 3단계 가이드 노출.
  - 또는 "Claude를 새 탭에서 열기" 대체 버튼 노출.

### 3.5 5차 — 검증 스위트
- 정상 프로필, 3rd-party cookies 차단 프로필, Chrome Canary `--enable-features=ThirdPartyStoragePartitioning` 세 환경에서 수동 테스트.
- 로그인 성공 여부를 iframe URL(`claude.ai/chats/...`)로 판정하는 자동 체크 스크립트 추가.

---

## 4. 범위

### Scope (In)
- manifest.json 권한/매칭 조정
- claude-preload.js 스푸핑 확장
- background.js DNR 규칙 점검·보강
- viewer.js 감지 로직 + onboarding 메시지 업데이트

### Out of Scope
- Claude 자체 인증을 대체하는 OAuth 프록시
- 확장에 `cookies` 권한 추가(필요 시 별도 Plan으로 분리)
- Firefox·Safari 대응

---

## 5. Risks

| 위험 | 영향 | 대응 |
|------|------|------|
| Chrome이 향후 확장 host_permissions 예외를 제거 | 높음 | 감지 + popup window 폴백(Option B) Plan을 Backlog로 유지 |
| Claude 측 iframe 감지 추가 강화 | 중 | preload 스푸핑 테스트 케이스 주기적 회귀 점검 |
| DNR로 Set-Cookie 수정 불가 | 중 | 사용자 가이드 오버레이로 대체 |
| `*.claude.ai` 와일드카드가 Web Store 심사 지연 유발 | 저 | 필요한 서브도메인만 명시적으로 유지 |

---

## 6. Deliverables

1. 수정된 `manifest.json`, `background.js`, `content/claude-preload.js`, `viewer/viewer.js`
2. `docs/02-design/features/claude-iframe-session.design.md` (다음 단계)
3. 검증 체크리스트(수동 3 환경 + 기능 회귀)
4. README 업데이트: "Claude가 로그아웃 상태로 보일 때" 트러블슈팅 섹션

---

## 7. Next Step

`/pdca design claude-iframe-session` 실행해 3가지 구현 아키텍처 비교안을 생성.

## Sources

- [Storage Partitioning — Chrome for Developers](https://developer.chrome.com/docs/privacy-sandbox/storage-partitioning/)
- [Storage Partitioning — Privacy Sandbox](https://privacysandbox.google.com/cookies/storage-partitioning)
- [Firebase Auth state doesn't sync through iFrame (Issue #7679)](https://github.com/firebase/firebase-js-sdk/issues/7679)
- [LocalStorage access issue since chrome v113 — chromium-extensions](https://groups.google.com/a/chromium.org/g/chromium-extensions/c/GLPcgjPdM80)
- [CHIPS Issue #88 — shared partitioned cookie](https://github.com/privacycg/CHIPS/issues/88)
