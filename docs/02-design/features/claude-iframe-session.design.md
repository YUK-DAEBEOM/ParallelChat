# Design: Claude iframe 로그아웃(시크릿) 문제 해결

- Feature: `claude-iframe-session`
- 작성일: 2026-04-17
- 선택 아키텍처: **C. Pragmatic Balance** (기존 4파일 확장)

---

## Context Anchor

| 항목 | 내용 |
|------|------|
| **WHY** | 시크릿처럼 뜨는 Claude는 확장 신뢰도를 깨뜨리고 핵심 Value Prop 무효화. |
| **WHO** | claude.ai에 이미 로그인된 일반 Chrome 사용자. |
| **RISK** | Chrome 정책 변경 시 우회 깨짐 → 사용자 가이드 경로 반드시 확보. |
| **SUCCESS** | 정상 프로필 기준 Claude 패널 로그인 유지율 ≥ 90%. |
| **SCOPE** | manifest / background / claude-preload / viewer 4파일. cookies 권한·프록시 서버 제외. |

---

## 1. 개요

### 1.1 목표
3rd-party Storage Partitioning 으로 격리된 Claude iframe 저장소를 **host_permissions 예외 + preload 스푸핑 + DNR 쿠키 보강**으로 top-level 파티션에 연결. 실패 시 onboarding 오버레이에 사용자 조치 가이드 제공.

### 1.2 아키텍처 선택 근거
Option C를 선택한 이유:
- 파일·모듈 증가 없이 기존 경계(manifest·background·content·viewer) 내에서 해결 가능.
- 각 변경 지점의 책임이 이미 명확(권한 / 네트워크 / 주입 / UI).
- 추후 Option B(모듈 분리)로 리팩토링 여지 보존.

## 2. 변경 파일 맵

| 파일 | 역할 | 변경 내용 |
|------|------|-----------|
| `manifest.json` | 권한·주입 규칙 | host_permissions·content_scripts 매칭 확장 |
| `background.js` | DNR | Claude 응답 쿠키 속성 보강 규칙 추가, startup/installed 재등록 검증 |
| `content/claude-preload.js` | iframe 감지 우회 | 저장소 접근 API 3종 추가 스푸핑 |
| `viewer/viewer.js` | UI 상태 감지 | Claude 세션 상태 판정 + onboarding 가이드 호출 |
| `viewer/viewer.html` (최소) | 오버레이 텍스트 | 가이드 3단계 문구 추가 (ko/en) |
| `viewer/viewer.js` STRINGS | i18n | 가이드 문구 ko/en 추가 |

## 3. 상세 설계

### 3.1 manifest.json
```jsonc
{
  "host_permissions": [
    "https://chatgpt.com/*",
    "https://chat.openai.com/*",
    "https://gemini.google.com/*",
    "https://claude.ai/*",
    "https://*.claude.ai/*",              // 신규: a.claude.ai, cdn.claude.ai 등 포괄
    "https://accounts.google.com/*"
  ],
  "content_scripts": [
    // ...
    {
      "matches": ["https://*.claude.ai/*"], // preload 확장
      "js": ["content/claude-preload.js"],
      "run_at": "document_start",
      "world": "MAIN",
      "all_frames": true
    },
    {
      "matches": ["https://claude.ai/*"],
      "js": ["content/shared.js", "content/claude.js"],
      "run_at": "document_idle",
      "all_frames": true
    }
  ]
}
```

> 판단: 입력/전송 핸들러(`claude.js`)는 `claude.ai` 최상위 앱에만 필요하므로 범위 유지.
> preload 스푸핑만 `*.claude.ai` 로 확장해 인증 서브 iframe에서도 감지 차단.

### 3.2 content/claude-preload.js — 추가 스푸핑

기존 3종(top/parent/frameElement/ancestorOrigins) 에 다음 4종 추가:

