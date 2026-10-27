#!/usr/bin/env python3
"""i18n acceptance gate for every _locales/<loc>/messages.json.

Run from anywhere; checks, per locale:
  1. valid UTF-8 JSON, no BOM, no duplicate keys (json keeps the last silently
     and the first entry becomes dead weight — this bit 002-legend-talk)
  2. the locale directory set matches the shipped registry
  3. key set AND order identical to en
  4. $1/$2 placeholder multiset identical to en per key
  5. frozen display-font keys (title/start/stop/retryFailed/pause/resume/
     resumeDismiss) unchanged versus HEAD — changing one means re-running
     scripts/subset-display-fonts.py, so it must be a deliberate act
     (extName is excluded: it only shows in the browser chrome)
  6. the placeholder keeps its two example URL lines
  7. no untranslated prose: a >=4-word sentence identical to English is a
     missed translation (brand keys exempt)

Exits non-zero on any finding; this is the CI gate, not a report.
"""
import json, subprocess, sys, collections, pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
LOCALES = ROOT / "_locales"
FROZEN = ["title", "start", "stop", "retryFailed", "pause", "resume", "resumeDismiss"]  # == subset DISPLAY_KEYS; extName is not display-font rendered
SHIPPED = {"en", "ar", "bn", "de", "es", "fa", "fil", "fr", "hi", "id", "it",
           "ja", "ko", "nl", "pl", "pt_BR", "ru", "th", "tr", "uk", "ur", "vi",
           "zh_CN", "zh_TW"}
BRAND_KEYS = {"extName", "title"}  # brand strings may legitimately equal en

def ph(s):
    return collections.Counter(t for t in ("$1", "$2") if t in s)

def load_strict(raw: bytes):
    """Parse JSON but surface duplicate keys instead of last-wins."""
    dups = []
    def hook(pairs):
        counts = collections.Counter(k for k, _ in pairs)
        dups.extend(k for k, n in counts.items() if n > 1)
        return dict(pairs)
    return json.loads(raw.decode("utf-8"), object_pairs_hook=hook), dups

# findings contain non-ASCII UI strings; Windows consoles default to GBK and
# would crash the report mid-print (exit code stays correct, the text is lost)
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

problems = []
baseline = {}

on_disk = {p.name for p in LOCALES.iterdir() if p.is_dir()} if LOCALES.is_dir() else set()
for gone in sorted(SHIPPED - on_disk):
    problems.append(f"{gone}: locale directory missing (in registry, not on disk)")
for stray in sorted(on_disk - SHIPPED):
    problems.append(f"{stray}: stray locale directory (not in the shipped registry)")

for p in sorted(LOCALES.iterdir()):
    if not p.is_dir():
        continue
    loc = p.name
    mf = p / "messages.json"
    if not mf.exists():
        problems.append(f"{loc}: no messages.json")
        continue
    raw = mf.read_bytes()
    if raw.startswith(b"\xef\xbb\xbf"):
        problems.append(f"{loc}: BOM")
    try:
        data, dups = load_strict(raw)
    except Exception as e:
        problems.append(f"{loc}: invalid JSON {e}")
        continue
    if dups:
        problems.append(f"{loc}: DUPLICATE keys {sorted(set(dups))} — the earlier entry is silently dead")
    old = subprocess.run(
        ["git", "show", f"HEAD:_locales/{loc}/messages.json"],
        cwd=ROOT, capture_output=True)
    if old.returncode == 0:
        old_data = json.loads(old.stdout.decode("utf-8"))
        for k in FROZEN:
            if k in old_data and data.get(k, {}).get("message") != old_data[k]["message"]:
                problems.append(
                    f"{loc}: FROZEN key {k} changed: {old_data[k]['message']!r} -> "
                    f"{data.get(k, {}).get('message')!r} — rerun scripts/subset-display-fonts.py")
    baseline[loc] = data

if "en" not in baseline:
    print("\n".join(problems) or "en unreadable")
    print("checked %d locales, %d problems" % (len(baseline), len(problems) + 1))
    sys.exit(1)

en = baseline["en"]
for loc, data in baseline.items():
    if loc == "en":
        continue
    if list(data) != list(en):
        missing = [k for k in en if k not in data]
        extra = [k for k in data if k not in en]
        problems.append(f"{loc}: key mismatch missing={missing} extra={extra} (order-only diff if lists equal as sets)")
        continue
    for k in en:
        v, e = data[k]["message"], en[k]["message"]
        if ph(v) != ph(e):
            problems.append(f"{loc}: placeholder mismatch in {k}: {e!r} vs {v!r}")
        if k not in BRAND_KEYS and v == e and len(v.split()) >= 4:
            problems.append(f"{loc}: {k} is untranslated (identical to English): {v!r}")
    if data["placeholder"]["message"].count("\n") != 2:
        problems.append(f"{loc}: placeholder lost its example lines")

for line in problems:
    print(line)
print(f"checked {len(baseline)} locales, {len(problems)} problems")
sys.exit(1 if problems else 0)
