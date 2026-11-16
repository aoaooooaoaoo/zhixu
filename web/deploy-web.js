#!/usr/bin/env node
/**
 * 知序网页版 · 用 Netlify Token 自动部署（可选，省得每次拖拽）
 *
 * 准备：
 *   1) Netlify → User settings → Applications → Personal access tokens → New access token
 *   2) 设置环境变量后运行：
 *        $env:NETLIFY_AUTH_TOKEN = "你的token"
 *        node deploy-web.js
 *
 * 可选参数：
 *   --site zhixu-note      站点名（默认读 SITE_NAME 或 zhixu-note）
 *   --zip zhixu-web.zip    上传的压缩包（默认项目根下 zhixu-web.zip）
 *   --dry                  只检查 token 与站点，不上传
 *
 * 行为：找到（或创建）站点 → 上传 zip → 轮询部署状态直到 ready → 打印地址
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = __dirname;

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const TOKEN = process.env.NETLIFY_AUTH_TOKEN || process.env.NETLIFY_TOKEN;
const SITE_NAME = arg('site', process.env.SITE_NAME || 'zhixu-note');
const ZIP = path.resolve(ROOT, arg('zip', 'zhixu-web.zip'));
const DRY = process.argv.includes('--dry');

function fail(msg) {
  console.error('\n❌ ' + msg + '\n');
  process.exit(1);
}

if (!TOKEN) {
  fail('缺少 NETLIFY_AUTH_TOKEN。先设环境变量：$env:NETLIFY_AUTH_TOKEN = "你的token"');
}
if (!fs.existsSync(ZIP)) {
  fail('找不到压缩包：' + ZIP + '\n先运行：node build.js --clean 然后 Compress-Archive -Path "dist\\*" -DestinationPath "zhixu-web.zip" -Force');
}

function request(method, urlPath, opts) {
  opts = opts || {};
  return new Promise(function (resolve, reject) {
    const req = https.request({
      hostname: 'api.netlify.com',
      port: 443,
      path: '/api/v1' + urlPath,
      method: method,
      headers: Object.assign({ Authorization: 'Bearer ' + TOKEN }, opts.headers || {})
    }, function (res) {
      const chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () {
        const body = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = body ? JSON.parse(body) : null; } catch (e) { /* 非 JSON */ }
        resolve({ status: res.statusCode, json: json, body: body });
      });
    });
    req.on('error', reject);
    req.setTimeout(60000, function () { req.destroy(new Error('请求超时')); });
    if (opts.stream) opts.stream.pipe(req);
    else { if (opts.body) req.write(opts.body); req.end(); }
  });
}

(async function main() {
  console.log('\n知序 · Netlify 自动部署');
  console.log('─'.repeat(48));
  console.log('站点名  : ' + SITE_NAME);
  console.log('压缩包  : ' + ZIP + '（' + (fs.statSync(ZIP).size / 1024).toFixed(1) + ' KB）');
  console.log('Token   : ' + TOKEN.slice(0, 6) + '…' + TOKEN.slice(-4));

  // 1) 找站点
  let site = null;
  const found = await request('GET', '/sites?name=' + encodeURIComponent(SITE_NAME));
  if (found.status === 200 && Array.isArray(found.json) && found.json.length) {
    site = found.json[0];
    console.log('\n✓ 找到已有站点：' + site.name + ' → ' + site.ssl_url);
  } else if (found.status === 401) {
    fail('Token 无效或已过期（401）');
  } else {
    console.log('\n· 没有同名站点，准备创建…');
    const created = await request('POST', '/sites', {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: SITE_NAME })
    });
    if (created.status >= 200 && created.status < 300 && created.json) {
      site = created.json;
      console.log('✓ 已创建站点：' + site.name + ' → ' + site.ssl_url);
    } else {
      fail('创建站点失败（HTTP ' + created.status + '）：' + String(created.body).slice(0, 200));
    }
  }

  if (DRY) {
    console.log('\n✅ --dry：检查通过，未上传。去掉 --dry 即可真正部署。\n');
    return;
  }

  // 2) 上传 zip（Netlify API：POST /sites/:id/deploys，body 为 zip 二进制）
  console.log('\n· 正在上传…');
  const stream = fs.createReadStream(ZIP);
  const deployRes = await request('POST', '/sites/' + site.id + '/deploys', {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Length': fs.statSync(ZIP).size
    },
    stream: stream
  });

  if (deployRes.status < 200 || deployRes.status >= 300 || !deployRes.json) {
    fail('上传失败（HTTP ' + deployRes.status + '）：' + String(deployRes.body).slice(0, 300));
  }
  const deploy = deployRes.json;
  console.log('✓ 已提交，deploy id：' + deploy.id + '，状态：' + deploy.state);

  // 3) 轮询状态
  const started = Date.now();
  let state = deploy.state;
  while (state !== 'ready' && state !== 'error' && Date.now() - started < 120000) {
    await new Promise(function (r) { setTimeout(r, 2500); });
    const cur = await request('GET', '/deploys/' + deploy.id);
    if (cur.json && cur.json.state) state = cur.json.state;
    process.stdout.write('  · ' + state + '\r');
  }

  console.log('\n');
  if (state === 'ready') {
    console.log('✅ 部署成功');
    console.log('   地址：' + (site.ssl_url || ('https://' + site.name + '.netlify.app')));
    console.log('   后台：https://app.netlify.com/projects/' + site.name);
    console.log('\n如果浏览器缓存了旧版本，强制刷新（Ctrl+F5）或换无痕窗口看。\n');
  } else if (state === 'error') {
    fail('部署失败，去后台看构建日志：https://app.netlify.com/projects/' + site.name + '/deploys');
  } else {
    fail('等待超时（最后状态：' + state + '），去后台确认：https://app.netlify.com/projects/' + site.name + '/deploys');
  }
})().catch(function (e) {
  fail(String((e && e.message) || e));
});
