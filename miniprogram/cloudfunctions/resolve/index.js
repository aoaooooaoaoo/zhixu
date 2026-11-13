// 云函数 resolve：抓取公开网页 → 标题 / 描述 / 正文
// 保留网页版的 SSRF 防护：拒绝本机与内网地址。

const cloud = require('wx-server-sdk');
const https = require('https');
const http = require('http');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 ZhixuBot/0.3';
const MAX_BYTES = 1500000;

function isPrivateHost(hostname) {
  const h = String(hostname || '').toLowerCase();
  if (!h) return true;
  if (h === 'localhost' || h === '::1' || h.endsWith('.local')) return true;
  if (/^127\./.test(h) || /^10\./.test(h) || /^169\.254\./.test(h) || /^0\./.test(h)) return true;
  if (/^192\.168\./.test(h)) return true;
  const m = h.match(/^172\.(\d+)\./);
  if (m && Number(m[1]) >= 16 && Number(m[1]) <= 31) return true;
  if (/^\[?::1\]?$/.test(h) || /^\[?fc/.test(h) || /^\[?fe80/.test(h)) return true;
  return false;
}

function fetchOnce(urlStr, timeoutMs) {
  return new Promise(function (resolve, reject) {
    let u;
    try {
      u = new URL(urlStr);
    } catch (e) {
      reject(new Error('链接格式不对'));
      return;
    }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      reject(new Error('只支持 http/https 链接'));
      return;
    }
    if (isPrivateHost(u.hostname)) {
      reject(new Error('出于安全考虑，不读取本机/内网地址'));
      return;
    }
    const lib = u.protocol === 'http:' ? http : https;
    const req = lib.request({
      hostname: u.hostname,
      port: u.port || (u.protocol === 'http:' ? 80 : 443),
      path: u.pathname + (u.search || ''),
      method: 'GET',
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.7'
      }
    }, function (res) {
      // 跟随重定向
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        resolve({ redirect: res.headers.location });
        res.resume();
        return;
      }
      const chunks = [];
      let size = 0;
      res.on('data', function (chunk) {
        size += chunk.length;
        if (size <= MAX_BYTES) chunks.push(chunk);
      });
      res.on('end', function () {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          buffer: Buffer.concat(chunks),
          finalUrl: urlStr
        });
      });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs || 15000, function () {
      req.destroy(new Error('页面读取超时'));
    });
    req.end();
  });
}

async function fetchPage(urlStr) {
  let current = urlStr;
  for (let i = 0; i < 4; i++) {
    const res = await fetchOnce(current, 15000);
    if (res.redirect) {
      current = new URL(res.redirect, current).toString();
      continue;
    }
    res.finalUrl = current;
    return res;
  }
  throw new Error('重定向次数过多');
}

function decodeHtml(buffer, contentType) {
  let charset = '';
  const m = String(contentType || '').match(/charset=([\w-]+)/i);
  if (m) charset = m[1];
  if (!charset) {
    const head = buffer.slice(0, 4000).toString('latin1');
    const m2 = head.match(/<meta[^>]+charset=["']?([\w-]+)/i);
    if (m2) charset = m2[1];
  }
  const candidates = [charset, 'utf-8', 'gb18030'].filter(Boolean);
  for (let i = 0; i < candidates.length; i++) {
    try {
      return new TextDecoder(candidates[i]).decode(buffer);
    } catch (e) {
      // 该编码不被支持，继续试下一个
    }
  }
  return buffer.toString('utf8');
}

function htmlUnescape(s) {
  return String(s || '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function metaContent(page) {
  const metas = {};
  const tags = page.match(/<meta\b[^>]*>/gi) || [];
  tags.forEach(function (tag) {
    const attrs = {};
    const re = /([\w:-]+)\s*=\s*["']([^"']*)["']/g;
    let m;
    while ((m = re.exec(tag))) attrs[m[1].toLowerCase()] = m[2];
    const key = (attrs.property || attrs.name || attrs.itemprop || '').toLowerCase();
    if (key && attrs.content && !metas[key]) {
      metas[key] = htmlUnescape(attrs.content).trim();
    }
  });
  return metas;
}

function extractPage(page, contentType) {
  const metas = metaContent(page);
  let title = metas['og:title'] || metas['twitter:title'] || '';
  if (!title) {
    const m = page.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    title = m ? htmlUnescape(m[1].replace(/\s+/g, ' ')).trim() : '';
  }
  const description = metas['og:description'] || metas['description'] || metas['twitter:description'] || '';

  let body = page.replace(/<(script|style|noscript|svg|iframe)[^>]*>[\s\S]*?<\/\1>/gi, ' ');
  body = body.replace(/<br\s*\/?>|<\/p>|<\/div>|<\/li>|<\/h[1-6]>/gi, '\n');
  body = body.replace(/<[^>]+>/g, ' ');
  body = htmlUnescape(body);
  body = body.replace(/[ \t\u3000]+/g, ' ');
  body = body.replace(/\n{2,}/g, '\n').trim();
  body = body.split('\n')
    .map(function (line) { return line.trim(); })
    .filter(function (line) { return line.length >= 6; })
    .join('\n')
    .slice(0, 6000);

  return { title: title.slice(0, 120), description: description.slice(0, 400), text: body };
}

exports.main = async function (event) {
  const raw = String((event && event.url) || '').trim();
  if (!raw) return { ok: false, blocked: true, note: '缺少链接', url: '' };
  const url = raw.replace(/[，。！？、,.!?)）】]+$/, '');

  try {
    const res = await fetchPage(url);
    if (res.status < 200 || res.status >= 300) {
      return { ok: false, blocked: true, note: '页面返回 HTTP ' + res.status, url: url };
    }
    const page = decodeHtml(res.buffer, res.headers['content-type']);
    const extracted = extractPage(page, res.headers['content-type']);
    const finalUrl = res.finalUrl || url;

    let hostname = '';
    try { hostname = new URL(finalUrl).hostname || ''; } catch (e) { hostname = ''; }
    const isXhs = /xiaohongshu\.com|xhslink\.cn/.test(hostname) || /xiaohongshu\.com|xhslink\.cn/.test(url);
    const loginRedirect = /\/login|website-login|\/captcha/.test(finalUrl);
    const body = extracted.text;

    let blocked = false;
    let note = '';
    if (isXhs && (loginRedirect || body.length < 100)) {
      blocked = true;
      note = '小红书页面需要登录/有反爬限制，没能直接读取正文。链接已保留，请把笔记文字粘贴到下面。';
    }
    if (!body && !extracted.description) {
      blocked = true;
      note = note || '这个页面没有可读正文，可能被平台拦截或需要登录。链接已保留，请手动粘贴文字。';
    }

    let site = '';
    try { site = hostname.replace(/^www\./, ''); } catch (e) { site = ''; }

    return {
      ok: true,
      url: finalUrl,
      site: site,
      title: extracted.title,
      description: extracted.description,
      text: body,
      blocked: blocked,
      note: note
    };
  } catch (err) {
    return {
      ok: false,
      blocked: true,
      note: String((err && err.message) || '读取失败'),
      url: url
    };
  }
};
