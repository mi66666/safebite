/**
 * auth.js — 本机账号体系（无后端）
 *
 * 为什么不做 Firebase Auth：课程允许，但 Firebase 需要项目配置与联网，
 * 演示当天配置失误就登录不了。本机认证用 WebCrypto 实现同等强度的密码学保证，
 * 而且报告里可以写清「凭据永不离开设备」这条隐私优势。
 */

import { get, put, del } from './db.js';
import { randomSalt, deriveFromPassword, safeEqual, toB64, fromB64, passwordIssues, encryptJSON, decryptJSON } from './crypto.js';

const SESSION_KEY = 'active';
const LAST_EMAIL_KEY = 'safebite:lastEmail';

export function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(email || '').trim());
}

export function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

export class AuthError extends Error {
  constructor(message, code = 'auth') {
    super(message);
    this.code = code;
  }
}

/** 注册：只保存加盐派生值，不保存密码 */
export async function register(email, password) {
  const mail = normalizeEmail(email);
  if (!isValidEmail(mail)) throw new AuthError('Please enter a valid email address.', 'email');
  const issues = passwordIssues(password);
  if (issues.length) throw new AuthError(issues.join('. ') + '.', 'password');

  const existing = await get('users', mail);
  if (existing) throw new AuthError('An account with this email already exists on this device.', 'duplicate');

  const salt = randomSalt(16);
  const { verifier, dataKey } = await deriveFromPassword(password, salt);
  await put('users', { email: mail, saltB64: toB64(salt), verifierB64: verifier, createdAt: Date.now() });
  await startSession(mail, dataKey);
  return { email: mail };
}

/** 登录：重新派生并做恒定时间比较 */
export async function login(email, password) {
  const mail = normalizeEmail(email);
  const user = await get('users', mail);
  if (!user) throw new AuthError('No account found with that email on this device.', 'not-found');

  const { verifier, dataKey } = await deriveFromPassword(password, fromB64(user.saltB64));
  if (!safeEqual(verifier, user.verifierB64)) {
    throw new AuthError('Incorrect password.', 'bad-password');
  }
  await startSession(mail, dataKey);
  return { email: mail };
}

async function startSession(email, dataKey) {
  await put('session', { key: SESSION_KEY, email, dataKey, startedAt: Date.now() });
  try {
    localStorage.setItem(LAST_EMAIL_KEY, email);
  } catch {
    /* 隐私模式下可能不可用 */
  }
}

/** 当前会话；无会话返回 null */
export async function currentUser() {
  const session = await get('session', SESSION_KEY);
  if (!session || !session.dataKey) return null;
  return session;
}

export async function logout() {
  await del('session');
}

export function lastEmail() {
  try {
    return localStorage.getItem(LAST_EMAIL_KEY) || '';
  } catch {
    return '';
  }
}

/** 读取并解密忌口档案（健康数据，加密存放） */
export async function loadProfile(session) {
  if (!session) return null;
  const row = await get('profile', session.email);
  if (!row || !row.enc) return null;
  try {
    return await decryptJSON(session.dataKey, row.enc);
  } catch {
    // 密钥不匹配（例如数据被篡改） → 视为无档案，避免崩溃
    return null;
  }
}

/** 加密保存忌口档案 */
export async function saveProfile(session, profile) {
  if (!session) throw new AuthError('Not signed in.', 'no-session');
  const enc = await encryptJSON(session.dataKey, profile);
  await put('profile', { email: session.email, enc, updatedAt: Date.now() });
}

/** 彻底删除本机账号与其全部数据（GDPR「被遗忘权」的落地） */
export async function deleteAccount(session) {
  if (!session) return;
  const { getAllByIndex } = await import('./db.js');
  const scans = await getAllByIndex('scans', 'byEmail', session.email);
  await Promise.all(scans.map((s) => del('scans', s.id)));
  await del('profile', session.email);
  await del('users', session.email);
  await del('session', SESSION_KEY);
}
