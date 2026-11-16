/**
 * cdp-eval.mjs — 在页面里执行一段表达式并打印结果（调试用）
 * 用法：node tools/cdp-eval.mjs <端口> <URL> "<表达式>"
 */

const PORT = Number(process.argv[2] || 5173);
const ROUTE = process.argv[3] || '/index.html';
const EXPR = process.argv[4] || '1+1';
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
const logs = [];
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m.result);
    pending.delete(m.id);
  } else if (m.method === 'Runtime.consoleAPICalled') {
    logs.push(`[console.${m.params.type}] ` + m.params.args.map((a) => a.value ?? a.description ?? a.type).join(' '));
  } else if (m.method === 'Runtime.exceptionThrown') {
    logs.push('[exception] ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
  }
});
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const myId = ++id;
    pending.set(myId, resolve);
    ws.send(JSON.stringify({ id: myId, method, params }));
  });

await send('Runtime.enable');
await send('Page.enable');
if (process.env.CLEAR === '1') {
  await send('Storage.clearDataForOrigin', { origin: `http://localhost:${PORT}`, storageTypes: 'all' });
}
await send('Page.navigate', { url: `http://localhost:${PORT}${ROUTE}` });
await sleep(2000);

const res = await send('Runtime.evaluate', { expression: EXPR, awaitPromise: true, returnByValue: true });
if (res.exceptionDetails) {
  console.log('EVAL EXCEPTION: ' + (res.exceptionDetails.exception?.description || res.exceptionDetails.text));
} else {
  console.log('RESULT: ' + JSON.stringify(res.result?.value, null, 2));
}
if (logs.length) {
  console.log('--- console ---');
  console.log(logs.join('\n'));
}

ws.close();
await sleep(100);
process.exit(0);
