/**
 * cdp-dump.mjs — 调试用：打开页面，打印标题、可见文本片段、脚本错误、存储状态
 * 用法：node tools/cdp-dump.mjs [端口] [路径]
 */

import path from 'node:path';

const PORT = Number(process.argv[2] || 5173);
const ROUTE = process.argv[3] || '/index.html';
const CDP_PORT = Number(process.env.CDP_PORT || 9222);
const BASE = `http://localhost:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
const console_msgs = [];
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const { resolve } = pending.get(m.id);
    pending.delete(m.id);
    resolve(m.result);
  } else if (m.method === 'Runtime.consoleAPICalled') {
    console_msgs.push(`${m.params.type}: ` + m.params.args.map((a) => a.value ?? a.description ?? a.type).join(' '));
  } else if (m.method === 'Runtime.exceptionThrown') {
    console_msgs.push('EXCEPTION: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
  }
});
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const myId = ++id;
    pending.set(myId, { resolve });
    ws.send(JSON.stringify({ id: myId, method, params }));
  });

const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) return { __error: r.exceptionDetails.exception?.description || r.exceptionDetails.text };
  return r.result?.value;
};

await send('Runtime.enable');
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

if (process.env.CLEAR === '1') {
  await send('Storage.clearDataForOrigin', { origin: BASE, storageTypes: 'all' });
  console.log('[cleared storage for] ' + BASE);
}

await send('Page.navigate', { url: `${BASE}${ROUTE}` });
await sleep(2500);

const info = await evaluate(`
  (() => ({
    title: document.title,
    hash: location.hash,
    hasAuthTitle: Boolean(document.querySelector('.auth-title')),
    hasTabbar: Boolean(document.querySelector('.tabbar')),
    appText: (document.getElementById('app')?.innerText || '').slice(0, 400),
    appHtmlStart: (document.getElementById('app')?.innerHTML || '').slice(0, 300),
    banner: document.querySelector('.banner')?.textContent || null,
    scripts: [...document.scripts].map(s => s.src.split('/').pop()),
    idx: (async () => {
      const dbs = (indexedDB.databases ? await indexedDB.databases() : []).map(d => d.name);
      const regs = (await navigator.serviceWorker.getRegistrations()).length;
      return { dbs, regs };
    })(),
  }))()
`);

if (info?.idx) info.idx = await evaluate(`(async () => {
  const dbs = (indexedDB.databases ? await indexedDB.databases() : []).map(d => d.name);
  const regs = (await navigator.serviceWorker.getRegistrations()).length;
  return { dbs, regs };
})()`);

console.log(JSON.stringify(info, null, 2));
console.log('--- console ---');
console.log(console_msgs.length ? console_msgs.join('\n') : '(empty)');

ws.close();
await sleep(100);
process.exit(0);
