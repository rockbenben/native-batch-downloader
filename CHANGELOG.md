# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/) and this project adheres to
[Semantic Versioning](https://semver.org/).

## [1.2.0] - 2026-06-10

### Added

- **Six more UI languages** — Bengali (BN), Hindi (HI), Indonesian (ID), Persian (FA), Filipino (FIL), Urdu (UR); the extension now ships in 24 languages.
- **Settings memory** — concurrency, delay, and the subfolder toggle persist via `chrome.storage.sync` and are restored when the popup opens.
- **Toolbar badge progress** — the icon shows the remaining count (sun-yellow badge) while a batch runs and clears when it ends, so progress is visible with the popup closed.
- **Retry failed** — failed, interrupted, and Stop-abandoned URLs are tracked per batch; a Retry button re-queues them with the same settings (new `retryFailed` message in all 24 locales).
- **Drag-and-drop URL lists** — drop a `.txt`/`.csv` (≤5 MB, `text/*` MIME or matching extension) anywhere on the popup to append its contents to the editor.
- **Dated subfolder** — downloads save into `BatchDL/<local date>/` via `onDeterminingFilename` (covers server-named files too); toggleable in the popup, on by default (new `subfolder`/`subfolderTip` messages in all 24 locales).
- **Drafts survive** — an unstarted URL list is kept when the popup closes and restored on reopen; cleared once the batch starts (or the browser exits).
- **Assignable shortcut** — the popup can be bound to a keyboard shortcut at `chrome://extensions/shortcuts`.

### Changed

- **Popup redesigned** — new "Conveyor" look: cream cabinet, cobalt chassis, red stop button, chunky outlines and hard shadows; conveyor-belt progress bar and colored stat tiles. Toolbar icons redrawn to match at all four sizes. RTL layouts, reduced-motion, and all element IDs/behavior unchanged.
- **Display font bundled for all 24 locales** (~108 KB total, local files, no network). Latin/Vietnamese use Bricolage Grotesque subsets; Chinese (SC/TC), Japanese, Korean, Arabic-script, Devanagari, Bengali, Thai, and Cyrillic titles/buttons use exact-glyph Noto Sans Black subsets (2–12 KB each) selected per UI locale via `:lang()`. Regenerate with `scripts/subset-display-fonts.py` when display messages change. Data (URLs, numbers, log) stays in the system mono stack.
- **Delay now spaces every download start.** Previously the first `concurrency` downloads launched simultaneously and the delay only throttled refills after completions — a burst that defeats the delay's purpose on rate-limited servers. Every launch, including the first batch, now respects the gap as a minimum spacing between starts.
- **Clearer skip messages** — "Skipped 0 invalid, 3 duplicate URL(s)" is now two separate log lines, each shown only when its count is non-zero (all 24 locales updated).
- **Now requires Chrome 110+**, declared via `minimum_chrome_version` — the badge APIs need it, and the store refuses incompatible installs instead of letting the extension break silently.

### Fixed

- **RTL layout** — the popup now sets text direction from the UI locale (`@@bidi_dir`) and uses logical CSS properties, so Arabic, Persian, and Urdu render right-to-left correctly. The URL field stays LTR since URLs are LTR.
- **Stop stat accuracy** — queued URLs that were never started are now counted as failed when Stop is pressed, so `ok + fail` equals `total` instead of leaving a phantom "waiting" count and a progress bar that never fills.
- **Uppercase URL schemes** — `HTTP://` and `HTTPS://` links are now accepted; scheme matching is case-insensitive per RFC 3986 instead of being skipped as invalid.
- **URL-derived filenames that Chrome rejects no longer fail the download.** A decoded path segment containing characters illegal in filenames (`report 12:30.pdf`), a trailing dot/space, or a Windows reserved device name (`aux.pdf`) was passed as a `filename` override and made the download error out — without the override Chrome sanitizes the name and succeeds. Such names now fall back to Chrome's own naming.
- **Stale "No valid URLs found" line no longer lingers** above the next batch's log.
- Delay input is clamped to its documented 0–10000 ms range on both ends (typing past the max no longer takes effect).

## [1.1.0] - 2026-06-09

### Added

- **Background queue** — the download queue now runs in a Manifest V3 service worker, so it keeps going after the popup is closed; reopen the popup anytime to see live progress.
- **Automatic de-duplication** — duplicate URLs are downloaded once, and skipped invalid/duplicate lines are reported in the log.
- `storage` permission, used to persist queue state across service-worker restarts.

### Changed

- **Filename handling** — the URL path is used as the filename only when it looks like one (has an extension); otherwise the server's `Content-Disposition` name is kept instead of being overwritten with an extension-less path segment.
- **Stop** now also cancels downloads already in progress, not just the ones still queued.

### Fixed

- i18n placeholders (`$1`/`$2`) were rendered empty in log lines (e.g. "Starting  downloads"); counts now show correctly.
- A stalled or never-terminating download no longer freezes the UI — Stop reliably recovers, and one slow download no longer blocks the whole queue.
- Concurrency race on a cold service worker where simultaneous completion events could strand entries in the active set and hang the batch.
- The log view no longer stops updating after 500 lines.
- Opening the popup during a running background batch can no longer wipe it.
- **Stop stat accuracy** — downloads in the "launching" phase (sent to Chrome but not yet assigned an ID) are now correctly counted as failed when Stop is pressed; previously `ok + fail` could be less than `total`.
- **Filename safety** — URLs with percent-encoded slashes (`%2F` / `%5C`) in the last path segment no longer create unexpected subdirectories in the downloads folder; the extension now falls back to Chrome's own naming for those filenames.
- **Concurrency input 0** — typing `0` in the Concurrency field now correctly clamps to the minimum of 1; previously it silently defaulted to 10.

## [1.0.0]

- Initial release: batch download through the browser's native download channel, concurrency and delay control, real-time stats, 18 languages, Manifest V3.
