// 知序 · AI 调用层
// 有云开发（config.USE_CLOUD）时走云函数 analyze/resolve，否则退回本地规则。

const config = require('../config');
const M = require('./model');
const rules = require('./rules');

function cloudAvailable() {
  return Boolean(config.USE_CLOUD && config.CLOUD_ENV && wx.cloud);
}

/**
 * 文本 → 卡片
 * @returns {Promise<{card:Object, mode:'cloud'|'local', note:string}>}
 */
async function analyze(text, url) {
  const clean = String(text || '').trim();
  if (clean.length < 12) {
    throw new Error('内容太短了，至少粘贴 12 个字再试');
  }

  if (cloudAvailable()) {
    try {
      const res = await wx.cloud.callFunction({
        name: 'analyze',
        data: { text: clean, url: String(url || '') }
      });
      const payload = (res && res.result) || {};
      const raw = payload.card || (payload.cards && payload.cards[0]);
      if (payload.ok && raw) {
        const source = M.sourceFromUrl(url || M.extractUrl(clean), clean);
        return {
          mode: 'cloud',
          note: '',
          card: M.normalizeCard(Object.assign({}, raw, {
            points: Array.isArray(raw.points) ? raw.points : [],
            tags: Array.isArray(raw.tags) ? raw.tags : [],
            sourceLabel: raw.sourceLabel || source.label,
            url: raw.url || source.url,
            createdAt: new Date().toISOString()
          }))
        };
      }
      // 云函数返回失败：静默降级
    } catch (e) {
      console.warn('[知序] 云函数 analyze 调用失败，改用本地规则', e);
    }
  }

  return {
    mode: 'local',
    note: '当前为本地规则提炼，结果可自行编辑',
    card: rules.localAnalyze(clean, url)
  };
}

/**
 * 链接 → 正文
 * @returns {Promise<Object>} { ok, url, site, title, description, text, blocked, note }
 */
async function resolveUrl(url) {
  const u = M.safeUrl(url);
  if (!u) throw new Error('请先填一个 http/https 链接');

  if (!cloudAvailable()) {
    return {
      ok: false,
      blocked: true,
      note: '还没开通云开发，读不了线上网页。可以直接把笔记文字粘贴到上面。',
      url: u
    };
  }

  try {
    const res = await wx.cloud.callFunction({ name: 'resolve', data: { url: u } });
    return (res && res.result) || { ok: false, blocked: true, note: '读取失败，请手动粘贴', url: u };
  } catch (e) {
    return {
      ok: false,
      blocked: true,
      note: '读取失败：' + (e && e.errMsg ? e.errMsg : '网络异常') + '，可以手动粘贴文字',
      url: u
    };
  }
}

module.exports = {
  cloudAvailable: cloudAvailable,
  analyze: analyze,
  resolveUrl: resolveUrl
};
