/**
 * crypto.js — 基于 WebCrypto 的安全层
 *
 * 设计要点（写进报告的安全论述）：
 * 1. 密码从不落盘：只存 PBKDF2-SHA256 派生出的校验值，且加随机盐。
 * 2. 中文/英文密码都支持，先转 UTF-8 字节再派生。
 * 3. 用同一次 PBKDF2 派生 512 bit，前 256 bit 做登录校验，
 *    后 256 bit 作为 AES-GCM 数据密钥 —— 用于加密本机的「健康数据」（忌口档案）。
 *    即使有人拿到 IndexedDB 文件，也读不出用户对什么过敏。
 * 4. 数据密钥以 CryptoKey 形式放在 IndexedDB（不可导出 extractable=false），
 *    页面脚本无法读出原始字节。
 */

const PBKDF2_ITERATIONS = 210_000; // OWASP 对 PBKDF2-SHA256 的下限建议量级
const enc = new TextEncoder();
const dec = new TextDecoder();

export function toB64(buf) {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

export function fromB64(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function randomSalt(bytes = 16) {
  return crypto.getRandomValues(new Uint8Array(bytes));
}

/**
 * 从密码派生「校验值」和「数据密钥」。
 * @returns {Promise<{verifier: string, dataKey: CryptoKey|null}>}
 */
export async function deriveFromPassword(password, saltBytes) {
  const baseKey = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: saltBytes, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    baseKey,
    512
  );
  const view = new Uint8Array(bits);
  const authBits = view.slice(0, 32);
  const dataBits = view.slice(32, 64);

  const dataKey = await crypto.subtle.importKey('raw', dataBits, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  return { verifier: toB64(authBits), dataKey };
}

/** 恒定时间比较，避免时序侧信道 */
export function safeEqual(a, b) {
  const x = String(a);
  const y = String(b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

/** 用 AES-GCM 加密任意 JSON 可序列化对象 */
export async function encryptJSON(key, value) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = enc.encode(JSON.stringify(value));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data);
  return { iv: toB64(iv), ct: toB64(ct) };
}

/** 解密；密钥不对或数据被篡改时抛错 */
export async function decryptJSON(key, payload) {
  if (!payload) return null;
  const iv = fromB64(payload.iv);
  const ct = fromB64(payload.ct);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return JSON.parse(dec.decode(plain));
}

/** 密码强度校验（注册时用，纯前端规则，可在测试里覆盖） */
export function passwordIssues(password) {
  const p = String(password || '');
  const issues = [];
  if (p.length < 8) issues.push('Use at least 8 characters');
  if (!/[a-zA-Z]/.test(p)) issues.push('Include at least one letter');
  if (!/\d/.test(p)) issues.push('Include at least one number');
  return issues;
}
