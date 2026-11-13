// 知序 · 本地存储层（与网页版 zhixu.mvp.v1 结构完全一致，导入导出可互通）
//
// 说明：v1 只做本地存储；云端同步（config.CLOUD_SYNC）为二期预留，
// 目前即使开了云开发也不会把卡片写进云数据库，避免半成品同步造成数据错乱。

const config = require('../config');
const M = require('./model');

const KEY = config.STORAGE_KEY;
const LEGACY_KEY = 'wenjiang.mvp.v1';

// 示例卡片（首次打开时用于让用户先逛一圈；清空示例后不再出现）
const DEMO_CARDS = [
  {
    title: '敏感肌别照抄早C晚A：先修屏障',
    summary: '作者用两周早C晚A烂脸的经历提醒敏感肌：先停猛药、用简单修护霜、把防晒放在美白前面，稳定一个月再考虑功效产品。',
    points: ['敏感肌先停酸类和猛药，减少叠加刺激', '修护期用成分简单的面霜，防晒优先于美白', '皮肤稳定一个月后再逐步引入低浓度A醇'],
    tags: ['早C晚A', '敏感肌', '屏障修护'],
    category: '护肤与美妆',
    topic: '早C晚A',
    quote: '敏感肌要先修屏障，再谈早C晚A。',
    sourceLabel: '小红书 · @小鹿的护肤笔记',
    url: '',
    createdAt: '2026-11-02T10:20:00+08:00'
  },
  {
    title: '早C晚A翻车后，我改成了「一周两次」',
    summary: '从每天早C晚A改成一周两次低浓度A醇，中间穿插修护和纯保湿，泛红明显减少；作者强调频率比浓度更重要。',
    points: ['新手从一周两次开始，不要天天上脸', 'A醇后第二天必须防晒', '出现刺痛就停用，先修护再继续'],
    tags: ['早C晚A', 'A醇', '敏感肌'],
    category: '护肤与美妆',
    topic: '早C晚A',
    quote: '频率比浓度更重要，皮肤稳定才是长期主义。',
    sourceLabel: '小红书 · @成分实验室',
    url: '',
    createdAt: '2026-11-04T21:05:00+08:00'
  },
  {
    title: '屏障修护期，我只留三样东西',
    summary: '换季烂脸时把护肤步骤砍到三步：温和清洁、修护面霜、硬防晒；不叠加精华，不给皮肤增加额外负担。',
    points: ['烂脸期做减法，不叠加功效精华', '硬防晒（帽子/口罩）比防晒霜更稳', '修护至少坚持 28 天再评估'],
    tags: ['屏障修护', '换季', '精简护肤'],
    category: '护肤与美妆',
    topic: '屏障修护',
    quote: '皮肤在报警的时候，做减法比做加法有用。',
    sourceLabel: '小红书 · @一颗圆白菜',
    url: '',
    createdAt: '2026-11-05T09:40:00+08:00'
  },
  {
    title: '我放弃番茄钟之后，反而更专注了',
    summary: '作者发现强制 25 分钟休息会打断心流，改成按任务阶段工作、只在自然停顿处休息，并用一张纸记录分心念头。',
    points: ['按任务阶段而不是固定时钟工作', '分心时先记在纸上，不立刻切换', '每天只安排 1 个「必须完成」的核心任务'],
    tags: ['时间管理', '专注', '效率'],
    category: '学习与效率',
    topic: '时间管理',
    quote: '专注不是盯住时钟，而是让任务本身有牵引力。',
    sourceLabel: '小红书 · @效率实验室',
    url: '',
    createdAt: '2026-11-01T19:12:00+08:00'
  },
  {
    title: '小红书爆款笔记的 3 个开头结构',
    summary: '拆了 100 篇高赞笔记后，作者总结出三种开头：反常识结论、具体场景痛点、结果前置；共同点是 3 秒内给出继续读的理由。',
    points: ['反常识结论：先打破预期，再给证据', '具体场景：让读者立刻对号入座', '结果前置：先展示变化，再讲过程'],
    tags: ['笔记方法', '内容创作', '小红书'],
    category: '学习与效率',
    topic: '笔记方法',
    quote: '开头不是铺垫，是给读者一个继续读下去的理由。',
    sourceLabel: '小红书 · @内容手艺人',
    url: '',
    createdAt: '2026-11-03T14:30:00+08:00'
  },
  {
    title: '面试讲项目，用 STAR 就够了',
    summary: '把项目拆成情境、任务、行动、结果四段，每段只讲一个重点；结果尽量量化，失败项目也要讲清楚复盘。',
    points: ['情境一句话交代背景，不铺陈', '行动部分突出「我」而不是「我们」', '结果带数字，失败项目讲复盘'],
    tags: ['面试表达', '职场', 'STAR'],
    category: '职场与成长',
    topic: '面试表达',
    quote: '面试官不关心项目多大，关心你在里面做了什么判断。',
    sourceLabel: '小红书 · @offer陪跑员',
    url: '',
    createdAt: '2026-10-29T08:15:00+08:00'
  }
];

