import { json } from '../../lib/http.js';
import { llmConfig } from '../../lib/llm.js';

export async function onRequest({ env }) {
  const mode = llmConfig(env).key ? 'spark' : 'local';
  return json({
    ok: true,
    mode,
    resolve: true,
    analyze: mode === 'spark',
    ask: mode === 'spark',
    auth: Boolean(env.ZHIXU_KV),
    sync: Boolean(env.ZHIXU_KV),
    platform: 'cloudflare-pages'
  });
}
