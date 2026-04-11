# ParallelChat — Chrome Extension

Chat with ChatGPT, Gemini, and Claude side by side in a single tab.

[![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-brightgreen)](https://developer.chrome.com/docs/extensions/)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-blue)](https://developer.chrome.com/docs/extensions/mv3/)
[![License](https://img.shields.io/badge/License-MIT-yellow)](./LICENSE)
[![Built with Claude](https://img.shields.io/badge/Built%20with-Claude-d97706)](https://claude.ai)

🇰🇷 [한국어 README](./README.ko.md)

---

## Features

- **3-panel layout** — ChatGPT / Gemini / Claude displayed side by side in one tab
- **Simultaneous send** — Type once, broadcast to all three AIs at once
- **Selective send** — Check/uncheck AIs to target only the ones you want
- **Per-panel reload** — Reload a single AI panel without touching the others (hover the panel header)
- **File attachments** — Drag & drop or click to attach files (up to 20 MB each)
- **Auto-save sessions** — Conversations are automatically saved once a new chat URL is detected
- **Sessions sidebar** — Always-visible right panel showing your saved sessions
- **Collapsible control bar** — Collapse the bottom bar to give chat panels more room

## Layout

```
┌─────────────────┬─────────────────┬─────────────────┬────────────┐
│ ● ChatGPT    ↺  │ ● Gemini      ↺ │ ● Claude      ↺ │  Sessions  │
│                 │                 │                 │ ─────────  │
│    (iframe)     │    (iframe)     │    (iframe)     │  session 1 │
│                 │                 │                 │  session 2 │
├─────────────────┴─────────────────┴─────────────────┤  session 3 │
│ MULTI CHAT  [↺ Reload] [+ New]   ☑GPT ☑Gem ☑Cla ▼ │            │
│ ┌─────────────────────────────────────────────────┐  └────────────┘
│ │ Type a message…                        📎  ↑GPT·Gem·Cla │
│ └─────────────────────────────────────────────────┘
└───────────────────────────────────────────────────────
```

## Installation

1. Download or clone this repository
2. Open Chrome and go to `chrome://extensions`
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked** and select the `multi-chat` folder

## Usage

1. Click the puzzle icon in Chrome → **ParallelChat**
2. A new tab opens with ChatGPT, Gemini, and Claude side by side
3. Type in the bottom bar and press **Enter** or the send button

| Shortcut | Action |
|----------|--------|
| `Enter` | Send message |
| `Shift + Enter` | New line |
| Hover panel header | Show per-panel reload button |
| `▼ / ▲` button | Collapse / expand the control bar |

### Session management

- Sessions are **auto-saved** once a new conversation URL is detected (~2.5 s after sending)
- Click any session in the right sidebar to reload it
- Use **+ 현재 세션 저장** to save manually at any time
- Hover a session item to reveal the delete button

### File attachments

- Click the **📎 파일** button or drag & drop files onto the window
- Attached files appear as chips; click **✕** to remove individually
- Maximum 20 MB per file

## Prerequisites

You must be **already logged in** to each AI service in your browser:

- [chatgpt.com](https://chatgpt.com)
- [gemini.google.com](https://gemini.google.com)
- [claude.ai](https://claude.ai)

## Project structure

```
multi-chat/
├── manifest.json         # Extension config (Manifest V3)
├── background.js         # Tab management, declarativeNetRequest rules
├── generate-icons.js     # Node.js icon generator (dev only)
├── content/
│   ├── shared.js         # Common utilities (title query, file upload)
│   ├── chatgpt.js        # ChatGPT page integration
│   ├── gemini.js         # Gemini page integration
│   └── claude.js         # Claude page integration
├── viewer/
│   ├── viewer.html       # Main viewer page
│   ├── viewer.js         # Viewer logic (frames, sessions, send)
│   └── viewer.css        # Styles
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

## Known limitations

- If an AI site updates its DOM structure, selector updates in the relevant content script may be needed
- On slow connections, the first send after page load may fail — just try again
- File upload behavior varies by site

## Built with

This extension was built with the help of [Claude](https://claude.ai) (Anthropic).

## License

MIT — see [LICENSE](./LICENSE)
