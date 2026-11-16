/**
 * cdp-shot.mjs — 打开指定路由并截图（可注入合成商品，用于验证界面路径）
 *
 * 用法：
 *   node tools/cdp-shot.mjs <端口> "<hash>" <输出png> [--synthetic]
 *
 * --synthetic 会把一条「数据库漏填 allergens_tags、但配料表写了 milk powder」的
 * 合成商品写入 IndexedDB 缓存，然后打开 #/product/0000000000000 查看界面表现。
 * 用真实条码找不到这种"漏填"的条目，所以用注入的方式验证降级路径。
 */

import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const PORT = Number(process.argv[2] || 5173);
const HASH = process.argv[3] || '#/scan';
const OUT = path.resolve(process.argv[4] || 'shot.png');
const SYNTHETIC = process.argv.includes('--synthetic');
const CDP_PORT = Number(process.env.CDP_PORT || 9222);
const BASE = `http://localhost:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const target = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.addEventListener('open', res, { once: true });
  ws.addEventListener('error', rej, { once: true });
});

let id = 0;
const pending = new Map();
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m.result);
    pending.delete(m.id);
  }
});
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const myId = ++id;
    pending.set(myId, resolve);
    ws.send(JSON.stringify({ id: myId, method, params }));
  });
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result?.value;
};

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

await send('Page.navigate', { url: BASE + '/index.html' });
await sleep(1500);

if (SYNTHETIC) {
  const injected = await evaluate(`
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
        allergensTags: [],              // 关键：故意不填过敏原声明
        tracesTags: [],
        ingredientsText: 'Sugar, wheat flour, milk powder, cocoa butter, emulsifier (soya lecithin)',
        analysisTags: ['en:vegetarian'],
        nutriscoreGrade: 'd',
        novaGroup: 4,
        additives: ['en:e322'],
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
  console.log('合成商品已注入缓存:', injected);
}

await evaluate(`location.hash = ${JSON.stringify(HASH)}; true`);
await sleep(2200);

const summary = await evaluate(`
  (() => ({
    hash: location.hash,
    verdict: document.querySelector('.verdict-label')?.textContent || null,
    findings: [...document.querySelectorAll('.finding .card-title')].map((t) => t.textContent),
    detail: [...document.querySelectorAll('.finding-list li')].map((li) => li.textContent),
    source: document.querySelector('.source-note')?.textContent || null,
  }))()
`);
console.log('页面摘要:', JSON.stringify(summary, null, 2));

await mkdir(path.dirname(OUT), { recursive: true });
const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
await writeFile(OUT, Buffer.from(data, 'base64'));
console.log('截图:', OUT);

ws.close();
await sleep(150);
process.exit(0);
