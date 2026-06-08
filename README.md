# Native Batch Downloader

> 365 Open Source Plan #001 · Chrome extension for batch downloading via native browser channel

A Chrome extension for batch downloading files through the browser's native download channel. Cookies, User-Agent, and Referer headers are carried automatically -- no extra configuration needed.

[中文](README.zh.md) | English

[![Chrome Web Store](https://img.shields.io/chrome-web-store/v/fmmihnoplefjcfoggfgpeiomlbmjnfpm)](https://chromewebstore.google.com/detail/native-batch-downloader/fmmihnoplefjcfoggfgpeiomlbmjnfpm)

## How It Works

Click the toolbar icon, paste your URLs (one per line), set the delay and concurrency, then hit **Start Download**.

Under the hood it calls `chrome.downloads.download(url)` for each link, which is essentially the same as typing a URL into the address bar and pressing Enter. The browser handles the actual request, so all session cookies, UA strings, and headers are sent natively.

The download queue runs in a background service worker, so it keeps going even if you close the popup -- reopen it anytime to see live progress.

## Features

- **Native download channel** -- requests go through the browser itself, not `fetch` or `XMLHttpRequest`, so authentication cookies and headers are automatically included.
- **Concurrency & delay control** -- set how many files download in parallel (1-200) and an optional delay between downloads (in ms).
- **Real-time progress** -- live stats for total / succeeded / failed / waiting, with a progress bar.
- **Any file type** -- PDF, images, videos, archives, executables -- anything a direct URL points to.
- **Keeps running in the background** -- the queue lives in a service worker, so closing the popup doesn't stop it; reopen anytime to resume the live view.
- **Smart de-duplication** -- duplicate URLs download once, and skipped invalid/duplicate lines are reported in the log.
- **Filename handling** -- uses the filename from the URL when it has one, otherwise lets the server's `Content-Disposition` header name the file.
- **18 languages** -- AR, DE, EN, ES, FR, IT, JA, KO, NL, PL, PT-BR, RU, TH, TR, UK, VI, ZH-CN, ZH-TW.
- **Manifest V3** -- modern Chrome extension architecture, with a background service worker.

## Installation

**From Chrome Web Store (recommended):**

Install directly from the [Chrome Web Store](https://chromewebstore.google.com/detail/native-batch-downloader/fmmihnoplefjcfoggfgpeiomlbmjnfpm).

**Manual installation (development):**

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
5. Watch the log and stats update in real time. You can close the popup -- downloads keep going. Click **Stop** to cancel the batch, including downloads in progress.

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

### Large delay + closed popup

The queue runs in a background service worker, which Chrome may evict after a period of inactivity. If you set a large **Delay** (e.g. several seconds) and close the popup, the worker can be evicted during a wait gap with no in-flight download left to wake it -- the batch silently pauses. Reopening the popup resumes it automatically. With the popup open, or with delay at 0, this doesn't happen.

## About the 365 Open Source Plan

This is project #001 of the [365 Open Source Plan](https://github.com/rockbenben/365opensource).

One person + AI, 300+ open-source projects in one year. [Submit your idea →](https://my.feishu.cn/share/base/form/shrcnI6y7rrmlSjbzkYXh6sjmzb)

## License

[MIT](LICENSE)
