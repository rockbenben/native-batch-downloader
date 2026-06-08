# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/) and this project adheres to
[Semantic Versioning](https://semver.org/).

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
