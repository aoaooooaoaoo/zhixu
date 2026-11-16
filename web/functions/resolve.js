/**
 * 知序 · 链接读取（Netlify Function）
 * 路由：/api/resolve → /.netlify/functions/resolve（见 netlify.toml 重定向）
 *
 * 能力：
 *   - 普通网页 / 博客 / 新闻：抓标题 + 描述 + 正文
 *   - 微信公众号文章：从 #js_content 提取正文
 *   - 豆瓣 / B 站 / 简书等：og:title + og:description + 正文
 *   - 小红书 / 知乎 / 微博 / 抖音：这类有登录墙或强反爬，直接返回 blocked 并给出手动粘贴提示
 *
 * 安全：拒绝本机与内网地址（SSRF 防护），限制超时与响应体大小。
 */

const MAX_BYTES = 1500 * 1000;
const TIMEOUT_MS = 15000;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 ZhixuBot/0.4 (+https://zhixu-note.netlify.app)';

// 需要登录/强反爬，自动读取基本无效
const MANUAL_HOSTS = [
  { test: /(^|\.)xiaohongshu\.com$|(^|\.)xhslink\.cn$/, name: '小红书', note: '小红书有登录墙和反爬限制，读不到正文。请把笔记文字粘贴到左侧，链接会自动保存为来源。' },
  { test: /(^|\.)zhihu\.com$/, name: '知乎', note: '知乎对未登录访问有反爬限制，正文可能读不到。建议直接粘贴文字，链接保留为来源。' },
  { test: /(^|\.)weibo\.com$|(^|\.)weibo\.cn$/, name: '微博', note: '微博需要登录且有反爬限制，建议手动粘贴文字。' },
  { test: /(^|\.)douyin\.com$/, name: '抖音', note: '抖音视频页正文极少，建议手动粘贴文案或字幕。' }
];

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

function detectManual(hostname) {
  return MANUAL_HOSTS.find(function (x) { return x.test.test(hostname); }) || null;
}

// 这些站点即使抓到内容也可能只有登录墙/推荐位，命中时用更贴切的提示
function manualNoteFor(hostname) {
  const hit = detectManual(hostname);
  return hit ? hit.note : '';
}

async function fetchOnce(urlStr) {
  const controller = new AbortController();
  const timer = setTimeout(function () { controller.abort(); }, TIMEOUT_MS);
  try {
    const res = await fetch(urlStr, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.7'
      }
    });
    const buf = Buffer.from(await res.arrayBuffer());
    return {
      status: res.status,
      url: res.url || urlStr,
      headers: res.headers,
      buffer: buf.slice(0, MAX_BYTES)
    };
  } finally {
    clearTimeout(timer);
  }
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
  const list = [charset, 'utf-8', 'gb18030'].filter(Boolean);
  for (const cs of list) {
    try {
      return new TextDecoder(cs).decode(buffer);
    } catch (e) { /* 不支持该编码 */ }
  }
  return buffer.toString('utf8');
}

