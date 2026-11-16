/**
 * perf-check.mjs — 性能测量（真实测量，不是估计）
 *
 * 方法：
 *  - 用 CPU 降速 4× + Fast 3G 限速（1.6 Mbps 下行 / 150 ms 延迟）模拟中端手机与弱网
 *  - 冷启动：清空全部站点数据（无 Service Worker、无缓存）
 *  - 暖启动：Service Worker 已接管，资源从缓存返回
 *  - 采集：TTFB、首次内容绘制(FCP)、DOMContentLoaded、load、传输字节、资源数、
 *          DOM 节点数、JS 堆大小、布局次数
 *
 * 用法：node tools/perf-check.mjs [端口] [输出md]
 */

import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const PORT = Number(process.argv[2] || 5173);
const OUT = path.resolve(process.argv[3] || 'docs/Performance_Report.md');
const CDP_PORT = Number(process.env.CDP_PORT || 9222);
const BASE = `http://localhost:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const THROTTLE = {
  offline: false,
  latency: 150,
  downloadThroughput: (1.6 * 1024 * 1024) / 8, // Fast 3G
  uploadThroughput: (750 * 1024) / 8,
};
const CPU_RATE = 4;

async function json(url, method = 'GET') {
  const res = await fetch(url, { method });
  return JSON.parse(await res.text());
}

const target = await json(`http://127.0.0.1:${CDP_PORT}/json/new?about:blank`, 'PUT');
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.addEventListener('open', res, { once: true });
  ws.addEventListener('error', rej, { once: true });
});

let id = 0;
const pending = new Map();
const byType = new Map();
let bytesTotal = 0;
let requestCount = 0;

ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m.result);
    pending.delete(m.id);
    return;
  }
  if (m.method === 'Network.responseReceived') {
    byType.set(m.params.requestId, m.params.type);
  }
  if (m.method === 'Network.loadingFinished') {
    const type = byType.get(m.params.requestId) || 'Other';
    bytesTotal += m.params.encodedDataLength || 0;
    requestCount += 1;
  }
});

const send = (method, params = {}) =>
  new Promise((resolve) => {
    const myId = ++id;
    pending.set(myId, resolve);
    ws.send(JSON.stringify({ id: myId, method, params }));
  });

const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result?.value;
};

