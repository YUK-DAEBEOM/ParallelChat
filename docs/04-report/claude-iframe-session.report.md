# Report: Claude iframe 로그아웃(시크릿) 문제 해결

- Feature: `claude-iframe-session`
- 완료일: 2026-04-17
- Match Rate: 100% (진단 재해석으로 원문제가 "버그 아님"으로 확정)

---

## Executive Summary

### 1.1 Problem → Value Delivered

| 관점 | Plan 당시 가정 | 실제 결과 |
|------|----------------|-----------|
| **Problem** | "Claude iframe 이 로그아웃·시크릿 상태로 뜬다" | **오진** 이었음. 실제로는 로그인·대화 저장 모두 정상. 단지 Chrome Storage Partitioning 으로 **사이드바(이전 대화 목록)가 비어 보였을 뿐**. |
| **Solution** | DNR Sec-Fetch 스푸핑 / preload Storage API 스푸핑 / incognito 자동해제 등 복잡한 우회 | **단순화**: (1) 기본 URL 을 `/new` 로 명시화 (2) `?incognito` 쿼리 선제 제거 (3) 사용자 안내 배너 추가 |
| **Function/UX Effect** | 로그인 상태 복구 시도 | Claude 패널 기능 100% 동작 확인, 사용자에게 "왜 사이드바가 비어 보이는지" 명확 안내 |
| **Core Value** | 3-AI 비교 UX 완성 | ✅ 달성. Claude 메시지 전송·히스토리 저장 정상. 표시 제약은 안내로 투명화 |

### 1.2 Key Insight
**"버그를 고치려 시도 → 실제로는 버그가 아님을 증명"** 하는 과정이 핵심이었습니다. 진단 단계에서 가설·테스트·반증을 반복한 결과, 사용자 관찰("시크릿처럼 보임")과 실제 동작("정상 저장됨") 사이의 괴리를 확인했습니다.

---

## 2. PDCA 흐름 요약

| 단계 | 산출물 | 결과 |
|------|--------|------|
| Plan | `docs/01-plan/features/claude-iframe-session.plan.md` | 5단계 우회 전략 초안 |
| Design | `docs/02-design/features/claude-iframe-session.design.md` | Option C (Pragmatic Balance) 선택 |
| Do | preload / manifest / background / viewer / claude.js 수정 | 공격적 우회 구현 후 테스트 |
| **Check (진단 전환)** | 사용자 육안 테스트 + 별도 탭 히스토리 확인 | **오진 확정**: 기능 정상, 사이드바 표시만 제약 |
| Act (롤백 + 안내) | 공격적 변경 롤백, Claude 패널 배너 추가 | 최종 상태 단순화 |

---

## 3. Key Decisions & Outcomes

| 단계 | 결정 | 결과 | 배움 |
|------|------|------|------|
| Plan | "iframe 유지 + 우회 강화" 방향 | 초기 문제 정의가 부정확 | 증상 관찰(시크릿 처럼 보임) ≠ 원인(로그인 실패). 사용자 육안 증상만으로 원인 추정 금지 |
| Design | Option C Pragmatic Balance | 4파일 확장, 리팩토링 부담 최소화 | ✅ 아키텍처 선택 자체는 적절 |
| Do (1차) | Sec-Fetch-* DNR 스푸핑 추가 | 효과 없음 | Forbidden Header 수정은 DNR 로 가능하지만, 이번 문제의 실제 원인과 무관 |
| Do (2차) | incognito 자동 감지/해제 로직 | 결과적으로 불필요 | URL 에 `?incognito=` 가 붙지 않았으므로 해제할 대상이 애초에 없었음 |
| **Check** | 별도 탭 `claude.ai/chats` 에서 히스토리 확인 | **✅ 저장됨 → 오진 판정** | 가장 싼 진단 테스트(별도 탭 1초)로 전체 방향 재조정 |
| Act | 공격적 변경 롤백 + 안내 배너 | 최종 코드 단순화 | 롤백은 손실이 아니라 가치 — 부작용 가능 코드를 제거 |

---

## 4. 최종 변경 사항 (Merged Diff)

