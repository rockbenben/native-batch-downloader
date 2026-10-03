# Native Batch Downloader

> Chrome extension for batch downloading via native browser channel

**English** · [简体中文](README.zh.md)

[![Chrome Web Store](https://img.shields.io/chrome-web-store/v/fmmihnoplefjcfoggfgpeiomlbmjnfpm)](https://chromewebstore.google.com/detail/native-batch-downloader/fmmihnoplefjcfoggfgpeiomlbmjnfpm)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![365 Open Source Plan #001](https://img.shields.io/badge/365%20Open%20Source%20Plan-%23001-1f6feb)](https://github.com/rockbenben/365opensource)

**[⬇ Install from the Chrome Web Store](https://chromewebstore.google.com/detail/native-batch-downloader/fmmihnoplefjcfoggfgpeiomlbmjnfpm)** -- one click, auto-updates. Needs Chrome 110+.

![Paste links, download them all — files behind a login just work](assets/banner.png)

Paste a list of links and download them all at once. Because it downloads through the browser's own channel -- the same path as clicking a link yourself -- **files that require a login work too**: you stay signed in automatically, with no setup.

## How It Works

Click the toolbar icon, paste your URLs one per line, and hit **Start Download**. The queue runs in Chrome's own download pipeline -- the same one a click on a link uses -- which is why the request carries your cookies and no credentials need configuring anywhere.

That also sets the boundary: if a link doesn't download by clicking it in this browser, it won't work here either. Everything below is about making a few hundred of those clicks bearable.

## Features

- **Logged-in downloads just work** -- files go through the browser's own download channel, so you stay signed in automatically. Anything you can normally download while signed in, you can batch here.
- **Concurrency & delay control** -- set how many files download in parallel (1-200) and an optional minimum gap between download starts (in ms) -- every start is spaced, including the first batch, so rate-limited servers aren't hit with a burst.
- **Remembers your settings** -- concurrency, delay, and the folder toggle persist across sessions (synced to your browser profile).
- **Badge progress** -- the toolbar icon shows the remaining count while a batch runs, so progress stays visible with the popup closed.
- **Retry failed** -- after a batch ends, one click re-queues every URL that failed, was interrupted, or was abandoned by Stop.
- **Batch dashboard** -- the door icon in the popup header opens a full-page view: every link with its status and failure reason, filter chips, live byte progress, one-click copy of any link, and Pause/Resume. The FAIL tile jumps straight to the failures.
- **Pause & resume** -- hold new launches while in-flight downloads finish, then continue -- from the dashboard, or the popup's Resume button.
- **Right-click to collect** -- right-click any link on any page to add it to the popup's draft; start the batch when you have enough.
- **Survives browser restarts** -- if Chrome restarts mid-batch, the not-yet-started links are kept and the popup offers to resume them.
- **Drop a list file** -- drag a `.txt`/`.csv` of URLs onto the popup to load it into the editor.
- **Tidy subfolder** -- files save into `BatchDL/<date>/` inside your Downloads folder (toggleable), so a 200-file batch doesn't bury everything else.
- **Real-time progress** -- live stats for total / succeeded / failed / waiting, with a progress bar.
- **Any file type** -- PDF, images, videos, archives, executables -- anything a direct URL points to.
- **Keeps running in the background** -- closing the popup doesn't stop the queue; reopen anytime to resume the live view.
- **Smart de-duplication** -- duplicate URLs download once, and skipped invalid/duplicate lines are reported in the log.
- **Sensible filenames** -- files keep their proper names automatically, whether the name comes from the link or from the server.
- **24 languages** -- AR, BN, DE, EN, ES, FA, FIL, FR, HI, ID, IT, JA, KO, NL, PL, PT-BR, RU, TH, TR, UK, UR, VI, ZH-CN, ZH-TW.

## Installation

Requires Chrome 110 or newer (declared in the manifest; the Web Store won't offer it to older versions).

**From Chrome Web Store (recommended):**

Install directly from the [Chrome Web Store](https://chromewebstore.google.com/detail/native-batch-downloader/fmmihnoplefjcfoggfgpeiomlbmjnfpm).

**Manual installation (development):**

1. Download or clone this repository.
2. Open `chrome://extensions/` in Chrome.
3. Enable **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select the project folder.
5. The extension icon appears in the toolbar -- click it to open the popup.

## Usage

![Paste or drop links, watch the batch run, retry any failures](assets/popup-states.png)

1. Click the extension icon in the toolbar.
2. Paste direct download URLs into the text area, **one per line** -- or drag a `.txt`/`.csv` file of URLs onto the popup, or right-click links on any page and choose **Add link to batch**. The Start button shows how many valid links it found. An unstarted list is kept if the popup closes -- reopen and it's still there.
3. Adjust **Concurrency** (default 10) and **Delay** (default 0 ms) if needed, and choose whether files go into a dated `BatchDL/<date>/` subfolder (on by default). All three settings are remembered for next time.
4. Click **Start Download** (or press **Ctrl/Cmd+Enter** in the text area).
5. Watch the log and stats update in real time. You can close the popup -- downloads keep going, and the toolbar badge shows how many are left. Click **Stop** to cancel the batch, including downloads in progress. If Chrome itself restarts mid-batch, the remaining links survive and the popup offers to resume them.
6. Need more room? Click the **door icon** in the popup header -- it appears once a batch exists -- to open the batch dashboard: every link with its status and failure reason, filter chips, byte progress, and **Pause**. When a batch has failures, clicking the **FAIL** tile goes straight to them; copy any link from its row.
7. If anything failed, a **Retry Failed** button appears after the batch ends -- one click re-queues exactly those URLs.

![The batch dashboard: per-link status and reasons, filters, byte progress, pause](assets/dashboard.png)

## Important Notes

### Permissions & privacy

The extension declares exactly three permissions and **no host permissions**:

- **downloads** -- the core of the tool: files are queued through Chrome's own download pipeline (the same one a click uses), which is what carries your login state. Nothing is read from or written to disk outside those downloads.
- **storage** -- remembers your settings (`sync`), keeps an unstarted URL list while the popup is closed (`session`), and mirrors the not-yet-started queue so it can be offered back after a browser restart (`local`). All of it stays inside your browser profile; there is no account and no server.
- **contextMenus** -- adds the single "Add link to batch" item, shown only on links. Chrome hands the extension the clicked link's URL directly; the permission grants no access to page content, and the extension never reads or modifies any webpage.

### URLs must be direct links

If a website generates a temporary download URL via JavaScript after you click a button (e.g. cloud storage "Download" buttons), pasting the page URL won't work. You need the actual file URL.

### Login state matters

The extension can carry cookies because it uses the browser's own request pipeline. If the target site requires login and you haven't logged in within the browser, you'll still get a 403.

### Chrome's per-domain connection limit

Chrome only transfers about **6 files from the same site at once**. Even if you set concurrency to 100, downloads from a single site go roughly 6 at a time -- the rest wait their turn. Downloading from several different sites doesn't have this limit.

### Dangerous file type warnings

Executable files (`.exe`, `.bat`, etc.) may trigger Chrome's built-in security prompt, which interrupts the automated flow. No extension can suppress this -- it's a Chrome safety rule, and it applies to every download path including this one.

**What to do**: keep executables out of the big batches. Queue them separately in a small batch and confirm each prompt -- that check is exactly the one worth keeping when you're pulling binaries from the internet in bulk.

Turning Safe Browsing off in `chrome://settings/security` does remove the prompt, but it removes phishing and malware protection from *all* of your browsing, not just this download. Not worth it to save a few clicks.

PDFs and other common document types are not affected.

### Large delay + closed popup

Chrome may put the extension's background process to sleep after a period of inactivity. If you set a large **Delay** (e.g. several seconds) and close the popup, that nap can land in a wait gap with no download in flight to wake it up -- the batch silently pauses. Reopening the popup resumes it automatically. With the popup open, or with delay at 0, this doesn't happen.

## Development

No build step -- plain HTML/CSS/JS, loads unpacked as-is.

- After changing the `title`/`start`/`stop`/`retryFailed` messages or adding a locale, regenerate the bundled display-font subsets: `pip install fonttools brotli`, then `python scripts/subset-display-fonts.py` (fails loudly on missing glyphs).
- Build the Web Store upload zip: `python scripts/package.py`

## About the 365 Open Source Plan

Project **#001** of the [365 Open Source Plan](https://github.com/rockbenben/365opensource) — one person + AI, 300+ open-source projects in a year.

[Submit your idea →](https://365.aishort.top/) · [Discord](https://discord.gg/PZTQfJ4GjX) · [Telegram](https://t.me/aishort_top)
