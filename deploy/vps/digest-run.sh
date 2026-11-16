#!/bin/bash
set -e
cp /tmp/digest.mjs /opt/zhixu/digest.mjs
cp /tmp/digest.json /opt/zhixu/config/digest.json
systemctl daemon-reload
echo "=== 手动运行一次 digest ==="
systemctl start digest.service
sleep 2
journalctl -u digest.service -n 40 --no-pager | tail -30

echo "=== 收件箱统计 ==="
curl -s http://127.0.0.1/api/inbox -o /tmp/inbox.json
/opt/node/bin/node -e '
let s = "";
process.stdin.on("data", (d) => (s += d)).on("end", () => {
  try {
    const j = JSON.parse(s);
    console.log("items=" + j.items.length);
    j.items.slice(0, 8).forEach((x) => console.log("- " + String(x.title || "").slice(0, 46) + " | " + (x.from || "")));
  } catch (e) { console.log("parse err", e.message); }
});' < /tmp/inbox.json
