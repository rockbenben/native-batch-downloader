---
version: alpha
name: Conveyor (Native Batch Downloader)
description: Chunky "vending machine for files" system — cream cabinet surfaces, cobalt chassis, ink outlines and hard offset shadows, springy motion. Serious work, toy energy.

colors:
  cream: &cream "#f4edda"
  canvas: *cream
  card: &card "#fdfaf1"
  surface: *card
  ink: &ink "#20242e"
  ink-soft: &ink-soft "#6f6852"
  on-primary: &on-primary "#ffffff"
  cobalt: &cobalt "#2547e0"
  cobalt-deep: "#1c38b5"
  red: "#e8442e"
  red-deep: "#c4301c"
  red-deeper: "#a52716"
  red-soft-bg: "#fde7e2"
  mint: "#237a52"
  mint-soft-bg: "#e2f3e7"
  sun: "#f5b80c"
  sun-deep: "#a8790a"
  sun-soft-bg: "#fff3c9"
  sun-hover: "#e0a90b"

typography:
  display-lg:
    fontFamily: '"BD Display", "Segoe UI", "Trebuchet MS", sans-serif'
    fontSize: 18px
    fontWeight: 800
    lineHeight: 1.15
    letterSpacing: -0.01em
  display-md:
    fontFamily: '"BD Display", "Segoe UI", "Trebuchet MS", sans-serif'
    fontSize: 14px
    fontWeight: 800
    lineHeight: 1.25
    letterSpacing: 0.02em
  stat-number:
    fontFamily: '"BD Display", "Segoe UI", "Trebuchet MS", sans-serif'
    fontSize: 21px
    fontWeight: 800
    lineHeight: 1
    letterSpacing: 0px
  body-md:
    fontFamily: '"SF Mono", "JetBrains Mono", "Cascadia Code", "Fira Code", ui-monospace, Consolas, monospace'
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: 0px
  input-md:
    fontFamily: '"SF Mono", ui-monospace, Consolas, monospace'
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: 0px
  label-caps:
    fontFamily: '"SF Mono", ui-monospace, Consolas, monospace'
    fontSize: 10px
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: 0.08em
  label-micro:
    fontFamily: '"SF Mono", ui-monospace, Consolas, monospace'
    fontSize: 10px
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: 0.1em
  log-md:
    fontFamily: '"SF Mono", ui-monospace, Consolas, monospace'
    fontSize: 11.5px
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: 0px

rounded:
  sm: 7px
  md: 10px
  lg: 13px
  chute: 12px
  pill: 99px

spacing:
  xxs: 4px
  xs: 6px
  sm: 8px
  md: 10px
  lg: 12px
  xl: 16px

components:
  button-start:
    backgroundColor: "{colors.cobalt}"
    textColor: "{colors.on-primary}"
    typography: "{typography.display-md}"
    rounded: "{rounded.lg}"
    padding: "11px 0"
  button-start-hover:
    backgroundColor: "{colors.cobalt-deep}"
    textColor: "{colors.on-primary}"
  button-stop:
    backgroundColor: "{colors.red-deep}"
    textColor: "{colors.on-primary}"
    typography: "{typography.display-md}"
    rounded: "{rounded.lg}"
    padding: "11px 0"
  button-stop-hover:
    backgroundColor: "{colors.red-deeper}"
    textColor: "{colors.on-primary}"
  button-retry:
    backgroundColor: "{colors.sun}"
    textColor: "{colors.ink}"
    typography: "{typography.display-md}"
    rounded: "{rounded.lg}"
    padding: "9px 0"
  button-retry-hover:
    backgroundColor: "{colors.sun-hover}"
    textColor: "{colors.ink}"
  text-area:
    backgroundColor: "{colors.card}"
    textColor: "{colors.ink}"
    typography: "{typography.input-md}"
    rounded: "{rounded.lg}"
    padding: "10px 12px"
  text-area-focused:
    backgroundColor: "{colors.card}"
    textColor: "{colors.ink}"
  dial:
    backgroundColor: "{colors.cream}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "7px 8px 8px"
  checkbox:
    backgroundColor: "{colors.card}"
    rounded: "{rounded.sm}"
    size: 23px
  checkbox-checked:
    backgroundColor: "{colors.cobalt}"
    textColor: "{colors.on-primary}"
  stat-tile:
    backgroundColor: "{colors.card}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "8px 4px"
  progress-belt:
    backgroundColor: "{colors.card}"
    rounded: "{rounded.pill}"
    height: 17px
