"""Flatten store assets to 24-bit RGB PNG (stores reject alpha) and verify sizes.

--check: verify only (CI gate) — never writes; a non-RGB or wrong-size image
fails loudly instead of being silently repaired in the workspace.
"""
import sys
from pathlib import Path
from PIL import Image

CHECK = "--check" in sys.argv
HERE = Path(__file__).parent
EXPECT = {
    "screenshot-1-1280x800.png": (1280, 800),
    "screenshot-2-1280x800.png": (1280, 800),
    "screenshot-3-1280x800.png": (1280, 800),
    "screenshot-4-1280x800.png": (1280, 800),
    "screenshot-5-1280x800.png": (1280, 800),
    "promo-small-440x280.png": (440, 280),
    "promo-marquee-1400x560.png": (1400, 560),
    "logo-300x300.png": (300, 300),
}

for name, size in EXPECT.items():
    p = HERE / name
    img = Image.open(p)
    assert img.size == size, f"{name}: {img.size} != {size}"
    if CHECK:
        assert img.mode == "RGB", f"{name}: mode {img.mode}, store rejects alpha (run flatten.py to fix)"
        print(f"{name}  {size[0]}x{size[1]}  mode=RGB  {p.stat().st_size:,}B")
        continue
    if img.mode != "RGB":
        # composite over the cream canvas so any transparency flattens cleanly
        bg = Image.new("RGB", img.size, (244, 237, 218))
        bg.paste(img, mask=img.split()[-1] if img.mode == "RGBA" else None)
        img = bg
        img.save(p, optimize=True)
    out = Image.open(p)
    print(f"{name}  {out.size[0]}x{out.size[1]}  mode={out.mode}  {p.stat().st_size:,}B")
print("ALL ASSETS 24-BIT RGB, SIZES EXACT")
