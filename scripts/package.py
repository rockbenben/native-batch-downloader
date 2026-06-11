#!/usr/bin/env python3
"""Build the Chrome Web Store upload zip.

Whitelist-based: only runtime files go in, so dev artifacts (scripts/, font
source caches, store-descriptions.json, READMEs) can never leak into the
package. Validates every cross-file asset reference before zipping and fails
loudly on any mismatch.

    python scripts/package.py

Output: native-batch-downloader-v<version>.zip in the repo root (gitignored
via *.zip).
"""

import json
import re
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Everything the extension needs at runtime — and nothing else.
RUNTIME = [
    "manifest.json",
    "background.js",
    "popup.html",
    "popup.js",
]
RUNTIME_DIRS = {
    "_locales": "**/messages.json",
    "icons": "*.png",
    "fonts": "*.woff2",
}


def fail(msg: str) -> None:
    print(f"ERROR: {msg}")
    sys.exit(1)


def collect() -> list:
    files = []
    for name in RUNTIME:
        p = ROOT / name
        if not p.is_file():
            fail(f"missing runtime file: {name}")
        files.append(p)
    for d, pattern in RUNTIME_DIRS.items():
        base = ROOT / d
        if not base.is_dir():
            fail(f"missing runtime dir: {d}/")
        matched = sorted(base.glob(pattern))
        if not matched:
            fail(f"no files match {d}/{pattern}")
        files.extend(matched)
    return files


def validate(files: list) -> None:
    rel = {f.relative_to(ROOT).as_posix() for f in files}
    manifest = json.loads((ROOT / "manifest.json").read_text("utf-8"))

    # every icon the manifest references must be in the package
    icon_refs = list(manifest.get("icons", {}).values()) + list(
        manifest.get("action", {}).get("default_icon", {}).values()
    )
    for icon in icon_refs:
        if icon not in rel:
            fail(f"manifest references {icon} but it is not packaged")
    # ...and the other direction: a stray PNG in icons/ (a mis-saved export)
    # must not ride into the package silently
    packaged_icons = {p for p in rel if p.startswith("icons/")}
    if orphans := packaged_icons - set(icon_refs):
        fail(f"packaged icons the manifest never references: {sorted(orphans)}")

    # service worker + popup
    for key, path in [
        ("service worker", manifest["background"]["service_worker"]),
        ("popup", manifest["action"]["default_popup"]),
    ]:
        if path not in rel:
            fail(f"manifest {key} {path} not packaged")

    # every font popup.html loads must be in the package, and vice versa
    html = (ROOT / "popup.html").read_text("utf-8")
    font_refs = set(re.findall(r'url\("(fonts/[^"]+)"\)', html))
    packaged_fonts = {p for p in rel if p.startswith("fonts/")}
    if missing := font_refs - packaged_fonts:
        fail(f"popup.html loads unpackaged fonts: {sorted(missing)}")
    if orphans := packaged_fonts - font_refs:
        fail(f"packaged fonts nothing references: {sorted(orphans)}")

    # default locale must exist
    if f"_locales/{manifest['default_locale']}/messages.json" not in rel:
        fail(f"default locale {manifest['default_locale']} not packaged")


def build(files: list) -> Path:
    manifest = json.loads((ROOT / "manifest.json").read_text("utf-8"))
    out = ROOT / f"native-batch-downloader-v{manifest['version']}.zip"
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for f in files:
            # forward-slash entry names — the store rejects backslash paths
            z.write(f, f.relative_to(ROOT).as_posix())
    return out


def main() -> None:
    files = collect()
    validate(files)
    out = build(files)
    size = out.stat().st_size
    print(f"packaged {len(files)} files -> {out.relative_to(ROOT)} ({size:,} bytes)")
    for f in sorted(p.relative_to(ROOT).as_posix() for p in files):
        print(f"  {f}")


if __name__ == "__main__":
    main()
