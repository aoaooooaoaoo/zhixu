// 云函数 inbox：分享收件箱（可选功能）
// 对应网页版的 /api/inbox：外部（浏览器插件 / QQ 桥 / 分享）投递的待归档链接。
// 数据存在云数据库集合 inbox，按 _openid 隔离，最多保留最近 100 条。

const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const COLL = 'inbox';
const MAX_ITEMS = 100;

function firstUrl(text) {
  const m = String(text || '').match(/https?:\/\/[^\s<>"']+/);
  if (!m) return '';
  return m[0].replace(/[，。！？、,.!?)）】]+$/, '');
}

exports.main = async function (event) {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID || '';
  const action = String((event && event.action) || 'list');

  if (!openid) {
    return { ok: false, error: '拿不到用户身份，请从小程序端调用' };
  }

  try {
    if (action === 'list') {
      const res = await db.collection(COLL)
        .where({ _openid: openid })
        .orderBy('createdAt', 'desc')
        .limit(MAX_ITEMS)
        .get();
      return { ok: true, items: res.data || [] };
    }

    if (action === 'add') {
      const url = firstUrl(String((event && event.url) || ''));
      if (!url) return { ok: false, error: '缺少有效的 http/https 链接' };

      const exists = await db.collection(COLL).where({ _openid: openid, url: url }).limit(1).get();
      if (exists.data && exists.data.length) {
        return { ok: true, item: exists.data[0], duplicated: true };
      }

      const item = {
        _openid: openid,
        url: url,
        title: String((event && event.title) || '').slice(0, 120),
        text: String((event && event.text) || '').slice(0, 2000),
        from: String((event && event.from) || '分享').slice(0, 80),
        createdAt: new Date().toISOString()
      };
      const added = await db.collection(COLL).add({ data: item });
      return { ok: true, id: added._id, item: Object.assign({ id: added._id }, item) };
    }

    if (action === 'remove') {
      const id = String((event && event.id) || '');
      if (!id) return { ok: false, error: '缺少 id' };
      await db.collection(COLL).doc(id).remove();
      return { ok: true, removed: 1 };
    }

    return { ok: false, error: '未知 action：' + action };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
};
