const M = require('../../utils/model');
const store = require('../../utils/store');

Page({
  data: {
    cards: [],
    stats: { cards: 0, categories: 0, topics: 0, sources: 0 },
    allCount: 0,
    isDemo: false,
    search: '',
    sortIndex: 0,
    sortOptions: ['最近添加', '最早添加', '按标题'],
    category: '',
    topic: '',
    categories: [],
    topics: [],
    detail: null,
    showDetail: false
  },

  onShow() {
    this.reload();
  },

  reload() {
    const data = store.load();
    const stats = store.stats(data);
    const catMap = {};
    data.cards.forEach(function (c) {
      if (!catMap[c.category]) catMap[c.category] = 0;
      catMap[c.category]++;
    });
    const categories = Object.keys(catMap).sort(function (a, b) { return catMap[b] - catMap[a]; });
    const self = this;
    this._data = data;
    this.setData({
      allCount: data.cards.length,
      isDemo: Boolean(data.demo),
      stats: stats,
      categories: categories
    }, function () {
      self.applyFilter();
    });
  },

  onSearch(e) {
    const v = e.detail.value || '';
    this.setData({ search: v });
    if (this._searchTimer) clearTimeout(this._searchTimer);
    const self = this;
    this._searchTimer = setTimeout(function () { self.applyFilter(); }, 200);
  },

  onSortChange(e) {
    this.setData({ sortIndex: Number(e.detail.value) });
    this.applyFilter();
  },

  selectCategory(e) {
    const cat = e.currentTarget.dataset.cat || '';
    const nextCat = cat === this.data.category ? '' : cat;
    this.setData({ category: nextCat, topic: '', topics: this.topicsOf(nextCat) });
    this.applyFilter();
  },

  selectTopic(e) {
    const topic = e.currentTarget.dataset.topic || '';
    this.setData({ topic: topic === this.data.topic ? '' : topic });
    this.applyFilter();
  },

  topicsOf(category) {
    if (!category) return [];
    const map = {};
    (this._data ? this._data.cards : []).forEach(function (c) {
      if (c.category === category) map[c.topic] = (map[c.topic] || 0) + 1;
    });
    return Object.keys(map).sort(function (a, b) { return map[b] - map[a]; });
  },

  applyFilter() {
    const data = this._data || store.load();
    const f = {
      category: this.data.category,
      topic: this.data.topic,
      q: String(this.data.search || '').trim().toLowerCase(),
      sort: ['new', 'old', 'title'][this.data.sortIndex] || 'new'
    };
    let list = data.cards.filter(function (c) {
      if (f.category && c.category !== f.category) return false;
      if (f.topic && c.topic !== f.topic) return false;
      if (f.q) {
        const hay = [c.title, c.summary, (c.points || []).join(' '), (c.tags || []).join(' '), c.category, c.topic, c.sourceLabel].join(' ').toLowerCase();
        if (hay.indexOf(f.q) < 0) return false;
      }
      return true;
    });
    list = list.slice().sort(function (a, b) {
      if (f.sort === 'old') return new Date(a.createdAt) - new Date(b.createdAt);
      if (f.sort === 'title') return String(a.title).localeCompare(String(b.title), 'zh');
      return new Date(b.createdAt) - new Date(a.createdAt);
    });
    const view = list.map(function (c) {
      const info = M.categoryInfo(c.category);
      return Object.assign({}, c, {
        color: info.color,
        soft: info.soft,
        pointsText: (c.points || []).join('；'),
        tagsText: (c.tags || []).join(' · '),
        dateText: M.fmtDate(c.createdAt),
        summaryShort: c.summary || ''
      });
    });
    this.setData({ cards: view });
  },

  openDetail(e) {
    const id = e.currentTarget.dataset.id;
    const card = (this._data ? this._data.cards : []).filter(function (c) { return c.id === id; })[0];
    if (!card) return;
    const info = M.categoryInfo(card.category);
    this.setData({
      showDetail: true,
      detail: Object.assign({}, card, {
        color: info.color,
        soft: info.soft,
        dateText: M.fmtDate(card.createdAt)
      })
    });
  },

  closeDetail() {
    this.setData({ showDetail: false, detail: null });
  },

  copySource() {
    const d = this.data.detail;
    if (!d) return;
    if (!d.url) {
      wx.showToast({ title: '这张卡片没有原链接', icon: 'none' });
      return;
    }
    wx.setClipboardData({ data: d.url });
  },

  askDelete() {
    const d = this.data.detail;
    if (!d) return;
    wx.showModal({
      title: '删除这张卡片？',
      content: '「' + d.title + '」删除后无法恢复。',
      confirmText: '删除',
      confirmColor: '#b4553f',
      success: (res) => {
        if (!res.confirm) return;
        store.removeCard(d.id);
        this.setData({ showDetail: false, detail: null });
        this.reload();
        wx.showToast({ title: '已删除', icon: 'success' });
      }
    });
  },

  clearDemo() {
    wx.showModal({
      title: '清空示例数据？',
      content: '只会删掉示例卡片，你自己添加的会保留。',
      success: (res) => {
        if (!res.confirm) return;
        store.clearDemo();
        this.reload();
        wx.showToast({ title: '已清空示例', icon: 'success' });
      }
    });
  },

  exportData() {
    const json = store.exportJSON();
    wx.setClipboardData({
      data: json,
      success: function () {
        wx.showModal({
          title: '已复制到剪贴板',
          content: '共 ' + JSON.parse(json).cards.length + ' 张卡片。粘贴到备忘录或发给自己即可备份。',
          showCancel: false
        });
      }
    });
  },

  importData() {
    wx.getClipboardData({
      success: (res) => {
        const text = res.data || '';
        if (text.length < 20) {
          wx.showToast({ title: '剪贴板里没有可导入的数据', icon: 'none' });
          return;
        }
        wx.showModal({
          title: '从剪贴板导入？',
          content: '导入会整包替换当前知识库（共 ' + this.data.allCount + ' 张卡片）。建议先导出备份。',
          confirmText: '导入',
          confirmColor: '#b95c35',
          success: (r) => {
            if (!r.confirm) return;
            try {
              store.importJSON(text);
              this.setData({ category: '', topic: '', topics: [] });
              this.reload();
              wx.showToast({ title: '导入成功', icon: 'success' });
            } catch (err) {
              wx.showModal({ title: '导入失败', content: err.message || '数据格式不对', showCancel: false });
            }
          }
        });
      }
    });
  },

  goCollect() {
    wx.switchTab({ url: '/pages/collect/index' });
  },

  noop() {}
});
