#!/bin/bash
echo "=== 状态文件 ==="
cat /opt/zhixu/data/digest-state.json 2>/dev/null | head -c 600
echo
echo "=== 配置 ==="
cat /opt/zhixu/config/digest.json 2>/dev/null | head -c 800
echo
echo "=== 手动 FORCE 运行 ==="
cd /opt/zhixu
ZHIXU_DIGEST_FORCE=1 /opt/node/bin/node /opt/zhixu/digest.mjs 2>&1 | tail -25
echo "=== 状态文件(后) ==="
cat /opt/zhixu/data/digest-state.json 2>/dev/null | head -c 400
echo
