#!/bin/bash
set -e
mkdir -p /opt/zhixu/config
cp /tmp/digest.mjs /opt/zhixu/digest.mjs
[ -f /opt/zhixu/config/digest.json ] || cp /tmp/digest.json /opt/zhixu/config/digest.json
cp /tmp/digest.service /tmp/digest.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now digest.timer
echo "=== timer ==="
systemctl list-timers digest.timer --no-pager | head -3

echo "=== test run ==="
cat > /tmp/digest.test.json <<'JSON'
{"webUrl":"http://47.86.32.77:8080/","maxPerSource":1,"sources":[{"type":"rss","name":"ruanyifeng","url":"https://www.ruanyifeng.com/blog/atom.xml"}],"notify":{}}
JSON
rm -rf /tmp/zhixu-digest-test
cd /opt/zhixu
ZHIXU_DIGEST_CONFIG=/tmp/digest.test.json ZHIXU_DATA_DIR=/tmp/zhixu-digest-test /opt/node/bin/node digest.mjs 2>&1 | tail -20

echo "=== inbox ==="
curl -s http://127.0.0.1/api/inbox | head -c 600
echo
