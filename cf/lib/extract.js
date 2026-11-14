/**
 * 知序 · 链接抓取与正文提取（Cloudflare Pages Functions 共享库）
 * 从 Netlify 版 resolve.js 移植：同样的规则与提示，去掉 Node 专有 API。
 */

const MAX_BYTES = 1500 * 1000;
const TIMEOUT_MS = 15000;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 ZhixuBot/0.4';

export const MANUAL_HOSTS = [
  { test: /(^|\.)xiaohongshu\.com$|(^|\.)xhslink\.cn$/, name: '小红书', note: '小红书有登录墙和反爬限制，读不到正文。请把笔记文字粘贴到左侧，链接会自动保存为来源。' },
  { test: /(^|\.)zhihu\.com$/, name: '知乎', note: '知乎对未登录访问有反爬限制，正文可能读不到。建议直接粘贴文字，链接保留为来源。' },
  { test: /(^|\.)weibo\.com$|(^|\.)weibo\.cn$/, name: '微博', note: '微博需要登录且有反爬限制，建议手动粘贴文字。' },
  { test: /(^|\.)douyin\.com$/, name: '抖音', note: '抖音视频页正文极少，建议手动粘贴文案或字幕。' }
];

export function isPrivateHost(hostname) {
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

export function manualNoteFor(hostname) {
  const hit = MANUAL_HOSTS.find((x) => x.test.test(hostname));
  return hit ? hit.note : '';
}

function unescapeHtml(s) {
  return String(s || '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
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

export function stripToText(fragment) {
  let s = String(fragment || '');
  s = s.replace(/<(script|style|noscript|svg|iframe)[^>]*>[\s\S]*?<\/\1>/gi, ' ');
  s = s.replace(/<br\s*\/?>|<\/p>|<\/div>|<\/li>|<\/h[1-6]>|<\/section>|<\/blockquote>/gi, '\n');
  s = s.replace(/<[^>]+>/g, ' ');
  s = unescapeHtml(s);
  s = s.replace(/[ \t\u3000]+/g, ' ');
  s = s.replace(/\n{2,}/g, '\n').trim();
  return s.split('\n').map((l) => l.trim()).filter((l) => l.length >= 6).join('\n');
}

export function extractGeneric(page) {
  const metas = metaContent(page);
  let title = metas['og:title'] || metas['twitter:title'] || '';
  if (!title) {
    const m = page.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    title = m ? unescapeHtml(m[1].replace(/\s+/g, ' ')).trim() : '';
  }
  const description = metas['og:description'] || metas['description'] || metas['twitter:description'] || '';
  const site = metas['og:site_name'] || metas['application-name'] || '';
  return { title, description, site, text: stripToText(page).slice(0, 6000) };
}

export function extractWeixin(page) {
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
  const author = (page.match(/var nickname = ["']([^"']+)["']/) || [])[1] || metas['og:article:author'] || '';
  return {
    title,
    description: metas['og:description'] || metas['description'] || '',
    site: '微信公众号' + (author ? ' · ' + author : ''),
    text: stripToText(bodyHtml || page).slice(0, 6000)
  };
}

function decodeBuffer(buf, contentType) {
  let charset = '';
  const m = String(contentType || '').match(/charset=([\w-]+)/i);
  if (m) charset = m[1];
  const body = new TextDecoder('utf-8').decode(buf);
  if (!charset) {
    const m2 = body.slice(0, 4000).match(/<meta[^>]+charset=["']?([\w-]+)/i);
    if (m2) charset = m2[1];
  }
  if (charset && !/^utf-?8$/i.test(charset)) {
    try {
      return new TextDecoder(charset).decode(buf);
    } catch (e) { /* Workers 可能不支持该编码，回退 utf-8 */ }
  }
  return body;
}

/** 抓取并提取；返回给前端的数据结构（与 Netlify 版一致） */
export async function resolveUrl(urlStr) {
  const parsed = new URL(urlStr);
  if (isPrivateHost(parsed.hostname)) {
    return { status: 400, payload: { ok: false, error: '出于安全考虑，不读取本机/内网地址', url: urlStr } };
  }
  const manualNote = manualNoteFor(parsed.hostname);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(urlStr, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': UA,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.7'
      }
    });
    if (res.status < 200 || res.status >= 300) {
      return {
        status: 200,
        payload: {
          ok: true, url: urlStr, site: parsed.hostname.replace(/^www\./, ''),
          title: '', description: '', text: '', blocked: true,
          note: '目标页面返回 HTTP ' + res.status + '，可能被拦截或需要登录。请手动粘贴文字。'
        }
      };
    }
    const buf = new Uint8Array(await res.arrayBuffer()).slice(0, MAX_BYTES);
    const html = decodeBuffer(buf, res.headers.get('content-type'));
    const host = new URL(res.url).hostname;
    const data = /(^|\.)mp\.weixin\.qq\.com$/.test(host) ? extractWeixin(html) : extractGeneric(html);

    const site = data.site || host.replace(/^www\./, '');
    let blocked = false;
    let note = '';
    const textLen = (data.text || '').length;
    if (textLen < 100) {
      blocked = true;
      note = manualNote || '这个页面没有可读正文（可能是 JS 渲染或被拦截）。请手动粘贴文字，链接会保存为来源。';
    } else if (manualNote && textLen < 400) {
      note = manualNote + '（这次抓到的内容偏少，建议核对一下）';
    }

    return {
      status: 200,
      payload: {
        ok: true,
        url: res.url || urlStr,
        site,
        title: (data.title || '').slice(0, 120),
        description: (data.description || '').slice(0, 400),
        text: (data.text || '').slice(0, 6000),
        blocked,
        note
      }
    };
  } catch (err) {
    const msg = String((err && err.message) || err);
    const timeout = /aborted|timeout/i.test(msg);
    return {
      status: 200,
      payload: {
        ok: true, url: urlStr, site: parsed.hostname.replace(/^www\./, ''),
        title: '', description: '', text: '', blocked: true,
        note: timeout ? '读取超时（这个站点响应太慢或被限制），请手动粘贴文字。' : '读取失败：' + msg.slice(0, 120) + '。请手动粘贴文字。'
      }
    };
  } finally {
    clearTimeout(timer);
  }
}