```js
// 4. document.hasStorageAccess / requestStorageAccess — 항상 허용된 것처럼 응답
try {
  Document.prototype.hasStorageAccess = function () { return Promise.resolve(true); };
  Document.prototype.requestStorageAccess = function () { return Promise.resolve(); };
} catch (e) {}

// 5. navigator.cookieEnabled — partitioned 환경에서도 true 강제
try {
  Object.defineProperty(Navigator.prototype, 'cookieEnabled', {
    get: function () { return true; },
    configurable: true
  });
} catch (e) {}

// 6. (방어적) document.referrer — 확장 chrome-extension:// 대신 빈 문자열
try {
  Object.defineProperty(Document.prototype, 'referrer', {
    get: function () { return ''; },
    configurable: true
  });
} catch (e) {}
```

> 유지: 기존 top/parent/frameElement/ancestorOrigins.
> 원칙: 서비스 측 감지 실패 대신 "최상위 컨텍스트" 로 보이도록만 최소 스푸핑.

### 3.3 background.js — DNR 쿠키 보강
```js
{
  id: 4,
  priority: 3,
  action: {
    type: 'modifyHeaders',
    responseHeaders: [
      // Set-Cookie 속성 치환: SameSite, Partitioned 보강
      // (MV3 DNR 제약상 append 불가. 제거 후 보강 불가 시 degrade 허용.)
      { header: 'Set-Cookie', operation: 'append',
        value: 'Path=/; SameSite=None; Secure; Partitioned' }
    ]
  },
  condition: {
    initiatorDomains: [chrome.runtime.id],
    regexFilter: '^https://(?:[a-z0-9.-]+\\.)?claude\\.ai/',
    resourceTypes: ['sub_frame', 'xmlhttprequest']
  }
}
```

> **중요**: DNR `append` 는 기존 Set-Cookie 를 치환하지 않는다. 실제 구현 시 검증 필요.
> 만약 효과 없거나 충돌 시 **규칙 4를 제거**하고 3.4 의 가이드만으로 폴백.

### 3.4 viewer/viewer.js — Claude 세션 감지 + 가이드
```js
// 기존 LOGIN_URL_PATTERNS 에 의존. 추가로 "세션 미확인" 상태 판정.
const SESSION_CHECK_DELAY_MS = 6000;
const CLAUDE_LOGGED_IN_PATTERNS = ['claude.ai/chats', 'claude.ai/new'];

async function checkClaudeSession() {
  await sleep(SESSION_CHECK_DELAY_MS);
  const frames = await chrome.webNavigation.getAllFrames({ tabId: state.tabId });
  const claudeTop = frames.find(f => f.parentFrameId === 0 &&
    f.url.startsWith('https://claude.ai'));
  if (!claudeTop) return;

  const loggedIn = CLAUDE_LOGGED_IN_PATTERNS.some(p => claudeTop.url.includes(p));
  const isLogin  = isLoginUrl('claude', claudeTop.url);

  if (!loggedIn && !isLogin) {
    // 랜딩에 머물러 있으면 파티션 문제 의심 → 가이드 표시
    showPartitionGuide();
  }
}
```

`showPartitionGuide()` 는 기존 Claude onboarding 오버레이 재활용. 단계 3가지:
1. "로그인된 상태인데 로그아웃처럼 보이나요?" (진단 문구)
2. "Chrome 설정 > 개인정보 > 사이트 설정 > 쿠키 > **claude.ai 허용 사이트로 추가**"
3. "해결 안 되면 ↻ 새로고침 또는 🔗 새 탭에서 claude.ai 열기"

### 3.5 viewer/viewer.js STRINGS — i18n 추가
```js
partitionGuideTitle:   '로그인된 상태인데 로그아웃처럼 보이나요?',
partitionGuideStep1:   'Chrome 설정 → 개인정보 및 보안 → 사이트 설정 → 쿠키',
partitionGuideStep2:   'claude.ai 를 "쿠키 항상 허용" 사이트 목록에 추가',
partitionGuideStep3:   '상단 ↻ 버튼으로 Claude 패널 새로고침',
partitionGuideOpenNew: '새 탭에서 claude.ai 열기',
```
(en 대응 문구 동일 구조로 추가.)

