#!/bin/bash
set -e
# 清掉卡住的 runningAt 标记
/opt/node/bin/node -e '
const fs = require("fs");
const f = "/opt/zhixu/data/digest-state.json";
const s = JSON.parse(fs.readFileSync(f, "utf8"));
s.runningAt = "";
fs.writeFileSync(f, JSON.stringify(s, null, 2));
console.log("cleared runningAt");
'
cp /tmp/digest.mjs /opt/zhixu/digest.mjs
md5sum /opt/zhixu/digest.mjs
systemctl is-active zhixu