---

# DESIGN.md — Conveyor

## Overview

The popup is one machine: a friendly file vending machine. A cream cabinet sits on a dotted
machine-room floor; everything the user can act on is outlined in 2.5px ink and lifted with a hard
offset shadow, so controls read as physical buttons, not web chrome. One cobalt primary action,
one red stop, one yellow service action. Motion is springy but short (entrance pop, blinking lamp,
riding belt stripes) and fully disabled under `prefers-reduced-motion`. The whole surface is a
fixed 420px popup — there is no responsive breakpoint, but every string must survive 24 locales,
including RTL (ar/fa/ur) and CJK display-font subsets.

## Colors

All colors come from the `:root` tokens; no literal hex in feature CSS outside the token block.
`cream` is the page canvas, `card` is every raised surface, `ink` is text and outline,
`ink-soft` is secondary text (placeholder, tile labels). `cobalt` is the primary action and
progress fill; `red-deep` (not the brighter decorative `red`) is the stop background so white
label text passes 4.5:1. `mint`/`sun`/`red-soft-bg` pairs are semantic success/warning/error
tints for stat tiles and log lines. Translucent inks exist only as named tokens
(`--floor-dot`, `--tile-shadow`, `--log-rule`, `--log-border`, `--scroll-thumb`) — never inline
`rgba()` at the point of use.

## Typography

Two families: `--display` (BD Display 800, per-locale CJK subsets picked by `:lang()`) for the
title, buttons and stat numbers; `--mono` for everything else. Levels are `display-lg` (title),
`display-md` (buttons), `stat-number`, `body-md` (base 13px), `input-md`, `label-caps` /
`label-micro` (uppercase 10px labels — never below 10px), and `log-md`. Uppercase + letter-spacing
is a label signature, but letter-spacing must be zeroed for Arabic-script locales
(`html[dir="rtl"]`) because tracking breaks Arabic glyph joining. The display font only renders
the `title`, `start`, `stop`, `retryFailed`, `pause`, `resume` and `resumeDismiss` messages —
the title and every button label; changing those strings requires rerunning
`scripts/subset-display-fonts.py`, and `scripts/subset-display-fonts.py --check` fails when the
committed subsets no longer cover them. A label whose glyphs are missing from its subset does not
fail loudly: the browser falls back per character, so the label renders half in the display font
and half in a fallback face.

## Layout

Two surfaces share this contract. The popup is a fixed 420px column
(`body.popup`): header → hopper (URL textarea) → dials (3-column grid) →
button row → belt → stat tiles → resume banner → service slot
(pause/resume/retry) → log. The dashboard
tab (`body.dash`, max 760px centered) is the machine room: same header, resume
banner, tiles and belt, then the byte readout and saved-folder line, filter
chips, a pause/stop/retry control row, and the batch table. Live syncs coalesce:
background status broadcasts at 150 ms, the dashboard refreshes at 500 ms;
a hidden dashboard skips fetches and catches up on visibility, and a
finished/stopped state refreshes immediately. Gaps and margins use the
`spacing` scale only (8/10/12/16, inner gaps 4/6). Neither surface scrolls
horizontally; the log and the batch table own vertical overflow with themed
scrollbars.

## Elevation & Depth

Two elevation kinds, both non-blurry: hard offset shadows for actionable surfaces (buttons
`4px 4px 0 ink`, chute/retry `3px 3px 0 ink`), and a soft `rgba(ink, 0.16)` offset for stat tiles
so they read as non-actionable. Pressing a button translates it by the shadow offset and drops the
shadow to 0 — the machine physically depresses. Focus is a 3px `sun` outline with 2px offset,
`focus-visible` only.

## Shapes

Chunky geometry: 2.5px ink borders everywhere (2px on tiles/inputs), radii from the `rounded`
scale — `lg` (13px) for cabinet surfaces, `chute` 12px, `sm` 7px for small controls, `pill` 99px
for the belt. Dashed 2px borders are reserved for the log (ticket stub) and the drag affordance.

## Components

- `button-start` / `button-stop` share the base button; stop is `red-deep` with `red-deeper`
  hover. Disabled buttons drop to 0.45 opacity with no shadow. Hover darkens; active presses.