## 4. API / 메시지 컨트랙트
본 기능은 **신규 메시지 타입 없음**. 기존:
- `registerFrame` — 변경 없음
- `setTheme` / `getTitle` / `inputText` — 변경 없음

새로 추가:
- `background.js` → `viewer`: `sessionProbe` (선택) — 디버깅용이므로 MVP에서 제외 가능.

## 5. 데이터 모델
- 새 저장소 키 없음. 기존 `chrome.storage.local` 유지.

## 6. 에러 처리
| 시나리오 | 처리 |
|---------|------|
| preload 주입 실패 | Claude는 iframe 감지로 렌더 실패 → Onboarding 자동 표시(기존 로직). |
| DNR rule 4 효과 없음 | 가이드 오버레이로 사용자 조치 안내. |
| 6초 후에도 `/chats` 진입 못함 | PartitionGuide 오버레이 표시. 사용자가 닫기 가능. |

## 7. 성능·보안
- preload 증가량 ≤ 20 lines. 실행 비용 무시 가능.
- DNR 규칙 1개 추가 → 정규식 간소. 브라우저 부하 무시 가능.
- 스푸핑은 **claude.ai 컨텍스트 내부에만 주입** → 다른 사이트 XSS 영향 없음.

## 8. 테스트 계획 (L1–L3)

| Level | 시나리오 | 검증 방식 |
|-------|---------|-----------|
| L1 | manifest 파싱/로드 성공 | `chrome://extensions` 리로드 후 에러 없음 |
| L1 | preload 스푸핑 동작 | Claude iframe DevTools 콘솔에서 `window.top === window`, `navigator.cookieEnabled === true`, `document.hasStorageAccess()` → Promise<true> |
| L2 | Claude 로그인 상태 유지 | 정상 프로필에서 viewer 열 때 Claude 패널이 `claude.ai/chats` 로 진입 |
| L2 | 메시지 전송 회귀 없음 | "hi" 전송 → 3개 AI 모두 ✓ |
| L2 | 세션 저장/복원 회귀 없음 | Save → Reload → Restore 정상 |
| L3 | 3rd-party 차단 강제 시 가이드 노출 | Chrome 쿠키 차단 모드 → PartitionGuide 오버레이 표시 |
| L3 | Edge/Canary 호환성 | Edge 최신 + Chrome Canary 수동 확인 |

## 9. 롤백 계획
모든 변경은 4개 파일 국소 수정. 문제 시 Git `revert` 로 복구. 사용자 데이터 마이그레이션 없음.

## 10. 마이그레이션
없음.

## 11. Implementation Guide

### 11.1 구현 순서
1. `content/claude-preload.js` 스푸핑 4종 추가 → 단독 테스트(DevTools 확인).
2. `manifest.json` host_permissions·content_scripts 매칭 확장 → 확장 리로드.
3. `viewer/viewer.js` `checkClaudeSession()` + STRINGS + HTML 오버레이 문구 추가.
4. `background.js` DNR 규칙 4 추가 → 효과 검증. **효과 없거나 충돌 시 제거**.
5. 3rd-party 차단 프로필에서 가이드 동작 확인.

### 11.2 예상 변경량
- 생성 파일: 0
- 수정 파일: 4 (`manifest.json`, `background.js`, `content/claude-preload.js`, `viewer/viewer.js`, `viewer/viewer.html` 소량)
- 총 변경 라인: ~80 lines

### 11.3 Session Guide
| Module | 파일 | 세션 |
|--------|------|------|
| module-1 (preload+manifest) | claude-preload.js, manifest.json | 세션 1 |
| module-2 (viewer guide) | viewer.js, viewer.html | 세션 2 |
| module-3 (DNR 보강·검증) | background.js + 테스트 | 세션 3 |

`/pdca do claude-iframe-session --scope module-1` 부터 진행 권장.
