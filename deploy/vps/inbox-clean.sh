#!/bin/bash
curl -s -X DELETE "http://127.0.0.1/api/inbox?id=c6727558d7d1e020"; echo
curl -s http://127.0.0.1/api/inbox -o /tmp/inbox2.json
/opt/node/bin/node -e '
const fs = require("fs");
const j = JSON.parse(fs.readFileSync("/tmp/inbox2.json", "utf8"));
console.log("remaining = " + j.items.length);
j.items.forEach((x) => console.log("- " + String(x.title || "").slice(0, 48) + "  |  " + (x.from || "")));
'
