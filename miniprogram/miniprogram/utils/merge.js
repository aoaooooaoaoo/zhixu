// 知序 · 相似度合并 + 思维导图树布局（移植自网页版 app.js）

function bigrams(s) {
  const clean = String(s || '').replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '');
  const out = new Set();
  for (let i = 0; i < clean.length - 1; i++) out.add(clean.slice(i, i + 2));
  return out;
}

function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  a.forEach(function (x) { if (b.has(x)) inter++; });
  return inter / (a.size + b.size - inter);
}

function cardSimilarity(a, b) {
  const tagJ = jaccard(
    new Set((a.tags || []).map(function (t) { return String(t).toLowerCase(); })),
    new Set((b.tags || []).map(function (t) { return String(t).toLowerCase(); }))
  );
  const titleJ = jaccard(bigrams(a.title), bigrams(b.title));
  const sumJ = jaccard(bigrams((a.summary || '').slice(0, 90)), bigrams((b.summary || '').slice(0, 90)));
  let score = 0.5 * tagJ + 0.3 * titleJ + 0.2 * sumJ;
  if (a.topic && a.topic === b.topic) score += 0.3;
  if (a.category && a.category === b.category) score += 0.05;
  return Math.min(1, score);
}

// 贪心分组：逐张卡片找「已有组里最相似的那张」，超过阈值就并组
function mergeCards(cards, threshold, mergeOn) {
  if (!mergeOn) return cards.map(function (c) { return { id: 'g_' + c.id, cards: [c] }; });
  const groups = [];
  cards.forEach(function (card) {
    let target = null;
    let bestScore = 0;
    groups.forEach(function (g) {
      const score = Math.max.apply(null, g.cards.map(function (x) { return cardSimilarity(card, x); }));
      if (score > bestScore) { bestScore = score; target = g; }
    });
    if (target && bestScore >= threshold) target.cards.push(card);
    else groups.push({ id: 'g_' + card.id, cards: [card] });
  });
  return groups;
}

function commonTags(cards) {
  const freq = {};
  cards.forEach(function (c) {
    (c.tags || []).forEach(function (t) { freq[t] = (freq[t] || 0) + 1; });
  });
  return Object.keys(freq)
    .filter(function (t) { return freq[t] > 1; })
    .sort(function (a, b) { return freq[b] - freq[a]; })
    .slice(0, 4);
}

function differencesOf(cards) {
  const diffs = [];
  const pointKeys = cards.map(function (c) {
    return (c.points || []).map(function (p) { return bigrams(p); });
  });
  cards.forEach(function (c, ci) {
    (c.points || []).forEach(function (p, pi) {
      let shared = false;
      cards.forEach(function (other, oi) {
        if (oi === ci) return;
        const otherTokens = pointKeys[oi];
        if (otherTokens.some(function (tokens) { return jaccard(pointKeys[ci][pi], tokens) >= 0.3; })) shared = true;
      });
      if (!shared) {
        const text = p.length > 70 ? p.slice(0, 69) + '…' : p;
        if (!diffs.some(function (d) { return d.text === text; })) {
          diffs.push({ source: c.sourceLabel, text: text });
        }
      }
    });
  });
  return diffs.slice(0, 5);
}

function mergeReason(group) {
  if (group.cards.length <= 1) return '';
  const tags = commonTags(group.cards);
  return '这 ' + group.cards.length + ' 张卡片都在讲「' +
    (tags.length ? tags.join('、') : group.cards[0].topic) +
    '」，观点大面积重叠，所以合并为一支；合并后保留每张卡片的来源和细微差异，避免重复刷屏。';
}

/**
 * 构建导图树
 * @param {Array} cards 全部卡片
 * @param {Object} opts { category, topic, threshold, merge }
 */
function buildMapTree(cards, opts) {
  opts = opts || {};
  if (!cards.length) return null;

  let category = opts.category;
  if (!category || !cards.some(function (c) { return c.category === category; })) {
    const counts = {};
    cards.forEach(function (c) { counts[c.category] = (counts[c.category] || 0) + 1; });
    category = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; })[0];
  }
  let catCards = cards.filter(function (c) { return c.category === category; });
  if (opts.topic) catCards = catCards.filter(function (c) { return c.topic === opts.topic; });

  const topics = new Map();
  catCards.forEach(function (c) {
    if (!topics.has(c.topic)) topics.set(c.topic, []);
    topics.get(c.topic).push(c);
  });

  const children = [];
  Array.from(topics.keys())
    .sort(function (a, b) { return topics.get(b).length - topics.get(a).length; })
    .forEach(function (topic) {
      const groups = mergeCards(topics.get(topic), opts.threshold || 0.45, opts.merge !== false);
      const groupNodes = groups.map(function (g) {
        const single = g.cards[0];
        return {
          id: g.id,
          type: g.cards.length > 1 ? 'merge' : 'card',
          label: single.title,
          cards: g.cards,
          differences: g.cards.length > 1 ? differencesOf(g.cards) : [],
          reason: mergeReason(g)
        };
      });
      children.push({
        id: 't_' + topic,
        type: 'topic',
        label: topic,
        cards: topics.get(topic),
        children: groupNodes
      });
    });

  return { id: 'root', type: 'root', label: category, cards: catCards, children: children };
}

/**
 * 树布局：固定三列 x 坐标，叶子自上而下排，父节点取子节点中点
 * @param {Object} root 树根
 * @param {Set<string>} collapsed 已折叠的 topic 节点 id 集合
 */
function layoutMap(root, collapsed) {
  const nodeW = { root: 168, topic: 150, card: 230, merge: 230 };
  const nodeH = { root: 56, topic: 40, card: 60, merge: 66 };
  const xFor = { root: 26, topic: 270, card: 535, merge: 535 };
  let cursorY = 40;
  const leafGap = 74;
  const isCollapsed = collapsed || new Set();

  function walk(node) {
    node.w = nodeW[node.type];
    node.h = nodeH[node.type];
    node.x = xFor[node.type];
    if (node.type === 'topic' && isCollapsed.has(node.id)) {
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

  const contentH = cursorY - 40;
  const offsetY = Math.max(0, (600 - contentH) / 2);
  (function shift(n) { n.y += offsetY; (n.children || []).forEach(shift); })(root);

  const height = Math.max(600, contentH + 80);
  const width = 900;
  return { width: width, height: height };
}

function collectNodes(root) {
  const out = [];
  (function walk(n) { out.push(n); (n.children || []).forEach(walk); })(root);
  return out;
}

function findNode(root, id) {
  const list = collectNodes(root);
  for (let i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
  return null;
}

// 按字符数硬折行（中文按字宽近似）
function wrapLabel(text, maxChars, maxLines) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  const lines = [];
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    cur += s[i];
    if (cur.length >= maxChars) {
      lines.push(cur);
      cur = '';
      if (lines.length >= maxLines) break;
    }
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  if (lines.length === maxLines && s.length > lines.join('').length) {
    const last = lines[maxLines - 1];
    lines[maxLines - 1] = last.slice(0, Math.max(1, maxChars - 1)) + '…';
  }
  return lines.length ? lines : [''];
}

module.exports = {
  bigrams: bigrams,
  jaccard: jaccard,
  cardSimilarity: cardSimilarity,
  mergeCards: mergeCards,
  commonTags: commonTags,
  differencesOf: differencesOf,
  mergeReason: mergeReason,
  buildMapTree: buildMapTree,
  layoutMap: layoutMap,
  collectNodes: collectNodes,
  findNode: findNode,
  wrapLabel: wrapLabel
};