- `button-retry` is the popup's sun-yellow service slot and shows exactly one action at a time: `Pause` while running, `Resume` while paused, or `Retry Failed` after a finished batch with failures. They are never visible together.
- `dashdoor` — the 28px card-white icon button left of the status lamp; opens the dashboard tab. Visible only once there is batch state to inspect (running, paused, a started batch, or a resumable queue) — with nothing to show the door stays hidden; the FAIL tile deep-links to failures when they exist.
- `text-area` focus lifts the card by 1px and paints a cobalt offset shadow; a dashed cobalt
  variant signals "drop files here" during dragover. Always LTR, even in RTL locales.
- `dial` wraps a label + control (number input or checkbox). Number inputs hide native spinners
  and center tabular digits; focus adds a cobalt border and 2px offset shadow.
- `checkbox` is a custom 23px box; the checkmark must use physical borders (`border-left`, not
  `border-inline-end`) so RTL does not flip it into an arrow.
- `stat-tile` shows a number + `label-micro` caption; semantic variants `ok` (mint), `fail`
  (red-deep), `wait` (sun-deep) on tinted backgrounds. The popup's fourth caption is
  `Remaining` (unfinished, including active). The dashboard's fourth tile is captioned
  `Waiting` but carries that same unfinished count (including active) — the dashboard's
  `Waiting` *filter chip* counts queued rows only, so the two readings of "waiting" differ
  by design and the tile caption is the one to watch.
- `progress-belt` is a pill bar; while running, stripes animate. It carries
  `role="progressbar"` with live `aria-valuenow`. The dashboard's byte
  readout is an LTR run (`direction: ltr`) — bare number+unit strings
  shuffle under RTL bidi otherwise.
- `saved-path` is a one-line 11px ink-soft destination under the byte readout
  after a finished/stopped batch with at least one saved file. It reuses the
  `savedFolder` copy and wraps the folder in LRM so the path stays LTR under RTL.
- Log lines are prefixed by CSS markers: `✓` mint, `✗` red, `▸` cobalt; newest on top.
  At the end of a batch that saved anything, a `▸` line names the destination folder.
  If the 500-line cap trims the opening start/skip lines, the invalid/duplicate counts
  are restated at the end; the popup drops trimmed lines from its DOM so they don't
  duplicate.
- `filter-chip` pills select batch-table subsets (all/waiting/downloading/done/failed)
  with live counts; the selected chip inverts to cobalt with `on-primary` text.
- `batch-row` repeats the log's glyph language per URL: status glyph
  (`✓ ✗ ▸ ○` — the waiting dot must read as a shape, not a speck), LTR
  saved filename (server Content-Disposition honored; conflict-suffixed names
  resolved from the finished DownloadItem; ellipsized, `title` carries the full
  URL), optional grey reason
  (a failure cause, or the advisory note when the saved file is an HTML
  page), and a `copy` button with the chunky 2px border and a 28px minimum hit area;
  rows lift to `card` on hover; a copied row flashes `mint-soft-bg` on the
  button for under a second. Rows render 400 at a time; a full-width, mono
  11px Show more text button reveals the next 400 instead of a dead `+N`.
- `resume-banner` (both surfaces) is a sun-tinted bar: message left, Resume
  (sun) and Discard (card) buttons right; it only appears when a restart-left
  batch is pending.
- Interaction states required for every actionable part: default, hover, focus-visible, active,
  disabled; plus loading (running: inputs disabled, lamp blinks), paused (lamp holds a steady
  sun, belt stripes freeze in place, the chute arrow keeps bobbing because in-flight downloads
  still land), and error (fail tile, retry). The running animations are scoped with
  `:not(.paused)`: a `:has()` selector out-specifies a plain `.paused` class, so the pause state
  has to exclude itself from the running rules rather than override them.

## Do's and Don'ts

- Do route every color through a `:root` token; don't write hex or `rgba()` inline at use sites.
- Do keep contrast ≥4.5:1 for label text on its actual background (stop button uses `red-deep`).
- Do test any copy change against ar/fa/ur (RTL mirroring) and zh/ja/ko (display subset) before shipping.
- Don't add new display-font strings without regenerating subsets.
- Don't use `letter-spacing` on Arabic/Thai text; don't rely on color alone for log status.
- Don't animate anything that isn't covered by the `prefers-reduced-motion` block.
- Don't duplicate the popup stylesheet — `popup.css` is the single source; `popup.html`, `dashboard.html` (+`dashboard.css`), `scripts/dev-harness*.html` and `store-assets/popup-shot.html` all link it.
