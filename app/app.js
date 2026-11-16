/* ==========================================================================
   知序 · Zhixu MVP
   纯前端（无构建、无依赖），localStorage 持久化；启动 server.py 后自动切换真 AI。
   ========================================================================== */
(function () {
  'use strict';

  /* ---------------------------------------------------------------- 常量 */
  const STORE_KEY = 'zhixu.mvp.v1';
  const LEGACY_STORE_KEY = 'wenjiang.mvp.v1';
  const PAGE_TITLES = { collect: '收集', library: '知识库', map: '思维导图' };

  /* ---------------------------------------------------------------- 链接来源能力 */
  // auto   = 部署了读取服务时可自动抓正文
  // manual = 有登录墙 / 强反爬，建议手动粘贴文字（链接仍会保存为来源）
  const LINK_SOURCES = [
    { key: 'weixin', name: '微信公众号', mode: 'auto', test: /(^|\.)mp\.weixin\.qq\.com$/i, note: '文章正文可自动读取' },
    { key: 'douban', name: '豆瓣', mode: 'auto', test: /(^|\.)douban\.com$/i, note: '日记、书影评可自动读取' },
    { key: 'jianshu', name: '简书', mode: 'auto', test: /(^|\.)jianshu\.com$/i, note: '文章正文可自动读取' },
    { key: 'bilibili', name: 'B 站', mode: 'auto', test: /(^|\.)bilibili\.com$/i, note: '标题与视频简介可读取' },
    { key: 'juejin', name: '掘金', mode: 'auto', test: /(^|\.)juejin\.cn$/i, note: '技术文章正文可自动读取' },
    { key: 'csdn', name: 'CSDN', mode: 'auto', test: /(^|\.)csdn\.net$/i, note: '多数文章可读，偶尔触发反爬' },
    { key: 'sspai', name: '少数派', mode: 'auto', test: /(^|\.)sspai\.com$/i, note: '文章正文可自动读取' },
    { key: '36kr', name: '36 氪', mode: 'auto', test: /(^|\.)36kr\.com$/i, note: '资讯正文可自动读取' },
    { key: 'github', name: 'GitHub', mode: 'auto', test: /(^|\.)github\.com$/i, note: 'README / Issue 可读取' },
    { key: 'zhihu', name: '知乎', mode: 'manual', test: /(^|\.)zhihu\.com$/i, note: '需登录，正文常读不到；建议手动粘贴' },
    { key: 'xiaohongshu', name: '小红书', mode: 'manual', test: /(^|\.)xiaohongshu\.com$|(^|\.)xhslink\.cn$/i, note: '需要登录态：启动本地抓取助手后可直接读取；未启动时请手动粘贴（链接会保存为来源）' },
    { key: 'weibo', name: '微博', mode: 'manual', test: /(^|\.)weibo\.com$|(^|\.)weibo\.cn$/i, note: '需登录；建议手动粘贴文字' },
    { key: 'douyin', name: '抖音', mode: 'manual', test: /(^|\.)douyin\.com$/i, note: '视频页文字很少；建议手动粘贴文案或字幕' },
    { key: 'web', name: '普通网页', mode: 'auto', test: /.*/i, note: '抓取标题、描述与正文' }
  ];

  function hostOf(url) {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return ''; }
  }

  // 本地「登录抓取助手」（integrations/xhs/xhs_helper.mjs）默认地址
  const XHS_HELPER = 'http://127.0.0.1:8790';

  async function helperCall(pathName, payload, timeoutMs) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs || 40000);
      const res = await fetch(XHS_HELPER + pathName, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload || {}),
        signal: ctrl.signal
      });
      clearTimeout(timer);
      if (!res.ok) return { ok: false, error: 'helper HTTP ' + res.status };
      return await res.json();
    } catch (e) {
      return { ok: false, helperOffline: true, error: '本地抓取助手未启动' };
    }
  }

  async function checkHelperAlive() {
    try {
      const res = await fetch(XHS_HELPER + '/health', { cache: 'no-store' });
      const j = await res.json();
      helperAlive = Boolean(j && j.ok);
    } catch (e) {
      helperAlive = false;
    }
    syncHelperHint();
    if (state.view === 'collect') updateLinkDetected();
  }

  function syncHelperHint() {
    const el = document.getElementById('support-manual');
    if (!el) return;
    if (helperAlive) {
      el.textContent = '🔓 登录窗口可读：小红书 · 知乎 · 微博 · 抖音';
      el.className = 'ls-ok';
    } else {
      el.textContent = '⚠️ 可能读不到（会尝试）：小红书 · 知乎 · 微博 · 抖音';
      el.className = 'ls-warn';
    }
  }

  function helperHelpHtml() {
    return `
      <div class="link-help">
        <p class="lh-lead">小红书的正文需要登录态。知序用一个<strong>独立的本地浏览器窗口</strong>保存你的登录状态，抓取时复用它，不会动你日常浏览器里的账号。</p>
        <p class="lh-lead">在本机运行一次这个助手（保持窗口开着）：</p>
        <pre class="cmd">node integrations/xhs/xhs_helper.mjs</pre>
        <p class="lh-lead">或直接双击 <code>integrations/xhs/start-xhs-helper.bat</code>。</p>
        <p class="lh-foot">首次会弹出一个浏览器窗口，扫码登录小红书；登录态保存在 <code>integrations/xhs/.profile</code>，之后无需重复登录。</p>
      </div>`;
  }

  function detectSource(url) {
    const host = hostOf(String(url || '').trim());
    if (!host) return null;
    const hit = LINK_SOURCES.find((s) => s.test.test(host));
    return hit ? Object.assign({ host }, hit) : null;
  }

  function updateLinkDetected() {
    const el = document.getElementById('link-detected');
    const input = document.getElementById('paste-url');
    if (!el || !input) return;
    const s = detectSource(input.value);
    if (!s) { el.hidden = true; el.innerHTML = ''; return; }
    el.hidden = false;
    el.className = 'link-detected ' + (s.mode === 'auto' ? 'is-ok' : 'is-warn');
    const tagText = s.mode === 'auto' ? '可自动读取' : (helperAlive ? '可用登录窗口读取' : '可能读不到（会尝试）');
    const note = (helperAlive && s.mode !== 'auto') ? '已连接本地登录窗口，点「读取链接」可直接抓取' : s.note;
    el.innerHTML = `<b>${esc(s.name)} · ${tagText}</b><span>${esc(note)}</span>`;
  }

  /* ---------------------------------------------------------------- 批量导入 */
  /* ---------------------------------------------------------------- 评论采集 */
  let pendingComments = [];

  function commentsHtml() {
    if (!pendingComments.length) return '<div class="batch-empty">没有抓到评论</div>';
    return '<div class="comment-list">' + pendingComments.map((c) => `
      <div class="comment-row">
        <div class="comment-head"><b>${esc(c.author || '匿名')}</b>${c.isAuthor ? '<span class="chip chip-sage">作者</span>' : ''}<span class="comment-like">${esc(c.likes || '0')} 赞</span></div>
        <div class="comment-text">${esc(c.text || '')}</div>
      </div>`).join('') + '</div>';
  }

  async function fetchComments() {
    const urlEl = document.getElementById('paste-url');
    const url = urlEl ? urlEl.value.trim() : '';
    if (!/^https?:\/\//i.test(url)) { toast('先在「帖子链接」里填一个链接', 'error'); return; }
    setLinkStatus('正在抓评论…（首次较慢）', 'loading');
    const r = await helperCall('/comments', { url: url, limit: 8 }, 90000);
    if (!r || !r.ok) {
      const note = (r && (r.note || r.error)) || '抓评论失败';
      setLinkStatus(note, 'warn');
      toast(note, 'error');
      return;
    }
    pendingComments = r.items || [];
    setLinkStatus('已抓取 ' + pendingComments.length + ' 条评论（按赞排序）', 'ok');
    openModal(modalShell('评论区（按赞排序）', '共 ' + (r.total || pendingComments.length) + ' 条，取前 ' + pendingComments.length + ' 条',
      commentsHtml(),
      '<button class="btn btn-ghost" type="button" data-action="close-modal">关闭</button>' +
      '<button class="btn btn-primary" type="button" data-action="merge-comments">并入正文</button>'));
  }

  function mergeComments() {
    const ta = document.getElementById('paste-text');
    if (!ta) return;
    if (!pendingComments.length) { toast('没有评论可并入', 'error'); return; }
    const block = '\n\n【评论区（按赞排序）】\n' + pendingComments.map((c) => '- ' + (c.author || '') + (c.likes ? '（' + c.likes + '赞）' : '') + '：' + c.text).join('\n');
    ta.value = ta.value + block;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    closeModal();
    toast('评论已并入正文，点「理成知识卡片」让 AI 一起看');
  }

  /* ---------------------------------------------------------------- 知识库问答 */
  const askState = { question: '', answer: '', used: [], error: '', busy: false };

  function askCandidates(question) {
    const cards = data.cards || [];
    const q = String(question || '').toLowerCase();
    const grams = new Set();
    for (let i = 0; i < q.length - 1; i++) grams.add(q.slice(i, i + 2));
    const scored = cards.map((c) => {
      const hay = [c.title, c.summary, (c.points || []).join(' '), (c.tags || []).join(' '), c.category, c.topic].join(' ').toLowerCase();
      let score = 0;
      grams.forEach((g) => { if (hay.indexOf(g) >= 0) score++; });
      return { c, score };
    });
    scored.sort((a, b) => b.score - a.score || (new Date(b.c.createdAt) - new Date(a.c.createdAt)));
    const hit = scored.filter((x) => x.score > 0).slice(0, 6).map((x) => x.c);
    return hit.length ? hit : cards.slice(0, 6);
  }

  function askHtml() {
    const used = askState.used.length
      ? '<div class="ask-used">参考卡片：' + askState.used.map((t) => '<span class="chip chip-line">' + esc(t) + '</span>').join('') + '</div>'
      : '';
    let body = '';
    if (askState.busy) body = '<div class="ask-answer is-busy">正在翻你的知识库并回答…</div>';
    else if (askState.error) body = '<div class="ask-answer is-error">' + esc(askState.error) + '</div>';
    else if (askState.answer) body = '<div class="ask-answer">' + esc(askState.answer).replace(/\n/g, '<br>') + '</div>';
    return `
      <div class="ask">
        <div class="ask-form">
          <input id="ask-input" type="text" placeholder="比如：我存的西交相关内容都有哪些？/ 早C晚A要注意什么？" value="${esc(askState.question)}" />
          <button class="btn btn-primary btn-small" type="button" data-action="ask-submit" ${askState.busy ? 'disabled' : ''}>提问</button>
        </div>
        ${body}
        ${used}
        <div class="ask-hint">只根据你知识库里的卡片回答；找不到会直说，不编造。</div>
      </div>`;
  }

  function openAsk() {
    openModal(modalShell('问我的知识库', '基于已入库卡片回答，并标注引用', askHtml()));
  }

  async function doAsk() {
    if (askState.busy) return;
    const input = document.getElementById('ask-input');
    const q = (input ? input.value : askState.question || '').trim();
    if (q.length < 2) { toast('先输入问题', 'error'); return; }
    askState.question = q;
    askState.busy = true;
    askState.error = '';
    askState.answer = '';
    openAsk();
    const cards = askCandidates(q);
    askState.used = cards.map((c) => c.title);
    try {
      const res = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: q,
          cards: cards.map((c) => ({ title: c.title, summary: c.summary, points: c.points, category: c.category, topic: c.topic }))
        })
      });
      const j = await res.json().catch(() => null);
      askState.busy = false;
      if (!res.ok || !j || !j.ok) askState.error = (j && j.error) || ('问答服务返回 HTTP ' + res.status);
      else askState.answer = j.answer;
    } catch (e) {
      askState.busy = false;
      askState.error = '问答失败：' + String(e.message || e);
    }
    openAsk();
  }

    /* ---------------------------------------------------------------- 账号 */
  const authState = { token: localStorage.getItem('zhixu.auth.token') || '', user: null, status: '', busy: false };

  function saveAuth(token, user) {
    authState.token = token || '';
    authState.user = user || null;
    if (token) localStorage.setItem('zhixu.auth.token', token); else localStorage.removeItem('zhixu.auth.token');
    if (user) localStorage.setItem('zhixu.auth.user', JSON.stringify(user)); else localStorage.removeItem('zhixu.auth.user');
    updateAccountBtn();
  }

  function updateAccountBtn() {
    const b = document.getElementById('btn-account');
    if (!b) return;
    b.title = authState.user ? ('账号：' + authState.user.username) : '登录 / 注册';
    b.classList.toggle('is-on', Boolean(authState.user));
  }

  async function authCall(action, extra) {
    const payload = Object.assign({ action: action, token: authState.token }, extra || {});
    const res = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return { ok: res.ok, status: res.status, json: await res.json().catch(() => null) };
  }

  async function refreshMe() {
    if (!authState.token) { updateAccountBtn(); return; }
    const r = await authCall('me');
    if (r.ok && r.json && r.json.ok) saveAuth(authState.token, r.json.user);
    else { saveAuth('', null); }
  }

  function accountHtml() {
    if (authState.user) {
      const u = authState.user;
      return `
        <div class="account">
          <div class="account-head"><b>${esc(u.username)}</b><span class="chip chip-sage">已登录</span></div>
          <div class="account-row"><span>接收 QQ</span><input id="account-qq" type="text" inputmode="numeric" placeholder="5-12 位数字，留空解绑" value="${esc(u.qq || '')}" /></div>
          <div class="account-actions">
            <button class="btn btn-small btn-primary" type="button" data-action="bind-qq">保存 QQ</button>
            <button class="btn btn-small" type="button" data-action="logout">退出登录</button>
          </div>
          <div class="account-status" id="account-status">${esc(authState.status || '')}</div>
          <div class="ask-hint">QQ 号用于「一对一接收」：绑定后，QQ 转发/批量导入的结果会发到该号（需本机 QQ 机器人已运行）。</div>
        </div>`;
    }
    return `
      <div class="account">
        <div class="account-row"><span>用户名</span><input id="account-username" type="text" autocomplete="username" placeholder="3-24 位，字母/数字/下划线/中文" /></div>
        <div class="account-row"><span>密码</span><input id="account-password" type="password" autocomplete="current-password" placeholder="至少 6 位" /></div>
        <div class="account-actions">
          <button class="btn btn-small btn-primary" type="button" data-action="auth-login">登录</button>
          <button class="btn btn-small" type="button" data-action="auth-register">注册</button>
        </div>
        <div class="account-status" id="account-status">${esc(authState.status || '')}</div>
        <div class="ask-hint">账号用于云同步与 QQ 绑定；密码加盐哈希存储，不保存明文。</div>
      </div>`;
  }

  function openAccount() {
    authState.status = authState.status || '';
    openModal(modalShell('账号', '登录后可云同步、绑定接收 QQ', accountHtml()));
  }

  async function doAuth(kind) {
    if (authState.busy) return;
    const uEl = document.getElementById('account-username');
    const pEl = document.getElementById('account-password');
    const username = uEl ? uEl.value.trim() : '';
    const password = pEl ? pEl.value : '';
    if (!username || !password) { toast('填写用户名和密码', 'error'); return; }
    authState.busy = true;
    authState.status = kind === 'login' ? '登录中…' : '注册中…';
    openAccount();
    const r = await authCall(kind, { username: username, password: password });
    authState.busy = false;
    if (r.ok && r.json && r.json.ok) {
      saveAuth(r.json.token, r.json.user);
      authState.status = kind === 'login' ? '登录成功' : '注册成功，已登录';
      toast(authState.status);
    } else {
      authState.status = (r.json && r.json.error) || ('失败 HTTP ' + r.status);
    }
    openAccount();
  }

  async function doBindQQ() {
    const el = document.getElementById('account-qq');
    const qq = el ? el.value.trim() : '';
    if (qq && !/^[1-9]\d{4,11}$/.test(qq)) { toast('QQ 号应为 5-12 位数字', 'error'); return; }
    authState.status = '保存中…';
    openAccount();
    const r = await authCall('bind-qq', { qq: qq });
    if (r.ok && r.json && r.json.ok) {
      saveAuth(authState.token, r.json.user);
      authState.status = qq ? ('已绑定接收 QQ：' + qq) : '已解绑 QQ';
      toast(authState.status);
    } else {
      authState.status = (r.json && r.json.error) || ('失败 HTTP ' + r.status);
    }
    openAccount();
  }

  async function doLogout() {
    await authCall('logout').catch(() => null);
    saveAuth('', null);
    authState.status = '已退出登录';
    openAccount();
  }

  /* ---------------------------------------------------------------- 云同步 */
  const syncState = { status: '', busy: false };

  function syncHtml() {
    if (!authState.user) {
      return `
        <div class="sync">
          <div class="sync-status">云同步需要先登录账号。</div>
          <div class="sync-actions"><button class="btn btn-small btn-primary" type="button" data-action="account-open">去登录 / 注册</button></div>
          <div class="ask-hint">登录后数据按账号隔离，换设备用同一账号登录即可合并。</div>
        </div>`;
    }
    return `
      <div class="sync">
        <div class="sync-status">当前账号：<b>${esc(authState.user.username)}</b>${authState.user.qq ? ' · 接收 QQ：' + esc(authState.user.qq) : ' · 未绑定 QQ'}</div>
        <div class="sync-actions">
          <button class="btn btn-small btn-primary" type="button" data-action="sync-push" ${syncState.busy ? 'disabled' : ''}>上传到云端</button>
          <button class="btn btn-small" type="button" data-action="sync-pull" ${syncState.busy ? 'disabled' : ''}>从云端合并</button>
        </div>
        <div class="sync-status" id="sync-status">${esc(syncState.status)}</div>
        <div class="ask-hint">上传 = 用当前数据覆盖云端；合并 = 云端卡片补进本地（按 id 去重，不删本地）。</div>
      </div>`;
  }

  function openSync() {
    openModal(modalShell('云同步', authState.user ? '账号：' + authState.user.username : '先登录再同步', syncHtml()));
  }

  async function doSync(action) {
    if (syncState.busy) return;
    if (!authState.user || !authState.token) {
      authState.status = '请先登录账号';
      openAccount();
      return;
    }
    syncState.busy = true;
    syncState.status = action === 'push' ? '上传中…' : '读取中…';
    openSync();
    try {
      const payload = action === 'push'
        ? { action: action, token: authState.token, data: { version: 1, exportedAt: new Date().toISOString(), cards: data.cards, settings: data.settings } }
        : { action: action, token: authState.token };
      const res = await fetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const j = await res.json().catch(() => null);
      if (res.status === 401) {
        saveAuth('', null);
        syncState.status = '登录已过期，请重新登录';
      } else if (!j || !j.ok) {
        syncState.status = '失败：' + ((j && j.error) || ('HTTP ' + res.status));
      } else if (action === 'push') {
        syncState.status = '已上传：' + j.count + ' 张卡片（' + j.updatedAt + '）';
        toast('已上传到云端');
      } else {
        const remote = j.data;
        if (!remote || !Array.isArray(remote.cards)) {
          syncState.status = (j && j.note) || '云端没有数据';
        } else {
          const byId = new Map(data.cards.map((c) => [c.id, c]));
          let added = 0;
          remote.cards.forEach((c) => {
            if (c && c.id && !byId.has(c.id)) { data.cards.push(normalizeCard(c)); added++; }
          });
          refreshDemoFlag();
          saveData();
          syncState.status = '已合并：新增 ' + added + ' 张（云端共 ' + remote.cards.length + ' 张）';
          if (state.view === 'library') renderLibrary();
        }
      }
    } catch (e) {
      syncState.status = '失败：' + String(e.message || e);
    }
    syncState.busy = false;
    openSync();
  }

  const batchState = { site: 'xiaohongshu', keyword: '', limit: 10, sort: 'default', items: [], status: '', importing: false };

  function addCardDirect(card) {
    const normalized = normalizeCard(Object.assign({}, card, { createdAt: new Date().toISOString(), demo: false }));
    data.cards.unshift(normalized);
    ensureCardCategory(normalized);
    refreshDemoFlag();
    saveData();
  }

  async function serverAnalyzeOnce(text, url) {
    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text, url: url, categories: allCategoryNames() })
      });
      if (!res.ok) return null;
      const j = await res.json();
      return j && j.card ? j.card : null;
    } catch (e) {
      return null;
    }
  }

  function batchListHtml() {
    if (!batchState.items.length) {
      return '<div class="batch-empty">还没有结果。填写关键词后点「搜索」，需要本地抓取助手已登录对应站点。</div>';
    }
    return batchState.items.map((it, i) => `
      <label class="batch-item">
        <input type="checkbox" class="batch-check" data-url="${esc(it.url)}" checked />
        <span class="batch-main">
          <b>${esc(it.title || it.url)}</b>
          <span class="batch-meta">${esc(it.author || '')}${it.likes ? ' · ' + esc(it.likes) : ''}${it.excerpt ? ' · ' + esc(it.excerpt).slice(0, 50) : ''}</span>
        </span>
      </label>`).join('');
  }

  function batchHtml() {
    return `
      <div class="batch">
        <div class="batch-form">
          <select id="batch-site">
            <option value="xiaohongshu" ${batchState.site === 'xiaohongshu' ? 'selected' : ''}>小红书</option>
            <option value="zhihu" ${batchState.site === 'zhihu' ? 'selected' : ''}>知乎</option>
          </select>
          <input id="batch-keyword" type="text" placeholder="搜索关键词，比如：早C晚A" value="${esc(batchState.keyword)}" />
          <select id="batch-sort">
            <option value="default" ${batchState.sort === 'default' ? 'selected' : ''}>综合</option>
            <option value="popular" ${batchState.sort === 'popular' ? 'selected' : ''}>最热</option>
            <option value="latest" ${batchState.sort === 'latest' ? 'selected' : ''}>最新</option>
          </select>
          <select id="batch-limit">
            <option value="5" ${batchState.limit === 5 ? 'selected' : ''}>5 条</option>
            <option value="10" ${batchState.limit === 10 ? 'selected' : ''}>10 条</option>
            <option value="20" ${batchState.limit === 20 ? 'selected' : ''}>20 条</option>
          </select>
          <button class="btn btn-primary btn-small" type="button" data-action="batch-search">搜索</button>
        </div>
        <div class="batch-status" id="batch-status">${esc(batchState.status || '')}</div>
        <div class="batch-list" id="batch-list">${batchListHtml()}</div>
        <div class="batch-actions">
          <button class="btn btn-small" type="button" data-action="batch-import" ${batchState.items.length ? '' : 'disabled'}>导入选中（提炼后入库）</button>
          <span class="batch-hint">导入会逐条抓正文 → AI 提炼 → 存入知识库，条数多时请耐心等。</span>
        </div>
      </div>`;
  }

  function openBatch() {
    openModal(modalShell('从搜索结果批量导入', '需要本地抓取助手 + 已登录对应站点', batchHtml()));
  }

  async function doBatchSearch() {
    const siteEl = document.getElementById('batch-site');
    const kwEl = document.getElementById('batch-keyword');
    const limitEl = document.getElementById('batch-limit');
    const sortEl = document.getElementById('batch-sort');
    batchState.site = siteEl ? siteEl.value : 'xiaohongshu';
    batchState.keyword = kwEl ? kwEl.value.trim() : '';
    batchState.limit = limitEl ? Number(limitEl.value) : 10;
    batchState.sort = sortEl ? sortEl.value : 'default';
    if (!batchState.keyword) { toast('先填关键词', 'error'); return; }
    batchState.status = '搜索中…（首次可能需要等页面加载）';
    openBatch();
    const r = await helperCall('/search', { site: batchState.site, keyword: batchState.keyword, limit: batchState.limit, sort: batchState.sort }, 120000);
    if (r && r.loginWall) {
      batchState.status = r.note || '需要登录：请先点「登录窗口」登录';
      batchState.items = [];
    } else if (r && r.ok) {
      batchState.items = r.items || [];
      batchState.status = '找到 ' + batchState.items.length + ' 条，勾选后点「导入选中」';
    } else if (r && r.helperOffline) {
      batchState.status = '本地抓取助手未启动：先运行 integrations/xhs/xhs_helper.mjs';
      batchState.items = [];
    } else {
      batchState.status = '搜索失败：' + ((r && r.error) || '未知错误');
      batchState.items = [];
    }
    openBatch();
  }

  async function doBatchImport() {
    if (batchState.importing) return;
    const checks = [...document.querySelectorAll('.batch-check')];
    const picked = checks.filter((c) => c.checked).map((c) => c.dataset.url);
    if (!picked.length) { toast('先勾选要导入的条目', 'error'); return; }

    // 已在知识库里的链接直接跳过（按 URL 去重）
    const existing = new Set((data.cards || []).map((c) => c.url).filter(Boolean));
    const seenNow = new Set();
    const urls = [];
    let dupCount = 0;
    picked.forEach((u) => {
      if (!u) return;
      if (existing.has(u) || seenNow.has(u)) { dupCount++; return; }
      seenNow.add(u);
      urls.push(u);
    });

    batchState.importing = true;
    let okCount = 0;
    let skipCount = 0;
    const failures = [];
    const setStatus = (t) => {
      const el = document.getElementById('batch-status');
      if (el) el.textContent = t;
    };

    for (let i = 0; i < urls.length; i++) {
      setStatus('导入中 ' + (i + 1) + ' / ' + urls.length + ' · 成功 ' + okCount + ' · 跳过 ' + (skipCount + dupCount));
      try {
        const r = await helperCall('/resolve', { url: urls[i] }, 60000);
        const text = String((r && r.text) || '').trim();
        if (!r || !r.ok || text.length < 12) {
          skipCount++;
          failures.push({ url: urls[i], reason: (r && (r.note || r.error)) || '正文太短' });
        } else {
          let card = await serverAnalyzeOnce(text.slice(0, 6000), urls[i]);
          if (!card) card = await localAnalyze(text, urls[i]);
          const sourceLabel = (r.site || '网页') + (r.author ? ' · @' + r.author : '');
          addCardDirect(Object.assign({}, card, {
            sourceLabel: sourceLabel,
            url: urls[i],
            demo: false
          }));
          okCount++;
        }
      } catch (e) {
        skipCount++;
        failures.push({ url: urls[i], reason: String(e.message || e) });
      }
      // 限速：避免连续抓取触发小红书的累计风控
      if (i < urls.length - 1) await delay(1500 + Math.random() * 1000);
    }

    batchState.importing = false;
    batchState.status = '完成：成功 ' + okCount + ' 条' +
      (skipCount ? '，失败 ' + skipCount + ' 条' : '') +
      (dupCount ? '，重复跳过 ' + dupCount + ' 条' : '') +
      (failures.length ? '（' + failures[0].reason.slice(0, 40) + '）' : '');
    openBatch();
    toast('批量导入完成：' + okCount + ' 条');
    if (state.view === 'library') renderLibrary();
  }

  function linkHelpHtml() {
    const rows = LINK_SOURCES.map((s) => `
      <tr>
        <td><b>${esc(s.name)}</b></td>
        <td><span class="tag ${s.mode === 'auto' ? 'is-accent' : ''}">${s.mode === 'auto' ? '可自动读取' : '可能读不到'}</span></td>
        <td>${esc(s.note)}</td>
      </tr>`).join('');
    const auto = LINK_SOURCES.filter((s) => s.mode === 'auto').map((s) => s.name);
    const manual = LINK_SOURCES.filter((s) => s.mode === 'manual').map((s) => s.name);
    return `
      <div class="link-help">
        <p class="lh-lead">把链接粘到「帖子链接」，点「读取链接」，知序会尝试抓取标题、描述和正文。能否读到取决于对方站点的开放程度。</p>
        <div class="lh-summary">
          <span class="lh-ok">✅ 自动读取：${esc(auto.join('、'))}</span>
          <span class="lh-warn">⚠️ 可能读不到（会尝试）：${esc(manual.join('、'))}</span>
        </div>
        <table class="lh-table">
          <thead><tr><th>来源</th><th>能力</th><th>说明</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <p class="lh-foot">读不到正文也没关系：链接仍会保存为「来源」，你把文字粘到左侧，提炼照常进行。</p>
      </div>`;
  }

  const CATEGORY_DEFS = [
    { name: '护肤与美妆', color: '#c97862', soft: '#f7e4dc', keywords: ['护肤', '皮肤', '敏感肌', '屏障', '早C晚A', '早c晚a', '精华', '面霜', '防晒', '痘痘', '闭口', '成分', '美白', '抗老', '卸妆', '面膜', '油皮', '干皮', '刷酸', '保湿', '粉底', '口红'], topics: ['早C晚A', '屏障修护', '防晒', '成分党', '痘痘急救', '底妆'] },
    { name: '学习与效率', color: '#7c9782', soft: '#e7efe7', keywords: ['学习', '笔记', '效率', '时间管理', '番茄钟', '专注', '拖延', '复盘', '记忆', '考试', '读书', '方法论', '思维导图', '自律', '计划', '输入', '输出'], topics: ['笔记方法', '时间管理', '阅读方法', '考试复盘', '知识管理'] },
    { name: '职场与成长', color: '#b18456', soft: '#f2e7d7', keywords: ['职场', '面试', '简历', '沟通', '汇报', '升职', '同事', '领导', '项目', '表达', '谈判', '实习', '跳槽', '述职'], topics: ['面试表达', '向上沟通', '简历优化', '项目复盘', '职场边界'] },
    { name: '健康与生活', color: '#7f9eaf', soft: '#e4eef2', keywords: ['睡眠', '熬夜', '健身', '减脂', '饮食', '养生', '运动', '情绪', '内耗', '焦虑', '冥想', '早餐', '久坐', '颈椎', '散步'], topics: ['睡眠', '减脂', '情绪调节', '日常养生', '运动习惯'] },
    { name: '穿搭与风格', color: '#b98aa0', soft: '#f4e6ec', keywords: ['穿搭', '显瘦', '通勤', '配色', '风格', '衣橱', '裙子', '牛仔裤', '鞋', '配饰', '小个子', '梨形', '基础款'], topics: ['通勤穿搭', '显瘦思路', '基础款', '配色', '小个子'] },
    { name: '美食与旅行', color: '#c39a5d', soft: '#f6ead7', keywords: ['美食', '咖啡', '探店', '旅行', '攻略', '酒店', '机票', '路线', '城市', '拍照', '露营', '徒步', '餐厅'], topics: ['城市攻略', '咖啡探店', '旅行路线', '露营', '拍照机位'] },
    { name: '理财与搞钱', color: '#8f9066', soft: '#eeeedb', keywords: ['理财', '存钱', '记账', '基金', '消费', '预算', '搞钱', '副业', '保险', '月光', '储蓄', '收入'], topics: ['存钱方法', '记账', '副业', '消费降级', '基础理财'] },
    { name: '家居与收纳', color: '#94a68d', soft: '#e9efe4', keywords: ['家居', '收纳', '装修', '房间', '清洁', '好物', '租房', '改造', '桌面', '灯光'], topics: ['收纳', '租房改造', '清洁', '桌面布置', '灯光'] },
    { name: '数码与工具', color: '#8b95ad', soft: '#e8ebf2', keywords: ['数码', '手机', '电脑', 'APP', 'app', '工具', 'AI', 'ai', '效率工具', '摄影', '相机', 'iPad', 'ipad'], topics: ['效率工具', 'AI 工具', '摄影', '设备选择', '工作流'] },
    { name: '情绪与关系', color: '#b58989', soft: '#f3e6e6', keywords: ['情绪', '关系', '恋爱', '朋友', '边界', '沟通', '自我', '原生家庭', '亲密关系', '拒绝', '讨好'], topics: ['边界感', '亲密关系', '自我觉察', '沟通', '情绪急救'] }
  ];

  const EXTRA_COLORS = ['#b7835f', '#8f9b7d', '#a9849a', '#7f98a6', '#b09562', '#9b8aa8'];

  const SAMPLE_TEXT = `早C晚A真的适合所有人吗？作为一个被烂脸教育过的敏感肌，我想说：先别急着照抄。

我曾经连续两周早C晚A，结果脸颊泛红、刺痛，后来才知道敏感肌要先修屏障。现在我的顺序是：早上清水洗脸 + 保湿 + 防晒，晚上用低浓度A醇，一周两次，中间穿插修护面霜。

如果你也是敏感肌，建议先做三件事：1）停掉所有酸类和猛药；2）用成分简单的修护霜；3）防晒优先于美白。等皮肤稳定一个月，再考虑早C晚A。

#护肤 #敏感肌 #早C晚A #屏障修护 #成分党`;

  const DEMO_CARDS = [
    {
      title: '敏感肌别照抄早C晚A：先修屏障',
      summary: '作者用两周早C晚A烂脸的经历提醒敏感肌：先停猛药、用简单修护霜、把防晒放在美白前面，稳定一个月再考虑功效产品。',
      points: ['敏感肌先停酸类和猛药，减少叠加刺激', '修护期用成分简单的面霜，防晒优先于美白', '皮肤稳定一个月后再逐步引入低浓度A醇'],
      tags: ['早C晚A', '敏感肌', '屏障修护'], category: '护肤与美妆', topic: '早C晚A',
      quote: '敏感肌要先修屏障，再谈早C晚A。', sourceLabel: '小红书 · @小鹿的护肤笔记', url: '',
      createdAt: '2026-11-02T10:20:00+08:00'
    },
    {
      title: '早C晚A翻车后，我改成了「一周两次」',
      summary: '从每天早C晚A改成一周两次低浓度A醇，中间穿插修护和纯保湿，泛红明显减少；作者强调频率比浓度更重要。',
      points: ['新手从一周两次开始，不要天天上脸', 'A醇后第二天必须防晒', '出现刺痛就停用，先修护再继续'],
      tags: ['早C晚A', 'A醇', '敏感肌'], category: '护肤与美妆', topic: '早C晚A',
      quote: '频率比浓度更重要，皮肤稳定才是长期主义。', sourceLabel: '小红书 · @成分实验室', url: '',
      createdAt: '2026-11-04T21:05:00+08:00'
    },
    {
      title: '屏障修护期，我只留三样东西',
      summary: '换季烂脸时把护肤步骤砍到三步：温和清洁、修护面霜、硬防晒；不叠加精华，不给皮肤增加额外负担。',
      points: ['烂脸期做减法，不叠加功效精华', '硬防晒（帽子/口罩）比防晒霜更稳', '修护至少坚持 28 天再评估'],
      tags: ['屏障修护', '换季', '精简护肤'], category: '护肤与美妆', topic: '屏障修护',
      quote: '皮肤在报警的时候，做减法比做加法有用。', sourceLabel: '小红书 · @一颗圆白菜', url: '',
      createdAt: '2026-11-05T09:40:00+08:00'
    },
    {
      title: '我放弃番茄钟之后，反而更专注了',
      summary: '作者发现强制 25 分钟休息会打断心流，改成按任务阶段工作、只在自然停顿处休息，并用一张纸记录分心念头。',
      points: ['按任务阶段而不是固定时钟工作', '分心时先记在纸上，不立刻切换', '每天只安排 1 个「必须完成」的核心任务'],
      tags: ['时间管理', '专注', '效率'], category: '学习与效率', topic: '时间管理',
      quote: '专注不是盯住时钟，而是让任务本身有牵引力。', sourceLabel: '小红书 · @效率实验室', url: '',
      createdAt: '2026-11-01T19:12:00+08:00'
    },
    {
      title: '小红书爆款笔记的 3 个开头结构',
      summary: '拆了 100 篇高赞笔记后，作者总结出三种开头：反常识结论、具体场景痛点、结果前置；共同点是 3 秒内给出继续读的理由。',
      points: ['反常识结论：先打破预期，再给证据', '具体场景：让读者立刻对号入座', '结果前置：先展示变化，再讲过程'],
      tags: ['笔记方法', '内容创作', '小红书'], category: '学习与效率', topic: '笔记方法',
      quote: '开头不是铺垫，是给读者一个继续读下去的理由。', sourceLabel: '小红书 · @内容手艺人', url: '',
      createdAt: '2026-11-03T14:30:00+08:00'
    },
    {
      title: '面试讲项目，用 STAR 就够了',
      summary: '把项目拆成情境、任务、行动、结果四段，每段只讲一个重点；结果尽量量化，失败项目也要讲清楚复盘。',
      points: ['情境一句话交代背景，不铺陈', '行动部分突出「我」而不是「我们」', '结果带数字，失败项目讲复盘'],
      tags: ['面试表达', '职场', 'STAR'], category: '职场与成长', topic: '面试表达',
      quote: '面试官不关心项目多大，关心你在里面做了什么判断。', sourceLabel: '小红书 · @offer陪跑员', url: '',
      createdAt: '2026-10-29T08:15:00+08:00'
    },
    {
      title: '睡前 1 小时断网，救我狗命',
      summary: '把手机放到客厅、用纸质书替代刷视频，入睡时间从 1 点提前到 11 点半；作者建议先断「信息流」而不是断所有屏幕。',
      points: ['睡前 1 小时把手机移出卧室', '用低刺激的纸质书替代短视频', '固定起床时间比固定睡觉时间更有效'],
      tags: ['睡眠', '熬夜', '习惯'], category: '健康与生活', topic: '睡眠',
      quote: '不是睡不着，是大脑还在等信息流的下一条。', sourceLabel: '小红书 · @早睡俱乐部', url: '',
      createdAt: '2026-10-27T22:45:00+08:00'
    },
    {
      title: '365 天存钱法，适合月光族',
      summary: '每天存 1–365 元中未使用的数字，一年最多可存 66795 元；作者建议从每天 10 元开始，先建立「存钱肌肉」。',
      points: ['把 1–365 做成表格，每天划掉一个数字', '收入不稳定时改成按周存', '存钱账户单独放，不绑定支付软件'],
      tags: ['存钱', '理财', '月光族'], category: '理财与搞钱', topic: '存钱方法',
      quote: '存钱不是等有剩余，而是先把一部分拿走。', sourceLabel: '小红书 · @小钱罐', url: '',
      createdAt: '2026-10-25T12:00:00+08:00'
    }
  ];

  /* ---------------------------------------------------------------- 工具 */
  const escMap = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => escMap[c]); }
  function safeUrl(u) { return /^https?:\/\//i.test(String(u || '')) ? String(u) : ''; }
  function uid(prefix) { return (prefix || 'id') + '_' + Date.now().toString(36) + Math.random().toString(16).slice(2, 7); }
  function clamp(n, a, b) { return Math.min(b, Math.max(a, n)); }
  function truncate(s, n) { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; }

  // 从标题里提炼「核心短语」，用于思维导图节点名（AI 给了 core 就优先用 AI 的）
  function coreFromTitle(title) {
    let s = String(title || '')
      .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}]/gu, ' ')
      .replace(/[【】\[\]（）()「」『』《》“”"'’]/g, ' ')
      .replace(/#[^\s#]+/g, ' ')
      .replace(/[，。！？、；：,.!?;:]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!s) return '未命名卡片';
    const parts = s.split(' ').filter(Boolean);
    let out = parts[0] || s;
    if (out.length > 12) out = out.slice(0, 11) + '…';
    return out;
  }

  function cardCore(card) {
    const ai = String((card && card.core) || '').trim();
    return ai || coreFromTitle(card && card.title);
  }
  function escapeRegExp(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  function hash(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; }
  function delay(ms) { return new Promise((r) => setTimeout(r, ms)); }
  function fmtDate(iso) { try { const d = new Date(iso); return `${d.getMonth() + 1}月${d.getDate()}日`; } catch { return ''; } }

  function customCategoryList() {
    if (!data.settings || typeof data.settings !== 'object') data.settings = {};
    if (!Array.isArray(data.settings.customCategories)) data.settings.customCategories = [];
    return data.settings.customCategories;
  }

  function findCategoryDef(name) {
    return CATEGORY_DEFS.find((c) => c.name === name) ||
      customCategoryList().find((c) => c && c.name === name) || null;
  }

  function categoryInfo(name) {
    const found = findCategoryDef(name);
    if (found) return Object.assign({ keywords: [], topics: [] }, found);
    const color = EXTRA_COLORS[hash(name || '其他') % EXTRA_COLORS.length];
    return { name, color, soft: color + '22', keywords: [], topics: [] };
  }

  function allCategoryNames() {
    const names = CATEGORY_DEFS.map((c) => c.name);
    customCategoryList().forEach((c) => { if (c && c.name && names.indexOf(c.name) < 0) names.push(c.name); });
    data.cards.forEach((c) => { if (c.category && names.indexOf(c.category) < 0) names.push(c.category); });
    return names;
  }

  /**
   * 登记一个分类（AI 自动新建 或 用户手动添加）
   * 返回 true 表示新增成功，false 表示已存在/无效
   */
  function registerCategory(name, opts) {
    const n = String(name || '').trim().slice(0, 12);
    if (!n) return false;
    if (findCategoryDef(n)) return false;
    const color = EXTRA_COLORS[hash(n) % EXTRA_COLORS.length];
    customCategoryList().push({
      name: n,
      color: color,
      soft: color + '22',
      auto: Boolean(opts && opts.auto),
      createdAt: new Date().toISOString()
    });
    saveData();
    return true;
  }

  /** 卡片入库后确保分类存在；AI 新分类会自动登记 */
  function ensureCardCategory(card) {
    if (!card || !card.category) return false;
    if (findCategoryDef(card.category)) return false;
    const added = registerCategory(card.category, { auto: true });
    if (added) toast('AI 自动新建了分类：' + card.category);
    return added;
  }

  function hashtagsOf(text) {
    const out = [];
    String(text || '').replace(/#([^#\s，。！？、,.!?]{1,16})/g, (_, tag) => { out.push(tag.trim()); return ''; });
    return out;
  }

  function extractUrl(text) {
    const m = String(text || '').match(/https?:\/\/[^\s，。！？]+/i);
    return m ? m[0].replace(/[),.]+$/, '') : '';
  }

  function sourceFromUrl(url, text) {
    const u = safeUrl(url);
    let label = '手动粘贴';
    if (u) {
      let host = '';
      try { host = new URL(u).hostname.replace(/^www\./, ''); } catch { host = ''; }
      const map = { 'xiaohongshu.com': '小红书', 'weibo.com': '微博', 'zhihu.com': '知乎', 'bilibili.com': 'B站', 'douyin.com': '抖音', 'wechat.com': '公众号', 'mp.weixin.qq.com': '公众号' };
      label = map[host] || host || '链接';
      const author = String(text || '').match(/(?:作者|博主|up主|UP主)[：:]\s*([^\n，。]{1,18})/);
      if (author) label += ' · @' + author[1].trim();
    }
    return { label, url: u };
  }

  function cleanTitleLine(line) {
    return String(line || '')
      .replace(/https?:\/\/\S+/g, '')
      .replace(/#[^#\s，。！？、,.!?]{1,16}/g, '')
      .replace(/^(标题|题目)[：:]\s*/, '')
      .replace(/^[\d\s.、,，:：\-—]+/, '')
      .trim();
  }

  function splitSentences(text) {
    return String(text || '')
      .replace(/\r/g, '')
      .replace(/\n{2,}/g, '。\n')
      .split(/[。！？!?；;]+|\n+/)
      .map((s) => s.replace(/^[\s\d.、,，:：\-—]+/, '').trim())
      .filter((s) => s.length >= 6 && s.length <= 160);
  }

  function keywordScores(text) {
    const scores = [];
    CATEGORY_DEFS.forEach((cat) => {
      let score = 0;
      cat.keywords.forEach((kw) => {
        if (!kw) return;
        const re = new RegExp(escapeRegExp(kw), 'gi');
        const m = String(text).match(re);
        if (m) score += m.length * (kw.length >= 3 ? 2 : 1);
      });
      scores.push({ cat, score });
    });
    return scores.sort((a, b) => b.score - a.score);
  }

  function topTags(text, category, limit) {
    const limitN = limit || 4;
    const tags = hashtagsOf(text);
    const textLower = String(text).toLowerCase();
    const scores = {};
    CATEGORY_DEFS.forEach((cat) => cat.keywords.forEach((kw) => {
      if (!kw) return;
      const idx = textLower.indexOf(String(kw).toLowerCase());
      if (idx >= 0) scores[kw] = (scores[kw] || 0) + (kw.length >= 3 ? 2 : 1);
    }));
    Object.keys(scores).sort((a, b) => scores[b] - scores[a]).forEach((kw) => {
      if (tags.indexOf(kw) < 0) tags.push(kw);
    });
    if (category && category.name && tags.length === 0) tags.push(category.name);
    return tags.slice(0, limitN);
  }

  function chooseTopic(text, category, tags) {
    const topicList = (category && category.topics) || [];
    const lower = String(text).toLowerCase();
    for (const t of topicList) {
      if (lower.indexOf(String(t).toLowerCase()) >= 0) return t;
    }
    for (const t of tags) {
      for (const topic of topicList) {
        if (t.indexOf(topic) >= 0 || topic.indexOf(t) >= 0) return topic;
      }
    }
    return tags[0] || '综合笔记';
  }

  function bigrams(s) {
    const clean = String(s || '').replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '');
    const out = new Set();
    for (let i = 0; i < clean.length - 1; i++) out.add(clean.slice(i, i + 2));
    return out;
  }

  function jaccard(a, b) {
    if (!a.size || !b.size) return 0;
    let inter = 0;
    a.forEach((x) => { if (b.has(x)) inter++; });
    return inter / (a.size + b.size - inter);
  }

  function cardTokens(card) {
    const set = new Set();
    (card.tags || []).forEach((t) => set.add(String(t).toLowerCase()));
    bigrams(card.title).forEach((x) => set.add(x));
    bigrams((card.summary || '').slice(0, 80)).forEach((x) => set.add(x));
    return set;
  }

  function cardSimilarity(a, b) {
    const tagJ = jaccard(new Set((a.tags || []).map((t) => String(t).toLowerCase())), new Set((b.tags || []).map((t) => String(t).toLowerCase())));
    const titleJ = jaccard(bigrams(a.title), bigrams(b.title));
    const sumJ = jaccard(bigrams((a.summary || '').slice(0, 90)), bigrams((b.summary || '').slice(0, 90)));
    let score = 0.5 * tagJ + 0.3 * titleJ + 0.2 * sumJ;
    if (a.topic && a.topic === b.topic) score += 0.3;
    if (a.category && a.category === b.category) score += 0.05;
    return Math.min(1, score);
  }

  /* ---------------------------------------------------------------- 数据 */
  let data = null;
  let aiLive = false;
  let serverLive = false;
  let helperAlive = false;
  let inboxItems = [];
  let inboxTimer = null;
  let linkResolving = false;

  function normalizeCard(c) {
    return {
      id: c.id || uid('card'),
      title: c.title || '未命名卡片',
      core: c.core || '',
      summary: c.summary || '',
      points: Array.isArray(c.points) ? c.points.filter(Boolean) : [],
      tags: Array.isArray(c.tags) ? c.tags.filter(Boolean) : [],
      category: c.category || '未分类',
      topic: c.topic || '综合笔记',
      quote: c.quote || '',
      sourceLabel: c.sourceLabel || '手动粘贴',
      url: safeUrl(c.url),
      createdAt: c.createdAt || new Date().toISOString(),
      demo: Boolean(c.demo)
    };
  }

  function seedData() {
    return {
      version: 1,
      demo: true,
      cards: DEMO_CARDS.map((c, i) => normalizeCard({ ...c, id: 'demo_' + i, demo: true })),
      settings: { threshold: 0.45, merge: true },
      createdAt: new Date().toISOString()
    };
  }

  function loadData() {
    try {
      const raw = localStorage.getItem(STORE_KEY) || localStorage.getItem(LEGACY_STORE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.cards)) {
          parsed.cards = parsed.cards.map(normalizeCard);
          parsed.settings = { threshold: 0.45, merge: true, ...(parsed.settings || {}) };
          // 从旧品牌迁移：读取一次后写入新 key
          if (!localStorage.getItem(STORE_KEY)) {
            try { localStorage.setItem(STORE_KEY, JSON.stringify(parsed)); } catch (e) { /* 忽略 */ }
          }
          return parsed;
        }
      }
    } catch (e) { /* 忽略损坏数据 */ }
    return seedData();
  }

  function saveData() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(data)); } catch (e) { /* 隐私模式忽略 */ }
  }

  function refreshDemoFlag() {
    data.demo = data.cards.some((c) => c.demo);
  }

  /* ---------------------------------------------------------------- 视图状态 */
  const state = {
    view: 'collect',
    busy: false,
    analysis: null,
    progress: 0,
    filter: { category: '', topic: '', q: '', sort: 'new' },
    openCats: new Set(),
    map: {
      category: '',
      topic: '',
      threshold: 0.45,
      merge: true,
      selected: null,
      collapsed: new Set(),
      zoom: 1,
      panX: 0,
      panY: 0
    },
    lastSavedId: ''
  };

  /* ---------------------------------------------------------------- 图标 */
  function icon(name, size) {
    const s = size || 18;
    const paths = {
      spark: '<path d="M12 3l1.7 5.3L19 10l-5.3 1.7L12 17l-1.7-5.3L5 10l5.3-1.7L12 3z"/><path d="M19 15l.9 2.6L22.5 18l-2.6.9L19 21l-.9-2.1L15.5 18l2.6-.4L19 15z"/>',
      arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
      folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/>',
      cards: '<rect x="3" y="6" width="12" height="15" rx="2"/><path d="M8 3h9a2 2 0 0 1 2 2v11"/>',
      map: '<circle cx="6" cy="12" r="2.3"/><circle cx="18" cy="6" r="2.3"/><circle cx="18" cy="18" r="2.3"/><path d="M8.3 11l7.4-4M8.3 13l7.4 4"/>',
      search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
      close: '<path d="M6 6l12 12M18 6L6 18"/>',
      download: '<path d="M12 3v12M7 10l5 5 5-5M4 21h16"/>',
      upload: '<path d="M12 21V9M7 14l5-5 5 5M4 3h16"/>',
      trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14"/>',
      external: '<path d="M14 4h6v6M20 4l-9 9M18 13v6H5V6h6"/>',
      plus: '<path d="M12 5v14M5 12h14"/>',
      refresh: '<path d="M20 11a8 8 0 1 0-2.3 6.7M20 5v6h-6"/>',
      info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
      check: '<path d="M4 12l5 5L20 6"/>',
      chevron: '<path d="M9 6l6 6-6 6"/>',
      folderOpen: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v2H3V7z"/><path d="M3 11h18l-2 8H5l-2-8z"/>',
      inbox: '<path d="M4 5h16v13H4z"/><path d="M4 13h4l2 3h4l2-3h4"/>',
      link: '<path d="M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1"/>',
      sparkle: '<path d="M12 2l2.2 6.8L21 11l-6.8 2.2L12 20l-2.2-6.8L3 11l6.8-2.2L12 2z"/>'
    };
    return `<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || ''}</svg>`;
  }

  /* ---------------------------------------------------------------- toast / modal */
  function toast(msg, type) {
    const wrap = document.getElementById('toast-wrap');
    const el = document.createElement('div');
    el.className = 'toast' + (type === 'error' ? ' is-error' : '');
    el.textContent = msg;
    wrap.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; el.style.transform = 'translateY(6px)'; }, 2600);
    setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 3000);
  }

  function openModal(html) {
    const root = document.getElementById('modal-root');
    root.hidden = false;
    root.innerHTML = `<div class="modal-backdrop" data-action="close-modal"></div><div class="modal" role="dialog" aria-modal="true">${html}</div>`;
    document.body.style.overflow = 'hidden';
  }

  function closeModal() {
    const root = document.getElementById('modal-root');
    root.hidden = true;
    root.innerHTML = '';
    document.body.style.overflow = '';
  }

  function modalShell(title, meta, body, actions) {
    return `
      <div class="modal-head">
        <div><h2>${esc(title)}</h2><div class="modal-meta">${meta || ''}</div></div>
        <button class="modal-close" type="button" data-action="close-modal" aria-label="关闭">${icon('close', 16)}</button>
      </div>
      <div class="modal-body">${body}</div>
      <div class="modal-actions">${actions || `<button class="btn btn-ghost" type="button" data-action="close-modal">关闭</button>`}</div>`;
  }

  /* ---------------------------------------------------------------- 分析：本地规则 */
  function localAnalyze(textInput, urlInput) {
    const text = String(textInput || '').replace(/\r/g, '').trim();
    const url = safeUrl(urlInput || extractUrl(text));
    const sentences = splitSentences(text);
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    const firstLine = cleanTitleLine(lines[0] || '');
    const scores = keywordScores(text);
    const best = scores[0];
    const strong = best && best.score >= 2;
    const category = strong ? best.cat : (best && best.score === 1 ? best.cat : null);
    const tags = topTags(text, category, 4);
    const cat = category || { name: tags[0] ? '新知识 · ' + tags[0] : '未分类', topics: [] };
    const dynamicCat = category ? category : categoryInfo(cat.name);
    const topic = chooseTopic(text, dynamicCat, tags);
    const titleCandidate = firstLine || (sentences[0] ? truncate(sentences[0], 26) : '一条新的知识卡片');
    const title = truncate(titleCandidate.replace(/^["'“”]+|["'“”]+$/g, ''), 30);
    const summarySentences = [];
    if (sentences[0]) summarySentences.push(sentences[0]);
    const ranked = sentences.slice(1).map((s, i) => {
      let sc = i === 0 ? 1 : 0;
      scores.forEach((entry) => entry.cat.keywords.forEach((kw) => { if (s.indexOf(kw) >= 0) sc += 2; }));
      return { s, sc };
    }).sort((a, b) => b.sc - a.sc);
    if (ranked[0]) summarySentences.push(ranked[0].s);
    const summary = truncate(summarySentences.join(' ').replace(/\s+/g, ' '), 120);
    const pointRanked = ranked
      .filter((x) => x.sc > 0 && x.s !== summarySentences[0])
      .slice(0, 6)
      .map((x) => truncate(x.s, 62));
    let points = [];
    pointRanked.forEach((p) => { if (points.indexOf(p) < 0) points.push(p); });
    if (points.length < 3) {
      sentences.forEach((s) => { if (points.length < 3 && points.indexOf(truncate(s, 62)) < 0 && s !== summarySentences[0]) points.push(truncate(s, 62)); });
    }
    const quote = sentences.find((s) => /建议|记住|最重要|其实|不要|必须|核心/.test(s)) || sentences[0] || '';
    const source = sourceFromUrl(url, text);

    return Promise.resolve(normalizeCard({
      title, core: coreFromTitle(title), summary: summary || truncate(text, 110), points: points.slice(0, 4),
      tags: tags.length ? tags : [topic],
      category: cat.name, topic,
      quote: truncate(quote, 90), sourceLabel: source.label, url: source.url,
      createdAt: new Date().toISOString()
    }));
  }

  /* ---------------------------------------------------------------- 分析：服务端真 AI（可选） */
  async function serverAnalyze(text, url) {
    const res = await fetch('/api/analyze', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, url, categories: allCategoryNames() })
    });
    if (!res.ok) throw new Error('AI 服务返回 ' + res.status);
    const payload = await res.json();
    const raw = payload.card || (payload.cards && payload.cards[0]);
    if (!raw) throw new Error('AI 没有返回卡片');
    const source = sourceFromUrl(url || extractUrl(text), text);
    return normalizeCard({
      ...raw,
      points: Array.isArray(raw.points) ? raw.points : [],
      tags: Array.isArray(raw.tags) ? raw.tags : [],
      sourceLabel: raw.sourceLabel || source.label,
      url: raw.url || source.url,
      createdAt: new Date().toISOString()
    });
  }

  async function analyze(text, url) {
    if (aiLive) {
      try { return await serverAnalyze(text, url); }
      catch (e) { toast('AI 服务暂时不可用，已改用本地演示解析', 'error'); }
    }
    return localAnalyze(text, url);
  }

  async function detectAI() {
    try {
      const res = await fetch('/api/health', { cache: 'no-store' });
      if (!res.ok) return;
      const j = await res.json();
      if (j && j.ok) {
        serverLive = true;
        const badge = document.getElementById('ai-badge');
        if (j.mode === 'spark') {
          aiLive = true;
          badge.classList.add('is-live');
          document.getElementById('ai-badge-text').textContent = 'AI 已连接';
        } else {
          // 有后端但没有模型 key：链接能读，提炼走本地规则
          document.getElementById('ai-badge-text').textContent = j.resolve ? '链接可读 · 本地规则' : '本地演示';
        }
        startInboxPolling();
      }
    } catch (e) { /* 静态打开：本地演示 */ }
  }

  /* ---------------------------------------------------------------- 分享链接 / 收件箱 */
  function setLinkStatus(text, kind) {
    const el = document.getElementById('link-status');
    if (!el) return;
    el.hidden = !text;
    el.textContent = text || '';
    el.className = 'link-status' + (kind ? ' is-' + kind : '');
  }

  function fillEditor(text, url) {
    const ta = document.getElementById('paste-text');
    const urlEl = document.getElementById('paste-url');
    if (urlEl && url) urlEl.value = url;
    if (ta && text) {
      ta.value = text;
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    }
    updateCharCount();
  }

  async function resolveLink(url, opts) {
    const options = opts || {};
    const inputUrl = String(url || '').trim();
    if (!/^https?:\/\//i.test(inputUrl)) {
      toast('先填一个 http/https 链接', 'error');
      return null;
    }
    const src = detectSource(inputUrl);
    if (src && src.mode === 'manual') {
      // 这类站点有反爬，但部分页面（SSR/开放内容）仍可能读到：先提示，再尝试
      setLinkStatus(src.name + '：' + src.note, 'warn');
    }
    // 小红书等：优先用本地登录窗口抓取（登录态在 helpers 的独立 profile 里）
    if (src && (src.key === 'xiaohongshu' || src.mode === 'manual')) {
      setLinkStatus('正在用本地登录窗口读取（首次需在弹出的窗口扫码登录）…', 'loading');
      const h = await helperCall('/resolve', { url: inputUrl }, 50000);
      if (h && h.ok) {
        fillEditor(String(h.text || '').slice(0, 6000), h.url || inputUrl);
        setLinkStatus('已用登录窗口读取：' + (h.title || src.name) + (h.author ? ' · @' + h.author : ''), 'ok');
        toast('已从登录窗口读取正文，确认后提炼');
        return h;
      }
      if (h && h.loginWall) {
        setLinkStatus(h.note || '请先在弹窗里扫码登录小红书，然后重试', 'warn');
        toast('请先在弹窗里扫码登录小红书，然后重试');
        return null;
      }
      if (h && h.helperOffline) {
        setLinkStatus('本地抓取助手未启动：先运行 integrations/xhs/xhs_helper.mjs；现在尝试普通读取…', 'warn');
      } else if (h && h.note) {
        setLinkStatus(h.note, 'warn');
      }
    }
    if (!serverLive) {
      setLinkStatus('当前没有连接「读取服务」：请直接粘贴文字，链接会保存为来源。部署了后端或在本机运行 server.py 后，公众号 / 豆瓣 / 普通网页等可自动读取。', 'warn');
      toast('未连接读取服务：请手动粘贴文字，链接会保存为来源', 'error');
      return null;
    }
    if (linkResolving) return null;
    linkResolving = true;
    setLinkStatus('正在读取链接…', 'loading');
    const btn = document.querySelector('[data-action="resolve-link"]');
    if (btn) btn.disabled = true;
    try {
      const res = await fetch('/api/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url })
      });
      const j = await res.json();
      if (!res.ok || !j.ok) throw new Error(j.error || '读取失败');
      let text = j.text || j.description || '';
      // 登录墙页面常把“小红书 - 你的生活兴趣社区”当正文，这种短标题不要当内容
      if (j.blocked && text.length < 60) text = '';
      if (j.blocked && !text) {
        const ta = document.getElementById('paste-text');
        if (ta) { ta.value = ''; updateCharCount(); }
      }
      fillEditor(text, url);
      if (j.blocked) {
        setLinkStatus(j.note || '平台限制，未能读取正文；请手动粘贴文字（链接已保留）', 'warn');
        toast(j.note || '平台限制，未能读取正文', 'error');
      } else {
        setLinkStatus(`已读取：${j.title || j.site || '网页'}${text ? '（正文已填入，可编辑）' : ''}`, 'ok');
        toast('链接已读取，确认文字后点「理成知识卡片」');
      }
      if (options.autoAnalyze) {
        const ta = document.getElementById('paste-text');
        if (ta && ta.value.trim().length >= 12) runAnalyze();
      }
      return j;
    } catch (e) {
      setLinkStatus(e.message || '读取失败，请手动粘贴', 'warn');
      toast(e.message || '读取失败，请手动粘贴', 'error');
      return null;
    } finally {
      linkResolving = false;
      const b = document.querySelector('[data-action="resolve-link"]');
      if (b) b.disabled = false;
    }
  }

  async function loadInbox() {
    if (!serverLive) return;
    try {
      const res = await fetch('/api/inbox', { cache: 'no-store' });
      if (!res.ok) return;
      const j = await res.json();
      if (j && j.ok && Array.isArray(j.items)) {
        inboxItems = j.items;
        updateInboxBadge();
        renderInboxPanel();
      }
    } catch (e) { /* 忽略 */ }
  }

  function startInboxPolling() {
    loadInbox();
    if (inboxTimer) clearInterval(inboxTimer);
    inboxTimer = setInterval(loadInbox, 8000);
  }

  function updateInboxBadge() {
    const badge = document.getElementById('inbox-badge');
    if (!badge) return;
    const n = inboxItems.length;
    badge.hidden = n === 0;
    badge.textContent = n > 9 ? '9+' : String(n);
  }

  function renderInboxPanel() {
    const host = document.getElementById('inbox-panel');
    if (!host) return;
    if (!serverLive || !inboxItems.length) {
      host.hidden = true;
      host.innerHTML = '';
      return;
    }
    host.hidden = false;
    host.innerHTML = `
      <div class="inbox-head">
        <div>${icon('inbox', 15)} <b>来自分享的链接</b><span>${inboxItems.length} 条待归档</span></div>
        <button class="btn btn-small btn-ghost" type="button" data-action="refresh-inbox">刷新</button>
      </div>
      <div class="inbox-list">
        ${inboxItems.map((it) => `
          <div class="inbox-item">
            <div class="inbox-item-main">
              <div class="inbox-item-title">${esc(it.title || it.url)}</div>
              <div class="inbox-item-meta">${esc(it.from || '分享')} · ${esc((it.createdAt || '').replace('T', ' ').slice(0, 16))}</div>
            </div>
            <div class="inbox-item-actions">
              <button class="btn btn-small btn-primary" type="button" data-action="use-inbox" data-id="${esc(it.id)}">读取并归档</button>
              <button class="btn btn-small btn-ghost" type="button" data-action="drop-inbox" data-id="${esc(it.id)}">忽略</button>
            </div>
          </div>`).join('')}
      </div>`;
  }

  async function useInboxItem(id) {
    const item = inboxItems.find((x) => x.id === id);
    if (!item) return;
    // QQ 桥已提炼好的卡片：直接进确认页，不重复调用 AI
    if (item.card && item.card.title) {
      const card = normalizeCard(Object.assign({}, item.card, { createdAt: new Date().toISOString() }));
      state.analysis = { rawText: String(item.text || ''), rawUrl: item.url || '', card };
      renderCollect();
      const result = document.getElementById('result-area');
      if (result) result.scrollIntoView({ behavior: 'smooth', block: 'start' });
      await removeInboxItem(id);
      toast('已接收 QQ 摘要，确认后保存到知识库');
      return;
    }
    const ta = document.getElementById('paste-text');
    const urlEl = document.getElementById('paste-url');
    // 浏览器插件/QQ 如果已经带来正文，直接填，不再抓登录墙
    if (item.text && String(item.text).trim().length >= 12) {
      fillEditor(String(item.text), item.url);
      setLinkStatus(`已接收：${item.title || '分享正文'}（正文已填入，可编辑后提炼）`, 'ok');
      await removeInboxItem(id);
      toast('正文已填入，点「理成知识卡片」即可');
      if (ta) ta.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    if (ta) ta.value = item.text || '';
    if (urlEl) urlEl.value = item.url;
    updateCharCount();
    const result = await resolveLink(item.url, { autoAnalyze: !!(item.text && item.text.length >= 12) });
    if (result !== null || !serverLive) await removeInboxItem(id);
    const urlInput = document.getElementById('paste-url');
    if (urlInput) urlInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  async function removeInboxItem(id) {
    try {
      await fetch('/api/inbox?id=' + encodeURIComponent(id), { method: 'DELETE' });
    } catch (e) { /* 忽略 */ }
    inboxItems = inboxItems.filter((x) => x.id !== id);
    updateInboxBadge();
    renderInboxPanel();
  }

  async function handleSharedParams() {
    const params = new URLSearchParams(location.search);
    const sharedText = params.get('text') || '';
    let sharedUrl = params.get('url') || params.get('link') || params.get('share') || '';
    if (!sharedUrl && sharedText) {
      const m = sharedText.match(/https?:\/\/[^\s<>"']+/);
      if (m) sharedUrl = m[0].replace(/[，。！？、,.!?)）】]+$/, '');
    }
    if (!sharedUrl && !sharedText) return;
    if (state.view !== 'collect') {
      state.view = 'collect';
      renderCollect();
    }
    const ta = document.getElementById('paste-text');
    const urlEl = document.getElementById('paste-url');
    if (sharedText) {
      if (ta) ta.value = sharedText.replace(sharedUrl, '').trim() || sharedText;
      updateCharCount();
    }
    if (urlEl && sharedUrl) urlEl.value = sharedUrl;
    if (sharedUrl && !sharedText) {
      toast('收到分享链接，正在读取…');
      await resolveLink(sharedUrl, { autoAnalyze: params.get('auto') === '1' });
    } else if (params.get('auto') === '1' && ta && ta.value.trim().length >= 12) {
      runAnalyze();
    }
  }


  function renderCollect() {
    const letters = document.querySelectorAll('.tab');
    letters.forEach((t) => t.classList.toggle('is-active', t.dataset.nav === 'collect'));
    const demoBanner = data.demo ? `
      <div class="demo-banner">
        <span>${icon('sparkle', 15)} 已放入 <b>8 张示例卡片</b>，可直接体验；也可以清空后从自己的笔记开始。</span>
        <div><button class="btn btn-small btn-ghost" type="button" data-action="clear-demo">清空示例</button></div>
      </div>` : '';

    document.getElementById('main').innerHTML = `
      <section class="view collect">
        ${demoBanner}
        <div id="inbox-panel" class="inbox-panel" hidden></div>
        <div class="hero">
          <div class="hero-copy">
            <p class="eyebrow">01 / 收集 · 从刷到到留下</p>
            <h1>把刷到的<em>好内容</em>，<br>理成自己的知识。</h1>
            <p class="lede">小红书笔记、公众号文章、豆瓣/博客/新闻都能收：把文字粘进来，或贴链接点「读取链接」自动抓正文（小红书、知乎这类有登录墙的站点请手动粘贴）。知序会提炼成一张带来源的知识卡片，并自动放进你的知识谱系。</p>
            <div class="hero-steps">
              <span class="step"><b>1</b> 复制笔记</span><span class="arrow">→</span>
              <span class="step"><b>2</b> AI 提炼</span><span class="arrow">→</span>
              <span class="step"><b>3</b> 自动归档</span>
            </div>
          </div>
          <div class="jar-stage" aria-hidden="true">
            <div class="jar-glow"></div>
            <span class="jar-tag t1"># 早C晚A</span>
            <span class="jar-tag t2"># 时间管理</span>
            <span class="jar-tag t3"># 面试表达</span>
            <span class="jar-tag t4"># 存钱方法</span>
            <div class="jar-big">
              <div class="jar-seal">知</div>
              <div class="jar-label">KNOWLEDGE ORDER</div>
            </div>
          </div>
        </div>

        <div class="collect-grid">
          <div class="panel input-panel">
            <div class="panel-head">
              <div class="panel-title">${icon('spark', 15)}<span>新建知识卡片</span></div>
              <span class="mode-chip">粘贴文本</span>
            </div>
            <textarea id="paste-text" class="paste-area" placeholder="把笔记文字粘贴到这里……&#10;支持小红书笔记、公众号文章、豆瓣 / 博客 / 新闻正文；也可以只贴链接，点「读取链接」自动抓取。">${esc(state.analysis ? state.analysis.rawText : '')}</textarea>
            <div class="input-foot">
              <input id="paste-url" class="url-input" type="url" placeholder="帖子链接（可选，用于记录来源）" value="${esc(state.analysis ? state.analysis.rawUrl : '')}" />
              <button class="btn btn-small btn-ghost url-read-btn" type="button" data-action="resolve-link">${icon('link', 13)} 读取链接</button>
              <span class="char-count" id="char-count">0 字</span>
            </div>
            <div class="link-status" id="link-status" hidden></div>
            <div class="link-detected" id="link-detected" hidden></div>
            <div class="link-support">
              <span class="ls-ok">✅ 自动读取：公众号 · 豆瓣 · 简书 · B站 · 掘金 · 普通网页</span>
              <span class="ls-warn" id="support-manual">⚠️ 可能读不到（会尝试）：小红书 · 知乎 · 微博 · 抖音</span>
              <button class="btn btn-small btn-ghost" type="button" data-action="fetch-comments">抓评论</button>
              <button class="btn btn-small btn-ghost" type="button" data-action="xhs-login">登录窗口</button>
              <button class="btn btn-small btn-ghost" type="button" data-action="link-help">支持哪些链接？</button>
            </div>
            <div class="share-hint">${icon('inbox', 12)} 在手机/QQ 里分享给知序，或在链接后加 <code>?url=</code>，都会进入同一个收集框。</div>
            <div class="input-actions">
              <button class="btn btn-ghost btn-small" type="button" data-action="batch-open">批量导入</button>
              <button class="btn btn-ghost btn-small" type="button" data-action="fill-sample">放入示例笔记</button>
              <button class="btn btn-primary" type="button" data-action="analyze" id="btn-analyze">
                ${icon('sparkle', 15)} 理成知识卡片 ${icon('arrow', 15)}
              </button>
            </div>
            <div class="analysis-progress" id="progress" hidden>
              <div class="p-title"><span>正在提炼这张卡片…</span><span id="progress-label">读取文本</span></div>
              <div class="p-steps">
                <div class="p-step" data-step="0"><span class="p-dot"></span><span>读取原文，识别主题与来源</span></div>
                <div class="p-step" data-step="1"><span class="p-dot"></span><span>提炼卡片：标题 / 摘要 / 要点 / 标签</span></div>
                <div class="p-step" data-step="2"><span class="p-dot"></span><span>匹配现有知识谱系，准备归档</span></div>
              </div>
            </div>
          </div>

          <aside class="panel tips-panel">
            <h3>一张好卡片，长什么样？</h3>
            <p>知序不保存整篇笔记，只留下「以后还会用到」的部分。</p>
            <ul class="tip-list">
              <li><span class="ti">壹</span><span><b>一句话结论</b><br>先说你最想记住的判断。</span></li>
              <li><span class="ti">贰</span><span><b>3–4 个要点</b><br>方法、步骤、避坑，各留一条。</span></li>
              <li><span class="ti">叁</span><span><b>来源不丢</b><br>记录博主 / 链接，方便回原帖对照。</span></li>
            </ul>
            <div class="sample-box">${icon('info', 13)} 第一次用？点左下角「放入示例笔记」，直接看一遍完整流程。</div>
          </aside>
        </div>

        <div id="result-area">${state.analysis ? renderAnalysisResult() : ''}</div>
      </section>`;

    updateCharCount();
    renderInboxPanel();
    updateInboxBadge();
    updateLinkDetected();
    syncHelperHint();
  }

  function renderAnalysisResult() {
    const card = state.analysis.card;
    const categories = allCategoryNames();
    if (categories.indexOf(card.category) < 0) categories.unshift(card.category);
    const catOptions = categories.map((name) => `<option value="${esc(name)}" ${name === card.category ? 'selected' : ''}>${esc(name)}</option>`).join('');
    return `
      <div class="result-wrap">
        <div class="result-head">
          <h2>卡片已提炼好，确认一下？</h2>
          <span class="hint">可修改后保存到知识库</span>
        </div>
        <div class="panel result-card">
          <div class="result-main">
            <div class="field"><label>标题</label><input id="edit-title" value="${esc(card.title)}" maxlength="40" /></div>
            <div class="field"><label>一句话摘要</label><textarea id="edit-summary" maxlength="160">${esc(card.summary)}</textarea></div>
            <div class="field-row">
              <div class="field"><label>分类（大点）</label><select id="edit-category">${catOptions}<option value="__new__">＋ 新建分类…</option></select></div>
              <div class="field"><label>主题（小点）</label><input id="edit-topic" value="${esc(card.topic)}" maxlength="20" /></div>
            </div>
            <div class="field" id="new-cat-field" hidden><label>新分类名称</label><input id="edit-new-cat" placeholder="比如：露营 / 养猫" maxlength="20" /></div>
            <div class="field"><label>要点（每行一条）</label><textarea id="edit-points">${esc(card.points.join('\n'))}</textarea></div>
            <div class="field"><label>标签（逗号分隔）</label><input id="edit-tags" value="${esc(card.tags.join('，'))}" /></div>
            <div class="field"><label>原帖里最值得保留的一句</label><input id="edit-quote" value="${esc(card.quote)}" /></div>
          </div>
          <div class="result-side">
            <div class="meta-block"><b>来源</b><input id="edit-source" class="field-input" value="${esc(card.sourceLabel)}" /></div>
            <div class="meta-block"><b>链接</b><input id="edit-url" class="field-input" value="${esc(card.url)}" placeholder="https://…" /></div>
            <div class="meta-block"><b>归档位置</b><div class="value" id="archive-preview">${esc(card.category)} › ${esc(card.topic)}</div></div>
            <div class="result-actions">
              <button class="btn btn-primary" type="button" data-action="save-card">${icon('check', 15)} 保存到知识库</button>
              <button class="btn btn-ghost btn-small" type="button" data-action="reanalyze">${icon('refresh', 14)} 重新解析</button>
              <button class="btn btn-link" type="button" data-action="discard-result">先不保存</button>
            </div>
          </div>
        </div>
      </div>`;
  }

  function updateCharCount() {
    const ta = document.getElementById('paste-text');
    const cc = document.getElementById('char-count');
    if (!ta || !cc) return;
    cc.textContent = `${ta.value.trim().length} 字`;
  }

  /* ---------------------------------------------------------------- 收集事件 */
  function setProgressStep(index) {
    document.querySelectorAll('.p-step').forEach((el, i) => {
      el.classList.toggle('is-done', i < index);
      el.classList.toggle('is-active', i === index);
    });
    const labels = ['读取文本', '提炼卡片', '匹配谱系'];
    const lab = document.getElementById('progress-label');
    if (lab) lab.textContent = labels[Math.min(index, labels.length - 1)];
  }

  async function runAnalyze() {
    if (state.busy) return;
    const ta = document.getElementById('paste-text');
    const urlEl = document.getElementById('paste-url');
    const text = ta ? ta.value.trim() : '';
    if (text.length < 12) { toast('先粘贴一段笔记文字（至少 12 个字）', 'error'); if (ta) ta.focus(); return; }
    state.busy = true;
    const btn = document.getElementById('btn-analyze');
    if (btn) btn.disabled = true;
    const progress = document.getElementById('progress');
    if (progress) progress.hidden = false;
    setProgressStep(0);
    state.analysis = { rawText: text, rawUrl: urlEl ? urlEl.value.trim() : '' };
    try {
      await delay(420);
      setProgressStep(1);
      const card = await analyze(text, urlEl ? urlEl.value.trim() : '');
      await delay(420);
      setProgressStep(2);
      await delay(360);
      state.analysis = { rawText: text, rawUrl: urlEl ? urlEl.value.trim() : '', card };
      setProgressStep(3);
      renderCollect();
      const result = document.getElementById('result-area');
      if (result) result.scrollIntoView({ behavior: 'smooth', block: 'start' });
      toast('卡片已生成，确认后保存');
    } catch (e) {
      toast(e.message || '解析失败，请重试', 'error');
    } finally {
      state.busy = false;
      if (btn) btn.disabled = false;
    }
  }

  function saveCardFromForm() {
    if (!state.analysis || !state.analysis.card) return;
    const base = state.analysis.card;
    const title = document.getElementById('edit-title').value.trim();
    const summary = document.getElementById('edit-summary').value.trim();
    const categorySel = document.getElementById('edit-category');
    let category = categorySel.value;
    if (category === '__new__') {
      const input = document.getElementById('edit-new-cat');
      category = input && input.value.trim() ? input.value.trim() : '未分类';
    }
    const topic = document.getElementById('edit-topic').value.trim() || '综合笔记';
    const points = document.getElementById('edit-points').value.split('\n').map((s) => s.trim()).filter(Boolean);
    const tags = document.getElementById('edit-tags').value.split(/[，,、\s]+/).map((s) => s.trim()).filter(Boolean);
    const quote = document.getElementById('edit-quote').value.trim();
    const sourceLabel = document.getElementById('edit-source').value.trim() || '手动粘贴';
    const url = safeUrl(document.getElementById('edit-url').value.trim());
    if (!title) { toast('标题不能为空', 'error'); return; }
    const card = normalizeCard({
      ...base, title, summary, category, topic, points, tags, quote,
      sourceLabel, url, createdAt: new Date().toISOString(), demo: false
    });
    data.cards.unshift(card);
    ensureCardCategory(card);
    refreshDemoFlag();
    saveData();
    state.analysis = null;
    state.lastSavedId = card.id;
    state.filter.category = '';
    state.filter.topic = '';
    state.filter.q = '';
    state.openCats.add(category);
    toast('已保存到知识库');
    setView('library');
  }

  /* ---------------------------------------------------------------- 知识库 */
  function filteredCards() {
    const f = state.filter;
    const q = f.q.trim().toLowerCase();
    return data.cards.filter((c) => {
      if (f.category && c.category !== f.category) return false;
      if (f.topic && c.topic !== f.topic) return false;
      if (q) {
        const hay = [c.title, c.summary, c.points.join(' '), c.tags.join(' '), c.category, c.topic, c.sourceLabel].join(' ').toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    }).sort((a, b) => {
      if (f.sort === 'old') return new Date(a.createdAt) - new Date(b.createdAt);
      if (f.sort === 'title') return String(a.title).localeCompare(String(b.title), 'zh');
      return new Date(b.createdAt) - new Date(a.createdAt);
    });
  }

  function buildTree() {
    const map = new Map();
    data.cards.forEach((c) => {
      if (!map.has(c.category)) map.set(c.category, new Map());
      const topics = map.get(c.category);
      if (!topics.has(c.topic)) topics.set(c.topic, []);
      topics.get(c.topic).push(c);
    });
    return map;
  }

  function renderLibrary() {
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('is-active', t.dataset.nav === 'library'));
    const tree = buildTree();
    const f = state.filter;
    const cards = filteredCards();
    const activeCat = f.category;
    const activeTopic = f.topic;

    let treeHtml = `<button class="tree-all ${!activeCat && !activeTopic ? 'is-active' : ''}" type="button" data-cat="" data-topic="">${icon('cards', 14)}<span>全部卡片</span><span class="count">${data.cards.length}</span></button>`;
    Array.from(tree.keys()).sort((a, b) => (tree.get(b).size - tree.get(a).size)).forEach((cat) => {
      const topics = tree.get(cat);
      const catCount = Array.from(topics.values()).reduce((n, arr) => n + arr.length, 0);
      const info = categoryInfo(cat);
      const open = state.openCats.has(cat) || activeCat === cat;
      treeHtml += `<div class="tree-cat ${open ? 'is-open' : ''}" data-cat-wrap="${esc(cat)}">
        <button class="tree-cat-head ${activeCat === cat && !activeTopic ? 'is-active' : ''}" type="button" data-cat="${esc(cat)}" data-topic="">
          <span class="cat-dot" style="background:${info.color}"></span>
          <span class="cat-name">${esc(cat)}</span><span class="count">${catCount}</span>
          <span class="chev">${icon('chevron', 12)}</span>
        </button>
        <div class="tree-topics">
          <div class="tree-cards">
            ${Array.from(topics.keys()).map((topic) => `<button class="tree-topic-head ${activeTopic === topic ? 'is-active' : ''}" type="button" data-cat="${esc(cat)}" data-topic="${esc(topic)}"><span>${esc(topic)}</span><span class="t-count">${topics.get(topic).length}</span></button>
            ${topics.get(topic).slice(0, 6).map((c) => `<button class="tree-card-btn" type="button" data-card="${esc(c.id)}"><span>${esc(c.title)}</span></button>`).join('')}`).join('')}
          </div>
        </div>
      </div>`;
    });
    if (!data.cards.length) treeHtml = `<div class="empty-state" style="padding:26px 14px"><p>还没有卡片</p></div>`;

    const headTitle = activeTopic || activeCat || '全部卡片';
    const headDesc = activeTopic ? `主题「${activeTopic}」下的卡片` : activeCat ? `分类「${activeCat}」下的全部卡片` : '你收集的所有知识卡片，按主题自动归档';
    const cardsHtml = cards.length ? `<div class="card-grid">${cards.map(renderCard).join('')}</div>` : `
      <div class="empty-state">
        <div class="empty-icon">${icon('cards', 24)}</div>
        <h3>${data.cards.length ? '这里还没有卡片' : '知识库还是空的'}</h3>
        <p>${data.cards.length ? '换个筛选，或者回到收集页再理一张。' : '去收集页粘贴一篇笔记，知序会帮你理出第一张卡片。'}</p>
        <button class="btn btn-primary" type="button" data-action="go-collect">${icon('plus', 15)} 去收集</button>
      </div>`;

    document.getElementById('main').innerHTML = `
      <section class="view library">
        <div class="page-head">
          <div>
            <p class="eyebrow">02 / 知识库 · 你的谱系</p>
            <h1>知识库</h1>
            <p class="lede">一张卡片是一个小点，一个主题是一根枝，一个分类是一个大点。新卡片会先尝试并入原来的谱系，放不进去时，才长出一个新的大点。</p>
          </div>
          <div class="stats-row">
            <span class="stat-chip"><b>${data.cards.length}</b>卡片</span>
            <span class="stat-chip"><b>${tree.size}</b>分类</span>
            <span class="stat-chip"><b>${new Set(data.cards.map((c) => c.category + '|' + c.topic)).size}</b>主题</span>
            <span class="stat-chip"><b>${new Set(data.cards.map((c) => c.sourceLabel)).size}</b>来源</span>
          </div>
        </div>
        ${data.demo ? `<div class="demo-banner"><span>${icon('sparkle', 15)} 当前是示例数据，方便你先逛一圈；开始记录自己的内容时，可随时清空。</span><div><button class="btn btn-small btn-ghost" type="button" data-action="clear-demo">清空示例</button></div></div>` : ''}
        <div class="library-grid">
          <aside class="panel tree-panel">
            <div class="tree-title"><span>知识谱系</span><span>${tree.size} 个分类</span></div>
            ${treeHtml}
          </aside>
          <div class="cards-panel">
            <div class="list-toolbar">
              <div class="search-box">${icon('search', 15)}<input id="search-input" type="search" placeholder="搜索标题、要点、标签、来源…" value="${esc(state.filter.q)}" /></div>
              <select class="select" id="sort-select" aria-label="排序">
                <option value="new" ${f.sort === 'new' ? 'selected' : ''}>最近添加</option>
                <option value="old" ${f.sort === 'old' ? 'selected' : ''}>最早添加</option>
                <option value="title" ${f.sort === 'title' ? 'selected' : ''}>按标题</option>
              </select>
              <span class="result-count">${cards.length} 张</span>
            </div>
            <div class="list-subhead" style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin:0 2px 12px">
              <div><b style="font-family:var(--font-serif);font-size:17px">${esc(headTitle)}</b><span style="font-size:11px;color:var(--muted);margin-left:8px">${esc(headDesc)}</span></div>
              <div style="display:flex;gap:6px;align-items:center">
                <button class="btn btn-small" type="button" data-action="ask-open">问知识库</button>
                <button class="btn btn-small" type="button" data-action="sync-open">云同步</button>
                <button class="icon-btn" type="button" title="导出知识库 JSON" data-action="export-data">${icon('download', 15)}</button>
                <button class="icon-btn" type="button" title="导入知识库 JSON" data-action="import-data">${icon('upload', 15)}</button>
              </div>
            </div>
            ${cardsHtml}
          </div>
        </div>
      </section>`;

    const search = document.getElementById('search-input');
    if (search) {
      let timer = null;
      search.addEventListener('input', function () {
        state.filter.q = this.value;
        clearTimeout(timer);
        timer = setTimeout(() => {
          renderLibrary();
          const next = document.getElementById('search-input');
          if (next) { next.focus(); next.setSelectionRange(next.value.length, next.value.length); }
        }, 200);
      });
    }
    const sort = document.getElementById('sort-select');
    if (sort) sort.addEventListener('change', function () { state.filter.sort = this.value; renderLibrary(); });
  }

  function renderCard(c) {
    const info = categoryInfo(c.category);
    return `
      <article class="kcard" data-card="${esc(c.id)}" style="--cat:${info.color};--cat-bg:${info.soft}">
        <div class="kcard-actions">
          <button type="button" title="删除卡片" data-del="${esc(c.id)}">${icon('trash', 13)}</button>
        </div>
        <div class="kcard-top">
          <span class="kcard-cat">${esc(c.category)}</span>
          <span class="kcard-topic">${esc(c.topic)}</span>
        </div>
        <h3 class="kcard-title">${esc(c.title)}</h3>
        <p class="kcard-summary">${esc(c.summary)}</p>
        <div class="kcard-tags">${(c.tags || []).slice(0, 3).map((t) => `<span class="tag">#${esc(t)}</span>`).join('')}</div>
        <div class="kcard-foot"><span class="src">${esc(c.sourceLabel)}</span><span>${fmtDate(c.createdAt)}</span></div>
      </article>`;
  }

  function openCardModal(id) {
    const c = data.cards.find((x) => x.id === id);
    if (!c) return;
    const info = categoryInfo(c.category);
    const url = safeUrl(c.url);
    const body = `
      <div class="modal-meta">
        <span class="tag is-accent">${esc(c.category)}</span>
        <span class="tag">${esc(c.topic)}</span>
        ${(c.tags || []).map((t) => `<span class="tag">#${esc(t)}</span>`).join('')}
      </div>
      <p style="font-size:14px;color:var(--ink-soft)">${esc(c.summary)}</p>
      ${c.points && c.points.length ? `<h4>要点</h4><ul>${c.points.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>` : ''}
      ${c.quote ? `<blockquote>「${esc(c.quote)}」</blockquote>` : ''}
      <h4>来源</h4>
      <p>${esc(c.sourceLabel)} ${url ? ` · <a href="${esc(url)}" target="_blank" rel="noopener noreferrer">打开原帖 ${icon('external', 12)}</a>` : ' · 手动粘贴'}</p>
      <p style="font-size:10.5px;color:var(--muted)">添加于 ${esc(new Date(c.createdAt).toLocaleString('zh-CN'))}</p>`;
    openModal(modalShell(c.title, `<span class="cat-dot" style="background:${info.color};display:inline-block;width:8px;height:8px;border-radius:50%"></span>`, body, `
      <button class="btn btn-ghost btn-small" type="button" data-action="card-map" data-id="${esc(c.id)}">${icon('map', 14)} 在导图中查看</button>
      <button class="btn btn-danger btn-small" type="button" data-action="ask-delete" data-id="${esc(c.id)}">${icon('trash', 14)} 删除</button>
      <button class="btn btn-ghost btn-small" type="button" data-action="close-modal">关闭</button>`));
  }

  function askDelete(id) {
    const c = data.cards.find((x) => x.id === id);
    if (!c) return;
    openModal(modalShell('删除这张卡片？', '', `<p>「${esc(c.title)}」会从知识库和思维导图中移除，此操作不能撤销。</p>`, `
      <button class="btn btn-ghost" type="button" data-action="close-modal">取消</button>
      <button class="btn btn-danger" type="button" data-action="do-delete" data-id="${esc(id)}">确认删除</button>`));
  }

  function deleteCard(id) {
    data.cards = data.cards.filter((c) => c.id !== id);
    refreshDemoFlag();
    saveData();
    closeModal();
    if (state.view === 'library') renderLibrary();
    if (state.view === 'map') renderMap();
    toast('已删除');
  }

  function clearDemo() {
    data.cards = data.cards.filter((c) => !c.demo);
    data.demo = false;
    saveData();
    state.analysis = null;
    toast('示例数据已清空，开始记录自己的知识吧');
    renderCurrentView();
  }

  /* ---------------------------------------------------------------- 合并 + 导图 */
  function mergeCards(cards, threshold, mergeOn) {
    if (!mergeOn) return cards.map((c) => ({ id: 'g_' + c.id, cards: [c] }));
    const groups = [];
    cards.forEach((card) => {
      let target = null;
      let bestScore = 0;
      groups.forEach((g) => {
        const score = Math.max.apply(null, g.cards.map((x) => cardSimilarity(card, x)));
        if (score > bestScore) { bestScore = score; target = g; }
      });
      if (target && bestScore >= threshold) target.cards.push(card);
      else groups.push({ id: 'g_' + card.id, cards: [card] });
    });
    return groups;
  }

  function commonTags(cards) {
    const freq = {};
    cards.forEach((c) => (c.tags || []).forEach((t) => { freq[t] = (freq[t] || 0) + 1; }));
    return Object.keys(freq).filter((t) => freq[t] > 1).sort((a, b) => freq[b] - freq[a]).slice(0, 4);
  }

  function differencesOf(cards) {
    const diffs = [];
    const pointKeys = cards.map((c) => (c.points || []).map((p) => bigrams(p)));
    cards.forEach((c, ci) => {
      (c.points || []).forEach((p, pi) => {
        let shared = false;
        cards.forEach((other, oi) => {
          if (oi === ci) return;
          const otherTokens = pointKeys[oi];
          if (otherTokens.some((tokens) => jaccard(pointKeys[ci][pi], tokens) >= 0.3)) shared = true;
        });
        if (!shared) {
          const text = truncate(p, 70);
          if (!diffs.some((d) => d.text === text)) diffs.push({ source: c.sourceLabel, text });
        }
      });
    });
    return diffs.slice(0, 5);
  }

  function mergeReason(group) {
    if (group.cards.length <= 1) return '';
    const tags = commonTags(group.cards);
    return `这 ${group.cards.length} 张卡片都在讲「${tags.length ? tags.join('、') : group.cards[0].topic}」，观点大面积重叠，所以合并为一支；合并后保留每张卡片的来源和细微差异，避免重复刷屏。`;
  }

  function buildMapTree() {
    const cards = data.cards;
    if (!cards.length) return null;
    let category = state.map.category;
    if (!category || !cards.some((c) => c.category === category)) {
      const counts = {};
      cards.forEach((c) => { counts[c.category] = (counts[c.category] || 0) + 1; });
      category = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
    }
    let catCards = cards.filter((c) => c.category === category);
    if (state.map.topic) catCards = catCards.filter((c) => c.topic === state.map.topic);
    const topics = new Map();
    catCards.forEach((c) => {
      if (!topics.has(c.topic)) topics.set(c.topic, []);
      topics.get(c.topic).push(c);
    });
    const children = [];
    Array.from(topics.keys()).sort((a, b) => topics.get(b).length - topics.get(a).length).forEach((topic) => {
      const groups = mergeCards(topics.get(topic), state.map.threshold, state.map.merge);
      const groupNodes = groups.map((g) => {
        const single = g.cards[0];
        const tags = commonTags(g.cards);
        // 节点名用「核心内容」而不是整条标题：AI 的 core 优先，否则从标题提炼
        const label = g.cards.length > 1
          ? (tags[0] ? tags[0] + ' ×' + g.cards.length : cardCore(single) + ' ×' + g.cards.length)
          : cardCore(single);
        return {
          id: g.id,
          type: g.cards.length > 1 ? 'merge' : 'card',
          label: label,
          fullTitle: single.title,
          cards: g.cards,
          differences: g.cards.length > 1 ? differencesOf(g.cards) : [],
          reason: mergeReason(g)
        };
      });
      children.push({ id: 't_' + topic, type: 'topic', label: topic, cards: topics.get(topic), children: groupNodes });
    });
    return { id: 'root', type: 'root', label: category, cards: catCards, children };
  }

  function layoutMap(root) {
    const nodeW = { root: 168, topic: 150, card: 230, merge: 230 };
    const nodeH = { root: 56, topic: 40, card: 60, merge: 66 };
    const xFor = { root: 26, topic: 270, card: 535, merge: 535 };
    let cursorY = 40;
    const leafGap = 74;
    const collapsed = state.map.collapsed;

    function walk(node) {
      node.w = nodeW[node.type];
      node.h = nodeH[node.type];
      node.x = xFor[node.type];
      if (node.type === 'topic' && collapsed.has(node.id)) {
        node.collapsed = true;
        node.y = cursorY + 18;
        cursorY += 58;
        return;
      }
      node.collapsed = false;
      if (!node.children || !node.children.length) {
        node.y = cursorY + node.h / 2;
        cursorY += leafGap;
        return;
      }
      node.children.forEach(walk);
      const first = node.children[0];
      const last = node.children[node.children.length - 1];
      node.y = (first.y + last.y) / 2;
    }
    walk(root);
    // 内容较少时垂直居中，避免导图挤在画布顶部
    const contentH = cursorY - 40;
    const offsetY = Math.max(0, (600 - contentH) / 2);
    (function shift(n) { n.y += offsetY; (n.children || []).forEach(shift); })(root);
    const height = Math.max(600, contentH + 80);
    const width = 900;
    return { width, height };
  }

  function wrapLabel(text, maxChars, maxLines) {
    const s = String(text || '').replace(/\s+/g, ' ').trim();
    const lines = [];
    let cur = '';
    for (let i = 0; i < s.length; i++) {
      cur += s[i];
      if (cur.length >= maxChars) { lines.push(cur); cur = ''; if (lines.length >= maxLines) break; }
    }
    if (cur && lines.length < maxLines) lines.push(cur);
    if (lines.length === maxLines && s.length > lines.join('').length) {
      lines[maxLines - 1] = truncate(lines[maxLines - 1], maxChars - 1);
    }
    return lines.length ? lines : [''];
  }

  function svgNode(node, selected) {
    const isSel = selected === node.id;
    const x = node.x;
    const y = node.y;
    const w = node.w;
    const h = node.h;
    let cls = 'mnode type-' + node.type + (isSel ? ' is-selected' : '');
    const stroke = isSel ? ' stroke="#d9784a" stroke-width="2"' : '';
    let content = '';
    if (node.type === 'root') {
      content = `<text class="n-title" x="${w / 2}" y="25" text-anchor="middle">${esc(node.label)}</text>
        <text class="n-sub" x="${w / 2}" y="42" text-anchor="middle">${node.cards.length} 张卡片 · ${node.children.length} 个主题</text>`;
    } else if (node.type === 'topic') {
      const arrow = node.collapsed ? '▸' : '▾';
      content = `<text class="n-title" x="14" y="25">${esc(truncate(node.label, 10))}</text>
        <text class="n-sub" x="${w - 14}" y="25" text-anchor="end">${node.cards.length} 张 ${arrow}</text>`;
    } else {
      const lines = wrapLabel(node.label, 17, 2);
      const titleY = lines.length > 1 ? 22 : 26;
      content = lines.map((line, i) => `<text class="n-title" x="14" y="${titleY + i * 16}">${esc(line)}</text>`).join('');
      const subY = h - 12;
      if (node.type === 'merge') {
        content += `<text class="n-sub" x="14" y="${subY}">${node.cards.length} 张合并 · ${new Set(node.cards.map((c) => c.sourceLabel)).size} 个来源</text>
          <circle cx="${w - 17}" cy="17" r="10" class="badge"></circle>
          <text class="badge-text" x="${w - 17}" y="20" text-anchor="middle">${node.cards.length}</text>`;
      } else {
        content += `<text class="n-sub" x="14" y="${subY}">${esc(truncate(node.cards[0].sourceLabel, 18))}</text>`;
      }
    }
    return `<g class="${cls}" data-node="${esc(node.id)}" transform="translate(${x},${y - h / 2})">
      <rect x="0" y="0" width="${w}" height="${h}" rx="12"${stroke}></rect>${content}</g>`;
  }

  function svgLink(parent, child) {
    const x1 = parent.x + parent.w;
    const y1 = parent.y;
    const x2 = child.x;
    const y2 = child.y;
    const mx = (x1 + x2) / 2;
    const cls = child.type === 'merge' ? 'mlink is-merge' : 'mlink';
    return `<path class="${cls}" d="M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}"></path>`;
  }

  function collectMapNodes(root) {
    const nodes = [];
    const links = [];
    (function walk(n, parent) {
      nodes.push(n);
      if (n.collapsed) return;
      (n.children || []).forEach((c) => { links.push([n, c]); walk(c, n); });
    })(root, null);
    return { nodes, links };
  }

  function renderMap() {
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('is-active', t.dataset.nav === 'map'));
    const cats = Array.from(new Set(data.cards.map((c) => c.category)));
    const tree = buildMapTree();
    if (tree) {
      state.map.category = tree.label;
      layoutMap(tree);
    }
    const catOptions = cats.map((c) => `<option value="${esc(c)}" ${c === state.map.category ? 'selected' : ''}>${esc(c)}</option>`).join('');
    const topics = tree ? tree.children.map((t) => t.label) : [];
    const topicOptions = `<option value="">全部主题</option>` + topics.map((t) => `<option value="${esc(t)}" ${t === state.map.topic ? 'selected' : ''}>${esc(t)}</option>`).join('');
    const mergedCount = tree ? tree.children.reduce((n, t) => n + t.children.filter((g) => g.type === 'merge').length, 0) : 0;
    const mergedCards = tree ? tree.children.reduce((n, t) => n + t.children.reduce((m, g) => m + (g.type === 'merge' ? g.cards.length - 1 : 0), 0), 0) : 0;

    document.getElementById('main').innerHTML = `
      <section class="view map">
        <div class="page-head">
          <div>
            <p class="eyebrow">03 / 思维导图 · 看见最近学了什么</p>
            <h1>思维导图</h1>
            <p class="lede">选一个知识大点，知序会把卡片里重复的观点合并成一支，保留每个来源和它们之间的细微差异。点节点，就能回看对应的卡片。</p>
          </div>
          ${tree ? `<div class="stats-row"><span class="stat-chip"><b>${mergedCount}</b>合并节点</span><span class="stat-chip"><b>${mergedCards}</b>重复卡片</span></div>` : ''}
        </div>
        ${data.cards.length ? `
        <div class="map-toolbar">
          <div class="group"><span>知识大点</span><select class="select" id="map-cat">${catOptions}</select></div>
          <div class="group"><span>主题</span><select class="select" id="map-topic">${topicOptions}</select></div>
          <div class="divider"></div>
          <label class="switch"><input type="checkbox" id="map-merge" ${state.map.merge ? 'checked' : ''} /> 合并相似卡片</label>
          <div class="group">合并阈值 <input type="range" id="map-threshold" min="0.25" max="0.75" step="0.05" value="${state.map.threshold}" /><span id="threshold-label">${state.map.threshold.toFixed(2)}</span></div>
          <div style="margin-left:auto;display:flex;gap:6px">
            <button class="btn btn-small btn-ghost" type="button" data-action="map-reset">${icon('refresh', 13)} 重新生成</button>
            <button class="btn btn-small btn-ghost" type="button" data-action="map-export">${icon('download', 13)} 导出 SVG</button>
          </div>
        </div>
        <div class="map-grid">
          <div class="map-canvas">
            <svg id="map-svg" role="img" aria-label="知识思维导图"></svg>
            <span class="map-hint">拖动空白处平移 · 滚轮缩放 · 点击节点看卡片</span>
            <div class="map-zoom">
              <button type="button" data-action="map-zoom-in" aria-label="放大">+</button>
              <button type="button" data-action="map-zoom-out" aria-label="缩小">−</button>
              <button type="button" data-action="map-zoom-reset" aria-label="复原">⌂</button>
            </div>
          </div>
          <aside class="panel map-side" id="map-side">${renderMapSide(tree)}</aside>
        </div>` : `
        <div class="empty-state" style="margin-top:20px">
          <div class="empty-icon">${icon('map', 24)}</div>
          <h3>还没有可以生成导图的卡片</h3>
          <p>先去收集页理一张知识卡片，知序会把它们连成一张可互动的导图。</p>
          <button class="btn btn-primary" type="button" data-action="go-collect">${icon('plus', 15)} 去收集</button>
        </div>`}
      </section>`;

    const catSel = document.getElementById('map-cat');
    if (catSel) catSel.addEventListener('change', function () {
      state.map.category = this.value; state.map.topic = ''; state.map.selected = null;
      state.map.collapsed.clear();
      renderMap();
    });
    const topicSel = document.getElementById('map-topic');
    if (topicSel) topicSel.addEventListener('change', function () {
      state.map.topic = this.value; state.map.selected = null;
      renderMap();
    });
    const mergeBox = document.getElementById('map-merge');
    if (mergeBox) mergeBox.addEventListener('change', function () {
      state.map.merge = this.checked;
      data.settings.merge = this.checked;
      saveData();
      renderMap();
    });
    const range = document.getElementById('map-threshold');
    if (range) {
      range.addEventListener('input', function () {
        const label = document.getElementById('threshold-label');
        if (label) label.textContent = Number(this.value).toFixed(2);
      });
      range.addEventListener('change', function () {
        state.map.threshold = Number(this.value);
        data.settings.threshold = state.map.threshold;
        saveData();
        renderMap();
      });
    }
    if (tree) renderMapSvg(tree);
  }

  function renderMapSvg(tree) {
    const svg = document.getElementById('map-svg');
    if (!svg) return;
    const size = layoutMap(tree);
    const { nodes, links } = collectMapNodes(tree);
    const linkHtml = links.map(([p, c]) => svgLink(p, c)).join('');
    const nodeHtml = nodes.map((n) => svgNode(n, state.map.selected)).join('');
    svg.setAttribute('viewBox', `0 0 ${size.width} ${size.height}`);
    svg.innerHTML = `<g id="map-content" transform="translate(${state.map.panX},${state.map.panY}) scale(${state.map.zoom})">
      ${linkHtml}${nodeHtml}
    </g>`;
    bindMapPan(svg);
  }

  function applyMapTransform() {
    const g = document.getElementById('map-content');
    if (g) g.setAttribute('transform', `translate(${state.map.panX},${state.map.panY}) scale(${state.map.zoom})`);
  }

  function findMapNode(id) {
    const tree = buildMapTree();
    if (!tree) return null;
    let found = null;
    (function walk(n) {
      if (n.id === id) found = n;
      if (n.collapsed) return;
      (n.children || []).forEach(walk);
    })(tree);
    return found;
  }

  function renderMapSide(tree) {
    if (!tree) return '';
    const nodes = [];
    (function walk(n) { nodes.push(n); (n.children || []).forEach(walk); })(tree);
    const merges = nodes.filter((n) => n.type === 'merge');
    const cards = tree.cards.length;
    const sourceCount = new Set(tree.cards.map((c) => c.sourceLabel)).size;
    const mergedCardCount = merges.reduce((n, m) => n + m.cards.length, 0);
    return `
      <h3>${esc(tree.label)}</h3>
      <p class="side-sub">${cards} 张卡片 · ${tree.children.length} 个主题 · ${merges.length} 个合并节点</p>
      <div class="merge-note">${merges.length ? `AI 在 ${cards} 张卡片里找到了 ${merges.length} 处重复观点（涉及 ${mergedCardCount} 张卡片），合并后保留 ${sourceCount} 个来源；点橙色节点看合并原因与差异。` : `目前没有触发合并；把「合并阈值」调低，或再收集几张相似卡片试试。`}</div>
      <div class="side-sec">
        <h4>怎么读这张图</h4>
        <p>最左是知识大点，中间是主题，右边是卡片。橙色节点表示多张卡片被合并，点开可以看到每个来源和它们的细微差异。</p>
      </div>
      <div class="legend-row">
        <span><i style="background:var(--ink)"></i>大点</span>
        <span><i style="background:var(--paper-2);border:1px solid var(--line-strong)"></i>主题</span>
        <span><i style="background:var(--orange-soft);border:1px solid rgba(217,120,74,.35)"></i>合并卡片</span>
      </div>`;
  }

  function renderMapNodeSide(node) {
    if (!node) return renderMapSide(buildMapTree());
    if (node.type === 'root') return renderMapSide(node);
    const sources = Array.from(new Set(node.cards.map((c) => c.sourceLabel)));
    if (node.type === 'topic') {
      return `
        <h3>${esc(node.label)}</h3>
        <p class="side-sub">${node.cards.length} 张卡片 · ${node.children.length} 个分支</p>
        <div class="side-sec"><h4>这个主题下的卡片</h4>
          ${node.cards.map((c) => `<button class="side-card" type="button" data-card="${esc(c.id)}"><b>${esc(c.title)}</b><span>${esc(c.sourceLabel)}</span></button>`).join('')}
        </div>
        <div class="side-sec"><h4>继续</h4><p>点右侧的卡片节点，可以看每张卡片的完整内容；点「返回」回到大点概览。</p>
        <button class="btn btn-ghost btn-small" type="button" data-action="map-side-root">返回大点概览</button></div>`;
    }
    if (node.type === 'merge') {
      return `
        <h3>${esc(node.fullTitle || node.label)}</h3>
        <p class="side-sub">核心：${esc(node.label)} · ${node.cards.length} 张卡片合并</p> · ${sources.length} 个来源</p>
        <div class="side-sec"><h4>为什么合并</h4><div class="merge-note">${esc(node.reason)}</div></div>
        <div class="side-sec"><h4>细微差异</h4>
          ${node.differences.length ? `<ul class="diff-list">${node.differences.map((d) => `<li><b>${esc(d.source)}</b>：${esc(d.text)}</li>`).join('')}</ul>` : '<p>这几张卡片观点高度一致，没有检测到明显差异。</p>'}
        </div>
        <div class="side-sec"><h4>来源卡片</h4>
          ${node.cards.map((c) => `<button class="side-card" type="button" data-card="${esc(c.id)}"><b>${esc(c.title)}</b><span>${esc(c.sourceLabel)}</span></button>`).join('')}
        </div>
        <div class="side-sec"><button class="btn btn-ghost btn-small" type="button" data-action="map-side-root">返回大点概览</button></div>`;
    }
    return `
      <h3>${esc(node.cards[0].title)}</h3>
      <p class="side-sub">${esc(node.cards[0].category)} › ${esc(node.cards[0].topic)}</p>
      <div class="side-sec"><h4>摘要</h4><p>${esc(node.cards[0].summary)}</p></div>
      <div class="side-sec"><h4>来源</h4><p>${esc(node.cards[0].sourceLabel)}</p></div>
      <div class="side-sec"><button class="btn btn-ghost btn-small" type="button" data-card="${esc(node.cards[0].id)}">${icon('cards', 14)} 打开完整卡片</button>
      <button class="btn btn-link btn-small" type="button" data-action="map-side-root">返回大点概览</button></div>`;
  }

  function selectMapNode(id) {
    const node = findMapNode(id);
    if (!node) return;
    if (node.type === 'topic') {
      // 第一次点：看这个主题下的卡片；再点一次：折叠/展开
      if (state.map.selected === id) {
        if (state.map.collapsed.has(node.id)) state.map.collapsed.delete(node.id);
        else state.map.collapsed.add(node.id);
        renderMap();
        return;
      }
    }
    state.map.selected = id;
    const side = document.getElementById('map-side');
    if (side) side.innerHTML = renderMapNodeSide(node);
    const tree = buildMapTree();
    if (tree) renderMapSvg(tree);
  }

  function bindMapPan(svg) {
    let dragging = false, sx = 0, sy = 0, ox = 0, oy = 0;
    svg.onpointerdown = function (e) {
      if (e.target.closest('.mnode')) return;
      dragging = true; svg.classList.add('is-panning');
      sx = e.clientX; sy = e.clientY; ox = state.map.panX; oy = state.map.panY;
      svg.setPointerCapture && svg.setPointerCapture(e.pointerId);
    };
    svg.onpointermove = function (e) {
      if (!dragging) return;
      state.map.panX = ox + (e.clientX - sx);
      state.map.panY = oy + (e.clientY - sy);
      applyMapTransform();
    };
    svg.onpointerup = function () { dragging = false; svg.classList.remove('is-panning'); };
    svg.onpointercancel = function () { dragging = false; svg.classList.remove('is-panning'); };
    svg.onwheel = function (e) {
      e.preventDefault();
      const rect = svg.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const old = state.map.zoom;
      const next = clamp(old * (e.deltaY < 0 ? 1.12 : 0.89), 0.45, 2.6);
      state.map.panX = mx - ((mx - state.map.panX) / old) * next;
      state.map.panY = my - ((my - state.map.panY) / old) * next;
      state.map.zoom = next;
      applyMapTransform();
    };
  }

  function exportMapSvg() {
    const svg = document.getElementById('map-svg');
    if (!svg) return;
    const clone = svg.cloneNode(true);
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
    style.textContent = `text{font-family:"PingFang SC","Microsoft YaHei",sans-serif}.mlink{fill:none;stroke:#ddcdbb;stroke-width:1.3}.mlink.is-merge{stroke:#d9784a;stroke-dasharray:4 4}.mnode rect{fill:#fffdf8;stroke:#eadfd2}.mnode.type-root rect{fill:#2f2a24}.mnode.type-root .n-title{fill:#fff9ef;font-size:16px}.mnode.type-topic rect{fill:#f7efe4}.mnode.type-merge rect{fill:#f7e3d5}.mnode .n-title{font-size:12.5px;font-weight:600;fill:#2f2a24}.mnode .n-sub{font-size:10px;fill:#918578}.badge{fill:#d9784a}.badge-text{fill:#fff;font-size:9px}`;
    clone.insertBefore(style, clone.firstChild);
    const blob = new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml' });
    downloadBlob(blob, 'zhixu-mindmap.svg');
    toast('导图已导出 SVG');
  }

  /* ---------------------------------------------------------------- 导入导出 */
  function downloadBlob(blob, filename) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  function exportData() {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    downloadBlob(blob, 'zhixu-knowledge-' + new Date().toISOString().slice(0, 10) + '.json');
    toast('知识库已导出');
  }

  function importDataFile(file) {
    const reader = new FileReader();
    reader.onload = function () {
      try {
        const parsed = JSON.parse(String(reader.result || '{}'));
        if (!parsed || !Array.isArray(parsed.cards)) throw new Error('格式不对：缺少 cards 数组');
        data = {
          version: 1,
          demo: false,
          cards: parsed.cards.map(normalizeCard),
          settings: { threshold: 0.45, merge: true, ...(parsed.settings || {}) },
          createdAt: parsed.createdAt || new Date().toISOString()
        };
        saveData();
        closeModal();
        setView('library');
        toast('已导入 ' + data.cards.length + ' 张卡片');
      } catch (e) { toast(e.message || '导入失败', 'error'); }
    };
    reader.readAsText(file);
  }

  async function runRecluster() {
    if (!data.cards.length) { toast('还没有卡片可以整理', 'error'); return; }
    if (!aiLive) { toast('AI 未连接，无法整理分类', 'error'); return; }
    if (!window.confirm('把 ' + data.cards.length + ' 张卡片交给 AI 重新归类？\n会更新卡片分类，并在需要时新建分类。')) return;
    toast('AI 正在整理分类，请稍等…');
    try {
      const res = await fetch('/api/recluster', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cards: data.cards.map((c) => ({
            id: c.id, title: c.title, summary: c.summary, points: c.points,
            tags: c.tags, category: c.category, topic: c.topic
          })),
          categories: allCategoryNames()
        })
      });
      const j = await res.json().catch(() => null);
      if (!res.ok || !j || !j.ok) {
        toast('整理失败：' + ((j && j.error) || ('HTTP ' + res.status)), 'error');
        return;
      }
      let created = 0;
      let changed = 0;
      (j.newCategories || []).forEach((n) => { if (registerCategory(n, { auto: true })) created++; });
      (j.assignments || []).forEach((a) => {
        const card = data.cards.find((c) => c.id === a.id);
        if (!card || !a.category) return;
        if (!findCategoryDef(a.category) && registerCategory(a.category, { auto: true })) created++;
        if (card.category !== a.category) { card.category = a.category; changed++; }
      });
      saveData();
      closeModal();
      renderCurrentView();
      toast('AI 整理完成：调整 ' + changed + ' 张，新增分类 ' + created + ' 个');
    } catch (e) {
      toast('整理失败：' + String(e.message || e), 'error');
    }
  }

  /* ---------------------------------------------------------------- 自动抓取面板 */
  const digestState = { config: null, last: null, nextRunAt: '', running: false, msg: '', loading: false };

  function digestHeaders() {
    return {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + (authState.token || '')
    };
  }

  async function digestApi(method, payload) {
    const res = await fetch('/api/digest', {
      method: method,
      headers: digestHeaders(),
      body: payload ? JSON.stringify(payload) : undefined
    });
    const j = await res.json().catch(() => null);
    return { status: res.status, json: j };
  }

  function fmtTime(iso) {
    if (!iso) return '未运行过';
    try {
      const d = new Date(iso);
      return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    } catch (e) { return iso; }
  }

  function digestHtml() {
    if (!authState.user) {
      return `<div class="digest">
        <div class="digest-msg">自动抓取面板需要登录账号（配置保存在服务器上）。</div>
        <div class="digest-actions"><button class="btn btn-small btn-primary" type="button" data-action="account-open">去登录 / 注册</button></div>
      </div>`;
    }
    if (digestState.loading || !digestState.config) {
      return '<div class="digest"><div class="digest-msg">正在读取配置…</div></div>';
    }
    const cfg = digestState.config;
    const kwSources = (cfg.sources || []).map((s, i) => ({ s: s, i: i })).filter((x) => x.s.type === 'keyword');
    const otherSources = (cfg.sources || []).map((s, i) => ({ s: s, i: i })).filter((x) => x.s.type !== 'keyword');
    const last = digestState.last || {};
    return `<div class="digest">
      <div class="digest-status">
        <div>上次运行：<b>${last.at ? fmtTime(last.at) : '未运行过'}</b>${last.at ? ' · 新增 ' + (last.added || 0) + ' 条' : ''}</div>
        <div>下次运行：<b>${cfg.enabled ? fmtTime(digestState.nextRunAt) : '已关闭自动抓取'}</b></div>
      </div>
      <div class="digest-sec">
        <div class="digest-label">关键词（抓新闻）</div>
        <div class="digest-chips">
          ${kwSources.map((x) => `<span class="digest-chip">${esc(x.s.keyword || x.s.name)}<button type="button" data-action="digest-del-src" data-idx="${x.i}" title="删除">×</button></span>`).join('') || '<span class="digest-empty">还没有关键词</span>'}
        </div>
        <div class="digest-add">
          <input id="digest-kw" type="text" placeholder="比如：西安交通大学" maxlength="30" />
          <button class="btn btn-small" type="button" data-action="digest-add-kw">添加</button>
        </div>
      </div>
      <div class="digest-sec">
        <div class="digest-label">抓取对象（RSS / 固定链接）</div>
        <div class="digest-chips">
          ${otherSources.map((x) => `<span class="digest-chip">${esc(x.s.name || x.s.url)}<button type="button" data-action="digest-del-src" data-idx="${x.i}" title="删除">×</button></span>`).join('') || '<span class="digest-empty">还没有 RSS / 链接</span>'}
        </div>
        <div class="digest-add">
          <select id="digest-src-type">
            <option value="rss">RSS</option>
            <option value="link">固定链接</option>
          </select>
          <input id="digest-src-url" type="text" placeholder="https://..." />
          <button class="btn btn-small" type="button" data-action="digest-add-src">添加</button>
        </div>
      </div>
      <div class="digest-row">
        <span>运行时间</span>
        <input id="digest-time" type="time" value="${esc(cfg.time || '08:00')}" />
        <label class="digest-check"><input id="digest-enabled" type="checkbox" ${cfg.enabled ? 'checked' : ''} /> 启用自动抓取</label>
      </div>
      <div class="digest-actions">
        <button class="btn btn-small btn-primary" type="button" data-action="digest-save">保存配置</button>
        <button class="btn btn-small" type="button" data-action="digest-run">立即运行一次</button>
      </div>
      <div class="digest-msg" id="digest-msg">${esc(digestState.msg || '')}</div>
      <div class="digest-hint">抓取结果会进「收件箱」，打开知序点「读取并归档」即可入库。小红书/知乎需登录态，服务器抓不到，请用关键词新闻或 RSS。</div>
    </div>`;
  }

  function openDigest() {
    if (!authState.user) {
      openModal(modalShell('自动抓取', '需要登录', digestHtml()));
      return;
    }
    digestState.loading = true;
    openModal(modalShell('自动抓取', '关键词 / 来源 / 时间 / 立即运行', digestHtml()));
    digestApi('GET').then((r) => {
      digestState.loading = false;
      if (r.json && r.json.ok) {
        digestState.config = r.json.config;
        digestState.last = r.json.last;
        digestState.nextRunAt = r.json.nextRunAt;
        digestState.running = r.json.running;
      } else {
        digestState.msg = '读取失败：' + ((r.json && r.json.error) || ('HTTP ' + r.status));
      }
      openModal(modalShell('自动抓取', '关键词 / 来源 / 时间 / 立即运行', digestHtml()));
    });
  }

  function collectDigestConfig() {
    const cfg = digestState.config ? JSON.parse(JSON.stringify(digestState.config)) : { sources: [] };
    const timeEl = document.getElementById('digest-time');
    const enEl = document.getElementById('digest-enabled');
    if (timeEl && timeEl.value) cfg.time = timeEl.value;
    if (enEl) cfg.enabled = enEl.checked;
    if (!Array.isArray(cfg.sources)) cfg.sources = [];
    return cfg;
  }

  async function digestSave() {
    const cfg = collectDigestConfig();
    digestState.msg = '保存中…';
    openModal(modalShell('自动抓取', '关键词 / 来源 / 时间 / 立即运行', digestHtml()));
    const r = await digestApi('POST', { action: 'save', config: cfg });
    if (r.json && r.json.ok) {
      digestState.config = r.json.config;
      digestState.nextRunAt = r.json.nextRunAt;
      digestState.msg = '已保存' + (r.json.config.enabled ? '' : '（自动抓取已关闭）');
      toast('自动抓取配置已保存');
    } else {
      digestState.msg = '保存失败：' + ((r.json && r.json.error) || ('HTTP ' + r.status));
    }
    openDigest();
  }

  async function digestRun() {
    if (!digestState.config) { toast('先读取配置', 'error'); return; }
    const cfg = collectDigestConfig();
    const saveRes = await digestApi('POST', { action: 'save', config: cfg });
    if (!(saveRes.json && saveRes.json.ok)) {
      digestState.msg = '先保存配置失败：' + ((saveRes.json && saveRes.json.error) || saveRes.status);
      openModal(modalShell('自动抓取', '', digestHtml()));
      return;
    }
    digestState.config = saveRes.json.config;
    digestState.msg = '已开始抓取，约 30–90 秒后出结果…';
    openModal(modalShell('自动抓取', '', digestHtml()));
    const r = await digestApi('POST', { action: 'run' });
    if (r.json && r.json.ok) {
      pollDigest(0);
    } else {
      digestState.msg = '启动失败：' + ((r.json && r.json.error) || ('HTTP ' + r.status));
      openModal(modalShell('自动抓取', '', digestHtml()));
    }
  }

  function pollDigest(times) {
    if (times >= 20) return;
    setTimeout(async () => {
      const r = await digestApi('GET');
      if (r.json && r.json.ok) {
        digestState.last = r.json.last;
        digestState.running = r.json.running;
        digestState.nextRunAt = r.json.nextRunAt;
        if (r.json.last && r.json.last.at && !r.json.running) {
          digestState.msg = '完成：新增 ' + (r.json.last.added || 0) + ' 条（已进收件箱）';
          openModal(modalShell('自动抓取', '', digestHtml()));
          return;
        }
      }
      pollDigest(times + 1);
    }, 4000);
  }

  function digestAddKeyword() {
    const cfg = collectDigestConfig();
    const el = document.getElementById('digest-kw');
    const kw = el ? el.value.trim() : '';
    if (!kw) { toast('先输入关键词', 'error'); return; }
    cfg.sources.push({ type: 'keyword', name: kw, keyword: kw });
    digestState.config = cfg;
    digestState.msg = '已添加关键词，记得点「保存配置」';
    openModal(modalShell('自动抓取', '', digestHtml()));
  }

  function digestAddSource() {
    const cfg = collectDigestConfig();
    const typeEl = document.getElementById('digest-src-type');
    const urlEl = document.getElementById('digest-src-url');
    const type = typeEl ? typeEl.value : 'rss';
    const url = urlEl ? urlEl.value.trim() : '';
    if (!/^https?:\/\//i.test(url)) { toast('请输入 http/https 链接', 'error'); return; }
    cfg.sources.push({ type: type, name: type === 'rss' ? 'RSS' : '链接', url: url });
    digestState.config = cfg;
    digestState.msg = '已添加来源，记得点「保存配置」';
    openModal(modalShell('自动抓取', '', digestHtml()));
  }

  function digestDelSource(idx) {
    if (!digestState.config) return;
    const cfg = collectDigestConfig();
    cfg.sources.splice(Number(idx), 1);
    digestState.config = cfg;
    digestState.msg = '已删除，记得点「保存配置」';
    openModal(modalShell('自动抓取', '', digestHtml()));
  }

  function openSettings() {
    const body = `
      <div class="settings-row"><div><div class="label">解析模式</div><div class="desc">${aiLive ? '已连接本地 AI 服务（server.py）' : '本地规则演示；运行 server.py 可接入星火等大模型'}</div></div><span class="tag ${aiLive ? 'is-accent' : ''}">${aiLive ? 'AI 已连接' : '本地演示'}</span></div>
      <div class="settings-row"><div><div class="label">数据存储</div><div class="desc">${data.cards.length} 张卡片，保存在当前浏览器的 localStorage；换设备请导出 JSON</div></div><div class="settings-actions">
        <button class="btn btn-small btn-ghost" type="button" data-action="export-data">${icon('download', 13)} 导出</button>
        <button class="btn btn-small btn-ghost" type="button" data-action="import-data">${icon('upload', 13)} 导入</button>
      </div></div>
      <div class="settings-row"><div><div class="label">分享接收</div><div class="desc">${serverLive ? '已启用：支持链接读取、/share 分享目标与 QQ 分享收件箱' : '启动 server.py 后可用：读取链接、接收 QQ/分享链接'}</div></div><button class="btn btn-small btn-ghost" type="button" data-action="copy-share-template">使用说明</button></div>
      <div class="settings-row"><div><div class="label">QQ 分享接入</div><div class="desc">用一个新 QQ 小号 + NapCat/OneBot，把链接投递到收件箱；详见 docs/03-QQ分享接入.md</div></div><span class="tag ${serverLive ? 'is-accent' : ''}">${serverLive ? '可联调' : '需启动服务'}</span></div>
      <div class="settings-row"><div><div class="label">分类管理</div><div class="desc">AI 提炼时优先复用这些分类；遇到放不进去的内容，AI 会自动新建分类并登记进来</div></div></div>
      <div class="cat-manage">
        <div class="cat-add">
          <input id="new-cat-name" type="text" placeholder="新分类名称（≤12 字），比如：科研与论文" maxlength="12" />
          <button class="btn btn-small" type="button" data-action="add-category">添加</button>
        </div>
        <div class="cat-chips">
          ${allCategoryNames().map((n) => {
            const ci = categoryInfo(n);
            const isCustom = customCategoryList().some((c) => c && c.name === n);
            const count = data.cards.filter((c) => c.category === n).length;
            return `<span class="cat-chip" style="--c:${ci.color}">
              <i style="background:${ci.color}"></i>
              <span class="cat-chip-name">${esc(n)}</span><em>${count}</em>
              ${isCustom ? `<button class="cat-act" type="button" title="重命名" data-action="rename-category" data-cat="${esc(n)}">改</button><button class="cat-act cat-del" type="button" title="删除分类" data-action="del-category" data-cat="${esc(n)}">×</button>` : ''}
            </span>`;
          }).join('')}
        </div>
        <div class="cat-hint">系统预置分类不可删除；自定义分类删除后，卡片会归到「未分类」。</div>
      </div>
      <div class="settings-row"><div><div class="label">AI 整理分类</div><div class="desc">把当前 ${data.cards.length} 张卡片交给 AI 重新归类：能复用就复用，不够用会自动新建分类</div></div><button class="btn btn-small" type="button" data-action="recluster">开始整理</button></div>
      <div class="settings-row"><div><div class="label">自动抓取</div><div class="desc">关键词 / RSS / 固定链接、运行时间、立即运行——都在面板里调</div></div><button class="btn btn-small" type="button" data-action="open-digest">打开面板</button></div>
      <div class="settings-row"><div><div class="label">示例数据</div><div class="desc">重置为 8 张示例卡片，方便演示</div></div><button class="btn btn-small btn-ghost" type="button" data-action="reset-demo">恢复示例</button></div>
      <div class="settings-row"><div><div class="label">清空全部</div><div class="desc">删除当前浏览器里的所有卡片，操作不可撤销</div></div><button class="btn btn-small btn-danger" type="button" data-action="ask-clear-all">清空数据</button></div>
      <div class="side-sec"><h4>关于知序</h4><p>知序是一个「把刷到的碎片理成自己知识」的 MVP：粘贴或分享小红书笔记，AI 提炼成带来源的卡片，自动归档成谱系，再生成可互动、会合并重复观点的思维导图。</p></div>`;
    openModal(modalShell('设置与数据', '', body, `<button class="btn btn-ghost" type="button" data-action="close-modal">关闭</button>`));
  }

  function askClearAll() {
    openModal(modalShell('清空全部数据？', '', `<p>将删除 ${data.cards.length} 张卡片，且不能撤销。建议先导出 JSON 备份。</p>`, `
      <button class="btn btn-ghost" type="button" data-action="close-modal">取消</button>
      <button class="btn btn-danger" type="button" data-action="do-clear-all">确认清空</button>`));
  }

  /* ---------------------------------------------------------------- 路由/壳 */
  function setView(view, pushHash) {
    if (!PAGE_TITLES[view]) view = 'collect';
    state.view = view;
    if (pushHash !== false) {
      const hash = '#' + view;
      if (location.hash !== hash) history.replaceState(null, '', hash);
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
    renderCurrentView();
  }

  function renderCurrentView() {
    if (state.view === 'library') renderLibrary();
    else if (state.view === 'map') renderMap();
    else renderCollect();
  }

  function handleAction(action, el) {
    switch (action) {
      case 'fill-sample': {
        const ta = document.getElementById('paste-text');
        const url = document.getElementById('paste-url');
        if (ta) ta.value = SAMPLE_TEXT;
        if (url) url.value = 'https://www.xiaohongshu.com/explore/sample-note';
        updateCharCount();
        updateLinkDetected();
        ta && ta.focus();
        toast('示例笔记已放入，点「理成知识卡片」试试');
        break;
      }
      case 'analyze': runAnalyze(); break;
      case 'resolve-link': {
        const urlEl = document.getElementById('paste-url');
        resolveLink(urlEl ? urlEl.value.trim() : '');
        break;
      }
      case 'link-help': {
        openModal(modalShell('支持哪些链接？', '链接读取能力一览', linkHelpHtml()));
        break;
      }
      case 'fetch-comments': fetchComments(); break;
      case 'merge-comments': mergeComments(); break;
      case 'ask-open': {
        askState.answer = '';
        askState.error = '';
        askState.used = [];
        askState.question = '';
        openAsk();
        break;
      }
      case 'ask-submit': doAsk(); break;
      case 'account-open': { authState.status = ''; openAccount(); break; }
      case 'auth-login': doAuth('login'); break;
      case 'auth-register': doAuth('register'); break;
      case 'bind-qq': doBindQQ(); break;
      case 'logout': doLogout(); break;
      case 'sync-open': { syncState.status = ''; openSync(); break; }
      case 'sync-push': doSync('push'); break;
      case 'sync-pull': doSync('pull'); break;
      case 'batch-open': {
        batchState.status = '';
        batchState.items = [];
        openBatch();
        break;
      }
      case 'batch-search': doBatchSearch(); break;
      case 'batch-import': doBatchImport(); break;
      case 'xhs-login': {
        const urlInput = document.getElementById('paste-url');
        const srcNow = detectSource(urlInput ? urlInput.value : '');
        const siteKey = srcNow ? srcNow.key : 'xiaohongshu';
        helperCall('/login', { site: siteKey }, 20000).then((r) => {
          checkHelperAlive();
          if (r && r.ok) {
            toast('已打开登录窗口：登录后点「读取链接」');
            setLinkStatus(r.note || '已打开登录窗口，登录后重试', 'warn');
          } else if (r && r.helperOffline) {
            openModal(modalShell('本地抓取助手还没启动', '需要先在本机运行它', helperHelpHtml()));
          } else {
            toast((r && r.error) || '打开登录窗口失败', 'error');
          }
        });
        break;
      }
      case 'refresh-inbox': loadInbox(); break;
      case 'use-inbox': useInboxItem(el.dataset.id); break;
      case 'drop-inbox': removeInboxItem(el.dataset.id); break;
      case 'open-inbox': {
        if (!serverLive) { toast('启动 server.py 后才能接收 QQ/分享链接', 'error'); break; }
        setView('collect');
        setTimeout(() => {
          const panel = document.getElementById('inbox-panel');
          if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 120);
        break;
      }
      case 'copy-share-template': {
        const text = '在浏览器打开 知序 后，把链接粘到「帖子链接」输入框，点「读取链接」。如果从手机分享，可把知序添加到主屏幕后使用系统分享。';
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(() => toast('分享说明已复制')).catch(() => toast('复制失败', 'error'));
        } else {
          toast('请手动复制：把链接粘到「帖子链接」输入框');
        }
        break;
      }
      case 'save-card': saveCardFromForm(); break;
      case 'reanalyze': {
        state.analysis = null;
        renderCollect();
        const ta = document.getElementById('paste-text');
        if (ta) ta.focus();
        break;
      }
      case 'discard-result': state.analysis = null; renderCollect(); break;
      case 'go-collect': setView('collect'); break;
      case 'clear-demo': clearDemo(); break;
      case 'export-data': exportData(); break;
      case 'import-data': {
        const input = document.createElement('input');
        input.type = 'file'; input.accept = 'application/json,.json';
        input.onchange = function () { if (input.files && input.files[0]) importDataFile(input.files[0]); };
        input.click();
        break;
      }
      case 'open-settings': openSettings(); break;
      case 'open-digest': openDigest(); break;
      case 'digest-save': digestSave(); break;
      case 'digest-run': digestRun(); break;
      case 'digest-add-kw': digestAddKeyword(); break;
      case 'digest-add-src': digestAddSource(); break;
      case 'digest-del-src': digestDelSource(el ? el.dataset.idx : -1); break;
      case 'recluster': runRecluster(); break;
      case 'reset-demo': {
        data = seedData(); saveData(); closeModal(); renderCurrentView(); toast('示例数据已恢复'); break;
      }
      case 'add-category': {
        const input = document.getElementById('new-cat-name');
        const name = input ? input.value.trim() : '';
        if (!name) { toast('先输入分类名', 'error'); break; }
        if (registerCategory(name, { auto: false })) {
          toast('已添加分类：' + name);
          openSettings();
        } else {
          toast('这个分类已存在', 'error');
        }
        break;
      }
      case 'rename-category': {
        const oldName = el ? el.dataset.cat : '';
        if (!oldName) break;
        const next = window.prompt('重命名分类（会同步更新该分类下所有卡片）', oldName);
        if (!next || !next.trim() || next.trim() === oldName) break;
        const n = next.trim().slice(0, 12);
        if (findCategoryDef(n)) { toast('已存在同名分类', 'error'); break; }
        const item = customCategoryList().find((c) => c && c.name === oldName);
        if (!item) break;
        item.name = n;
        data.cards.forEach((c) => { if (c.category === oldName) c.category = n; });
        saveData();
        toast('已重命名为：' + n);
        openSettings();
        break;
      }
      case 'del-category': {
        const name = el ? el.dataset.cat : '';
        if (!name) break;
        const count = data.cards.filter((c) => c.category === name).length;
        if (!window.confirm('删除分类「' + name + '」？该分类下 ' + count + ' 张卡片会移到「未分类」。')) break;
        data.settings.customCategories = customCategoryList().filter((c) => !(c && c.name === name));
        data.cards.forEach((c) => { if (c.category === name) c.category = '未分类'; });
        saveData();
        toast('已删除分类：' + name);
        openSettings();
        break;
      }
      case 'ask-clear-all': askClearAll(); break;
      case 'do-clear-all': {
        data = { version: 1, demo: false, cards: [], settings: data.settings, createdAt: new Date().toISOString() };
        saveData(); closeModal(); renderCurrentView(); toast('已清空'); break;
      }
      case 'close-modal': closeModal(); break;
      case 'ask-delete': askDelete(el.dataset.id); break;
      case 'do-delete': deleteCard(el.dataset.id); break;
      case 'card-map': {
        const c = data.cards.find((x) => x.id === el.dataset.id);
        closeModal();
        if (c) { state.map.category = c.category; state.map.topic = ''; state.map.selected = null; state.map.collapsed.clear(); setView('map'); }
        break;
      }
      case 'map-reset': state.map.selected = null; state.map.zoom = 1; state.map.panX = 0; state.map.panY = 0; state.map.collapsed.clear(); renderMap(); break;
      case 'map-export': exportMapSvg(); break;
      case 'map-side-root': state.map.selected = null; renderMap(); break;
      case 'map-zoom-in': state.map.zoom = clamp(state.map.zoom * 1.18, 0.45, 2.6); applyMapTransform(); break;
      case 'map-zoom-out': state.map.zoom = clamp(state.map.zoom * 0.85, 0.45, 2.6); applyMapTransform(); break;
      case 'map-zoom-reset': state.map.zoom = 1; state.map.panX = 0; state.map.panY = 0; applyMapTransform(); break;
      default: break;
    }
  }

  /* ---------------------------------------------------------------- 事件绑定 */
  document.addEventListener('click', function (e) {
    const navBtn = e.target.closest('[data-nav]');
    if (navBtn) { e.preventDefault(); setView(navBtn.dataset.nav); return; }

    const tab = e.target.closest('[data-nav]');
    if (tab) return;

    const cardEl = e.target.closest('[data-card]');
    const delBtn = e.target.closest('[data-del]');
    if (delBtn) { e.preventDefault(); e.stopPropagation(); askDelete(delBtn.dataset.del); return; }
    if (cardEl) {
      const id = cardEl.dataset.card;
      if (id) { openCardModal(id); return; }
    }

    const catBtn = e.target.closest('[data-cat]');
    if (catBtn) {
      const cat = catBtn.dataset.cat;
      const topic = catBtn.dataset.topic || '';
      if (!cat && !topic) {
        state.filter.category = ''; state.filter.topic = '';
      } else if (topic) {
        state.filter.category = cat; state.filter.topic = topic;
      } else {
        const wrap = catBtn.closest('.tree-cat');
        if (state.filter.category === cat && !state.filter.topic && wrap) {
          state.filter.category = ''; state.filter.topic = '';
        } else {
          state.filter.category = cat; state.filter.topic = '';
          state.openCats.add(cat);
        }
      }
      renderLibrary();
      return;
    }

    const actionEl = e.target.closest('[data-action]');
    if (actionEl) {
      e.preventDefault();
      handleAction(actionEl.dataset.action, actionEl);
      return;
    }

    const nodeEl = e.target.closest('.mnode');
    if (nodeEl) {
      e.preventDefault();
      selectMapNode(nodeEl.dataset.node);
      return;
    }
  });

  document.addEventListener('input', function (e) {
    if (e.target.id === 'paste-text') updateCharCount();
    if (e.target.id === 'paste-url') updateLinkDetected();
    if (e.target.id === 'edit-category') {
      const field = document.getElementById('new-cat-field');
      if (field) field.hidden = e.target.value !== '__new__';
    }
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeModal();
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      if (document.getElementById('paste-text') && state.view === 'collect' && !state.analysis) runAnalyze();
      else if (state.analysis) saveCardFromForm();
    }
  });

  window.addEventListener('hashchange', function () {
    const view = (location.hash || '#collect').slice(1);
    if (PAGE_TITLES[view] && view !== state.view) setView(view, false);
  });

  /* ---------------------------------------------------------------- 启动 */
  function boot() {
    data = loadData();
    const hashView = (location.hash || '#collect').slice(1);
    state.view = PAGE_TITLES[hashView] ? hashView : 'collect';
    if (data.cards.length) {
      const first = data.cards[0];
      state.openCats.add(first.category);
      state.map.category = first.category;
    }
    state.map.threshold = data.settings.threshold || 0.45;
    state.map.merge = data.settings.merge !== false;
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('is-active', t.dataset.nav === state.view));
    renderCurrentView();
    detectAI().then(() => handleSharedParams());
    checkHelperAlive();
    refreshMe();
  }

  boot();
})();
