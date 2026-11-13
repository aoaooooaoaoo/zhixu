const statusEl = document.getElementById('status');
const sendBtn = document.getElementById('send');

function setStatus(text, kind) {
  statusEl.textContent = text;
  statusEl.className = 'status' + (kind ? ' ' + kind : '');
}

chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
  const url = tab && tab.url || '';
  if (/xiaohongshu\.com|xhslink\.cn/.test(url)) {
    setStatus('已识别到小红书页面。若是笔记详情页，直接点发送。');
  } else {
    setStatus('当前不是小红书笔记页；也可以发送任意网页的标题/描述。', 'err');
  }
});

sendBtn.addEventListener('click', async () => {
  sendBtn.disabled = true;
  setStatus('正在提取并发送…');
  try {
    const resp = await chrome.runtime.sendMessage({ type: 'zhixu-send-tab' });
    if (!resp || !resp.ok) throw new Error((resp && resp.error) || '发送失败');
    setStatus('已发送：' + (resp.title || '当前页面') + '\n打开知序 →「收件箱」→「读取并归档」。', 'ok');
  } catch (e) {
    setStatus('发送失败：' + (e.message || e) + '\n请确认知序 server.py 已启动（127.0.0.1:8788）。', 'err');
  } finally {
    sendBtn.disabled = false;
  }
});

document.getElementById('open').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'zhixu-open-inbox' });
  window.close();
});
