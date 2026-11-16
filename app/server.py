"""知序 MVP 本地服务：静态页面 + 可选真 AI 解析 + 分享链接导入。

用法（Windows）：
    D:\\python\\python.exe server.py
    然后打开 http://127.0.0.1:8788

AI 配置（三选一，不会把 key 写进前端）：
  1. 环境变量 WJ_LLM_API_KEY / WJ_LLM_BASE_URL / WJ_LLM_MODEL
  2. 本目录 .env（同上，键名 WJ_LLM_*）
  3. 复用核反应堆项目 apps/api/.env 里的 RP_LLM_*（只读，不修改）

分享能力：
  - POST /api/resolve   读取一个网页的标题/描述/正文（受平台登录/反爬限制时返回 blocked）
  - /share              接收 PWA Web Share Target 的分享参数（返回 index.html）
  - /api/inbox          QQ 桥等外部来源投递的待归档链接（GET/POST/DELETE）
"""
from __future__ import annotations

import html
import ipaddress
import json
import mimetypes
import os
import re
import socket
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

APP_DIR = Path(__file__).resolve().parent
ROOT_DIR = APP_DIR.parent
DATA_DIR = APP_DIR / "data"
INBOX_FILE = DATA_DIR / "inbox.json"
REACTOR_ENV = Path(r"D:\桌面\教学agent\核反应堆物理agent\apps\api\.env")
PORT = int(os.environ.get("WJ_PORT", "8788"))

DEFAULT_BASE = "https://maas-api.cn-huabei-1.xf-yun.com/v2"
DEFAULT_MODEL = "spark-x2.6-4b"
CATEGORY_HINT = "护肤与美妆、学习与效率、职场与成长、健康与生活、穿搭与风格、美食与旅行、理财与搞钱、家居与收纳、数码与工具、情绪与关系；放不进去时可以用「新知识 · 关键词」"
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 ZhixuBot/0.2"

INBOX_TOKEN = os.environ.get("WJ_INBOX_TOKEN", "")


def load_env_file(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    try:
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            k = k.strip()
            v = v.strip().strip('"').strip("'")
            if k:
                out[k] = v
    except OSError:
        pass
    return out


def read_config() -> dict[str, str]:
    env: dict[str, str] = {}
    for source in (APP_DIR / ".env", REACTOR_ENV):
        env.update(load_env_file(source))
    env.update({k: v for k, v in os.environ.items() if k.startswith(("WJ_LLM_", "RP_LLM_"))})

    def pick(*keys: str) -> str:
        for k in keys:
            if env.get(k):
                return env[k]
        return ""

    key = pick("WJ_LLM_API_KEY", "RP_LLM_API_KEY")
    base = pick("WJ_LLM_BASE_URL", "RP_LLM_BASE_URL") or DEFAULT_BASE
    model = pick("WJ_LLM_MODEL", "RP_LLM_MODEL") or DEFAULT_MODEL
    extra_raw = pick("WJ_LLM_EXTRA_BODY", "RP_LLM_EXTRA_BODY")
    try:
        extra = json.loads(extra_raw) if extra_raw else {"thinking": {"type": "disabled"}}
    except json.JSONDecodeError:
        extra = {"thinking": {"type": "disabled"}}
    return {"key": key, "base": base.rstrip("/"), "model": model, "extra": extra}


CONFIG = read_config()


# ---------------------------------------------------------------- AI 卡片
def build_prompt(text: str, url: str) -> list[dict]:
    system = (
        "你是「知序」，一个帮用户把小红书/网页笔记提炼成知识卡片的助手。"
        "只做提炼，不扩写、不编造。输出严格 JSON（不要 markdown 代码块），字段："
        '{"title": "不超过30字的标题", "summary": "80-120字的一句话摘要", '
        '"points": ["3-4条可执行要点，每条不超过60字"], '
        '"tags": ["3-5个短标签"], '
        f'"category": "从这些分类里选一个：{CATEGORY_HINT}", '
        '"topic": "这个分类下的具体主题，不超过12字", '
        '"core": "不超过10字的核心短语（名词短语，概括这张卡片的核心内容）", '
        '"quote": "原文里最值得保留的一句，不超过60字"}。'
        "category 必须尽量复用已有分类；只有完全无法归入时才新建「新知识 · 关键词」。"
        "标题要具体（写清对象与结论），不要用「核心内容」「知识梳理」「内容简介」这类空泛说法；core 用名词短语，同样不要写「核心内容」。"
    )
    user = f"原文：\n{text[:6000]}\n\n原帖链接（可能为空）：{url or '无'}\n请输出 JSON。"
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]


