#!/usr/bin/env node
/**
 * 知序小程序 · 一键填配置（带自动备份）
 *
 * 用法：
 *   node scripts/setup.js --list                       # 看当前配置
 *   node scripts/setup.js --appid wx1234567890abcdef  # 填小程序 AppID
 *   node scripts/setup.js --env zhixu-prod-8gxxxxxx    # 开通云开发（自动置 USE_CLOUD=true）
 *   node scripts/setup.js --local                      # 退回纯本地模式
 *   node scripts/setup.js --appid wx... --env zhixu-xxx
 *
 * 所有修改都会先在同目录生成 <文件名>.bak-<时间戳> 备份。
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PROJECT_CONFIG = path.join(ROOT, 'project.config.json');
const MP_CONFIG = path.join(ROOT, 'miniprogram', 'config.js');

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
}

function backup(file) {
  const bak = file + '.bak-' + stamp();
  fs.copyFileSync(file, bak);
  return bak;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function show() {
  const cfg = readJson(PROJECT_CONFIG);
  const src = fs.readFileSync(MP_CONFIG, 'utf8');
  const envM = src.match(/CLOUD_ENV\s*:\s*['"]([^'"]*)['"]/);
  const useM = src.match(/USE_CLOUD\s*:\s*(true|false)/);
  console.log('\n当前配置');
  console.log('─'.repeat(46));
  console.log('AppID       : ' + (cfg.appid || '(空)') + (cfg.appid === 'touristappid' ? '   ← 还是占位值' : ''));
  console.log('云环境 ID   : ' + (envM ? envM[1] || '(空)' : '(读不到)'));
  console.log('启用云开发  : ' + (useM ? useM[1] : '(读不到)'));
  console.log('解释        : ' + (useM && useM[1] === 'true' ? '云函数 AI + 链接读取' : '纯本地：规则提炼 + 本地存储'));
  console.log('─'.repeat(46) + '\n');
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--list') out.list = true;
    else if (a === '--local') out.local = true;
    else if (a === '--appid') out.appid = argv[++i];
    else if (a === '--env') out.env = argv[++i];
    else if (a === '--help' || a === '-h') out.help = true;
  }
  return out;
}

function usage() {
  console.log([
    '知序小程序 · 一键填配置',
    '',
    '  node scripts/setup.js --list                       查看当前配置',
    '  node scripts/setup.js --appid wx1234567890abcdef  填写 AppID',
    '  node scripts/setup.js --env zhixu-prod-8gxxxxxx    开通云开发',
    '  node scripts/setup.js --local                      退回纯本地模式',
    '',
    'AppID 在：微信公众平台 → 开发管理 → 开发设置 → AppID（小程序ID）',
    '云环境在：微信开发者工具 → 顶部「云开发」→ 开通后控制台显示的环境 ID'
  ].join('\n'));
}

const args = parseArgs(process.argv.slice(2));

if (args.help || (!args.list && !args.appid && !args.env && !args.local)) {
  usage();
  show();
  process.exit(0);
}

let changed = 0;

/* ---------- AppID ---------- */
if (args.appid) {
  const appid = String(args.appid).trim();
  if (!/^wx[0-9a-f]{16}$/i.test(appid)) {
    console.error('❌ AppID 格式不对：' + appid + '（应为 wx + 16 位十六进制，共 18 位）');
    process.exit(1);
  }
  const cfg = readJson(PROJECT_CONFIG);
  if (cfg.appid === appid) {
    console.log('· AppID 没变，跳过');
  } else {
    const bak = backup(PROJECT_CONFIG);
    const src = fs.readFileSync(PROJECT_CONFIG, 'utf8');
    const next = src.replace(/("appid"\s*:\s*)"[^"]*"/, '$1"' + appid + '"');
    JSON.parse(next); // 写完前先验证仍是合法 JSON
    fs.writeFileSync(PROJECT_CONFIG, next, 'utf8');
    console.log('✅ AppID 已写入：' + appid + '（备份：' + path.basename(bak) + '）');
    changed++;
  }
}

/* ---------- 云环境 ---------- */
if (args.env) {
  const env = String(args.env).trim();
  if (!/^[a-zA-Z0-9_-]{3,64}$/.test(env)) {
    console.error('❌ 云环境 ID 看起来不对：' + env);
    process.exit(1);
  }
  const bak = backup(MP_CONFIG);
  let src = fs.readFileSync(MP_CONFIG, 'utf8');
  src = src.replace(/(CLOUD_ENV\s*:\s*)['"][^'"]*['"]/, "$1'" + env + "'");
  src = src.replace(/(USE_CLOUD\s*:\s*)(true|false)/, '$1true');
  fs.writeFileSync(MP_CONFIG, src, 'utf8');
  console.log('✅ 云环境已写入：' + env + '，并已置 USE_CLOUD=true（备份：' + path.basename(bak) + '）');
  console.log('   接下来：微信开发者工具 → 右键 cloudfunctions/analyze 等目录 → 上传并部署（云端安装依赖）');
  changed++;
}

/* ---------- 退回本地 ---------- */
if (args.local) {
  const bak = backup(MP_CONFIG);
  let src = fs.readFileSync(MP_CONFIG, 'utf8');
  src = src.replace(/(USE_CLOUD\s*:\s*)(true|false)/, '$1false');
  fs.writeFileSync(MP_CONFIG, src, 'utf8');
  console.log('✅ 已切回纯本地模式（备份：' + path.basename(bak) + '）');
  changed++;
}

if (args.list || changed) show();

if (changed) {
  console.log('下一步建议：node scripts/doctor.js\n');
}
