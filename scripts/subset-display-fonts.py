#!/usr/bin/env python3
"""Build per-script display-font subsets for the popup.

The popup's display font (Bricolage Grotesque 800) renders the title and every
button label. Those strings are static per locale, so non-Latin scripts get an
exact-glyph subset of Noto Sans Black (a few KB each) instead of a
multi-megabyte full font. Latin/Vietnamese come straight from Bricolage's own
Google-served subsets.

DISPLAY_KEYS below is the single source of truth for which messages are
display-font rendered: scripts/i18n-check.py freezes the same set and
AGENTS.md lists it. A message that renders in the display font but is missing
from DISPLAY_KEYS has no glyphs baked for it — the browser falls back to a
system font mid-word, so every locale's string must be re-baked into fonts/
whenever a key is added or its text changes.

Run from the repo root after changing any of the DISPLAY_KEYS messages (or
adding a locale):

    python scripts/subset-display-fonts.py            # rebuild fonts/
    python scripts/subset-display-fonts.py --check    # verify committed fonts/

--check reads fonts/ as committed and reports any display string whose glyphs
are missing from the subset that serves its locale; it needs no network.

Outputs into fonts/ and prints the @font-face CSS to paste into popup.css
if ranges ever change. Requires: pip install fonttools brotli
"""

import io
import json
import re
import sys
import urllib.request
from pathlib import Path

from fontTools.subset import Options, Subsetter
from fontTools.ttLib import TTFont

import tempfile

ROOT = Path(__file__).resolve().parent.parent
LOCALES = ROOT / "_locales"
FONTS = ROOT / "fonts"
# Source-font cache lives in the system temp dir, not the repo — the CJK
# sources are ~8 MB each and would otherwise sit around as junk.
CACHE = Path(tempfile.gettempdir()) / "nbd-fontsrc-cache"

# Keys whose values are rendered in the display font (popup buttons + title).
# Keep in sync with FROZEN in scripts/i18n-check.py and with the "Frozen
# display keys" section of AGENTS.md.
DISPLAY_KEYS = ("title", "start", "stop", "retryFailed", "pause", "resume", "resumeDismiss")

# Locales served by the Bricolage whole-script subsets (Latin / Latin-ext /
# Vietnamese) rather than by a per-script exact-glyph subset.
LATIN_LOCALES = ["en", "de", "es", "fil", "fr", "id", "it", "nl", "pl", "pt_BR", "tr", "vi"]

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"

# script group -> (locales, source font)
# CJK sources are Noto's per-region subset OTFs on GitHub (Google's css2 API
# slices CJK into ~100 unicode-range shards, useless as subset input).
NOTO_CJK = "https://raw.githubusercontent.com/notofonts/noto-cjk/main/Sans/SubsetOTF/{r}/NotoSans{r}-Black.otf"
GROUPS = {
    "sc": (["zh_CN"], NOTO_CJK.format(r="SC")),
    "tc": (["zh_TW"], NOTO_CJK.format(r="TC")),
    "jp": (["ja"], NOTO_CJK.format(r="JP")),
    "kr": (["ko"], NOTO_CJK.format(r="KR")),
    # Non-CJK Noto fonts: take Google's whole-script subset woff2 as input.
    # (family, css2 subset comment) resolved via the css2 API below.
    "arabic": (["ar", "fa", "ur"], ("Noto Sans Arabic", "arabic")),
    "devanagari": (["hi"], ("Noto Sans Devanagari", "devanagari")),
    "bengali": (["bn"], ("Noto Sans Bengali", "bengali")),
    "thai": (["th"], ("Noto Sans Thai", "thai")),
    "cyrillic": (["ru", "uk"], ("Noto Sans", "cyrillic")),
}

# Declared in popup.html per face. Coarse script blocks are fine: codepoints
# the subset lacks simply fall through to the next family.
RANGES = {
    "sc": "U+3000-303F, U+4E00-9FFF, U+FF00-FFEF",
    "tc": "U+3000-303F, U+4E00-9FFF, U+FF00-FFEF",
    "jp": "U+3000-30FF, U+4E00-9FFF, U+FF00-FFEF",
    "kr": "U+1100-11FF, U+3130-318F, U+AC00-D7AF",
    "arabic": "U+0600-06FF, U+0750-077F, U+08A0-08FF, U+FB50-FDFF, U+FE70-FEFF",
    "devanagari": "U+0900-097F",
    "bengali": "U+0980-09FF",
    "thai": "U+0E00-0E7F",
    "cyrillic": "U+0400-04FF",
}

# Bricolage's own subsets, copied as-is (already small).
BRICOLAGE = "Bricolage Grotesque"
BRICOLAGE_SUBSETS = ("latin", "latin-ext", "vietnamese")


def fetch(url: str, cache_name: str) -> bytes:
    CACHE.mkdir(parents=True, exist_ok=True)
    cached = CACHE / cache_name
    if cached.exists():
        return cached.read_bytes()
    print(f"  fetching {url}")
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    data = urllib.request.urlopen(req).read()
    cached.write_bytes(data)
    return data


