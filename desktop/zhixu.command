#!/bin/bash
# macOS 双击运行（首次可能需要：chmod +x "zhixu.command"）
cd "$(dirname "$0")/.." || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "需要 Node.js 22+：https://nodejs.org/"
  read -n 1 -s -r -p "按任意键退出"
  exit 1
fi
node desktop/launch.mjs
