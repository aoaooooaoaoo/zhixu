const M = require('../../utils/model');
const store = require('../../utils/store');
const ai = require('../../utils/ai');

const SAMPLE_TEXT = '早C晚A真的适合所有人吗？作为一个被烂脸教育过的敏感肌，我想说：先别急着照抄。\n\n我曾经连续两周早C晚A，结果脸颊泛红、刺痛，后来才知道敏感肌要先修屏障。现在我的顺序是：早上清水洗脸 + 保湿 + 防晒，晚上用低浓度A醇，一周两次，中间穿插修护面霜。\n\n如果你也是敏感肌，建议先做三件事：1）停掉所有酸类和猛药；2）用成分简单的修护霜；3）防晒优先于美白。等皮肤稳定一个月，再考虑早C晚A。\n\n#护肤 #敏感肌 #早C晚A #屏障修护 #成分党';

Page({
  data: {
    text: '',
    url: '',
    charCount: 0,
    busy: false,
    stepIndex: 0,
    note: '',
    aiLabel: '本地规则',
    // 解析结果
    card: null,
    categories: [],
    categoryIndex: 0,
    isNewCategory: false,
    newCategory: '',
    pointsText: '',
    tagsText: '',
    saving: false
  },

  onLoad() {
    this.refreshMode();
  },

  onShow() {
    this.refreshMode();
  },

  refreshMode() {
    const app = getApp();
    const cloud = ai.cloudAvailable();
    this.setData({ aiLabel: cloud ? 'AI 已连接' : '本地规则' });
    if (app && app.globalData) {
      app.globalData.aiMode = cloud ? 'cloud' : 'local';
    }
  },

  onInputText(e) {
    const v = e.detail.value || '';
    this.setData({ text: v, charCount: v.length });
  },

  onInputUrl(e) {
    this.setData({ url: e.detail.value || '' });
  },

  fillSample() {
    this.setData({ text: SAMPLE_TEXT, charCount: SAMPLE_TEXT.length, note: '已填入示例笔记' });
  },

  clearInput() {
    this.setData({ text: '', url: '', charCount: 0, note: '', card: null });
  },

  async readLink() {
    if (this.data.busy) return;
    const url = M.safeUrl(this.data.url) || M.extractUrl(this.data.text);
    if (!url) {
      wx.showToast({ title: '先填一个链接', icon: 'none' });
      return;
    }
    this.setData({ busy: true, stepIndex: 1, note: '正在读取链接…' });
    try {
      const res = await ai.resolveUrl(url);
      if (res.blocked) {
        this.setData({ busy: false, stepIndex: 0, note: res.note || '这个页面读不到正文，请手动粘贴' });
        return;
      }
      const body = String(res.text || '');
      const merged = body.length >= 60 ? body : (res.description || '');
      this.setData({
        busy: false,
        stepIndex: 2,
        url: res.url || url,
        text: merged ? merged : this.data.text,
        charCount: (merged || this.data.text).length,
        note: '已读取：' + (res.title || res.site || '网页') + (merged ? '（正文已填入，可编辑）' : '（没有抓到正文，请手动粘贴）')
      });
    } catch (e) {
      this.setData({ busy: false, stepIndex: 0, note: e.message || '读取失败' });
    }
  },

  async analyze() {
    if (this.data.busy) return;
    const text = String(this.data.text || '').trim();
    if (text.length < 12) {
      wx.showToast({ title: '至少粘贴 12 个字', icon: 'none' });
      return;
    }
    this.setData({ busy: true, stepIndex: 1, note: '正在提炼…' });
    try {
      const out = await ai.analyze(text, this.data.url);
      this.enterEdit(out.card, out.mode);
      this.setData({
        busy: false,
        stepIndex: 3,
        note: out.mode === 'cloud' ? 'AI 提炼完成，可修改后保存' : '本地规则提炼完成，可修改后保存'
      });
    } catch (e) {
      this.setData({ busy: false, stepIndex: 0, note: e.message || '提炼失败' });
      wx.showToast({ title: e.message || '提炼失败', icon: 'none' });
    }
  },

  enterEdit(card, mode) {
    const data = store.load();
    const names = M.categoryNamesOf(data.cards);
    let idx = names.indexOf(card.category);
    if (idx < 0) idx = names.length;
    const categories = names.concat(['＋ 新建分类…']);
    this.setData({
      card: card,
      categories: categories,
      categoryIndex: idx,
      isNewCategory: idx >= names.length,
      newCategory: '',
      pointsText: (card.points || []).join('\n'),
      tagsText: (card.tags || []).join('，'),
      note: mode === 'cloud' ? 'AI 已提炼，确认后保存' : '本地规则已提炼，确认后保存'
    });
  },

  onEditTitle(e) { this.setData({ 'card.title': e.detail.value }); },
  onEditSummary(e) { this.setData({ 'card.summary': e.detail.value }); },
  onEditTopic(e) { this.setData({ 'card.topic': e.detail.value }); },
  onEditQuote(e) { this.setData({ 'card.quote': e.detail.value }); },
  onEditSource(e) { this.setData({ 'card.sourceLabel': e.detail.value }); },
  onEditUrl(e) { this.setData({ 'card.url': e.detail.value }); },
  onEditPoints(e) { this.setData({ pointsText: e.detail.value }); },
  onEditTags(e) { this.setData({ tagsText: e.detail.value }); },

  onCategoryChange(e) {
    const idx = Number(e.detail.value);
    const isNew = idx >= this.data.categories.length - 1;
    this.setData({ categoryIndex: idx, isNewCategory: isNew });
  },

  onNewCategoryInput(e) {
    this.setData({ newCategory: e.detail.value });
  },

  save() {
    const card = this.data.card;
    if (!card) return;
    const title = String(card.title || '').trim();
    if (!title) {
      wx.showToast({ title: '标题不能为空', icon: 'none' });
      return;
    }
    let category = this.data.categories[this.data.categoryIndex];
    if (this.data.isNewCategory) {
      category = String(this.data.newCategory || '').trim() || '未分类';
    }
    const points = String(this.data.pointsText || '').split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
    const tags = String(this.data.tagsText || '').split(/[，,、\s]+/).map(function (s) { return s.trim(); }).filter(Boolean);

    const finalCard = M.normalizeCard(Object.assign({}, card, {
      title: title,
      category: category,
      topic: String(card.topic || '').trim() || '综合笔记',
      points: points,
      tags: tags,
      url: M.safeUrl(card.url),
      createdAt: new Date().toISOString(),
      demo: false
    }));

    const ok = store.save((function () {
      const data = store.load();
      data.cards.unshift(finalCard);
      return data;
    })());

    if (!ok) {
      wx.showToast({ title: '保存失败，检查存储空间', icon: 'none' });
      return;
    }
    wx.showToast({ title: '已保存到知识库', icon: 'success' });
    this.setData({ card: null, text: '', url: '', charCount: 0, stepIndex: 0, note: '', pointsText: '', tagsText: '' });
    setTimeout(function () {
      wx.switchTab({ url: '/pages/library/index' });
    }, 500);
  },

  discard() {
    wx.showModal({
      title: '放弃这张卡片？',
      content: '刚才提炼的内容不会保存。',
      confirmText: '放弃',
      confirmColor: '#b4553f',
      success: (res) => {
        if (res.confirm) this.setData({ card: null, stepIndex: 0, note: '' });
      }
    });
  },

  goLibrary() {
    wx.switchTab({ url: '/pages/library/index' });
  }
});
