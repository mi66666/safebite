/**
 * server.mjs — 本地开发/演示静态服务器
 *
 * 用途：
 *  - 本地开发时预览（http://localhost:5173）
 *  - Service Worker 只在 localhost 或 HTTPS 下生效，所以本机用 localhost 测离线是可以的
 *  - 真机演示请用 GitHub Pages 或 HTTPS 隧道（手机访问局域网 http 地址时 SW 不会注册）
 *
 * 用法：node tools/server.mjs [端口]
 */

import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2] || process.env.PORT || 5173);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

function safeJoin(root, target) {
  const resolved = path.resolve(root, '.' + decodeURIComponent(target));
  if (!resolved.startsWith(root)) return null; // 目录穿越防护
  return resolved;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    let filePath = safeJoin(ROOT, url.pathname);

    if (!filePath) {
      res.writeHead(403).end('Forbidden');
      return;
    }

    let info = await stat(filePath).catch(() => null);
    if (info?.isDirectory()) {
      filePath = path.join(filePath, 'index.html');
      info = await stat(filePath).catch(() => null);
    }

    // SPA 回落：找不到的路径交给前端路由
    if (!info) {
      filePath = path.join(ROOT, 'index.html');
      info = await stat(filePath).catch(() => null);
      if (!info) {
        res.writeHead(404).end('Not found');
        return;
      }
    }

    const body = await readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': body.length,
      // 开发期一律不缓存，避免改了代码看不到效果
      'Cache-Control': 'no-store',
      'Service-Worker-Allowed': '/',
    });
    res.end(body);
  } catch (err) {
    res.writeHead(500).end(`Server error: ${err.message}`);
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`SafeBite dev server: http://localhost:${PORT}`);
  console.log(`Serving: ${ROOT}`);
});