function seedData() {
  return {
    version: 1,
    demo: true,
    createdAt: new Date().toISOString(),
    settings: { threshold: 0.45, merge: true },
    cards: DEMO_CARDS.map(function (c, i) {
      return M.normalizeCard(Object.assign({}, c, { id: 'demo_' + i, demo: true }));
    })
  };
}

function normalizeData(parsed) {
  parsed.cards = parsed.cards.map(M.normalizeCard);
  parsed.settings = Object.assign({ threshold: 0.45, merge: true }, parsed.settings || {});
  if (typeof parsed.demo !== 'boolean') {
    parsed.demo = parsed.cards.some(function (c) { return c.demo; });
  }
  return parsed;
}

function load() {
  try {
    let raw = wx.getStorageSync(KEY);
    if (!raw) {
      const legacy = wx.getStorageSync(LEGACY_KEY);
      if (legacy) {
        const migrated = normalizeData(legacy);
        raw = migrated;
        try { wx.setStorageSync(KEY, migrated); } catch (e) { /* 忽略 */ }
      }
    }
    if (raw && Array.isArray(raw.cards)) return normalizeData(raw);
  } catch (e) {
    // 数据损坏时静默回落到示例数据，不让用户卡死
  }
  return seedData();
}

function save(data) {
  data.demo = data.cards.some(function (c) { return c.demo; });
  return writeRaw(data);
}

function writeRaw(data) {
  try {
    wx.setStorageSync(KEY, data);
    return true;
  } catch (e) {
    return false;
  }
}

function addCard(card) {
  const data = load();
  data.cards.unshift(M.normalizeCard(card));
  save(data);
  return data;
}

function updateCard(card) {
  const data = load();
  const idx = data.cards.findIndex(function (c) { return c.id === card.id; });
  if (idx >= 0) data.cards[idx] = M.normalizeCard(card);
  else data.cards.unshift(M.normalizeCard(card));
  save(data);
  return data;
}

function removeCard(id) {
  const data = load();
  data.cards = data.cards.filter(function (c) { return c.id !== id; });
  save(data);
  return data;
}

function clearDemo() {
  const data = load();
  data.cards = data.cards.filter(function (c) { return !c.demo; });
  save(data);
  return data;
}

function resetAll() {
  const fresh = seedData();
  save(fresh);
  return fresh;
}

function stats(data) {
  const cards = (data || load()).cards;
  const cats = new Set();
  const topics = new Set();
  const sources = new Set();
  cards.forEach(function (c) {
    cats.add(c.category);
    topics.add(c.category + '|' + c.topic);
    sources.add(c.sourceLabel);
  });
  return {
    cards: cards.length,
    categories: cats.size,
    topics: topics.size,
    sources: sources.size
  };
}

function exportJSON() {
  return JSON.stringify(load(), null, 2);
}

// 整包替换式导入（与网页版一致：不按 id 去重，直接覆盖）
function importJSON(text) {
  let parsed;
  try {
    parsed = JSON.parse(String(text || ''));
  } catch (e) {
    throw new Error('不是合法的 JSON');
  }
  if (!parsed || !Array.isArray(parsed.cards)) {
    throw new Error('文件里没有 cards 数组，可能不是知序导出的数据');
  }
  parsed.version = 1;
  parsed.demo = false;
  parsed.createdAt = parsed.createdAt || new Date().toISOString();
  const data = normalizeData(parsed);
  // 导入是按用户主动行为，不把 demo 徽标重新算出来（与网页版一致）
  writeRaw(data);
  return data;
}

module.exports = {
  KEY: KEY,
  seedData: seedData,
  load: load,
  save: save,
  addCard: addCard,
  updateCard: updateCard,
  removeCard: removeCard,
  clearDemo: clearDemo,
  resetAll: resetAll,
  stats: stats,
  exportJSON: exportJSON,
  importJSON: importJSON
};
