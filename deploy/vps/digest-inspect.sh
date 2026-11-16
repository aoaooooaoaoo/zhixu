#!/bin/bash
echo "=== digest.log (tail) ==="
tail -30 /opt/zhixu/data/digest.log 2>/dev/null || echo "(no log)"
echo
echo "=== process count ==="
ps aux | grep "[d]igest.mjs" | wc -l
echo
echo "=== state ==="
/opt/node/bin/node -e '
const fs = require("fs");
const s = JSON.parse(fs.readFileSync("/opt/zhixu/data/digest-state.json", "utf8"));
console.log(JSON.stringify({ runningAt: s.runningAt || "", lastRunAt: s.lastRunAt || "", added: (s.lastResult && s.lastResult.added) || 0 }));
'
echo
echo "=== inbox count ==="
curl -s http://127.0.0.1/api/inbox -o /tmp/inbox3.json
/opt/node/bin/node -e '
const fs = require("fs");
const j = JSON.parse(fs.readFileSync("/tmp/inbox3.json", "utf8"));
console.log("items = " + j.items.length);
'
