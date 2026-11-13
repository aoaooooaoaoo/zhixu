#!/usr/bin/env node
/**
 * 知序 · MCP Server（stdio）
 *
 * 把知序的「搜索 / 抓正文 / AI 提炼」暴露成 MCP 工具，任何支持 MCP 的 AI 客户端
 * （Claude Desktop、DSH、Cline 等）都能直接调用。
 *
 * 依赖：
 *   - 本地抓取助手：node integrations/xhs/xhs_helper.mjs（默认 http://127.0.0.1:8790）
 *   - AI 提炼：本地 server.py（默认 http://127.0.0.1:8788）或线上 https://zhixu-note.netlify.app
 *
 * 运行（由 MCP 客户端拉起）：
 *   node integrations/mcp/zhixu-mcp.mjs
 *
 * 环境变量：
 *   ZHIXU_HELPER  抓取助手地址，默认 http://127.0.0.1:8790
 *   ZHIXU_API     知序 API 地址，默认 http://127.0.0.1:8788；失败时回退线上站点
 *
 * 协议：MCP over stdio，LSP 风格 Content-Length 分帧；stdout 只输出协议消息，日志走 stderr。
 */

const HELPER = (process.env.ZHIXU_HELPER || 'http://127.0.0.1:8790').replace(/\/+$/, '');
const API = (process.env.ZHIXU_API || 'http://127.0.0.1:8788').replace(/\/+$/, '');
const FALLBACK_API = 'https://zhixu-note.netlify.app';

function log(...args) {
  process.stderr.write('[zhixu-mcp] ' + args.join(' ') + '\n');
}

async function postJson(url, payload, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs || 60000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(payload),
      signal: ctrl.signal
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch (e) { /* 保留原文 */ }
    return { ok: res.ok, status: res.status, json, text };
  } finally {
    clearTimeout(timer);
  }
}

async function getJson(url, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs || 20000);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch (e) { /* ignore */ }
    return { ok: res.ok, status: res.status, json, text };
  } finally {
    clearTimeout(timer);
  }
}

const TOOLS = [
  {
    name: 'zhixu_search',
    description: '在小红书或知乎按关键词搜索笔记/回答，返回标题、作者、点赞、带 xsec_token 的可读链接。需要本地抓取助手已登录对应站点。',
    inputSchema: {
      type: 'object',
      properties: {
        site: { type: 'string', enum: ['xiaohongshu', 'zhihu'], description: '站点' },
        keyword: { type: 'string', description: '搜索关键词' },
        limit: { type: 'number', description: '返回条数，1-20，默认 5' },
        sort: { type: 'string', enum: ['default', 'popular', 'latest'], description: '排序：综合/最热/最新（小红书）' }
      },
      required: ['keyword']
    }
  },
  {
    name: 'zhixu_resolve',
    description: '读取一个小红书/知乎/B站/微博/抖音/普通网页链接的正文，返回标题、正文、作者、标签。需要本地抓取助手。',
    inputSchema: {
      type: 'object',
      properties: { url: { type: 'string', description: '要读取的链接' } },
      required: ['url']
    }
  },
  {
    name: 'zhixu_analyze',
    description: '把一段文本提炼成知识卡片（标题/摘要/3-4 条要点/标签/分类/主题/核心短语），用于整理笔记。',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: '原文内容，至少 12 字' },
        url: { type: 'string', description: '原帖链接（可选）' }
      },
      required: ['text']
    }
  },
  {
    name: 'zhixu_comments',
    description: '抓取小红书笔记的评论区（按点赞数降序），返回作者、内容、点赞、是否作者本人。',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: '小红书笔记链接（建议带 xsec_token）' },
        limit: { type: 'number', description: '返回条数，1-30，默认 10' }
      },
      required: ['url']
    }
  },
  {
    name: 'zhixu_status',
    description: '检查知序本地抓取助手与 AI 服务是否可用。',
    inputSchema: { type: 'object', properties: {} }
  }
];

function toolResult(payload) {
  return { content: [{ type: 'text', text: typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2) }] };
}