def parse_json_card(content: str) -> dict:
    content = content.strip()
    content = re.sub(r"^```(?:json)?\s*", "", content)
    content = re.sub(r"\s*```$", "", content)
    start = content.find("{")
    end = content.rfind("}")
    if start < 0 or end <= start:
        raise RuntimeError("模型没有返回 JSON")
    card = json.loads(content[start:end + 1])
    for key in ("title", "summary", "category", "topic"):
        card[key] = str(card.get(key) or "").strip()
    card["points"] = [str(x).strip() for x in (card.get("points") or []) if str(x).strip()][:5]
    card["tags"] = [str(x).strip() for x in (card.get("tags") or []) if str(x).strip()][:6]
    card["quote"] = str(card.get("quote") or "").strip()
    card["core"] = str(card.get("core") or "").strip()[:12]
    if not card["title"] or not card["summary"]:
        raise RuntimeError("模型返回的卡片字段不完整")
    return card


def call_llm(text: str, url: str) -> dict:
    if not CONFIG["key"]:
        raise RuntimeError("没有配置 LLM key")
    body = {
        "model": CONFIG["model"],
        "messages": build_prompt(text, url),
        "temperature": 0.2,
        "stream": False,
        **CONFIG["extra"],
    }
    req = urllib.request.Request(
        CONFIG["base"] + "/chat/completions",
        data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
        headers={"Content-Type": "application/json", "Authorization": "Bearer " + CONFIG["key"]},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=90) as resp:
        payload = json.loads(resp.read().decode("utf-8"))
    content = (payload.get("choices") or [{}])[0].get("message", {}).get("content", "")
    if not content:
        raise RuntimeError("模型返回为空")
    return parse_json_card(content)


# ---------------------------------------------------------------- 链接读取
def host_is_private(hostname: str) -> bool:
    try:
        infos = socket.getaddrinfo(hostname, None)
    except socket.gaierror:
        return True
    for info in infos:
        try:
            ip = ipaddress.ip_address(info[4][0])
        except ValueError:
            continue
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast:
            return True
    return False


def decode_html(raw: bytes, content_type: str) -> str:
    charset = ""
    m = re.search(r"charset=([\w-]+)", content_type or "", re.I)
    if m:
        charset = m.group(1)
    if not charset:
        m = re.search(rb"<meta[^>]+charset=[\"']?([\w-]+)", raw[:4000], re.I)
        if m:
            charset = m.group(1).decode("ascii", "ignore")
    for enc in (charset, "utf-8", "gb18030"):
        if not enc:
            continue
        try:
            return raw.decode(enc, errors="replace")
        except (LookupError, UnicodeDecodeError):
            continue
    return raw.decode("utf-8", errors="replace")


def meta_content(page: str) -> dict[str, str]:
    metas: dict[str, str] = {}
    for tag in re.findall(r"<meta\b[^>]*>", page, re.I):
        attrs = dict((k.lower(), v) for k, v in re.findall(r"([\w:-]+)\s*=\s*[\"']([^\"']*)[\"']", tag))
        key = (attrs.get("property") or attrs.get("name") or attrs.get("itemprop") or "").lower()
        if key and attrs.get("content"):
            value = html.unescape(attrs["content"]).strip()
            if value and key not in metas:
                metas[key] = value
    title = ""
    m = re.search(r"<title[^>]*>([\s\S]*?)</title>", page, re.I)
    if m:
        title = html.unescape(re.sub(r"\s+", " ", m.group(1))).strip()
    return metas


