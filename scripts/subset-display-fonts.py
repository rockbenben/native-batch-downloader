#!/usr/bin/env python3
"""Build per-script display-font subsets for the popup.

The popup's display font (Bricolage Grotesque 800) only renders three strings:
the title and the two button labels. Those strings are static per locale, so
non-Latin scripts get an exact-glyph subset of Noto Sans Black (a few KB each)
instead of a multi-megabyte full font. Latin/Vietnamese come straight from
Bricolage's own Google-served subsets.

Run from the repo root after changing any of the `title`, `start`, or `stop`
messages (or adding a locale):

    python scripts/subset-display-fonts.py

Outputs into fonts/ and prints the @font-face CSS to paste into popup.html
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

# Keys whose values are rendered in the display font (popup.html).
DISPLAY_KEYS = ("title", "start", "stop", "retryFailed")

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


def main() -> int:
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

    print("Script subsets (exact glyphs of title/start/stop):")
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

    print("\n/* @font-face block for popup.html */")
    print("\n".join(css_lines))

    if failures:
        print("\nFAILURES:", *failures, sep="\n  ")
        return 1
    print("\nAll display strings covered.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
