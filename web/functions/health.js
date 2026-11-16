/**
 * 知序 · 健康检查（Netlify Function）
 * 路由：/api/health
 *
 * 前端启动时会请求它：返回 ok 才会启用「读取链接」等在线能力。
 * 因为公众号/豆瓣/普通网页可以自动读取，所以这里不再伪装成「本地演示」，
 * 而是报告真实能力：resolve:true，ai 视是否配置模型 key 而定。
 */
exports.handler = async function () {
  const hasKey = Boolean(process.env.WJ_LLM_API_KEY || process.env.RP_LLM_API_KEY);
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    body: JSON.stringify({
      ok: true,
      name: '知序',
      mode: hasKey ? 'spark' : 'local',
      resolve: true,
      analyze: hasKey,
      inbox: process.env.ZHIXU_INBOX === '1',
      note: hasKey ? 'AI 与链接读取均已启用' : '链接读取已启用；未配置模型 key，AI 走本地规则'
    })
  };
};
