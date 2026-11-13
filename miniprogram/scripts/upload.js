#!/usr/bin/env node
/**
 * 知序小程序 · 一键上传 / 生成预览码（走官方 miniprogram-ci，不需要开界面）
 *
 * 准备（只做一次）：
 *   1) 公众平台 → 开发管理 → 开发设置 → 小程序代码上传 → 生成密钥并下载 private.wxXXXX.key
 *   2) cd 到本目录，安装 CI 工具：  npm i miniprogram-ci --no-save
 *
 * 用法：
 *   node scripts/upload.js --version 1.0.0 --desc "首个版本"            # 上传开发版
 *   node scripts/upload.js --key C:\path\private.wx123.key --preview    # 生成预览二维码
 *   node scripts/upload.js --dry                                        # 只检查参数和文件
 *
 * 参数都可走环境变量：WX_APPID / WX_PRIVATE_KEY / WX_VERSION / WX_DESC / WX_ROBOT
 * 不传 --key 时会自动在本目录及上一级找 private.wx*.key。
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--appid') out.appid = argv[++i];
    else if (a === '--key') out.key = argv[++i];
    else if (a === '--version') out.version = argv[++i];
    else if (a === '--desc') out.desc = argv[++i];
    else if (a === '--robot') out.robot = Number(argv[++i]);
    else if (a === '--preview') out.preview = true;
    else if (a === '--qrcode') out.qrcode = argv[++i];
    else if (a === '--page') out.page = argv[++i];
    else if (a === '--dry') out.dry = true;
    else if (a === '--help' || a === '-h') out.help = true;
  }
  return out;
}

function findKey(dir) {
  try {
    const hit = fs.readdirSync(dir).filter(f => /^private\.wx[0-9a-f]+\.key$/i.test(f));
    if (hit.length) return path.join(dir, hit[0]);
  } catch (e) { /* ignore */ }
  return '';
}

function readAppidFromProject() {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, 'project.config.json'), 'utf8')).appid || '';
  } catch (e) {
    return '';
  }
}

function fail(msg, hint) {
  console.error('\n❌ ' + msg);
  if (hint) console.error('   → ' + hint);
  console.error('');
  process.exit(1);
}

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  console.log([
    '知序小程序 · 上传 / 预览',
    '',
    '  node scripts/upload.js --version 1.0.0 --desc "首个版本"',
    '  node scripts/upload.js --preview',
    '  node scripts/upload.js --dry',
    '',
    '必填（或用环境变量）：',
    '  --appid   小程序 AppID（不传则读 project.config.json）',
    '  --key     代码上传密钥路径 private.wxXXXX.key',
    '  版本号默认 1.0.0；--desc 默认「知序」',
    '  --robot   1–30，多机器人并发时用，默认 1',
    '  --page    预览小程序启动页，例如 pages/collect/index'
  ].join('\n'));
  process.exit(0);
}

const appid = args.appid || process.env.WX_APPID || readAppidFromProject();
if (!appid || appid === 'touristappid') {
  fail('还没有可用的 AppID（当前：' + (appid || '空') + '）',
    '先去注册小程序，然后运行：node scripts/setup.js --appid wx你的AppID');
}

const keyPath = args.key || process.env.WX_PRIVATE_KEY || findKey(ROOT) || findKey(path.dirname(ROOT));
if (!keyPath) {
  fail('找不到代码上传密钥 private.wxXXXX.key',
    '公众平台 → 开发管理 → 开发设置 → 小程序代码上传 → 生成并下载密钥，然后用 --key 指定路径');
}
if (!fs.existsSync(keyPath)) fail('密钥文件不存在：' + keyPath);

const version = args.version || process.env.WX_VERSION || '1.0.0';
if (!/^\d+\.\d+\.\d+$/.test(version)) fail('版本号要写成 1.0.0 这种三段式，当前：' + version);