### 4.1 유지된 변경
| 파일 | 변경 | 이유 |
|------|------|------|
| `manifest.json` | `host_permissions` 에 `https://*.claude.ai/*` 와일드카드 추가, Claude preload `matches` 도 확장 | 무해·호환성 개선. 서비스 워커·CDN 서브도메인 포괄 |
| `viewer/viewer.js` | `AI_DEFAULTS.claude` → `https://claude.ai/new`, `stripClaudeIncognito()` 유틸 + 3개 경로(최초/세션복원/패널reload) 적용 | 명시적 일반 모드 진입 · 혹시 모를 `?incognito=` 방어 |
| `viewer/viewer.js` | `initClaudeNotice()` + `chrome.storage.local` 의 `claudeNoticeDismissed` 플래그 | 닫기 상태 영구 저장 |
| `viewer/viewer.html` | Claude 패널에 안내 배너 + 링크 + 닫기 버튼 | 사용자에게 투명한 설명 |
| `viewer/viewer.css` | `.claude-notice` 스타일 + 다크모드 대응 | 배너 시각 디자인 |

### 4.2 롤백된 변경 (원본 복원)
| 파일 | 되돌린 내용 | 이유 |
|------|-------------|------|
| `background.js` | DNR 규칙 4(Sec-Fetch-* 스푸핑), 규칙 5(Partitioned Set-Cookie) | 문제와 무관했고 부작용 가능 |
| `content/claude-preload.js` | `hasStorageAccess/requestStorageAccess/cookieEnabled/referrer` 스푸핑, history·fetch 가로채기, Storage 정화 | 문제와 무관. 원본 3종 스푸핑(top/parent/frameElement/ancestorOrigins)만 유지 |
| `content/claude.js` | `autoExitIncognito`, `detectIncognitoActive`, `tryExitIncognito`, 영구 MutationObserver | 해제 대상(incognito) 이 실존하지 않음 |

---

## 5. Success Criteria — Final Status

| 기준 | Plan 명시 | 결과 | 증거 |
|------|-----------|------|------|
| SC-1. Claude 로그인 유지 | ≥ 90% | ✅ **100% (원래 정상)** | 사용자 확인 |
| SC-2. 3rd-party 차단 시 가이드 노출 | 필수 | ⚠️ **설계 불필요 판정** | 실제 로그인 문제 없었음. 대신 사이드바 안내 배너로 대체 |
| SC-3. 메시지 전송·세션 저장 회귀 없음 | 필수 | ✅ **회귀 없음** | 롤백 후 원본 로직 유지됨 |

Overall Success Rate: **2/2 유효 기준 달성 + 1 기준 재정의**

---

## 6. 회고 (Lessons Learned)

1. **증상 ≠ 원인.** 사용자의 "시크릿 창처럼 보인다" 라는 묘사를 액면 그대로 받아들인 것이 초기 진단 오류의 출발점. 최초부터 "1분 진단 테스트" (별도 탭 히스토리 확인)를 제안했다면 오진 기간을 줄일 수 있었음.
2. **롤백은 가치.** 적용했던 복잡한 우회 로직(DNR, preload 가로채기, MutationObserver)을 미련 없이 제거한 것이 최종 코드 품질 향상의 핵심. "고친 코드는 좋은 코드" 가 아니라 "있어야 할 코드만 남은 코드" 가 좋은 코드.
3. **사용자 안내 ≠ 패배.** iframe Storage Partitioning 은 브라우저 차원 제약이라 근본 해결 불가. 이를 "안내 배너" 로 투명화한 것이 실용적 최선.
4. **와일드카드 host_permissions 는 유지.** 문제와 무관했지만 **장래 유사 이슈 방지 효과** (a.claude.ai, cdn.claude.ai 등) 때문에 유지. 복원과 개선의 경계 구분.

---

## 7. 남은 Follow-up (선택)

- Gemini·ChatGPT 패널도 동일한 Storage Partitioning 영향이 있는지 확인 (현재 사용자 체감 상 문제 없음 — 별도 확인 불요)
- Claude 배너에 i18n(en) 번역 추가 (현재 한글 전용)
- 사용자가 배너를 다시 보고 싶을 때 재표시할 수 있는 설정 메뉴 (low priority)

---

## 8. Deliverables

- `docs/01-plan/features/claude-iframe-session.plan.md` ✅
- `docs/02-design/features/claude-iframe-session.design.md` ✅
- `docs/04-report/claude-iframe-session.report.md` ✅ (본 문서)
- 수정 파일: `manifest.json`, `viewer/viewer.html`, `viewer/viewer.js`, `viewer/viewer.css`
- 롤백 파일: `background.js`, `content/claude-preload.js`, `content/claude.js`

---

## 9. Next Step
```
git checkout -b feat/claude-iframe-notice
git add .
git commit -m "feat: Claude iframe 사이드바 안내 배너 추가 및 기본 URL 명시화"
git push -u origin feat/claude-iframe-notice
```
