#!/usr/bin/env python3
"""Build the GitHub Release notes for a version out of both changelogs.

    python scripts/release-notes.py 1.4.0 > notes.md
    python scripts/release-notes.py --check

The notes are the English section of CHANGELOG.md followed by the Chinese
section of CHANGELOG.zh.md for the SAME version. A missing section is a hard
error: a release whose notes silently drop half of the changelog is worse
than a failed release.

--check takes the version from manifest.json and only verifies that both
changelogs carry a section for it. That is the gate that catches a version
bump without its changelog sections on every push, long before the tag is
pushed.
"""
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
CHANGELOGS = (ROOT / "CHANGELOG.md", ROOT / "CHANGELOG.zh.md")
STORE = ("https://chromewebstore.google.com/detail/native-batch-downloader/"
         "fmmihnoplefjcfoggfgpeiomlbmjnfpm")
REPO = "https://github.com/rockbenben/native-batch-downloader"


def section(path: pathlib.Path, ver: str) -> str:
    """The body of the `## [ver]` section, without its heading."""
    text = path.read_text(encoding="utf-8")
    for chunk in text.split("\n## "):
        if chunk.startswith(f"[{ver}]"):
            return "\n".join(chunk.split("\n")[1:]).strip()
    raise SystemExit(f"{path.name} has no section for {ver} — write it before tagging")


def notes(ver: str) -> str:
    en = section(CHANGELOGS[0], ver)
    zh = section(CHANGELOGS[1], ver)
    return "\n".join([
        f"Install from the [Chrome Web Store]({STORE}),",
        'or download the zip below: unzip it, open `chrome://extensions`, '
        'enable Developer mode, and choose "Load unpacked".',
        "",
        f"## Changes in {ver}",
        "",
        en,
        "",
        "---",
        "",
        f"从 [Chrome 应用商店]({STORE})安装（一键、自动更新），",
        "或下载下方 zip：解压后打开 `chrome://extensions`，开启开发者模式，"
        "点「加载已解压的扩展程序」。",
        "",
        f"## {ver} 更新内容",
        "",
        zh,
        "",
        f"Source: {REPO}",
    ])


def main(argv: list) -> int:
    if "--check" in argv:
        ver = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))["version"]
        for path in CHANGELOGS:
            section(path, ver)
        print(f"CHANGELOG.md and CHANGELOG.zh.md both carry a section for {ver}")
        return 0
    if len(argv) != 1:
        print(__doc__)
        return 2
    print(notes(argv[0].lstrip("v")))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
