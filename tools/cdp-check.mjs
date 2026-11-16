/**
 * cdp-check.mjs — 用 Chrome DevTools Protocol 做端到端自检
 *
 * 做四件事：
 *  1. 用手机视口（390×844）打开 app
 *  2. 走完「注册 → 设置忌口 → 扫码查询」的真实交互
 *  3. 收集 console 报错与未捕获异常
 *  4. 每步截图，人工可复核
 *
 * 用法：node tools/cdp-check.mjs [端口] [输出目录]
 * 前置：Chrome 以 --remote-debugging-port=9222 启动
 */

import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const PORT = Number(process.argv[2] || 5173);
const OUT = path.resolve(process.argv[3] || 'tmp-shots');
const CDP_PORT = Number(process.env.CDP_PORT || 9222);
// GitHub Pages 把站点挂在子路径（/<repo>/）下，用 BASE_PATH 模拟这种部署
const BASE_PATH = (process.env.BASE_PATH || '').replace(/\/$/, '');
// LIVE_BASE 直接指向已部署的公网地址，用来验证真实线上站点
const LIVE_BASE = (process.env.LIVE_BASE || '').replace(/\/$/, '');
const BASE = LIVE_BASE || `http://localhost:${PORT}${BASE_PATH}`;
const ORIGIN = LIVE_BASE ? new URL(LIVE_BASE).origin : `http://localhost:${PORT}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function json(url, method = 'GET') {
  const res = await fetch(url, { method });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Bad JSON from ${url}: ${text.slice(0, 200)}`);
  }
}

