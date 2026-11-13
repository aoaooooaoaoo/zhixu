const M = require('../../utils/model');
const store = require('../../utils/store');
const merge = require('../../utils/merge');

const TYPE_STYLE = {
  root: { fill: '#2f2a24', stroke: '#2f2a24', text: '#fff9ef', font: 16, weight: '600' },
  topic: { fill: '#f7e3d5', stroke: '#ddcdbb', text: '#5c5349', font: 14, weight: '600' },
  card: { fill: '#fffdf8', stroke: '#eadfd2', text: '#2f2a24', font: 13, weight: '400' },
  merge: { fill: '#fff4e8', stroke: '#d9784a', text: '#2f2a24', font: 13, weight: '400' }
};

Page({
  data: {
    categories: [],
    catIndex: 0,
    mergeOn: true,
    threshold: 0.45,
    thresholdText: '0.45',
    hasTree: false,
    zoomText: '100%',
    overview: { cards: 0, topics: 0, merges: 0 },
    selected: null,
    totalCards: 0
  },

  onShow() {
    this.reload(true);
  },

  onReady() {
    this.initCanvas();
  },

  onUnload() {
    this.canvas = null;
    this.ctx = null;
  },

  /* ---------------- 数据 ---------------- */
  reload(needDraw) {
    const data = store.load();
    const countMap = {};
    const topicSet = {};
    data.cards.forEach(function (c) {
      countMap[c.category] = (countMap[c.category] || 0) + 1;
      topicSet[c.category + '|' + c.topic] = 1;
    });
    const categories = Object.keys(countMap).sort(function (a, b) { return countMap[b] - countMap[a]; });
    let catIndex = this.data.catIndex;
    const current = this.data.categories[catIndex];
    if (current && categories.indexOf(current) >= 0) {
      catIndex = categories.indexOf(current);
    } else {
      catIndex = 0;
    }
    this._allCards = data.cards;
    const settings = data.settings || {};
    this.setData({
      categories: categories,
      catIndex: catIndex,
      totalCards: data.cards.length,
      mergeOn: settings.merge !== false,
      threshold: settings.threshold || 0.45,
      thresholdText: Number(settings.threshold || 0.45).toFixed(2)
    }, () => {
      this.build(needDraw);
    });
  },

  build(needDraw) {
    const cards = this._allCards || [];
    const category = this.data.categories[this.data.catIndex] || '';
    if (!cards.length) {
      this.root = null;
      this.setData({ hasTree: false, overview: { cards: 0, topics: 0, merges: 0 }, selected: null });
      this.draw();
      return;
    }
    const root = merge.buildMapTree(cards, {
      category: category,
      topic: '',
      threshold: this.data.threshold,
      merge: this.data.mergeOn
    });
    if (!root) {
      this.root = null;
      this.setData({ hasTree: false });
      this.draw();
      return;
    }
    this.root = root;
    const size = merge.layoutMap(root, new Set());
    this.layoutW = size.width;
    this.layoutH = size.height;

    let mergeCount = 0;
    (root.children || []).forEach(function (t) {
      (t.children || []).forEach(function (n) { if (n.type === 'merge') mergeCount++; });
    });
    this.setData({
      hasTree: true,
      overview: {
        cards: root.cards.length,
        topics: (root.children || []).length,
        merges: mergeCount
      }
    });
    if (needDraw) this.fit();
    this.draw();
  },

  /* ---------------- 画布 ---------------- */
  initCanvas() {
    const query = wx.createSelectorQuery();
    query.select('#mapCanvas').fields({ node: true, size: true }).exec((res) => {
      if (!res || !res[0] || !res[0].node) return;
      const canvas = res[0].node;
      const ctx = canvas.getContext('2d');
      let dpr = 2;
      try {
        dpr = (wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()).pixelRatio || 2;
      } catch (e) { dpr = 2; }
      canvas.width = res[0].width * dpr;
      canvas.height = res[0].height * dpr;
      ctx.scale(dpr, dpr);
      this.canvas = canvas;
      this.ctx = ctx;
      this.cw = res[0].width;
      this.ch = res[0].height;
      this.view = this.view || { scale: 1, tx: 0, ty: 0 };
      this.fit();
      this.draw();
    });
  },

  fit() {
    if (!this.cw || !this.layoutW) return;
    const s = Math.min(this.cw / this.layoutW, this.ch / this.layoutH, 1.1) * 0.94;
    this.view = {
      scale: s,
      tx: (this.cw - this.layoutW * s) / 2,
      ty: (this.ch - this.layoutH * s) / 2
    };
    this.updateZoomText();
  },

  updateZoomText() {
    if (!this.view) return;
    this.setData({ zoomText: Math.round(this.view.scale * 100) + '%' });
  },

  draw() {
    const ctx = this.ctx;
    if (!ctx) return;
    ctx.clearRect(0, 0, this.cw, this.ch);
    ctx.fillStyle = '#fbf6ee';
    ctx.fillRect(0, 0, this.cw, this.ch);
    if (!this.root) {
      ctx.fillStyle = '#918578';
      ctx.font = '14px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('还没有卡片，去收集页理一张吧', this.cw / 2, this.ch / 2);
      ctx.textAlign = 'left';
      return;
    }
    const nodes = merge.collectNodes(this.root);
    ctx.save();
    ctx.translate(this.view.tx, this.view.ty);
    ctx.scale(this.view.scale, this.view.scale);

    // 连线
    const sel = this.selectedId;
    nodes.forEach((parent) => {
      (parent.children || []).forEach((child) => {
        this.drawLink(ctx, parent, child, sel);
      });
    });
    // 节点
    nodes.forEach((node) => this.drawNode(ctx, node, sel));

    ctx.restore();
  },

  drawLink(ctx, p, c, sel) {
    const x1 = p.x + p.w;
    const y1 = p.y;
    const x2 = c.x;
    const y2 = c.y;
    const mx = (x1 + x2) / 2;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.bezierCurveTo(mx, y1, mx, y2, x2, y2);
    const active = sel && (c.id === sel || p.id === sel);
    if (c.type === 'merge' && c.cards && c.cards.length > 1) {
      ctx.strokeStyle = active ? '#d9784a' : 'rgba(217,120,74,0.75)';
      ctx.lineWidth = 1.6;
      ctx.setLineDash([4, 4]);
    } else {
      ctx.strokeStyle = active ? '#d9784a' : '#ddcdbb';
      ctx.lineWidth = 1.4;
      ctx.setLineDash([]);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  },

  drawNode(ctx, node, sel) {
    const style = TYPE_STYLE[node.type] || TYPE_STYLE.card;
    const x = node.x;
    const y = node.y - node.h / 2;
    const w = node.w;
    const h = node.h;
    const isSel = sel === node.id;

    ctx.beginPath();
    this.roundRect(ctx, x, y, w, h, 12);
    ctx.fillStyle = style.fill;
    ctx.fill();
    if (isSel) {
      ctx.strokeStyle = '#d9784a';
      ctx.lineWidth = 2;
      ctx.setLineDash([]);
    } else if (node.type === 'merge') {
      ctx.strokeStyle = 'rgba(217,120,74,0.9)';
      ctx.lineWidth = 1.4;
      ctx.setLineDash([4, 4]);
    } else {
      ctx.strokeStyle = style.stroke;
      ctx.lineWidth = 1;
      ctx.setLineDash([]);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    // 文本
    const maxChars = node.type === 'root' ? 11 : node.type === 'topic' ? 9 : 17;
    const maxLines = node.type === 'root' ? 1 : 2;
    const lines = node.type === 'card' || node.type === 'merge'
      ? merge.wrapLabel(node.label, maxChars, maxLines)
      : merge.wrapLabel(node.label, maxChars, maxLines);
    const lineH = style.font + 3;
    const totalH = lines.length * lineH;
    const startY = y + (h - totalH) / 2 + style.font * 0.82;
    ctx.fillStyle = style.text;
    ctx.font = style.weight + ' ' + style.font + 'px ' + (node.type === 'root' ? '"Songti SC", serif' : 'sans-serif');
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    lines.forEach((line, i) => {
      ctx.fillText(line, x + w / 2, startY + i * lineH);
    });
    ctx.textAlign = 'left';

    // 合并节点右上角计数徽标
    if (node.type === 'merge' && node.cards) {
      const badge = String(node.cards.length);
      ctx.beginPath();
      ctx.arc(x + w - 14, y + 13, 10, 0, Math.PI * 2);
      ctx.fillStyle = '#d9784a';
      ctx.fill();
      ctx.fillStyle = '#fff9ef';
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(badge, x + w - 14, y + 16.5);
      ctx.textAlign = 'left';
    }
  },

  roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  },

  /* ---------------- 手势 ---------------- */
  onTouchStart(e) {
    if (!this.view) return;
    const ts = e.touches || [];
    this._touch = {
      startX: ts[0] ? ts[0].x : 0,
      startY: ts[0] ? ts[0].y : 0,
      lastX: ts[0] ? ts[0].x : 0,
      lastY: ts[0] ? ts[0].y : 0,
      startAt: Date.now(),
      moved: 0,
      pinchDist: ts.length >= 2 ? this.dist(ts[0], ts[1]) : 0,
      pinchScale: this.view.scale
    };
  },

  dist(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy) || 1;
  },

  onTouchMove(e) {
    if (!this.view || !this._touch) return;
    const ts = e.touches || [];
    if (ts.length >= 2) {
      const d = this.dist(ts[0], ts[1]);
      if (this._touch.pinchDist) {
        const ratio = d / this._touch.pinchDist;
        const next = Math.min(2.6, Math.max(0.45, this._touch.pinchScale * ratio));
        const mx = (ts[0].x + ts[1].x) / 2;
        const my = (ts[0].y + ts[1].y) / 2;
        const old = this.view.scale;
        this.view.tx = mx - ((mx - this.view.tx) / old) * next;
        this.view.ty = my - ((my - this.view.ty) / old) * next;
        this.view.scale = next;
        this.updateZoomText();
        this.draw();
      }
      return;
    }
    const t = ts[0];
    if (!t) return;
    const dx = t.x - this._touch.lastX;
    const dy = t.y - this._touch.lastY;
    this._touch.moved += Math.abs(dx) + Math.abs(dy);
    this.view.tx += dx;
    this.view.ty += dy;
    this._touch.lastX = t.x;
    this._touch.lastY = t.y;
    this.draw();
  },

  onTouchEnd(e) {
    if (!this._touch) return;
    const wasTap = this._touch.moved < 10 && Date.now() - this._touch.startAt < 300;
    if (wasTap && this.root) {
      const t = (e.changedTouches && e.changedTouches[0]) || null;
      if (t) {
        const wx0 = (t.x - this.view.tx) / this.view.scale;
        const wy0 = (t.y - this.view.ty) / this.view.scale;
        const hit = merge.collectNodes(this.root).filter(function (n) {
          return wx0 >= n.x && wx0 <= n.x + n.w && wy0 >= n.y - n.h / 2 && wy0 <= n.y + n.h / 2;
        })[0];
        if (hit) this.selectNode(hit);
      }
    }
    this._touch = null;
  },

  selectNode(node) {
    this.selectedId = node.id;
    const cards = (node.cards || []).slice(0, 6).map(function (c) {
      return {
        title: c.title,
        sourceLabel: c.sourceLabel,
        dateText: M.fmtDate(c.createdAt)
      };
    });
    this.setData({
      selected: {
        id: node.id,
        type: node.type,
        label: node.label,
        count: (node.cards || []).length,
        differences: node.differences || [],
        reason: node.reason || '',
        cards: cards,
        typeText: node.type === 'root' ? '知识大点' : node.type === 'topic' ? '主题' : node.type === 'merge' ? '合并节点' : '卡片'
      }
    });
    this.draw();
  },

  clearSelection() {
    this.selectedId = null;
    this.setData({ selected: null });
    this.draw();
  },

  /* ---------------- 交互 ---------------- */
  onCategoryChange(e) {
    this.setData({ catIndex: Number(e.detail.value) }, () => {
      this.build(true);
      this.clearSelection();
    });
  },

  onMergeChange(e) {
    const on = e.detail.value;
    this.setData({ mergeOn: on }, () => this.persistSettings());
    this.build(true);
    this.clearSelection();
  },

  onThresholdChange(e) {
    const v = Number(e.detail.value) / 100;
    this.setData({ threshold: v, thresholdText: v.toFixed(2) }, () => this.persistSettings());
    this.build(true);
    this.clearSelection();
  },

  persistSettings() {
    const data = store.load();
    data.settings = { threshold: this.data.threshold, merge: this.data.mergeOn };
    store.save(data);
  },

  zoomIn() {
    this.zoomBy(1.18);
  },

  zoomOut() {
    this.zoomBy(0.85);
  },

  zoomBy(factor) {
    if (!this.view) return;
    const next = Math.min(2.6, Math.max(0.45, this.view.scale * factor));
    const cx = this.cw / 2;
    const cy = this.ch / 2;
    const old = this.view.scale;
    this.view.tx = cx - ((cx - this.view.tx) / old) * next;
    this.view.ty = cy - ((cy - this.view.ty) / old) * next;
    this.view.scale = next;
    this.updateZoomText();
    this.draw();
  },

  resetView() {
    this.fit();
    this.draw();
  },

  goCollect() {
    wx.switchTab({ url: '/pages/collect/index' });
  },

  saveImage() {
    if (!this.canvas) return;
    wx.showLoading({ title: '生成中…' });
    wx.canvasToTempFilePath({
      canvas: this.canvas,
      success: (res) => {
        wx.hideLoading();
        wx.saveImageToPhotosAlbum({
          filePath: res.tempFilePath,
          success: () => wx.showToast({ title: '已保存到相册', icon: 'success' }),
          fail: () => wx.showToast({ title: '需要相册权限', icon: 'none' })
        });
      },
      fail: () => {
        wx.hideLoading();
        wx.showToast({ title: '导出失败', icon: 'none' });
      }
    });
  }
});
