#!/bin/bash
set -euo pipefail

echo "=== 解压 Node ==="
mkdir -p /opt/node
if [ ! -x /opt/node/bin/node ]; then
  tar -xJf /tmp/node.tar.xz -C /opt/node --strip-components=1
fi
/opt/node/bin/node -v

echo "=== 解压知序 ==="
mkdir -p /opt/zhixu
tar -xzf /tmp/zhixu-vps.tar.gz -C /opt/zhixu
mkdir -p /opt/zhixu/data
ls -la /opt/zhixu | head -12

echo "=== systemd ==="
cat > /etc/systemd/system/zhixu.service <<'UNIT'
[Unit]
Description=Zhixu web (Node)
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/zhixu
ExecStart=/opt/node/bin/node server.mjs
Environment=NODE_OPTIONS=--max-old-space-size=192
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable zhixu >/dev/null 2>&1 || true
systemctl restart zhixu

sleep 3
echo "=== 状态 ==="
systemctl is-active zhixu || true
ss -lntp | grep ':80 ' || echo 'NO_LISTEN_80'
echo "=== 本机检查 ==="
curl -s http://127.0.0.1/__health || echo 'health 失败'
echo
curl -s http://127.0.0.1/api/health || echo 'api health 失败'
echo
