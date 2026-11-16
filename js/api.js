/**
 * api.js — Open Food Facts 客户端 + 离线缓存
 *
 * 为什么选 Open Food Facts：
 *  - 开放食品数据库，无需注册、无需 API key（课程示例里的 OpenWeather 需要 key，演示当天配置失误就白屏）
 *  - 数据以 Open Database License 发布，许可合规
 *
 * 缓存策略（离线能力的核心，报告里要讲）：
 *  - 命中缓存且未过期 → 立即返回缓存，同时后台静默刷新（stale-while-revalidate）
 *  - 网络失败 → 退回任意旧缓存，标记 stale
 *  - 完全无缓存且无网络 → 返回明确错误，UI 提示离线
 */

import { get, put } from './db.js';

const API_BASE = 'https://world.openfoodfacts.org/api/v2/product';
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 天
const FIELDS = [
  'code',
  'product_name',
  'product_name_en',
  'brands',
  'quantity',
  'image_front_small_url',
  'image_front_url',
  'allergens_tags',
  'traces_tags',
  'ingredients_text',
  'ingredients_text_en',
  'ingredients_analysis_tags',
  'nutriscore_grade',
  'nutriscore_score',
  'nova_group',
  'additives_tags',
  'categories_tags',
  'labels_tags',
].join(',');

/** 测试与调试用：允许重写 base（例如换成 mock） */
export let apiBase = API_BASE;
export function setApiBase(base) {
  apiBase = base;
}

function normalizeProduct(raw) {
  if (!raw) return null;
  return {
    barcode: raw.code || '',
    name: raw.product_name_en || raw.product_name || '',
    brands: raw.brands || '',
    quantity: raw.quantity || '',
    image: raw.image_front_url || raw.image_front_small_url || '',
    allergensTags: raw.allergens_tags || [],
    tracesTags: raw.traces_tags || [],
    ingredientsText: raw.ingredients_text_en || raw.ingredients_text || '',
    analysisTags: raw.ingredients_analysis_tags || [],
    nutriscoreGrade: raw.nutriscore_grade || '',
    novaGroup: raw.nova_group || null,
    additives: raw.additives_tags || [],
    categories: raw.categories_tags || [],
    labels: raw.labels_tags || [],
  };
}

/** 把内部商品结构转回 logic.assessProduct 需要的字段名 */
export function toAssessmentInput(product) {
  if (!product) return null;
  return {
    allergens_tags: product.allergensTags,
    traces_tags: product.tracesTags,
    ingredients_text: product.ingredientsText,
    ingredients_analysis_tags: product.analysisTags,
  };
}

async function readCache(barcode) {
  try {
    return await get('cache', barcode);
  } catch {
    return null;
  }
}

async function writeCache(barcode, product) {
  try {
    await put('cache', { barcode, product, fetchedAt: Date.now() });
  } catch {
    /* 缓存失败不影响主流程 */
  }
}

/**
 * 查询商品。
 * @param {string} barcode 规范化后的 EAN-13
 * @param {{force?: boolean, timeoutMs?: number}} options
 * @returns {Promise<{status:'ok'|'not-found'|'offline'|'error', product:object|null, source:'network'|'cache'|'none', stale:boolean, fetchedAt?:number, message?:string}>}
 */
export async function fetchProduct(barcode, options = {}) {
  const { force = false, timeoutMs = 9000 } = options;
  const cached = await readCache(barcode);
  const fresh = cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS;

  if (cached && fresh && !force) {
    // 后台静默刷新，不阻塞 UI
    void refreshInBackground(barcode, timeoutMs);
    return { status: 'ok', product: cached.product, source: 'cache', stale: false, fetchedAt: cached.fetchedAt };
  }

  try {
    const product = await request(barcode, timeoutMs);
    if (!product) {
      return { status: 'not-found', product: null, source: 'network', stale: false };
    }
    await writeCache(barcode, product);
    return { status: 'ok', product, source: 'network', stale: false, fetchedAt: Date.now() };
  } catch (err) {
    if (cached) {
      return {
        status: 'ok',
        product: cached.product,
        source: 'cache',
        stale: true,
        fetchedAt: cached.fetchedAt,
        message: 'Showing saved data — you appear to be offline.',
      };
    }
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    return {
      status: offline ? 'offline' : 'error',
      product: null,
      source: 'none',
      stale: false,
      message: offline
        ? 'No connection and this product is not saved on this device yet.'
        : `Could not reach Open Food Facts (${err.message}).`,
    };
  }
}

async function refreshInBackground(barcode, timeoutMs) {
  try {
    const product = await request(barcode, timeoutMs);
    if (product) await writeCache(barcode, product);
  } catch {
    /* 静默失败，保留旧缓存 */
  }
}

async function request(barcode, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const url = `${apiBase}/${encodeURIComponent(barcode)}.json?fields=${FIELDS}`;
    const res = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.status === 0 || !data.product) return null;
    return normalizeProduct(data.product);
  } finally {
    clearTimeout(timer);
  }
}

/** 打包归档用：把某个条码的缓存清掉（调试/测试用） */
export async function forgetProduct(barcode) {
  const { del } = await import('./db.js');
  await del('cache', barcode);
}
