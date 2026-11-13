// 知序 · 数据模型与通用工具（移植自网页版 app.js）

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

function hash(s) {
  let h = 0;
  const str = String(s || '其他');
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h;
}

function uid(prefix) {
  return (prefix || 'id') + '_' + Date.now().toString(36) + Math.random().toString(16).slice(2, 7);
}

function truncate(s, n) {
  s = String(s || '').replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function safeUrl(u) {
  return /^https?:\/\//i.test(String(u || '')) ? String(u) : '';
}

function extractUrl(text) {
  const m = String(text || '').match(/https?:\/\/[^\s，。！？]+/i);
  return m ? m[0].replace(/[),.]+$/, '') : '';
}

function hashtagsOf(text) {
  const out = [];
  String(text || '').replace(/#([^#\s，。！？、,.!?]{1,16})/g, function (_, tag) {
    out.push(tag.trim());
    return '';
  });
  return out;
}

function sourceFromUrl(url, text) {
  const u = safeUrl(url);
  let label = '手动粘贴';
  if (u) {
    let host = '';
    try {
      const m = u.match(/^https?:\/\/([^\/:]+)/i);
      host = m ? m[1].replace(/^www\./, '') : '';
    } catch (e) { host = ''; }
    const map = {
      'xiaohongshu.com': '小红书', 'weibo.com': '微博', 'zhihu.com': '知乎',
      'bilibili.com': 'B站', 'douyin.com': '抖音', 'wechat.com': '公众号',
      'mp.weixin.qq.com': '公众号'
    };
    label = map[host] || host || '链接';
    const author = String(text || '').match(/(?:作者|博主|up主|UP主)[：:]\s*([^\n，。]{1,18})/);
    if (author) label += ' · @' + author[1].trim();
  }
  return { label: label, url: u };
}

function categoryInfo(name) {
  const found = CATEGORY_DEFS.filter(function (c) { return c.name === name; })[0];
  if (found) return found;
  const color = EXTRA_COLORS[hash(name) % EXTRA_COLORS.length];
  return { name: name, color: color, soft: color + '22', keywords: [], topics: [] };
}

function normalizeCard(c) {
  c = c || {};
  return {
    id: c.id || uid('card'),
    title: c.title || '未命名卡片',
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

function fmtDate(iso) {
  try {
    const d = new Date(iso);
    return (d.getMonth() + 1) + '月' + d.getDate() + '日';
  } catch (e) { return ''; }
}

function categoryNamesOf(cards) {
  const names = CATEGORY_DEFS.map(function (c) { return c.name; });
  (cards || []).forEach(function (c) {
    if (c.category && names.indexOf(c.category) < 0) names.push(c.category);
  });
  return names;
}

module.exports = {
  CATEGORY_DEFS: CATEGORY_DEFS,
  EXTRA_COLORS: EXTRA_COLORS,
  hash: hash,
  uid: uid,
  truncate: truncate,
  escapeRegExp: escapeRegExp,
  safeUrl: safeUrl,
  extractUrl: extractUrl,
  hashtagsOf: hashtagsOf,
  sourceFromUrl: sourceFromUrl,
  categoryInfo: categoryInfo,
  normalizeCard: normalizeCard,
  fmtDate: fmtDate,
  categoryNamesOf: categoryNamesOf
};