function unescapeHtml(s) {
  return String(s || '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, function (_, n) { return String.fromCharCode(Number(n)); });
}

function metaContent(page) {
  const metas = {};
  const tags = page.match(/<meta\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const attrs = {};
    const re = /([\w:-]+)\s*=\s*["']([^"']*)["']/g;
    let m;
    while ((m = re.exec(tag))) attrs[m[1].toLowerCase()] = m[2];
    const key = (attrs.property || attrs.name || attrs.itemprop || '').toLowerCase();
    if (key && attrs.content && !metas[key]) metas[key] = unescapeHtml(attrs.content).trim();
  }
  return metas;
}

function stripToText(fragment) {
  let s = String(fragment || '');
  s = s.replace(/<(script|style|noscript|svg|iframe)[^>]*>[\s\S]*?<\/\1>/gi, ' ');
  s = s.replace(/<br\s*\/?>|<\/p>|<\/div>|<\/li>|<\/h[1-6]>|<\/section>|<\/blockquote>/gi, '\n');
  s = s.replace(/<[^>]+>/g, ' ');
  s = unescapeHtml(s);
  s = s.replace(/[ \t\u3000]+/g, ' ');
  s = s.replace(/\n{2,}/g, '\n').trim();
  return s.split('\n').map(function (l) { return l.trim(); }).filter(function (l) { return l.length >= 6; }).join('\n');
}

function extractGeneric(page) {
  const metas = metaContent(page);
  let title = metas['og:title'] || metas['twitter:title'] || '';
  if (!title) {
    const m = page.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    title = m ? unescapeHtml(m[1].replace(/\s+/g, ' ')).trim() : '';
  }
  const description = metas['og:description'] || metas['description'] || metas['twitter:description'] || '';
  const site = metas['og:site_name'] || metas['application-name'] || '';
  return { title: title, description: description, site: site, text: stripToText(page).slice(0, 6000) };
}

/** 微信公众号：正文在 #js_content */
function extractWeixin(page) {
  const metas = metaContent(page);
  let title = '';
  const tm = page.match(/<h1[^>]*id=["']activity-name["'][^>]*>([\s\S]*?)<\/h1>/i);
  if (tm) title = stripToText(tm[1]);
  if (!title) title = metas['og:title'] || '';
  if (!title) {
    const t2 = page.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    title = t2 ? unescapeHtml(t2[1]).trim() : '';
  }
  let bodyHtml = '';
  const cm = page.match(/<div[^>]*id=["']js_content["'][^>]*>([\s\S]*?)<\/div>\s*<\/div>/i);
  if (cm) bodyHtml = cm[1];
  if (!bodyHtml) {
    const cm2 = page.match(/<div[^>]*id=["']js_content["'][^>]*>([\s\S]*)/i);
    if (cm2) bodyHtml = cm2[1];
  }
  const text = stripToText(bodyHtml || page).slice(0, 6000);
  const author = (page.match(/var nickname = ["']([^"']+)["']/) || [])[1] || metas['og:article:author'] || '';
  return {
    title: title,
    description: metas['og:description'] || metas['description'] || '',
    site: '微信公众号' + (author ? ' · ' + author : ''),
    text: text
  };
}

exports.handler = async function (event) {
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
  const done = function (code, payload) {
    return { statusCode: code, headers: headers, body: JSON.stringify(payload) };
  };

  if (event.httpMethod !== 'POST') {
    return done(405, { ok: false, error: '只支持 POST' });
  }

  let url = '';
  try {
    const body = JSON.parse(event.body || '{}');
    url = String(body.url || '').trim();
  } catch (e) {
    return done(400, { ok: false, error: '请求体不是合法 JSON' });
  }
  url = url.replace(/[，。！？、,.!?)）】]+$/, '');
  if (!/^https?:\/\//i.test(url)) {
    return done(400, { ok: false, error: '只支持 http/https 链接', url: url });
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch (e) {
    return done(400, { ok: false, error: '链接格式不对', url: url });
  }
  if (isPrivateHost(parsed.hostname)) {
    return done(400, { ok: false, error: '出于安全考虑，不读取本机/内网地址', url: url });
  }

  // 先尝试抓取：部分小红书/知乎页面在 SSR 里带正文，能读到就不必让用户手动粘贴
  const manualNote = manualNoteFor(parsed.hostname);

  try {
    const res = await fetchOnce(url);
    if (res.status < 200 || res.status >= 300) {
      return done(200, {
        ok: true, url: url, site: parsed.hostname.replace(/^www\./, ''),
        title: '', description: '', text: '', blocked: true,
        note: '目标页面返回 HTTP ' + res.status + '，可能被拦截或需要登录。请手动粘贴文字。'
      });
    }

    const html = decodeHtml(res.buffer, res.headers.get('content-type'));
    const host = new URL(res.url).hostname;
    let data;
    if (/(^|\.)mp\.weixin\.qq\.com$/.test(host)) {
      data = extractWeixin(html);
    } else {
      data = extractGeneric(html);
    }

    let site = data.site || host.replace(/^www\./, '');
    let blocked = false;
    let note = '';
    const textLen = (data.text || '').length;
    if (textLen < 100) {
      blocked = true;
      note = manualNote || '这个页面没有可读正文（可能是 JS 渲染或被拦截）。请手动粘贴文字，链接会保存为来源。';
    } else if (manualNote && textLen < 400) {
      note = manualNote + '（这次抓到的内容偏少，建议核对一下）';
    }

    return done(200, {
      ok: true,
      url: res.url || url,
      site: site,
      title: (data.title || '').slice(0, 120),
      description: (data.description || '').slice(0, 400),
      text: (data.text || '').slice(0, 6000),
      blocked: blocked,
      note: note
    });
  } catch (err) {
    const msg = String((err && err.message) || err);
    const timeout = /aborted|timeout/i.test(msg);
    return done(200, {
      ok: true, url: url, site: parsed.hostname.replace(/^www\./, ''),
      title: '', description: '', text: '', blocked: true,
      note: timeout
        ? '读取超时（这个站点响应太慢或被限制），请手动粘贴文字。'
        : '读取失败：' + msg.slice(0, 120) + '。请手动粘贴文字。'
    });
  }
};
