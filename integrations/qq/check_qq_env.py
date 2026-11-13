"""知序 · QQ 接入环境检查（只读，不启动/关闭任何 QQ 或程序）。

用法：
    D:\\python\\python.exe integrations\\qq\\check_qq_env.py

检查：
  - 本机 QQ 是否在运行（只看进程，不碰它）
  - NapCat / Lagrange 是否已安装（常见目录）
  - OneBot 端口是否在监听
  - Node 版本是否够跑桥
  - 知序 server.py 是否已启动
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import urllib.request
from pathlib import Path

PORTS = [3001, 6099, 6700, 8788]


def find_qq() -> list[str]:
    out: list[str] = []
    candidates = [
        Path(r"D:\QQ\QQ.exe"),
        Path(os.environ.get("ProgramFiles", r"C:\Program Files")) / "Tencent" / "QQNT" / "QQ.exe",
        Path(os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)")) / "Tencent" / "QQNT" / "QQ.exe",
        Path(os.environ.get("LOCALAPPDATA", "")) / "Programs" / "QQ" / "QQ.exe",
    ]
    for p in candidates:
        if p.exists():
            out.append(str(p))
    # 运行中的 QQ 路径
    try:
        cmd = [
            "powershell", "-NoProfile", "-Command",
            "Get-Process QQ -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Path -Unique",
        ]
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=8)
        for line in r.stdout.splitlines():
            line = line.strip()
            if line and line.lower().endswith("qq.exe") and line not in out:
                out.append(line)
    except Exception:
        pass
    return out


def find_napcat() -> list[str]:
    out: list[str] = []
    candidates = [
        Path(os.environ.get("LOCALAPPDATA", "")) / "Programs" / "NapCat",
        Path(os.environ.get("LOCALAPPDATA", "")) / "NapCat",
        Path(os.environ.get("ProgramFiles", r"C:\Program Files")) / "NapCat",
        Path(os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)")) / "NapCat",
        Path(r"D:\NapCat"),
        Path(r"D:\NapCat\NapCat.52230.Shell"),
    ]
    for p in candidates:
        if p.exists():
            out.append(str(p))
    return out


def ports() -> dict[int, bool]:
    out: dict[int, bool] = {}
    try:
        r = subprocess.run(
            ["powershell", "-NoProfile", "-Command",
             "Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty LocalPort"],
            capture_output=True, text=True, timeout=8,
        )
        listening = {int(x) for x in r.stdout.split() if x.isdigit()}
        for p in PORTS:
            out[p] = p in listening
    except Exception:
        for p in PORTS:
            out[p] = False
    return out


def node_version() -> str:
    exe = shutil.which("node")
    if not exe:
        return "未找到 Node（需要 Node.js 22+）"
    try:
        return subprocess.run([exe, "--version"], capture_output=True, text=True, timeout=5).stdout.strip()
    except Exception:
        return "未知"


def zhiXu_health() -> str:
    try:
        with urllib.request.urlopen("http://127.0.0.1:8788/api/health", timeout=2) as r:
            return r.read().decode("utf-8", "replace")
    except Exception:
        return "未启动"


def main() -> None:
    print("=" * 64)
    print("知序 · QQ 接入环境检查（只读）")
    print("=" * 64)
    qq = find_qq()
    napcat = find_napcat()
    ps = ports()
    print("QQ 路径 / 进程：")
    print("  " + ("\n  ".join(qq) if qq else "未找到 QQ"))
    print("NapCat：")
    print("  " + ("\n  ".join(napcat) if napcat else "未安装（或不在常见目录）"))
    print("端口：")
    for p, ok in ps.items():
        label = {3001: "OneBot WS", 6099: "NapCat WebUI", 6700: "OneBot 反向 WS", 8788: "知序"}.get(p, "")
        print(f"  {p} {label}: {'监听中' if ok else '未监听'}")
    print("Node：" + node_version())
    print("知序 health：" + zhiXu_health()[:160])
    print("-" * 64)
    print("下一步：")
    if not napcat:
        print("1. 安装 NapCatQQ（https://github.com/NapNeko/NapCatQQ），用新 QQ 小号扫码登录；")
        print("2. 在 NapCat 里开启 OneBot 11 WebSocket 服务器（如 3001）并设置 token；")
    elif not ps.get(3001):
        print("1. 启动 NapCat，用新 QQ 小号扫码登录；")
        print("2. 确认 OneBot 11 WebSocket 服务器在 3001 监听；")
    else:
        print("OneBot 端口已在监听，可以运行 qq_bridge.mjs 联调。")
    if not ps.get(8788):
        print("3. 先启动知序：cd app && D:\\python\\python.exe server.py")
    print("4. 运行桥：node integrations/qq/qq_bridge.mjs")
    print("注意：第三方协议有账号风控风险，只用小号；不要把 QQ 密码写进任何文件。")


if __name__ == "__main__":
    main()
