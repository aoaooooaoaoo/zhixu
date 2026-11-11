"""把 app/ 打包成单文件 docs/知序MVP-单页版.html（图片内联、无外部依赖）。

用法：D:\\python\\python.exe scripts\\build_single.py
"""
from __future__ import annotations

import base64
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / "app"
OUT = ROOT / "docs" / "知序MVP-单页版.html"


def main() -> None:
    html = (APP / "index.html").read_text(encoding="utf-8")
    css = (APP / "styles.css").read_text(encoding="utf-8")
    js = (APP / "app.js").read_text(encoding="utf-8")
    fav = (APP / "favicon.svg").read_text(encoding="utf-8")
    fav_b64 = base64.b64encode(fav.encode("utf-8")).decode()

    html = re.sub(
        r'<link rel="icon"[^>]*href="favicon\.svg"[^>]*>',
        f'<link rel="icon" type="image/svg+xml" href="data:image/svg+xml;base64,{fav_b64}" />',
        html,
    )
    html = re.sub(r'<link rel="manifest"[^>]*>', "", html)
    html = re.sub(r"\n  <script>\n    if \('serviceWorker'[\s\S]*?</script>", "", html)
    html = re.sub(r'<link rel="stylesheet" href="styles\.css[^"]*" />', lambda m: f"<style>\n{css}\n</style>", html)
    html = re.sub(r'<script src="app\.js[^"]*" defer></script>', lambda m: f"<script>\n{js}\n</script>", html)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(html, encoding="utf-8")
    print(f"saved {OUT} ({len(html)} chars)")


if __name__ == "__main__":
    main()
