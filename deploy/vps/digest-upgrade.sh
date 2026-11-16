#!/bin/bash
set -e
cp /tmp/digest.timer /etc/systemd/system/digest.timer
cp /tmp/digest.mjs /opt/zhixu/digest.mjs
systemctl daemon-reload
systemctl restart digest.timer
echo "=== timer ==="
systemctl list-timers digest.timer --no-pager | head -3
echo "=== services ==="
systemctl is-active zhixu
echo "=== api ==="
curl -s http://127.0.0.1/api/health
echo
