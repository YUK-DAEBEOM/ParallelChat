# ParallelChat — 크롬 익스텐션

ChatGPT, Gemini, Claude를 하나의 탭에서 나란히 사용하는 크롬 익스텐션입니다.

[![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-brightgreen)](https://developer.chrome.com/docs/extensions/)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-blue)](https://developer.chrome.com/docs/extensions/mv3/)
[![License](https://img.shields.io/badge/License-MIT-yellow)](./LICENSE)
[![Built with Claude](https://img.shields.io/badge/Built%20with-Claude-d97706)](https://claude.ai)

🌐 [English README](./README.md)

---

## 기능

- **3분할 화면** — ChatGPT / Gemini / Claude를 하나의 탭에 나란히 표시
- **동시 전송** — 메시지 한 번 입력으로 3개 AI에 동시 전송
- **선택 전송** — 체크박스로 원하는 AI만 골라서 전송
- **패널별 새로고침** — 패널 헤더에 마우스를 올리면 나타나는 ↺ 버튼으로 해당 패널만 새로고침
- **파일 첨부** — 드래그 앤 드롭 또는 클릭으로 파일 업로드 (파일당 최대 20MB)
- **세션 자동 저장** — 새 대화 URL이 감지되면 자동으로 세션 저장
- **세션 사이드바** — 오른쪽에 항상 표시되는 세션 목록 패널
- **컨트롤바 접기** — 하단 입력창을 접으면 채팅 패널이 더 넓어짐

## 화면 구조

```
┌─────────────────┬─────────────────┬─────────────────┬────────────┐
│ ● ChatGPT    ↺  │ ● Gemini      ↺ │ ● Claude      ↺ │  Sessions  │
│                 │                 │                 │ ─────────  │
│    (iframe)     │    (iframe)     │    (iframe)     │  세션 1    │
│                 │                 │                 │  세션 2    │
├─────────────────┴─────────────────┴─────────────────┤  세션 3    │
│ MULTI CHAT  [↺ Reload] [+ New]   ☑GPT ☑Gem ☑Cla ▼ │            │
│ ┌─────────────────────────────────────────────────┐  └────────────┘
│ │ 메시지를 입력하세요…                   📎  ↑GPT·Gem·Cla │
│ └─────────────────────────────────────────────────┘
└───────────────────────────────────────────────────────
```

## 설치 방법

1. 이 저장소를 다운로드 또는 클론
2. Chrome 주소창에 `chrome://extensions` 입력
3. 우측 상단 **개발자 모드** 활성화
4. **압축해제된 확장 프로그램을 로드합니다** 클릭
5. `multi-chat` 폴더 선택

## 사용 방법

1. Chrome 우측 상단 퍼즐 아이콘 → **ParallelChat** 클릭
2. 새 탭에 ChatGPT / Gemini / Claude가 3분할로 열림
3. 하단 입력창에 메시지 입력 후 **Enter** 또는 전송 버튼 클릭

| 단축키 | 동작 |
|--------|------|
| `Enter` | 전송 |
| `Shift + Enter` | 줄바꿈 |
| 패널 헤더 호버 | 패널별 새로고침 버튼 표시 |
| `▼ / ▲` 버튼 | 컨트롤 패널 접기/펼치기 |

### 세션 관리

- 전송 후 새 대화 URL이 감지되면 **자동 저장** (~2.5초 후)
- 오른쪽 Sessions 패널에서 저장된 세션 클릭 → 해당 대화로 이동
- **+ 현재 세션 저장** 버튼으로 수동 저장 가능
- 세션 항목에 마우스를 올리면 삭제 버튼 표시

### 파일 첨부

- **📎 파일** 버튼 클릭 또는 창에 파일 **드래그 앤 드롭**
- 첨부된 파일은 칩 형태로 표시, **✕** 로 개별 제거
- 파일당 최대 20MB

## 사전 조건

각 AI 서비스에 **미리 로그인** 되어 있어야 합니다.

- [chatgpt.com](https://chatgpt.com)
- [gemini.google.com](https://gemini.google.com)
- [claude.ai](https://claude.ai)

## 폴더 구조

```
multi-chat/
├── manifest.json         # 익스텐션 설정 (Manifest V3)
├── background.js         # 탭 관리, declarativeNetRequest 설정
├── generate-icons.js     # 아이콘 생성 스크립트 (개발용)
├── content/
│   ├── shared.js         # 공통 유틸리티 (타이틀 조회, 파일 업로드)
│   ├── chatgpt.js        # ChatGPT 페이지 연동
│   ├── gemini.js         # Gemini 페이지 연동
│   └── claude.js         # Claude 페이지 연동
├── viewer/
│   ├── viewer.html       # 메인 뷰어 페이지
│   ├── viewer.js         # 뷰어 로직 (프레임 관리, 세션, 전송)
│   └── viewer.css        # 스타일
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

## 알려진 제한사항

- 각 AI 사이트의 DOM 구조가 업데이트되면 content script의 셀렉터 수정이 필요할 수 있습니다
- 사이트 로딩이 느릴 경우 첫 전송이 실패할 수 있습니다 (재전송하면 됩니다)
- 파일 업로드는 각 사이트의 파일 입력 방식에 따라 동작이 다를 수 있습니다

## 제작

이 익스텐션은 [Claude](https://claude.ai) (Anthropic)의 도움을 받아 제작되었습니다.

## 라이선스

MIT — [LICENSE](./LICENSE) 참고
