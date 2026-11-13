/* 知序 · 小红书页面提取（content script） */
(function () {
  if (window.__zhixuExtractorLoaded) return;
  window.__zhixuExtractorLoaded = true;

  function textOf(el) {
    return el ? String(el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim() : '';
  }

  function firstText(selectors) {
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      const t = textOf(el);
      if (t) return t;
    }
    return '';
  }

  function meta(prop) {
    const el = document.querySelector(`meta[property="${prop}"],meta[name="${prop}"]`);
    return el ? String(el.getAttribute('content') || '').trim() : '';
  }

  function extract() {
    const title = firstText(['#detail-title', 'h1', '.note-title']) || meta('og:title') || document.title.replace(/\s*-\s*小红书.*$/, '');
    const author = firstText(['.author-wrapper .name', '.author-wrapper .username', '.username', '[class*="author"] [class*="name"]', '[class*="user"] [class*="name"]']);
    let content = firstText(['#detail-desc .note-text', '#detail-desc', '.note-text', '.note-content', '.desc', '[class*="note-text"]', '[class*="detail-desc"]']);
    if (!content) {
      const article = document.querySelector('article');
      content = textOf(article);
    }
    if (!content) {
      // 最后兜底：取正文区域的可见文本，去掉导航/评论噪声
      const body = String(document.body.innerText || '');
      content = body
        .split('\n')
        .map((s) => s.trim())
        .filter((s) => s.length > 8 && !/^(首页|发现|发布|消息|我|登录|搜索|评论|赞|收藏|分享)$/.test(s))
        .slice(0, 40)
        .join('\n');
    }
    const tags = [];
    const source = `${title}\n${content}`;
    for (const m of source.matchAll(/#([^#\s，。！？、,.!?]{1,20})/g)) {
      if (!tags.includes(m[1])) tags.push(m[1]);
    }
    for (const el of document.querySelectorAll('.tags, [class*="tag"], [class*="topic"]')) {
      for (const m of textOf(el).matchAll(/#?([^#\s，。！？、,.!?]{1,20})/g)) {
        const t = m[1].trim();
        if (t && t.length <= 12 && !tags.includes(t) && !/^(标签|话题|展开|收起)$/.test(t)) tags.push(t);
      }
    }
    const images = [];
    for (const img of document.querySelectorAll('.swiper-slide img, .note-image img, [class*="note"] img, meta[property="og:image"]')) {
      const src = img.tagName === 'META' ? img.getAttribute('content') : img.currentSrc || img.src;
      if (src && !images.includes(src)) images.push(src);
    }
    const text = [
      content,
      author ? `作者：${author}` : '',
      tags.length ? `话题：${tags.map((t) => '#' + t).join(' ')}` : '',
    ].filter(Boolean).join('\n');

    return {
      ok: true,
      url: location.href,
      title: title.slice(0, 120),
      text: text.slice(0, 8000),
      author: author.slice(0, 60),
      tags: tags.slice(0, 12),
      images: images.slice(0, 6),
      site: 'xiaohongshu',
    };
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg && msg.type === 'zhixu-extract') {
      try {
        sendResponse(extract());
      } catch (e) {
        sendResponse({ ok: false, error: String(e && e.message || e) });
      }
    }
  });

  // 快捷方式/右键菜单由 background 注入时可直接调用
  window.__zhixuExtract = extract;
})();