const desc = args.desc || process.env.WX_DESC || '知序 · 把刷到的碎片理成知识';
if (desc.length > 32) fail('版本描述最多 32 个字，当前 ' + desc.length + ' 个');

const robot = Number.isFinite(args.robot) ? Math.min(30, Math.max(1, args.robot)) : Number(process.env.WX_ROBOT || 1);

console.log('\n知序小程序 · ' + (args.preview ? '生成预览码' : '上传开发版'));
console.log('─'.repeat(46));
console.log('AppID   : ' + appid);
console.log('版本号  : ' + version);
console.log('描述    : ' + desc);
console.log('密钥    : ' + keyPath);
console.log('机器人  : ' + robot);
console.log('项目    : ' + ROOT);
console.log('─'.repeat(46));

if (args.dry) {
  console.log('\n✅ 参数检查通过（--dry 模式，没有真正上传）');
  console.log('去掉 --dry 即可执行。\n');
  process.exit(0);
}

let ci;
try {
  ci = require('miniprogram-ci');
} catch (e) {
  fail('还没安装 miniprogram-ci',
    'cd "' + ROOT + '"; npm i miniprogram-ci --no-save');
}

const project = new ci.Project({
  appid: appid,
  type: 'miniProgram',
  projectPath: ROOT,
  privateKeyPath: keyPath,
  ignores: ['node_modules/**/*', 'scripts/**/*', '*.md', 'preview*.png', '*.bak-*']
});

const setting = {
  es6: true,
  es7: true,
  minify: true,
  autoPrefixWXSS: true,
  codeProtect: false
};

function onProgress(task) {
  if (task && task.message) console.log('  · ' + task.message);
}

(async function () {
  try {
    if (args.preview) {
      const qrcodeOutputDest = args.qrcode || path.join(ROOT, 'preview-' + version + '.png');
      console.log('\n正在生成预览二维码…');
      const result = await ci.preview({
        project: project,
        desc: desc,
        version: version,
        setting: setting,
        robot: robot,
        qrcodeFormat: 'image',
        qrcodeOutputDest: qrcodeOutputDest,
        pagePath: args.page || '',
        onProgressUpdate: onProgress
      });
      console.log('\n✅ 预览码已生成：' + qrcodeOutputDest);
      console.log('用微信扫码即可在真机上打开（需该微信号是小程序开发者/体验者）。');
      if (result && result.subPackageInfo) console.log('分包信息：' + JSON.stringify(result.subPackageInfo));
      console.log('');
    } else {
      console.log('\n正在上传…');
      const result = await ci.upload({
        project: project,
        version: version,
        desc: desc,
        setting: setting,
        robot: robot,
        onProgressUpdate: onProgress
      });
      console.log('\n✅ 上传成功' + (result && result.subPackageInfo ? '：' + JSON.stringify(result.subPackageInfo) : ''));
      console.log('下一步：微信公众平台 → 版本管理 → 开发版本 → 「提交审核」');
      console.log('       审核通过后点「发布」即正式上线。');
      console.log('');
    }
  } catch (err) {
    const msg = String((err && err.message) || err);
    console.error('\n❌ 失败：' + msg);
    if (/ip|whitelist|白名单/i.test(msg)) {
      console.error('   → 大概率是「代码上传密钥 IP 白名单」限制：公众平台 → 开发管理 → 开发设置 → 关闭白名单或加入本机公网 IP');
    } else if (/privateKey|key|RSA|decrypt/i.test(msg)) {
      console.error('   → 密钥文件不对或已失效：重新生成 private.wxXXXX.key 后再试');
    } else if (/appid|permission|no permission/i.test(msg)) {
      console.error('   → 当前微信号没有这个 AppID 的上传权限，确认是管理员/开发者身份');
    } else {
      console.error('   → 先跑 node scripts/doctor.js 排查项目本身的问题');
    }
    console.error('');
    process.exit(1);
  }
})();