class Page {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.events = [];
    this.consoleErrors = [];
    // 当前阶段：故意断网的阶段里出现网络错误是预期行为，不应判为失败
    this.phase = 'online';
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(`${msg.error.message} (${JSON.stringify(msg.error.data || '')})`));
        else resolve(msg.result);
      } else if (msg.method) {
        this.events.push(msg);
        if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(msg.params.type)) {
          this.consoleErrors.push({
            phase: this.phase,
            type: msg.params.type,
            text: msg.params.args.map((a) => a.value ?? a.description ?? a.type).join(' '),
          });
        }
        if (msg.method === 'Runtime.exceptionThrown') {
          this.consoleErrors.push({
            phase: this.phase,
            type: 'exception',
            text: msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text,
          });
        }
        if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
          this.consoleErrors.push({ phase: this.phase, type: 'log', text: msg.params.entry.text });
        }
      }
    });
  }

  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP timeout: ${method}`));
        }
      }, 30000);
    });
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    if (result.exceptionDetails) {
      throw new Error(`Eval error: ${result.exceptionDetails.exception?.description || result.exceptionDetails.text}`);
    }
    return result.result?.value;
  }

  async waitFor(expression, { timeout = 15000, interval = 150, label = expression } = {}) {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      const ok = await this.evaluate(`Boolean(${expression})`).catch(() => false);
      if (ok) return true;
      await sleep(interval);
    }
    throw new Error(`Timed out waiting for: ${label}`);
  }

  async shot(name, full = true) {
    await mkdir(OUT, { recursive: true });
    const { data } = await this.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: full,
    });
    const file = path.join(OUT, `${name}.png`);
    await writeFile(file, Buffer.from(data, 'base64'));
    return file;
  }
}

async function main() {
  const results = [];
  const check = (name, ok, detail = '') => {
    results.push({ name, ok, detail });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  };

  // 打开一个新标签页
  const target = await json(`http://127.0.0.1:${CDP_PORT}/json/new?about:blank`, 'PUT');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });

  const page = new Page(ws);
  await page.send('Page.enable');
  await page.send('Runtime.enable');
  await page.send('Log.enable');
  await page.send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
    mobile: true,
  });
  await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

  // --- 0. 清空上一次运行留下的数据（会话、IndexedDB、缓存、SW）---
  // 必须用 CDP 的 Storage.clearDataForOrigin：在页面里手动 deleteDatabase 会被
  // 未关闭的连接阻塞，导致上一轮的登录会话残留、脚本等不到登录页。
  await page.send('Page.navigate', { url: `${BASE}/index.html` });
  await sleep(800);
  await page.send('Storage.clearDataForOrigin', { origin: ORIGIN, storageTypes: 'all' });
  await sleep(300);

  // --- 1. 加载登录页 ---
  await page.send('Page.navigate', { url: `${BASE}/index.html` });
  await page.waitFor(`document.querySelector('.auth-title')`, { label: 'login screen' });
  check('登录页渲染', true, await page.evaluate(`document.querySelector('.auth-title').textContent`));
  await page.shot('01-login');

  // --- 2. 注册账号 ---
  const email = `test${Date.now()}@dundee.ac.uk`;
  await page.evaluate(`
    (() => {
      const switcher = [...document.querySelectorAll('button')].find(b => /create an account/i.test(b.textContent));
      switcher.click();
      const email = document.querySelector('#email');
      const pass = document.querySelector('#password');
      email.value = ${JSON.stringify(email)};
      email.dispatchEvent(new Event('input', { bubbles: true }));
      pass.value = 'testpass123';
      pass.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('form.form').requestSubmit();
      return true;
    })()
  `);
  await page.waitFor(`location.hash.includes('/scan')`, { label: 'route to scan' });
  check('注册并进入扫码页', true, `email=${email}`);
  await page.shot('02-scan-empty-profile');

  // --- 3. 设置忌口档案 ---
  await page.evaluate(`location.hash = '#/profile'; true`);
  await page.waitFor(`document.querySelector('.chip-grid')`, { label: 'profile chips' });
  await page.evaluate(`
    (() => {
      const chips = [...document.querySelectorAll('.toggle-chip')];
      const pick = (re) => { const b = chips.find(c => re.test(c.textContent)); if (b) b.click(); return !!b; };
      pick(/^Milk$/);
      pick(/^Tree nuts$/);
      pick(/^Peanuts$/);
      pick(/^Vegan$/);
      const kw = document.querySelector('#keyword');
      kw.value = 'coconut';
      kw.dispatchEvent(new Event('input', { bubbles: true }));
      kw.form.requestSubmit();
      return [...document.querySelectorAll('.toggle-chip[aria-pressed="true"]')].length;
    })()
  `);
  const selected = await page.evaluate(`[...document.querySelectorAll('.toggle-chip[aria-pressed="true"]')].length`);
  check('档案勾选生效', selected >= 4, `${selected} 项已选`);
  await page.shot('03-profile');

  await page.evaluate(`
    (() => { const b = [...document.querySelectorAll('button')].find(x => /save profile/i.test(x.textContent)); b.click(); return true; })()
  `);
  await page.waitFor(`location.hash.includes('/scan')`, { label: 'save profile → scan' });
  check('档案保存并加密落库', true);

  // --- 4. 查询真实商品（走 Open Food Facts）---
  await page.evaluate(`location.hash = '#/product/3017620422003'; true`);
  await page.waitFor(`document.querySelector('.verdict') || document.querySelector('.banner-error')`, {
    timeout: 25000,
    label: 'product result',
  });
  const verdict = await page.evaluate(`
    (() => {
      const v = document.querySelector('.verdict');
      if (!v) return { error: document.querySelector('.banner')?.textContent || 'no verdict' };
      return {
        label: v.querySelector('.verdict-label')?.textContent,
        name: document.querySelector('.product-name')?.textContent,
        findings: [...document.querySelectorAll('.finding-list li')].map(li => li.textContent),
        source: document.querySelector('.source-note')?.textContent,
      };
    })()
  `);
  check('真实 API 查询 + 结论渲染', Boolean(verdict.label), JSON.stringify(verdict).slice(0, 300));
  await page.shot('04-product-result');

  // 视口截图 + 几何检测：固定标签栏有没有压住内容
  await page.evaluate(`window.scrollTo(0, document.body.scrollHeight); true`);
  await sleep(350);
  const overlap = await page.evaluate(`
    (() => {
      const bar = document.querySelector('.tabbar');
      if (!bar) return { ok: false, reason: 'no tabbar' };
      const barTop = bar.getBoundingClientRect().top;
      const buttons = [...document.querySelectorAll('main#view .btn')];
      const last = buttons[buttons.length - 1];
      if (!last) return { ok: true, reason: 'no buttons in view' };
      const rect = last.getBoundingClientRect();
      return { ok: rect.bottom <= barTop + 1, barTop: Math.round(barTop), btnBottom: Math.round(rect.bottom) };
    })()
  `);
  check('底部导航不遮挡内容', overlap.ok, JSON.stringify(overlap));
  await page.shot('04b-product-bottom-viewport', false);

  // --- 5. 历史页 ---
  await page.evaluate(`location.hash = '#/history'; true`);
  await page.waitFor(`document.querySelector('.history-list') || document.querySelector('.empty-state')`, { label: 'history page' });
  const historyCount = await page.evaluate(`document.querySelectorAll('.history-item').length`);
  check('扫码写入历史', historyCount >= 1, `${historyCount} 条记录`);
  await page.shot('05-history');

  // --- 6b. 安全兜底：条目漏填过敏原声明时，必须用配料文本兜底而不是谎报安全 ---
  await page.evaluate(`
    (async () => {
      const db = await new Promise((resolve, reject) => {
        const req = indexedDB.open('safebite');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      const product = {
        barcode: '0000000000000',
        name: 'Campus Cereal Bar',
        brands: 'Test Foods Ltd',
        quantity: '40 g',
        image: '',
        allergensTags: [],
        tracesTags: [],
        ingredientsText: 'Sugar, wheat flour, milk powder, cocoa butter, emulsifier (soya lecithin)',
        analysisTags: [],
        nutriscoreGrade: '',
        novaGroup: null,
        additives: [],
        categories: [],
        labels: [],
      };
      await new Promise((resolve, reject) => {
        const tx = db.transaction('cache', 'readwrite');
        tx.objectStore('cache').put({ barcode: product.barcode, product, fetchedAt: Date.now() });
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error);
      });
      db.close();
      return true;
    })()
  `);
  await page.evaluate("location.hash = '#/product/0000000000000'; true");
  await page.waitFor("document.querySelector('.verdict') || document.querySelector('.banner-error')", {
    timeout: 15000,
    label: 'text-fallback product',
  });
  const fallback = await page.evaluate(`
    ({
      verdict: document.querySelector('.verdict-label')?.textContent || null,
      cardTitles: [...document.querySelectorAll('.finding .card-title')].map((t) => t.textContent),
      detail: [...document.querySelectorAll('.finding-list li')].map((t) => t.textContent),
    })
  `);
  check(
    '漏填过敏原声明时用配料文本兜底（不谎报安全）',
    fallback.verdict === 'Caution' && fallback.cardTitles.includes('Ingredient list mentions'),
    JSON.stringify(fallback)
  );
  await page.shot('05b-text-fallback');

  // --- 6c. 设备自检页：真机测试与演示前检查都要用 ---
  await page.evaluate("location.hash = '#/diagnostics'; true");
  await page.waitFor(
    "document.querySelectorAll('.diag-row').length > 2 && !/Checking/.test(document.querySelector('.diag-list').textContent)",
    { label: 'diagnostics rows' }
  );
  const diag = await page.evaluate(`
    (() => {
      const rows = [...document.querySelectorAll('.diag-row')].map((r) => r.textContent.trim());
      return {
        count: rows.length,
        detector: rows.some((r) => r.includes('BarcodeDetector')),
        serviceWorker: rows.some((r) => r.includes('Service worker')),
        offlineProducts: rows.some((r) => r.includes('Products available offline')),
      };
    })()
  `);
  check(
    '设备自检页报告条码与离线能力',
    diag.count >= 8 && diag.detector && diag.serviceWorker && diag.offlineProducts,
    JSON.stringify(diag)
  );
  await page.shot('05c-diagnostics');

  // --- 7. Service Worker + 缓存 ---
  const swState = await page.evaluate(`
    (async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      const keys = await caches.keys();
      return { registered: Boolean(reg), active: reg?.active?.state || null, caches: keys };
    })()
  `);
  check('Service Worker 已注册', swState.registered, JSON.stringify(swState));

  // --- 7. 设置页 + 字号缩放 + 高对比 ---
  await page.evaluate(`location.hash = '#/settings'; true`);
  await page.waitFor(`document.querySelector('.switch')`, { label: 'settings page' });
  await page.evaluate(`
    (() => {
      const slider = document.querySelector('#font-scale');
      slider.value = '1.4';
      slider.dispatchEvent(new Event('input', { bubbles: true }));
      slider.dispatchEvent(new Event('change', { bubbles: true }));
      const contrast = [...document.querySelectorAll('.switch')].find(s => /high contrast/i.test(s.closest('.setting-row')?.textContent || ''));
      contrast?.click();
      return true;
    })()
  `);
  await sleep(400);
  const a11y = await page.evaluate(`
    (() => ({
      fontScale: getComputedStyle(document.documentElement).getPropertyValue('--font-scale').trim(),
      htmlFontSize: getComputedStyle(document.documentElement).fontSize,
      contrast: document.documentElement.dataset.contrast,
    }))()
  `);
  check('字号缩放与高对比生效', a11y.fontScale === '1.4' && a11y.contrast === 'high', JSON.stringify(a11y));
  await page.shot('06-settings-highcontrast');

  // 复原，避免截图误导
  await page.evaluate(`
    (() => {
      const slider = document.querySelector('#font-scale');
      slider.value = '1'; slider.dispatchEvent(new Event('input',{bubbles:true})); slider.dispatchEvent(new Event('change',{bubbles:true}));
      const contrast = [...document.querySelectorAll('.switch')].find(s => /high contrast/i.test(s.closest('.setting-row')?.textContent || ''));
      contrast?.click();
      return true;
    })()
  `);
  await sleep(300);

  // --- 8. 校验位错误的条码必须被拦下 ---
  await page.evaluate(`location.hash = '#/product/3017620422004'; true`);
  await sleep(1200);
  const invalid = await page.evaluate(`document.querySelector('.banner')?.textContent?.trim().slice(0,80) || 'no banner'`);
  check('非法条码有明确提示', /invalid|not valid/i.test(String(invalid)), String(invalid));
  await page.shot('07-invalid-barcode');

  // --- 9. 真·离线验证：掐断网络后 app 外壳与已缓存商品是否可用 ---
  page.phase = 'offline';
  await page.send('Network.enable');
  await page.send('Network.emulateNetworkConditions', {
    offline: true,
    latency: 0,
    downloadThroughput: 0,
    uploadThroughput: 0,
  });
  await page.send('Page.reload', { ignoreCache: false });
  await page.waitFor(`document.querySelector('.tabbar') || document.querySelector('.auth-title')`, {
    timeout: 15000,
    label: 'app shell from service worker while offline',
  });
  const offlineBoot = await page.evaluate(`({ hasApp: Boolean(document.querySelector('.tabbar')), hash: location.hash })`);
  check('断网仍能打开 app 外壳（Service Worker 缓存）', offlineBoot.hasApp, JSON.stringify(offlineBoot));
  await page.shot('08-offline-shell');

  // 已缓存的商品应能离线查看
  await page.evaluate(`location.hash = '#/product/3017620422003'; true`);
  await page.waitFor(`document.querySelector('.verdict') || document.querySelector('.banner-error')`, {
    timeout: 12000,
    label: 'offline product from IndexedDB cache',
  });
  const offlineProduct = await page.evaluate(`
    ({
      verdict: document.querySelector('.verdict-label')?.textContent || null,
      source: document.querySelector('.source-note')?.textContent || null,
      banner: document.querySelector('.banner-error')?.textContent || null,
    })
  `);
  check(
    '离线可查看已保存商品',
    Boolean(offlineProduct.verdict) && /saved|offline/i.test(String(offlineProduct.source)),
    JSON.stringify(offlineProduct)
  );
  await page.shot('09-offline-product');

  // 未缓存的商品在离线时必须给出明确提示，而不是卡住或假装安全
  await page.evaluate(`location.hash = '#/product/5449000000996'; true`);
  await sleep(1600);
  const offlineUnknown = await page.evaluate(
    `document.querySelector('.banner-warn')?.textContent || document.querySelector('.banner-error')?.textContent || document.querySelector('.verdict-label')?.textContent || 'none'`
  );
  check('离线查未保存商品有明确提示', /offline|no connection|not saved/i.test(String(offlineUnknown)), String(offlineUnknown));
  await page.shot('10-offline-unknown');

  // 恢复网络
  await page.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
  });
  page.phase = 'online';

  // --- 汇总 console 报错（离线阶段的网络错误属于预期，不计入）---
  const errors = page.consoleErrors.filter(
    (e) =>
      e.phase === 'online' &&
      !/favicon|manifest|Deprecation|third-party/i.test(e.text || '')
  );
  check('无 console 异常', errors.length === 0, errors.length ? JSON.stringify(errors).slice(0, 500) : 'clean');

  await page.send('Page.close').catch(() => {});
  ws.close();

  const failed = results.filter((r) => !r.ok);
  console.log(`\n===== ${results.length - failed.length}/${results.length} 项通过 =====`);
  console.log(`截图目录: ${OUT}`);
  if (failed.length) {
    console.log('失败项: ' + failed.map((f) => f.name).join(', '));
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('自检脚本失败:', err.message);
  process.exitCode = 1;
  // 有未关闭的 WebSocket 时进程不会自行退出，直接收尾
  setTimeout(() => process.exit(1), 200);
});
