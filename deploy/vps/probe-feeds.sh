#!/bin/bash
echo "=== Bing News RSS 测试（关键词：西安交通大学）==="
curl -s -m 20 -A "Mozilla/5.0" "https://www.bing.com/news/search?q=%E8%A5%BF%E5%AE%89%E4%BA%A4%E9%80%9A%E5%A4%A7%E5%AD%A6&format=rss" -o /tmp/bing.xml -w "HTTP %{http_code} size %{size_download}\n" || echo "curl 失败"
head -c 600 /tmp/bing.xml; echo
echo "=== 条目数 ==="
grep -o "<item>" /tmp/bing.xml | wc -l

echo "=== Google News RSS 测试 ==="
curl -s -m 20 -A "Mozilla/5.0" "https://news.google.com/rss/search?q=%E8%A5%BF%E5%AE%89%E4%BA%A4%E9%80%9A%E5%A4%A7%E5%AD%A6&hl=zh-CN&gl=CN&ceid=CN:zh-Hans" -o /tmp/gnews.xml -w "HTTP %{http_code} size %{size_download}\n" || echo "curl 失败"
grep -o "<item>" /tmp/gnews.xml | wc -l

echo "=== Qmsg 推送测试 ==="
curl -s -m 20 -X POST "https://qmsg.zendee.cn/send/77d953bf173b5a1aac50ec001394eca3d0e3c6dc" \
  --data-urlencode "msg=【知序】测试消息：服务器推送通道已打通 $(date '+%H:%M:%S')" -w "\nHTTP %{http_code}\n"
