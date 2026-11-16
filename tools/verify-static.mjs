/**
 * verify-static.mjs — 静态一致性校验（无需浏览器，可在 CI 里跑）
 *
 * 防的是这类"改名/加文件后忘了同步"的 bug：
 *   1. sw.js 预缓存清单里的每个文件都必须真实存在
 *   2. js/ 下每个模块都必须被预缓存（否则离线时会缺一块，页面白屏）
 *   3. manifest.json 必填字段齐全，图标文件存在，且路径是相对路径
 *   4. index.html 必须引用 manifest.json 与 js/app.js，且 html 带 lang
 *   5. 所有 js/mjs 文件语法可解析
 *
 * 用法：node tools/verify-static.mjs
 */

import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readdir } from 'node:fs/promises';

const exec = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const problems = [];
const notes = [];
const fail = (msg) => problems.push(msg);
const note = (msg) => notes.push(msg);

const exists = async (rel) => {
  try {
    await stat(path.join(ROOT, rel));
    return true;
  } catch {
    return false;
  }
};

const read = (rel) => readFile(path.join(ROOT, rel), 'utf8');

// ---- 1 & 2. Service Worker 预缓存清单 ----
const sw = await read('sw.js');
const listed = [...sw.matchAll(/'(\.[^']+)'/g)].map((m) => m[1]);
const precached = new Set(listed);

if (precached.size < 10) fail(`sw.js 预缓存条目过少（${precached.size}），可能解析失败`);

for (const entry of precached) {
  const rel = entry.replace(/^\.\//, '');
  const target = rel.endsWith('/') || rel === '' ? 'index.html' : rel;
  if (!(await exists(target))) fail(`sw.js 预缓存了不存在的文件: ${entry}`);
}

const jsFiles = (await readdir(path.join(ROOT, 'js'))).filter((f) => f.endsWith('.js'));
for (const f of jsFiles) {
  if (!precached.has(`./js/${f}`)) fail(`js/${f} 未被 Service Worker 预缓存，离线时会缺失`);
}
note(`Service Worker 预缓存 ${precached.size} 项，覆盖 js/ 全部 ${jsFiles.length} 个模块`);

// ---- 3. manifest.json ----
let manifest;
try {
  manifest = JSON.parse(await read('manifest.json'));
} catch (err) {
  fail(`manifest.json 不是合法 JSON: ${err.message}`);
}

if (manifest) {
  for (const field of ['name', 'short_name', 'start_url', 'display', 'icons', 'theme_color', 'background_color']) {
    if (!manifest[field]) fail(`manifest.json 缺少必填字段: ${field}`);
  }
  if (!['standalone', 'fullscreen', 'minimal-ui'].includes(manifest.display)) {
    fail(`manifest.json display 不是可安装值: ${manifest.display}`);
  }
  // 相对路径：Pages 项目页挂在 /<repo>/ 下，绝对路径会 404
  for (const key of ['start_url', 'scope']) {
    if (manifest[key] && !manifest[key].startsWith('./')) {
      fail(`manifest.json 的 ${key} 必须是相对路径（以 ./ 开头），当前为 ${manifest[key]}`);
    }
  }
  for (const icon of manifest.icons || []) {
    const rel = String(icon.src).replace(/^\.\//, '');
    if (!(await exists(rel))) fail(`manifest 图标不存在: ${icon.src}`);
  }
  const sizes = (manifest.icons || []).map((i) => i.sizes);
  if (!sizes.includes('192x192') || !sizes.includes('512x512')) {
    fail(`manifest 图标必须包含 192x192 与 512x512，当前为 ${sizes.join(', ')}`);
  }
  if (!(manifest.icons || []).some((i) => String(i.purpose || '').includes('maskable'))) {
    fail('manifest 缺少 maskable 图标（Android 会显示白色方块）');
  }
  note(`manifest.json 校验通过，图标 ${manifest.icons.length} 个`);
}

// ---- 4. index.html ----
const html = await read('index.html');
if (!/<html[^>]+lang=/.test(html)) fail('index.html 的 html 元素缺少 lang 属性');
if (!html.includes('rel="manifest"')) fail('index.html 未引用 manifest');
if (html.includes('manifest.webmanifest')) fail('index.html 仍引用已改名的 manifest.webmanifest');
if (!html.includes('./js/app.js')) fail('index.html 未加载 js/app.js');
if (!/<meta[^>]+name="viewport"[^>]+viewport-fit=cover/.test(html)) {
  fail('index.html 的 viewport 缺少 viewport-fit=cover（刘海屏会出现白边）');
}

// ---- 5. 语法检查 ----
const toCheck = [
  ...jsFiles.map((f) => `js/${f}`),
  'sw.js',
  ...(await readdir(path.join(ROOT, 'tools'))).filter((f) => f.endsWith('.mjs')).map((f) => `tools/${f}`),
  ...(await readdir(path.join(ROOT, 'tests'))).filter((f) => f.endsWith('.mjs')).map((f) => `tests/${f}`),
];
let syntaxFailures = 0;
for (const rel of toCheck) {
  try {
    await exec(process.execPath, ['--check', path.join(ROOT, rel)]);
  } catch (err) {
    syntaxFailures += 1;
    fail(`语法错误 ${rel}: ${(err.stderr || err.message).split('\n')[0]}`);
  }
}
note(`语法检查 ${toCheck.length} 个文件，失败 ${syntaxFailures} 个`);

// ---- 汇总 ----
console.log('=== 静态一致性校验 ===');
for (const n of notes) console.log('  · ' + n);
if (problems.length) {
  console.log(`\n发现 ${problems.length} 个问题:`);
  for (const p of problems) console.log('  ✗ ' + p);
  process.exit(1);
}
console.log('\n全部通过 ✓');
