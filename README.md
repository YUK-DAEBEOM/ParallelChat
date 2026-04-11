# Multi Chat — Chrome Extension

ChatGPT, Gemini, Claude를 하나의 탭에서 동시에 사용하는 크롬 익스텐션입니다.

![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-brightgreen)
![Manifest V3](https://img.shields.io/badge/Manifest-V3-blue)
![License](https://img.shields.io/badge/License-MIT-yellow)

## 기능

- **3분할 화면** — ChatGPT / Gemini / Claude를 하나의 탭에 나란히 표시
- **동시 전송** — 메시지 한 번 입력으로 3개 AI에 동시 전송
- **선택 전송** — 체크박스로 원하는 AI만 골라서 전송
- **파일 첨부** — 드래그 앤 드롭 또는 클릭으로 파일 업로드 (최대 20MB)
- **세션 자동 저장** — 새 대화가 시작되면 자동으로 세션 저장
- **세션 사이드바** — 오른쪽 패널에서 세션 목록 확인 및 로드
- **패널 접기/펼치기** — 컨트롤 패널을 접으면 채팅 영역이 전체화면으로 확장

## 화면 구조

```
┌──────────────┬──────────────┬──────────────┬──────────────┐
│              │              │              │              │
│   ChatGPT    │   Gemini     │   Claude     │   Sessions   │
│              │              │              │   ─────────  │
│              │              │              │   세션 목록   │
├──────────────┴──────────────┴──────────────┤              │
│ MULTI CHAT  [⟳ Reload] [+ New]             │              │
│ ┌──────────────────────────────────── [⬆]┐ └──────────────┘
│ │ 메시지 입력...                  📎 [▲]  │
│ └────────────────────────────────────────┘
└────────────────────────────────────────────
```

## 설치 방법

1. 이 저장소를 다운로드 또는 클론
2. Chrome 주소창에 `chrome://extensions` 입력
3. 우측 상단 **개발자 모드** 활성화
4. **압축해제된 확장 프로그램을 로드합니다** 클릭
5. `multi-chat` 폴더 선택

## 사용 방법

1. Chrome 우측 상단 퍼즐 아이콘 → **Multi Chat** 클릭
2. 새 탭에 ChatGPT / Gemini / Claude가 3분할로 열림
3. 하단 입력창에 메시지 입력 후 **Enter** 또는 **Send All** 클릭

| 단축키 | 동작 |
|--------|------|
| `Enter` | 전송 |
| `Shift + Enter` | 줄바꿈 |
| `▼ / ▲` 버튼 | 컨트롤 패널 접기/펼치기 |

### 세션 관리

- 메시지를 전송하면 대화 URL이 생성된 후 **자동 저장**
- 우측 Sessions 패널에서 저장된 세션 목록 확인
- 세션 클릭 → 해당 대화로 이동
- **+ 현재 세션 저장** 버튼으로 수동 저장 가능

### 파일 첨부

- 입력창 하단 **📎 파일** 버튼 클릭
- 또는 창에 파일 **드래그 앤 드롭**
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
├── manifest.json       # 익스텐션 설정 (Manifest V3)
├── background.js       # 탭 관리, declarativeNetRequest 설정
├── content/
│   ├── shared.js       # 공통 유틸리티 (DOM 조작, 파일 업로드, 타이틀 조회)
│   ├── chatgpt.js      # ChatGPT 페이지 연동
│   ├── gemini.js       # Gemini 페이지 연동
│   └── claude.js       # Claude 페이지 연동
├── viewer/
│   ├── viewer.html     # 메인 뷰어 페이지
│   ├── viewer.js       # 뷰어 로직 (프레임 관리, 세션, 전송)
│   └── viewer.css      # 스타일
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── README.md
```

## 알려진 제한사항

- 각 AI 사이트의 DOM 구조가 업데이트되면 content script의 셀렉터 수정이 필요할 수 있습니다
- 사이트 로딩이 느릴 경우 첫 전송이 실패할 수 있습니다 (재전송하면 됩니다)
- 파일 업로드는 각 사이트의 파일 입력 방식에 따라 동작이 다를 수 있습니다

## 라이선스

MIT