def css2_faces(family: str, weight: int) -> dict:
    """subset-name -> (woff2 url, unicode-range) from the css2 API."""
    url = f"https://fonts.googleapis.com/css2?family={family.replace(' ', '+')}:wght@{weight}&display=swap"
    css = fetch(url, f"css2-{family.replace(' ', '_')}-{weight}.css").decode()
    faces = {}
    for m in re.finditer(
        r"/\* (?P<sub>[a-z-]+) \*/\s*@font-face \{(?P<body>[^}]*)\}", css
    ):
        body = m.group("body")
        u = re.search(r"url\((?P<u>https://[^\)]+\.woff2)\)", body)
        r = re.search(r"unicode-range: (?P<r>[^;]+);", body)
        faces[m.group("sub")] = (u.group("u"), r.group("r"))
    return faces


def display_chars(locales: list) -> str:
    chars = set()
    for loc in locales:
        msgs = json.loads((LOCALES / loc / "messages.json").read_text("utf-8"))
        for key in DISPLAY_KEYS:
            chars.update(msgs[key]["message"])
    chars.add(" ")
    return "".join(sorted(chars))


def subset_to_woff2(src: bytes, text: str, out: Path) -> set:
    font = TTFont(io.BytesIO(src))
    opts = Options()
    opts.layout_features = ["*"]  # keep shaping (Arabic joining, Indic conjuncts)
    opts.flavor = "woff2"
    opts.name_IDs = [1, 2]
    sub = Subsetter(options=opts)
    sub.populate(text=text)
    sub.subset(font)
    font.save(out)
    cmap = font.getBestCmap()
    return {c for c in text if c != " " and ord(c) not in cmap}


def check_committed() -> int:
    """Verify the committed subsets already carry every display glyph.

    The rebuild path below only proves the SOURCE fonts can render the display
    strings. This mode reads fonts/ as committed, so a subset that was never
    re-baked after a display string changed fails the gate instead of shipping
    half-fallback labels. Needs no network.
    """
    problems = []
    for group, (locales, _source) in GROUPS.items():
        path = FONTS / f"display-{group}.woff2"
        if not path.is_file():
            problems.append(f"{group}: fonts/{path.name} is missing")
            continue
        cmap = TTFont(path).getBestCmap()
        for loc in locales:
            missing = {c for c in display_chars([loc]) if c != " " and ord(c) not in cmap}
            if missing:
                problems.append(
                    f"{loc}: fonts/{path.name} misses {sorted(missing)} — "
                    "rerun scripts/subset-display-fonts.py and commit fonts/"
                )
    latin_cmap = {}
    for sub in BRICOLAGE_SUBSETS:
        path = FONTS / f"bricolage-800-{sub}.woff2"
        if not path.is_file():
            problems.append(f"latin: fonts/{path.name} is missing")
            continue
        latin_cmap.update(TTFont(path).getBestCmap())
    for loc in LATIN_LOCALES:
        missing = {c for c in display_chars([loc]) if c != " " and ord(c) not in latin_cmap}
        if missing:
            problems.append(f"{loc}: the Bricolage subsets miss {sorted(missing)}")
    for line in problems:
        print(line)
    print(
        f"checked {len(GROUPS)} script subsets + {len(LATIN_LOCALES)} latin locales, "
        f"{len(problems)} problems"
    )
    return 1 if problems else 0


def main() -> int:
    if "--check" in sys.argv[1:]:
        return check_committed()
    FONTS.mkdir(exist_ok=True)
    failures = []
    css_lines = []

    print("Bricolage Grotesque (copied subsets):")
    for sub, (url, urange) in css2_faces(BRICOLAGE, 800).items():
        if sub not in BRICOLAGE_SUBSETS:
            continue
        out = FONTS / f"bricolage-800-{sub}.woff2"
        out.write_bytes(fetch(url, f"bricolage-{sub}.woff2"))
        print(f"  {out.name}  {out.stat().st_size:,} B")
        css_lines.append(
            f'@font-face {{ font-family: "BD Display"; src: url("fonts/{out.name}") '
            f'format("woff2"); font-weight: 800; font-display: swap; '
            f"unicode-range: {urange}; }}"
        )

    print(f"Script subsets (exact glyphs of {', '.join(DISPLAY_KEYS)}):")
    for group, (locales, source) in GROUPS.items():
        text = display_chars(locales)
        if isinstance(source, tuple):
            family, sub = source
            url, _ = css2_faces(family, 900)[sub]
            src = fetch(url, f"{family.replace(' ', '_')}-{sub}.woff2")
        else:
            src = fetch(source, source.rsplit("/", 1)[-1])
        out = FONTS / f"display-{group}.woff2"
        missing = subset_to_woff2(src, text, out)
        print(f"  {out.name}  {out.stat().st_size:,} B  ({len(text)} chars, {locales})")
        if missing:
            failures.append(f"{group}: missing glyphs {missing}")
        cjk = group in ("sc", "tc", "jp", "kr")
        fam = f"BD Display {group.upper()}" if cjk else "BD Display"
        css_lines.append(
            f'@font-face {{ font-family: "{fam}"; src: url("fonts/{out.name}") '
            f'format("woff2"); font-weight: 800; font-display: swap; '
            f"unicode-range: {RANGES[group]}; }}"
        )

    print("\n/* @font-face block for popup.css */")
    print("\n".join(css_lines))

    if failures:
        print("\nFAILURES:", *failures, sep="\n  ")
        return 1
    print("\nAll display strings covered.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
