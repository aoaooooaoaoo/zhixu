// 知序 · 本地规则提炼（离线兜底，无 AI 也能用）
// 完全移植自网页版 app.js 的 localAnalyze 及其辅助函数。

const M = require('./model');

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
    .map(function (s) { return s.replace(/^[\s\d.、,，:：\-—]+/, '').trim(); })
    .filter(function (s) { return s.length >= 6 && s.length <= 160; });
}

function keywordScores(text) {
  const scores = M.CATEGORY_DEFS.map(function (cat) {
    let score = 0;
    cat.keywords.forEach(function (kw) {
      if (!kw) return;
      const m = String(text).match(new RegExp(M.escapeRegExp(kw), 'gi'));
      if (m) score += m.length * (kw.length >= 3 ? 2 : 1);
    });
    return { cat: cat, score: score };
  });
  return scores.sort(function (a, b) { return b.score - a.score; });
}

function topTags(text, category, limit) {
  const limitN = limit || 4;
  const tags = M.hashtagsOf(text);
  const textLower = String(text).toLowerCase();
  const scores = {};
  M.CATEGORY_DEFS.forEach(function (cat) {
    cat.keywords.forEach(function (kw) {
      if (!kw) return;
      if (textLower.indexOf(String(kw).toLowerCase()) >= 0) {
        scores[kw] = (scores[kw] || 0) + (kw.length >= 3 ? 2 : 1);
      }
    });
  });
  Object.keys(scores)
    .sort(function (a, b) { return scores[b] - scores[a]; })
    .forEach(function (kw) { if (tags.indexOf(kw) < 0) tags.push(kw); });
  if (category && category.name && tags.length === 0) tags.push(category.name);
  return tags.slice(0, limitN);
}

function chooseTopic(text, category, tags) {
  const topicList = (category && category.topics) || [];
  const lower = String(text).toLowerCase();
  for (let i = 0; i < topicList.length; i++) {
    if (lower.indexOf(String(topicList[i]).toLowerCase()) >= 0) return topicList[i];
  }
  for (let i = 0; i < tags.length; i++) {
    for (let j = 0; j < topicList.length; j++) {
      const topic = topicList[j];
      if (tags[i].indexOf(topic) >= 0 || topic.indexOf(tags[i]) >= 0) return topic;
    }
  }
  return tags[0] || '综合笔记';
}

function localAnalyze(textInput, urlInput) {
  const text = String(textInput || '').replace(/\r/g, '').trim();
  const url = M.safeUrl(urlInput || M.extractUrl(text));
  const sentences = splitSentences(text);
  const lines = text.split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
  const firstLine = cleanTitleLine(lines[0] || '');
  const scores = keywordScores(text);
  const best = scores[0];
  const strong = best && best.score >= 2;
  const category = strong ? best.cat : (best && best.score === 1 ? best.cat : null);
  const tags = topTags(text, category, 4);
  const cat = category || { name: tags[0] ? '新知识 · ' + tags[0] : '未分类', topics: [] };
  const dynamicCat = category ? category : M.categoryInfo(cat.name);
  const topic = chooseTopic(text, dynamicCat, tags);

  const titleCandidate = firstLine || (sentences[0] ? M.truncate(sentences[0], 26) : '一条新的知识卡片');
  const title = M.truncate(titleCandidate.replace(/^["'“”]+|["'“”]+$/g, ''), 30);

  const summarySentences = [];
  if (sentences[0]) summarySentences.push(sentences[0]);
  const ranked = sentences.slice(1).map(function (s, i) {
    let sc = i === 0 ? 1 : 0;
    scores.forEach(function (entry) {
      entry.cat.keywords.forEach(function (kw) { if (s.indexOf(kw) >= 0) sc += 2; });
    });
    return { s: s, sc: sc };
  }).sort(function (a, b) { return b.sc - a.sc; });
  if (ranked[0]) summarySentences.push(ranked[0].s);
  const summary = M.truncate(summarySentences.join(' ').replace(/\s+/g, ' '), 120);

  const pointRanked = ranked
    .filter(function (x) { return x.sc > 0 && x.s !== summarySentences[0]; })
    .slice(0, 6)
    .map(function (x) { return M.truncate(x.s, 62); });
  const points = [];
  pointRanked.forEach(function (p) { if (points.indexOf(p) < 0) points.push(p); });
  if (points.length < 3) {
    sentences.forEach(function (s) {
      if (points.length < 3 && points.indexOf(M.truncate(s, 62)) < 0 && s !== summarySentences[0]) {
        points.push(M.truncate(s, 62));
      }
    });
  }

  const quote = sentences.filter(function (s) {
    return /建议|记住|最重要|其实|不要|必须|核心/.test(s);
  })[0] || sentences[0] || '';

  const source = M.sourceFromUrl(url, text);

  return M.normalizeCard({
    title: title,
    summary: summary || M.truncate(text, 110),
    points: points.slice(0, 4),
    tags: tags.length ? tags : [topic],
    category: cat.name,
    topic: topic,
    quote: M.truncate(quote, 90),
    sourceLabel: source.label,
    url: source.url,
    createdAt: new Date().toISOString()
  });
}

module.exports = {
  cleanTitleLine: cleanTitleLine,
  splitSentences: splitSentences,
  keywordScores: keywordScores,
  topTags: topTags,
  chooseTopic: chooseTopic,
  localAnalyze: localAnalyze
};
