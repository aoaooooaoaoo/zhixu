/**
 * 本地文件存储，兼容 @netlify/blobs 的最小 API（给 functions/auth.js、sync.js 用）
 * 数据落在 <项目根>/data/ 下
 */
const fs = require('node:fs');
const path = require('node:path');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function storeDir(name) {
  const d = path.join(DATA_DIR, String(name || 'default'));
  ensureDir(d);
  return d;
}

function keyToFile(dir, key) {
  const safe = Buffer.from(String(key)).toString('base64url');
  return path.join(dir, safe + '.json');
}

function makeStore(name) {
  const dir = storeDir(name);
  return {
    async get(key, opts) {
      const file = keyToFile(dir, key);
      if (!fs.existsSync(file)) return null;
      const raw = fs.readFileSync(file, 'utf8');
      if (opts && opts.type === 'json') return JSON.parse(raw);
      return raw;
    },
    async getWithMetadata(key, opts) {
      const value = await this.get(key, opts);
      return { value, metadata: value ? {} : null };
    },
    async getMetadata(key) {
      const file = keyToFile(dir, key);
      if (!fs.existsSync(file)) return null;
      const st = fs.statSync(file);
      return { etag: String(st.mtimeMs), metadata: {} };
    },
    async set(key, value) {
      ensureDir(dir);
      fs.writeFileSync(keyToFile(dir, key), String(value), 'utf8');
      return { modified: true, etag: String(Date.now()) };
    },
    async setJSON(key, value) {
      return this.set(key, JSON.stringify(value));
    },
    async delete(key) {
      const file = keyToFile(dir, key);
      if (fs.existsSync(file)) fs.unlinkSync(file);
      return { modified: true };
    },
    async list(opts) {
      const prefix = (opts && opts.prefix) || '';
      const files = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
      const blobs = files
        .filter((f) => f.endsWith('.json'))
        .map((f) => ({ key: Buffer.from(f.slice(0, -5), 'base64url').toString() }))
        .filter((b) => b.key.startsWith(prefix));
      return { blobs };
    }
  };
}

function getStore(opts) {
  const name = typeof opts === 'string' ? opts : (opts && opts.name) || 'default';
  return makeStore(name);
}

module.exports = { getStore };