def extract_page(url: str) -> dict:
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        raise ValueError("只支持 http/https 链接")
    if host_is_private(parsed.hostname):
        raise ValueError("出于安全考虑，不读取本机/内网地址")
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.7",
        },
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        content_type = resp.headers.get("Content-Type", "")
        raw = resp.read(1_500_000 + 1)
        final_url = resp.geturl()
    if len(raw) > 1_500_000:
        raw = raw[:1_500_000]
    page = decode_html(raw, content_type)
    metas = meta_content(page)
    title = metas.get("og:title") or metas.get("twitter:title") or ""
    if not title:
        m = re.search(r"<title[^>]*>([\s\S]*?)</title>", page, re.I)
        title = html.unescape(re.sub(r"\s+", " ", m.group(1))).strip() if m else ""
    description = metas.get("og:description") or metas.get("description") or metas.get("twitter:description") or ""
    site = metas.get("og:site_name") or metas.get("application-name") or parsed.hostname.replace("www.", "")
    body = re.sub(r"(?is)<(script|style|noscript|svg|iframe)[^>]*>[\s\S]*?</\1>", " ", page)
    body = re.sub(r"(?is)<br\s*/?>|</p>|</div>|</li>|</h[1-6]>", "\n", body)
    body = re.sub(r"(?s)<[^>]+>", " ", body)
    body = html.unescape(body)
    body = re.sub(r"[ \t\u3000]+", " ", body)
    body = re.sub(r"\n{2,}", "\n", body).strip()
    body = "\n".join(line.strip() for line in body.splitlines() if len(line.strip()) >= 6)[:6000]
    blocked = False
    note = ""
    host = parsed.hostname or ""
    final_host = urllib.parse.urlparse(final_url).hostname or host
    is_xhs = "xiaohongshu.com" in host or "xiaohongshu.com" in final_host or "xhslink.cn" in host
    login_redirect = ("/login" in final_url) or ("website-login" in final_url) or ("/captcha" in final_url)
    if is_xhs and (login_redirect or len(body) < 100):
        blocked = True
        note = "小红书页面需要登录/有反爬限制，没能直接读取正文。链接已保留，请把笔记文字粘贴到下面。"
    if not body and not description:
        blocked = True
        note = note or "这个页面没有可读正文，可能被平台拦截或需要登录。链接已保留，请手动粘贴文字。"
    return {
        "ok": True, "url": final_url or url, "site": site,
        "title": title[:120], "description": description[:400],
        "text": body, "blocked": blocked, "note": note,
    }


# ---------------------------------------------------------------- 分享收件箱
def load_inbox() -> list[dict]:
    try:
        data = json.loads(INBOX_FILE.read_text(encoding="utf-8"))
        return data if isinstance(data, list) else []
    except (OSError, json.JSONDecodeError):
        return []


def save_inbox(items: list[dict]) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    INBOX_FILE.write_text(json.dumps(items[-100:], ensure_ascii=False, indent=2), encoding="utf-8")


def add_inbox_item(payload: dict) -> dict:
    raw_url = str(payload.get("url") or "").strip()
    url = extract_first_url(raw_url)
    if not url:
        raise ValueError("缺少有效的 http/https 链接")
    items = load_inbox()
    if any(x.get("url") == url for x in items):
        return next(x for x in items if x.get("url") == url)
    item = {
        "id": uuid.uuid4().hex[:12],
        "url": url,
        "title": str(payload.get("title") or "")[:120],
        "text": str(payload.get("text") or "")[:2000],
        "from": str(payload.get("from") or "QQ")[:80],
        "card": payload.get("card") if isinstance(payload.get("card"), dict) else None,
        "createdAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
    }
    items.append(item)
    save_inbox(items)
    return item


def extract_first_url(text: str) -> str:
    m = re.search(r"https?://[^\s<>\"']+", text or "")
    if not m:
        return ""
    return m.group(0).rstrip("，。！？、,.!?)）】")


