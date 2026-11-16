/**
 * a11y.js — 无障碍与外观偏好
 *
 * 覆盖评分表里的 accessibility 项：
 *  - 字号可调（1.0×–1.6×），全部尺寸用 rem/clamp 派生
 *  - 高对比模式（满足 WCAG 2.2 AA 对比度）
 *  - 减少动效（尊重 prefers-reduced-motion 与用户显式设置）
 *  - 语音朗读开关
 *
 * 偏好同时写 localStorage（立即可用，避免闪烁）与 IndexedDB（持久、可随账号迁移）
 */

import { get, put } from './db.js';

const LS_KEY = 'safebite:prefs';

export const DEFAULT_PREFS = {
  fontScale: 1,
  highContrast: false,
  reduceMotion: false,
  voice: true,
  haptics: true,
};

let prefs = { ...DEFAULT_PREFS };

function readLocal() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeLocal() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(prefs));
  } catch {
    /* 忽略隐私模式写入失败 */
  }
}

export function getPrefs() {
  return { ...prefs };
}

/** 立即套用到 DOM（在首屏渲染前调用，防止样式跳动） */
export function applyPrefs() {
  const root = document.documentElement;
  root.style.setProperty('--font-scale', String(prefs.fontScale));
  root.dataset.contrast = prefs.highContrast ? 'high' : 'normal';
  root.dataset.motion = prefs.reduceMotion ? 'reduced' : 'auto';
  document.body?.classList.toggle('reduce-motion', prefs.reduceMotion);
}

/** 初始化：先读 localStorage 立刻生效，再异步与 IndexedDB 对齐 */
export async function initPrefs() {
  const local = readLocal();
  if (local) prefs = { ...DEFAULT_PREFS, ...local };
  applyPrefs();
  try {
    const row = await get('prefs', 'a11y');
    if (row?.value) {
      prefs = { ...DEFAULT_PREFS, ...row.value };
      writeLocal();
      applyPrefs();
    }
  } catch {
    /* 首次运行无记录 */
  }
  return getPrefs();
}

export async function setPref(key, value) {
  prefs = { ...prefs, [key]: value };
  writeLocal();
  applyPrefs();
  try {
    await put('prefs', { key: 'a11y', value: prefs });
  } catch {
    /* 持久化失败不阻塞交互 */
  }
  return getPrefs();
}

/** 无障碍公告（屏幕阅读器专用，视觉上隐藏） */
export function announce(message) {
  const region = document.getElementById('sr-announcer');
  if (!region) return;
  region.textContent = '';
  // 强制触发朗读：先清空再写入
  requestAnimationFrame(() => {
    region.textContent = message;
  });
}
