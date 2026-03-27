# Native Batch Downloader

A Chrome extension for batch downloading files through the browser's native download channel. Cookies, User-Agent, and Referer headers are carried automatically -- no extra configuration needed.

[中文](README.zh.md) | English

## How It Works

Click the toolbar icon, paste your URLs (one per line), set the delay and concurrency, then hit **Start Download**.

Under the hood it calls `chrome.downloads.download(url)` for each link, which is essentially the same as typing a URL into the address bar and pressing Enter. The browser handles the actual request, so all session cookies, UA strings, and headers are sent natively.

## Features

- **Native download channel** -- requests go through the browser itself, not `fetch` or `XMLHttpRequest`, so authentication cookies and headers are automatically included.
- **Concurrency & delay control** -- set how many files download in parallel (1-200) and an optional delay between downloads (in ms).
- **Real-time progress** -- live stats for total / succeeded / failed / waiting, with a progress bar.
- **Any file type** -- PDF, images, videos, archives, executables -- anything a direct URL points to.
- **18 languages** -- AR, DE, EN, ES, FR, IT, JA, KO, NL, PL, PT-BR, RU, TH, TR, UK, VI, ZH-CN, ZH-TW.
- **Manifest V3** -- modern Chrome extension architecture, no background scripts.

## Installation

1. Download or clone this repository.
2. Open `chrome://extensions/` in Chrome.
3. Enable **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select the project folder.
5. The extension icon appears in the toolbar -- click it to open the popup.

## Usage

1. Click the extension icon in the toolbar.
2. Paste direct download URLs into the text area, **one per line**.
3. Adjust **Concurrency** (default 10) and **Delay** (default 0 ms) if needed.
4. Click **Start Download**.
5. Watch the log and stats update in real time. Click **Stop** to abort.

## Important Notes

### URLs must be direct links

If a website generates a temporary download URL via JavaScript after you click a button (e.g. cloud storage "Download" buttons), pasting the page URL won't work. You need the actual file URL.

### Login state matters

The extension can carry cookies because it uses the browser's own request pipeline. If the target site requires login and you haven't logged in within the browser, you'll still get a 403.

### Chrome's per-domain connection limit

Chrome allows roughly **6 concurrent TCP connections per domain**. Even if you set concurrency to 100, only about 6 downloads from the same domain will transfer simultaneously -- the rest queue internally. This limit doesn't apply across different domains.

### Dangerous file type warnings

Executable files (`.exe`, `.bat`, etc.) may trigger Chrome's built-in security prompt, which interrupts the automated flow. There is no way for any extension to suppress this -- `chrome.downloads.acceptDanger()` still shows a native confirmation dialog.

**Workaround**: go to `chrome://settings/security` and set Safe Browsing to **No protection**. Remember to switch it back after you're done.

PDFs and other common document types are not affected.

## License

[MIT](LICENSE)
