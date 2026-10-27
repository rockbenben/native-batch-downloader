# Agent notes

Conventions this repo relies on — read before changing anything below.

## Gates (all runnable locally; all but flatten/smoke are wired into .github/workflows/ci.yml)

```
node --check background.js popup.js dashboard.js   # syntax
python scripts/i18n-check.py                       # locale parity/dups/registry/untranslated, exit 1 on finding
python scripts/package.py                          # zip whitelist + asset cross-reference validation
node scripts/run-tests.mjs                         # popup/dashboard/background behavior tests via headless CDP
node scripts/smoke.mjs                             # real-install: SW + contextMenus + getFull + popup
                                                   # (local only — needs Chrome for Testing; branded
                                                   # stable ignores --load-extension)
python store-assets/flatten.py --check             # store images: exact sizes, 24-bit RGB (local only —
                                                   # store PNGs are generated output, gitignored)
python scripts/subset-display-fonts.py             # font coverage (fails on missing glyphs)
python scripts/subset-display-fonts.py --check     # committed fonts/ still cover the current display strings
python scripts/release-notes.py --check            # both changelogs carry a section for manifest's version
```

Every gate was sabotage-tested (break it → go red → restore). Keep it that way when editing gates.

The dev-only Python dependencies (fontTools, brotli) are declared as ranges in
`requirements-dev.txt`; setup-python caches pip against that file, so CI
installs the font tooling from cache.

## Frozen display keys

`title`, `start`, `stop`, `retryFailed`, `pause`, `resume`, `resumeDismiss` are
baked into the per-script display-font subsets in `fonts/` — they are the
strings rendered in the display font (the title and every button label). The
set must stay in sync with `DISPLAY_KEYS` in the subset script and with
`FROZEN` in `i18n-check.py`; `extName` shows only in browser chrome, not in
display-font UI, so it is not frozen. Changing any of their values in any
locale REQUIRES rerunning `scripts/subset-display-fonts.py` (needs network;
retry on `IncompleteRead`; byte-churn-only subsets can be `git checkout`-reverted,
glyph-changed ones must be committed). `i18n-check.py` fails on frozen-key
drift, and `subset-display-fonts.py --check` fails when the committed subsets
no longer cover the current strings.

A display-font string that is missing from the subsets does not fail loudly —
the browser falls back to a system font for just the missing characters, so
the label renders half in the display font and half in a fallback. That is why
the key list is pinned from three places instead of one.

The freeze check compares the working tree against `HEAD`, so editing a frozen
key turns `i18n-check.py` red immediately and it stays red until the locale
change and the re-baked fonts are committed together. That is the intended
"deliberate act" signal, not a broken gate — commit both in the same commit.

## CSS single source

`popup.css` is the one stylesheet: `popup.html`, `dashboard.html` (plus
`dashboard.css` for the wide layout), `scripts/dev-harness*.html` and
`store-assets/popup-shot.html` all link it. Never paste popup CSS anywhere.
Design contract: `DESIGN.md` (audited by the design-review plugin; keep its
English section names exact).

## Behavior tests

`scripts/run-tests.mjs` serves the repo over HTTP, drives headless Chrome over
CDP, and evaluates `scripts/*-test.js` against the harnesses:
`scripts/dev-harness.html` (real `popup.js`), `scripts/dev-harness-dash.html`
(real `dashboard.js`) and `scripts/background-harness.html` (real
`background.js`). The harnesses stub `chrome.*`; they never reimplement app
logic. Each test file returns a JSON object, the runner compares it against the
`expect` map in `TESTS`, and any mismatch exits non-zero.

Adding a test: drop a `<name>-test.js` beside the others, add a `TESTS` entry
with the harness URL and the expected values, and extend the harness if the
state you need cannot be seeded. Harness state comes from query parameters —
`?state=` (popup), `?full=` / `?big=` (dashboard) — plus `window.pushState()`
for driving the live-sync path. `CHROME=<path>` overrides the browser binary.

## i18n rollouts

24 locales, one-line-per-key compact JSON, UTF-8 no BOM, CRLF, key order == en,
`$1` placeholders verbatim. Number phrases with `$1` must be inflection-safe
(label + colon form). Batch edits: shard agents write per-shard files and a
merge script applies them — never let multiple agents write one JSON (lost
updates). Verify with `git diff --numstat` per locale + `i18n-check.py`.

## Store listing

Store copy/search terms live in `013-fillduck/projects/native-batch-downloader/`
(runtime data, not this repo). Store images are generated: edit
`store-assets/*.html` → capture with headless CDP at deviceScaleFactor 2 →
downscale to exact sizes → `flatten.py` → `flatten.py --check`.

## Release

Plain-version bumps, push, tags and store publishing each need explicit user
approval. The order that works:

1. Bump the version in `manifest.json`.
2. Land a `## [X.Y.Z] - <date>` section in BOTH `CHANGELOG.md` and
   `CHANGELOG.zh.md` — the two sections are concatenated (English first) as
   the GitHub Release notes. Keep-a-changelog layout: the version section
   follows the preamble directly, and a release leaves no empty `[Unreleased]`
   section behind.
3. `scripts/release-notes.py --check` (a CI gate on every push) fails if
   either changelog lacks the section for the version in `manifest.json`, so
   a version bump without its sections goes red immediately.
4. Push to main, then `git tag vX.Y.Z && git push --tags`.

CI's release job runs only for a tag, only after the gates passed, and only
when the tag matches manifest.json. It builds the store zip and publishes the
GitHub Release. It does NOT publish to the Chrome Web Store — that upload is
manual, and the store listing copy lives outside this repo.

The tag-vs-manifest check is its own job, so a mistyped tag fails in seconds
instead of after the whole gate suite. The release step is idempotent: re-
running a tag updates the existing release instead of failing on "release
already exists".
