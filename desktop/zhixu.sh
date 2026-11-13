#!/bin/bash
# Linux 运行：chmod +x zhixu.sh && ./zhixu.sh
cd "$(dirname "$0")/.." || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "需要 Node.js 22+：https://nodejs.org/"
  exit 1
fi
node desktop/launch.mjs
