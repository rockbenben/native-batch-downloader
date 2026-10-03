# Agent notes

Conventions this repo relies on — read before changing anything below.

## Gates (all runnable locally; all but flatten/smoke are wired into .github/workflows/ci.yml)

```
node --check background.js popup.js dashboard.js   # syntax
python scripts/i18n-check.py                       # locale parity/dups/registry/untranslated, exit 1 on finding
python scripts/package.py                          # zip whitelist + asset cross-reference validation
node scripts/run-tests.mjs                         # draft/flush behavior tests via headless CDP
node scripts/smoke.mjs                             # real-install: SW + contextMenus + getFull + popup
                                                   # (local only — needs Chrome for Testing; branded
                                                   # stable ignores --load-extension)
python store-assets/flatten.py --check             # store images: exact sizes, 24-bit RGB (local only —
                                                   # store PNGs are generated output, gitignored)
python scripts/subset-display-fonts.py             # font coverage (fails on missing glyphs)
```

Every gate was sabotage-tested (break it → go red → restore). Keep it that way when editing gates.

## Frozen display keys

`title`, `start`, `stop`, `retryFailed` are baked into the per-script
display-font subsets in `fonts/` (the set must stay in sync with
`DISPLAY_KEYS` in the subset script; `extName` shows only in browser chrome,
not in display-font UI). Changing any of their values in any locale
REQUIRES rerunning `scripts/subset-display-fonts.py` (needs network; retry on
`IncompleteRead`; byte-churn-only subsets can be `git checkout`-reverted, glyph-
changed ones must be committed). `i18n-check.py` fails on frozen-key drift.

## CSS single source

`popup.css` is the one stylesheet: `popup.html`, `dashboard.html` (plus
`dashboard.css` for the wide layout), `scripts/dev-harness*.html` and
`store-assets/popup-shot.html` all link it. Never paste popup CSS anywhere.
Design contract: `DESIGN.md` (audited by the design-review plugin; keep its
English section names exact).

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
approval; CI's release step only runs after `git tag vX.Y.Z && git push --tags`,
requires manifest.json to match the tag, and fails when CHANGELOG.md has no
section for the tagged version (that section becomes the release notes).
