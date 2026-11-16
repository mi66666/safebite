/**
 * make-report.mjs — 用 Chrome 把 report.html 打印成 PDF
 *
 * 为什么这么做：课程要求 PDF、2 页、Calibri/Arial 11pt。用 Chrome 的
 * Page.printToPDF 打印，排版结果和浏览器里看到的完全一致，也不需要装
 * 任何 PDF 库；@page 里定义的 A4 尺寸与页边距会通过 preferCSSPageSize 生效。
 *
 * 用法：
 *   node tools/make-report.mjs "F:/dsh/mobile app/report/report.html" "F:/dsh/mobile app/report/YuntianMi_2732066_ProjectReport.pdf"
 * 前置：Chrome 以 --remote-debugging-port=9222 运行
 */

import { writeFile, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const SRC = path.resolve(process.argv[2] || 'report/report.html');
const OUT = path.resolve(process.argv[3] || 'report/report.pdf');
const CDP_PORT = Number(process.env.CDP_PORT || 9222);
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
    const { resolve, reject } = pending.get(m.id);
    pending.delete(m.id);
    if (m.error) reject(new Error(m.error.message));
    else resolve(m.result);
  }
});
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const myId = ++id;
    pending.set(myId, { resolve, reject });
    ws.send(JSON.stringify({ id: myId, method, params }));
    setTimeout(() => {
      if (pending.has(myId)) {
        pending.delete(myId);
        reject(new Error(`CDP timeout: ${method}`));
      }
    }, 30000);
  });

await send('Page.enable');
await send('Page.navigate', { url: pathToFileURL(SRC).href });
await sleep(1200);

// 等字体就绪，否则 PDF 里可能用回退字体
await send('Runtime.evaluate', {
  expression: `document.fonts ? document.fonts.ready.then(() => true) : true`,
  awaitPromise: true,
});

const { data } = await send('Page.printToPDF', {
  printBackground: true,
  preferCSSPageSize: true,
  displayHeaderFooter: false,
});
await writeFile(OUT, Buffer.from(data, 'base64'));

const bytes = await readFile(OUT);
console.log(`[ok] PDF 生成: ${OUT}`);
console.log(`     大小: ${(bytes.length / 1024).toFixed(1)} KB`);
ws.close();
await sleep(150);
process.exit(0);
