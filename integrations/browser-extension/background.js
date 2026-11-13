/* 知序 · 扩展后台：右键菜单、快捷键、把页面发给本地知序 */
const ZHIXU_URL = 'http://127.0.0.1:8788';

async function postToZhixu(payload) {
  const res = await fetch(ZHIXU_URL + '/api/inbox', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw new Error(data.error || ('HTTP ' + res.status));
  return data.item;
}

function notify(title, message) {
  try {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon-128.png',
      title,
      message: String(message || '').slice(0, 240),
    });
  } catch (e) { /* 忽略 */ }
}

async function getExtraction(tabId) {
  try {
    const resp = await chrome.tabs.sendMessage(tabId, { type: 'zhixu-extract' });
    if (resp && resp.ok) return resp;
  } catch (e) { /* content script 未注入 */ }
  // 兜底：注入 content.js 再取；非小红书页面用通用提取
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    const resp = await chrome.tabs.sendMessage(tabId, { type: 'zhixu-extract' });
    if (resp && resp.ok) return resp;
  } catch (e) { /* 继续通用提取 */ }
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const meta = (p) => {
        const el = document.querySelector(`meta[property="${p}"],meta[name="${p}"]`);
        return el ? (el.getAttribute('content') || '').trim() : '';
      };
      const title = meta('og:title') || document.title;
      const desc = meta('og:description') || meta('description');
      const body = String(document.body.innerText || '').split('\n').map((s) => s.trim()).filter((s) => s.length > 8).slice(0, 50).join('\n');
      return { ok: true, url: location.href, title: title.slice(0, 120), text: (desc || body).slice(0, 8000), site: location.hostname };
    },
  });
  return result && result.result;
}

async function sendTab(tab) {
  if (!tab || !tab.id) throw new Error('没有活动页面');
  const data = await getExtraction(tab.id);
  if (!data || !data.ok) throw new Error((data && data.error) || '没有读到页面内容');
  if (!data.text || data.text.trim().length < 12) throw new Error('没有读到正文；请打开小红书笔记详情页再试');
  const item = await postToZhixu({
    url: data.url || tab.url,
    title: data.title || tab.title || '浏览器分享',
    text: data.text,
    from: data.site === 'xiaohongshu' ? '浏览器插件 · 小红书' : '浏览器插件 · ' + (data.site || '网页'),
  });
  notify('已发送到知序', (data.title || '页面') + '\n打开知序收件箱即可归档。');
  return { ok: true, item, title: data.title, length: data.text.length };
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'zhixu-send-page',
    title: '发送当前页面到知序',
    contexts: ['page', 'selection', 'link'],
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'zhixu-send-page' || !tab) return;
  try { await sendTab(tab); } catch (e) { notify('发送失败', e.message); }
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'send-to-zhixu') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try { await sendTab(tab); } catch (e) { notify('发送失败', e.message); }
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === 'zhixu-send-tab') {
    chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => sendTab(tab))
      .then((r) => sendResponse(r))
      .catch((e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }
  if (msg && msg.type === 'zhixu-open-inbox') {
    chrome.tabs.create({ url: ZHIXU_URL + '/#collect' });
    sendResponse({ ok: true });
  }
});