async function callTool(name, args) {
  args = args || {};
  if (name === 'zhixu_search') {
    const keyword = String(args.keyword || '').trim();
    if (!keyword) return toolResult({ ok: false, error: '缺少 keyword' });
    const r = await postJson(HELPER + '/search', {
      site: args.site === 'zhihu' ? 'zhihu' : 'xiaohongshu',
      keyword,
      limit: Math.min(20, Math.max(1, Number(args.limit) || 5)),
      sort: args.sort || 'default'
    }, 120000);
    if (!r.ok || !r.json) return toolResult({ ok: false, error: '搜索失败 HTTP ' + r.status });
    if (r.json.loginWall) return toolResult({ ok: false, needLogin: true, note: r.json.note || '需要登录' });
    return toolResult({ ok: true, site: r.json.site, keyword, count: (r.json.items || []).length, items: r.json.items || [] });
  }

  if (name === 'zhixu_resolve') {
    const target = String(args.url || '').trim();
    if (!/^https?:\/\//i.test(target)) return toolResult({ ok: false, error: '需要 http/https 链接' });
    const r = await postJson(HELPER + '/resolve', { url: target }, 90000);
    if (!r.ok || !r.json) return toolResult({ ok: false, error: '读取失败 HTTP ' + r.status });
    const j = r.json;
    return toolResult({
      ok: Boolean(j.ok), blocked: Boolean(j.blocked), site: j.site,
      title: j.title, author: j.author, tags: j.tags,
      textLen: String(j.text || '').length,
      text: String(j.text || '').slice(0, 6000),
      note: j.note || ''
    });
  }

  if (name === 'zhixu_analyze') {
    const text = String(args.text || '').trim();
    if (text.length < 12) return toolResult({ ok: false, error: '内容太短，至少 12 字' });
    const payload = { text: text.slice(0, 6000), url: String(args.url || '') };
    let r = null;
    try { r = await postJson(API + '/api/analyze', payload, 90000); } catch (e) { r = null; }
    if (!r || !r.ok || !r.json || !r.json.ok) {
      try { r = await postJson(FALLBACK_API + '/api/analyze', payload, 90000); } catch (e) { r = null; }
    }
    if (!r || !r.ok || !r.json || !r.json.ok) {
      return toolResult({ ok: false, error: (r && r.json && r.json.error) || 'AI 服务不可用（本地与线上都失败）' });
    }
    return toolResult({ ok: true, mode: r.json.mode || 'spark', card: r.json.card });
  }

  if (name === 'zhixu_comments') {
    const target = String(args.url || '').trim();
    if (!/^https?:\/\//i.test(target)) return toolResult({ ok: false, error: '需要 http/https 链接' });
    const r = await postJson(HELPER + '/comments', { url: target, limit: Math.min(30, Math.max(1, Number(args.limit) || 10)) }, 120000);
    if (!r.ok || !r.json) return toolResult({ ok: false, error: '抓评论失败 HTTP ' + r.status });
    return toolResult({ ok: Boolean(r.json.ok), total: r.json.total || 0, items: r.json.items || [], error: r.json.error || '' });
  }

  if (name === 'zhixu_status') {
    const helper = await getJson(HELPER + '/health', 8000).catch(() => ({ ok: false }));
    const api = await getJson(FALLBACK_API + '/api/health', 15000).catch(() => ({ ok: false }));
    return toolResult({
      ok: true,
      helper: helper.ok && helper.json ? helper.json : { ok: false },
      api: api.ok && api.json ? api.json : { ok: false }
    });
  }

  return toolResult({ ok: false, error: '未知工具：' + name });
}

/* ---------------------------------------------------------------- MCP 分帧 */
let buffer = Buffer.alloc(0);

function send(msg) {
  const body = JSON.stringify(msg);
  process.stdout.write('Content-Length: ' + Buffer.byteLength(body, 'utf8') + '\r\n\r\n' + body);
}

async function handle(req) {
  const { id, method, params } = req || {};
  if (!method) return;

  if (method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'zhixu-mcp', version: '0.1.0' }
      }
    });
    log('initialize ok');
    return;
  }
  if (method === 'notifications/initialized' || method === 'initialized') return;

  if (method === 'tools/list') {
    send({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
    return;
  }

  if (method === 'tools/call') {
    try {
      const result = await callTool(params && params.name, params && params.arguments);
      send({ jsonrpc: '2.0', id, result });
    } catch (e) {
      send({ jsonrpc: '2.0', id, result: toolResult({ ok: false, error: String(e.message || e) }) });
    }
    return;
  }

  if (method === 'ping') {
    send({ jsonrpc: '2.0', id, result: {} });
    return;
  }

  send({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found: ' + method } });
}

function onData(chunk) {
  buffer = Buffer.concat([buffer, chunk]);
  for (;;) {
    const sep = buffer.indexOf('\r\n\r\n');
    if (sep < 0) return;
    const header = buffer.slice(0, sep).toString('utf8');
    const m = /Content-Length:\s*(\d+)/i.exec(header);
    if (!m) { buffer = buffer.slice(sep + 4); continue; }
    const len = Number(m[1]);
    if (buffer.length < sep + 4 + len) return;
    const body = buffer.slice(sep + 4, sep + 4 + len).toString('utf8');
    buffer = buffer.slice(sep + 4 + len);
    let req;
    try { req = JSON.parse(body); } catch (e) { log('bad json'); continue; }
    handle(req).catch((e) => log('handle error: ' + e.message));
  }
}

process.stdin.on('data', onData);
process.stdin.on('end', () => process.exit(0));
log('zhixu-mcp v0.1.0 已启动（helper=' + HELPER + ', api=' + API + '）');