await send('Page.enable');
await send('Runtime.enable');
await send('Network.enable');
await send('Performance.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await send('Emulation.setCPUThrottlingRate', { rate: CPU_RATE });
await send('Network.emulateNetworkConditions', THROTTLE);

async function measure(label) {
  bytesTotal = 0;
  requestCount = 0;
  byType.clear();

  await send('Page.navigate', { url: BASE + '/index.html' });
  // 等 load 事件后再留一段空闲，让首屏渲染与字体稳定
  for (let i = 0; i < 100; i++) {
    const ready = await evaluate("document.readyState === 'complete'").catch(() => false);
    if (ready) break;
    await sleep(100);
  }
  await sleep(900);

  const nav = await evaluate(`
    (() => {
      const n = performance.getEntriesByType('navigation')[0] || {};
      const paints = Object.fromEntries(performance.getEntriesByType('paint').map((p) => [p.name, Math.round(p.startTime)]));
      const res = performance.getEntriesByType('resource') || [];
      return {
        ttfb: Math.round(n.responseStart || 0),
        domContentLoaded: Math.round(n.domContentLoadedEventEnd || 0),
        load: Math.round(n.loadEventEnd || 0),
        firstPaint: paints['first-paint'] ?? null,
        firstContentfulPaint: paints['first-contentful-paint'] ?? null,
        resourceEntries: res.length,
        transferBytes: res.reduce((sum, r) => sum + (r.transferSize || 0), 0),
      };
    })()
  `);

  const metrics = await evaluate(`
    (() => ({
      domNodes: document.getElementsByTagName('*').length,
      hasAppContent: Boolean(document.querySelector('main#view')),
    }))()
  `);

  const perfMetrics = await send('Performance.getMetrics');
  const metric = (name) => {
    const found = perfMetrics.metrics.find((m) => m.name === name);
    return found ? found.value : null;
  };

  return {
    label,
    ttfb: nav.ttfb,
    fcp: nav.firstContentfulPaint,
    domContentLoaded: nav.domContentLoaded,
    load: nav.load,
    requests: requestCount || nav.resourceEntries,
    kb: Math.round((bytesTotal || nav.transferBytes) / 1024),
    domNodes: metrics.domNodes,
    jsHeapMb: Number(((metric('JSHeapUsedSize') || 0) / 1048576).toFixed(2)),
    layouts: metric('LayoutCount'),
    appRendered: metrics.hasAppContent,
  };
}

// ---- 冷启动：清空一切 ----
await send('Page.navigate', { url: BASE + '/index.html' });
await sleep(600);
await send('Storage.clearDataForOrigin', { origin: `http://localhost:${PORT}`, storageTypes: 'all' });
await sleep(300);
const cold = await measure('cold (no cache, no service worker)');

// ---- 暖启动：Service Worker 已接管 ----
const swState = await evaluate(`
  (async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    return { registered: Boolean(reg), active: reg?.active?.state || null };
  })()
`);
const warm = await measure('warm (service worker active)');

await send('Emulation.setCPUThrottlingRate', { rate: 1 });
await send('Network.emulateNetworkConditions', {
  offline: false,
  latency: 0,
  downloadThroughput: -1,
  uploadThroughput: -1,
});

const rows = [cold, warm];
const md = [];
md.push('# SafeBite — Performance Measurements');
md.push('');
md.push('Generated by `tools/perf-check.mjs`. Measurements are taken over the Chrome DevTools');
md.push('Protocol with **4× CPU throttling** and **Fast 3G** network emulation (1.6 Mbps down,');
md.push('150 ms latency) at a 390 × 844 device viewport — deliberately pessimistic, to approximate');
md.push('a mid-range Android phone on a bad campus connection rather than a desktop.');
md.push('');
md.push('| Metric | Cold start (no cache, no service worker) | Warm start (service worker active) |');
md.push('|---|---|---|');
md.push(`| Time to first byte | ${cold.ttfb} ms | ${warm.ttfb} ms |`);
md.push(`| First contentful paint | ${cold.fcp ?? '—'} ms | ${warm.fcp ?? '—'} ms |`);
md.push(`| DOMContentLoaded | ${cold.domContentLoaded} ms | ${warm.domContentLoaded} ms |`);
md.push(`| Load event | ${cold.load} ms | ${warm.load} ms |`);
md.push(`| Requests | ${cold.requests} | ${warm.requests} |`);
md.push(`| Transferred | ${cold.kb} KB | ${warm.kb} KB |`);
md.push(`| DOM nodes | ${cold.domNodes} | ${warm.domNodes} |`);
md.push(`| JS heap | ${cold.jsHeapMb} MB | ${warm.jsHeapMb} MB |`);
md.push(`| Layouts during load | ${cold.layouts} | ${warm.layouts} |`);
md.push('');
md.push(`Service worker state when the warm measurement ran: **${swState.active || (swState.registered ? 'registered' : 'none')}**.`);
md.push('');
md.push('## Why this is fast enough to demo');
md.push('');
md.push('- **No framework, no build step.** Total application code is a few tens of KB of plain');
md.push('  ES modules; there is no bundle to parse and no hydration step.');
md.push('- **The shell is precached.** On any repeat launch the HTML, CSS, JS and icons come from the');
md.push('  service worker cache, so the app paints without touching the network — this is the');
md.push('  difference between the two columns above and the reason a basement seminar room works.');
md.push('- **Product images are lazy-loaded** and fall back to an inline SVG placeholder, so a slow or');
md.push('  failing image cannot block or shift the verdict, which is the part the user needs.');
md.push('- **API responses are cached in IndexedDB** with a seven-day TTL, and a cached product is');
md.push('  served immediately while the network refresh happens in the background.');
md.push('- **Rendering is plain DOM from the existing page** — no re-render of the whole tree on');
md.push('  interaction, and verdict computation is a synchronous pass over a short list of tags.');
md.push('');
md.push('## Honest limitations');
md.push('');
md.push('- PBKDF2 key derivation (210 000 iterations) runs on the main thread at sign-in and takes');
md.push('  a few hundred milliseconds on a throttled phone; the button label changes to');
md.push('  "Signing in…" so the wait is visible, but moving derivation to a Web Worker would be the');
md.push('  correct next step.');
md.push('- These numbers come from emulation, not from a physical mid-range Android device. The');
md.push('  device test log records real-device behaviour (B-series checks).');
md.push('');

await mkdir(path.dirname(OUT), { recursive: true });
await writeFile(OUT, md.join('\n'), 'utf8');

console.log('冷启动:', JSON.stringify(cold));
console.log('暖启动:', JSON.stringify(warm));
console.log('报告:', OUT);

ws.close();
await sleep(150);
process.exit(0);
