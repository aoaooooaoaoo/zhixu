/** 账号相关加密：SHA-256 / PBKDF2（Workers 无 Node crypto，用 WebCrypto） */

const enc = new TextEncoder();

function hex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function sha256Hex(text) {
  const d = await crypto.subtle.digest('SHA-256', enc.encode(String(text)));
  return hex(d);
}

export function randomHex(bytes) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return hex(arr.buffer);
}

/** PBKDF2-HMAC-SHA256，迭代 10 万次；返回 hex */
export async function hashPassword(password, salt) {
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(String(password)), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: enc.encode(String(salt)), iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    256
  );
  return hex(bits);
}

export function timingSafeEqual(a, b) {
  const x = String(a || '');
  const y = String(b || '');
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}