# ---------------------------------------------------------------- HTTP
class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(APP_DIR), **kwargs)

    def log_message(self, fmt, *args):
        sys.stderr.write("[zhixu] " + fmt % args + "\n")

    def _json(self, code: int, payload: dict):
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def _check_token(self) -> bool:
        if not INBOX_TOKEN:
            return True
        return self.headers.get("X-Inbox-Token", "") == INBOX_TOKEN

    def _read_json(self) -> dict:
        length = int(self.headers.get("Content-Length") or 0)
        if length > 2_000_000:
            raise ValueError("请求太大")
        return json.loads(self.rfile.read(length).decode("utf-8") or "{}")

    def do_GET(self):
        path = self.path.split("?")[0]
        if path == "/api/health":
            self._json(200, {
                "ok": True, "name": "知序", "mode": "spark" if CONFIG["key"] else "local",
                "model": CONFIG["model"], "resolve": True, "inbox": True,
            })
            return
        if path == "/api/inbox":
            self._json(200, {"ok": True, "items": load_inbox()})
            return
        if path in ("/", "/index.html", "/share"):
            self.path = "/index.html"
            super().do_GET()
            return
        super().do_GET()

    def do_POST(self):
        path = self.path.split("?")[0]
        try:
            body = self._read_json()
        except Exception as e:
            self._json(400, {"ok": False, "error": str(e)})
            return

        if path == "/api/analyze":
            text = str(body.get("text") or "").strip()
            url = str(body.get("url") or "").strip()
            if len(text) < 12:
                self._json(400, {"ok": False, "error": "至少粘贴 12 个字"})
                return
            if not CONFIG["key"]:
                self._json(503, {"ok": False, "error": "未配置 LLM key，使用本地演示解析"})
                return
            try:
                card = call_llm(text, url)
                self._json(200, {"ok": True, "mode": "spark", "card": card})
            except urllib.error.HTTPError as e:
                self._json(502, {"ok": False, "error": f"模型接口 HTTP {e.code}"})
            except Exception as e:
                self._json(500, {"ok": False, "error": str(e)})
            return

        if path == "/api/resolve":
            try:
                page = extract_page(str(body.get("url") or "").strip())
                self._json(200, page)
            except urllib.error.HTTPError as e:
                self._json(502, {"ok": False, "error": f"页面返回 HTTP {e.code}"})
            except Exception as e:
                self._json(400, {"ok": False, "error": str(e)})
            return

        if path == "/api/inbox":
            if not self._check_token():
                self._json(401, {"ok": False, "error": "inbox token 不正确"})
                return
            try:
                item = add_inbox_item(body)
                self._json(200, {"ok": True, "item": item})
            except Exception as e:
                self._json(400, {"ok": False, "error": str(e)})
            return

        self._json(404, {"ok": False, "error": "not found"})

    def do_DELETE(self):
        path = self.path.split("?")[0]
        if not path.startswith("/api/inbox"):
            self._json(404, {"ok": False, "error": "not found"})
            return
        parsed = urllib.parse.urlparse(self.path)
        item_id = (urllib.parse.parse_qs(parsed.query).get("id") or [""])[0]
        if not item_id and path.startswith("/api/inbox/"):
            item_id = path.rsplit("/", 1)[-1]
        items = load_inbox()
        kept = [x for x in items if x.get("id") != item_id]
        save_inbox(kept)
        self._json(200, {"ok": True, "removed": len(items) - len(kept)})

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Max-Age", "86400")
        self.end_headers()

    def end_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Inbox-Token")
        super().end_headers()


def main():
    mimetypes.add_type("application/javascript", ".js")
    mimetypes.add_type("application/manifest+json", ".webmanifest")
    mimetypes.add_type("image/svg+xml", ".svg")
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"知序已启动：http://127.0.0.1:{PORT}")
    print("AI 模式：" + ("星火已配置（只显示模式，不打印 key）" if CONFIG["key"] else "本地演示（未配置 key）"))
    print("分享收件箱：" + ("需要 token" if INBOX_TOKEN else "未设 token（仅本机）"))
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止")


if __name__ == "__main__":
    main()
