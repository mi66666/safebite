/**
 * a11y-audit.mjs — 无障碍审计（真实测量，不是主观判断）
 *
 * 逐页检查并输出可引用的证据：
 *   1. 交互元素触控目标 ≥ 44×44 CSS px
 *   2. 每个可交互元素都有可访问名称（aria-label / label / 文本 / title）
 *   3. 图片必须有 alt 属性
 *   4. 标题层级不跳级（h1→h3 算违规）
 *   5. 页面级要求：<main>、<h1>、带名称的 <nav>、[aria-live]、lang、title
 *   6. 文本与背景的 WCAG 对比度（普通文本 4.5:1，大字 3:1）
 *   7. 16px 基准字号下不发生横向溢出；160% 字号下同样不许溢出
 *
 * 分四个阶段：默认（浅色）→ 深色 → 高对比 → 160% 字号。
 *
 * 用法：node tools/a11y-audit.mjs [端口] [输出md] [输出json]
 */

import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const PORT = Number(process.argv[2] || 5173);
const OUT_MD = path.resolve(process.argv[3] || 'docs/Accessibility_Audit.md');
const OUT_JSON = path.resolve(process.argv[4] || 'docs/a11y-audit.json');
const CDP_PORT = Number(process.env.CDP_PORT || 9222);
const BASE = `http://localhost:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ 审计函数
 * 这个函数会被序列化后在页面里执行，因此不能引用 Node 侧的任何变量。
 */
function auditPage() {
  const violations = [];
  const push = (rule, detail) => violations.push({ rule, detail });

  const visible = (el) => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    if (Number(cs.opacity) === 0) return false;
    if (el.classList.contains('sr-only') || el.closest('.sr-only')) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    return true;
  };

  const describe = (el) => {
    const id = el.id ? '#' + el.id : '';
    let cls = '';
    if (typeof el.className === 'string' && el.className.trim()) {
      cls = '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.');
    }
    const text = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 28);
    return el.tagName.toLowerCase() + id + cls + (text ? ' "' + text + '"' : '');
  };

  /** 只统计未被 aria-hidden 隐藏的后代文本 —— 按可访问名称算法，隐藏内容不参与命名 */
  const exposedText = (root) => {
    let out = '';
    const walk = (node) => {
      for (const child of node.childNodes) {
        if (child.nodeType === 3) out += child.textContent;
        else if (child.nodeType === 1) {
          if (child.getAttribute('aria-hidden') === 'true') continue;
          walk(child);
        }
      }
    };
    walk(root);
    return out.replace(/\s+/g, ' ').trim();
  };

  const accessibleName = (el) => {
    const aria = el.getAttribute('aria-label');
    if (aria && aria.trim()) return aria.trim();
    const byId = el.getAttribute('aria-labelledby');
    if (byId) {
      const txt = byId
        .split(/\s+/)
        .map((id) => (document.getElementById(id)?.textContent || '').trim())
        .join(' ')
        .trim();
      if (txt) return txt;
    }
    const tag = el.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') {
      if (el.id) {
        const lab = document.querySelector('label[for="' + el.id + '"]');
        if (lab && lab.textContent.trim()) return lab.textContent.trim();
      }
      const wrap = el.closest('label');
      if (wrap && wrap.textContent.trim()) return wrap.textContent.trim();
      if (['submit', 'button', 'reset'].includes(el.type) && el.value) return el.value;
    }
    const txt = exposedText(el);
    if (txt) return txt;
    const title = el.getAttribute('title');
    if (title && title.trim()) return title.trim();
    return '';
  };

  /* ---- 颜色工具 ---- */
  const parseColor = (c) => {
    const m = String(c).match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(',').map((v) => parseFloat(v));
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const over = (fg, bg) => ({
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1,
  });
  const lum = (c) => {
    const f = (v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  const ratio = (a, b) => {
    const la = lum(a);
    const lb = lum(b);
    const hi = Math.max(la, lb);
    const lo = Math.min(la, lb);
    return (hi + 0.05) / (lo + 0.05);
  };
  const effectiveBg = (el) => {
    const chain = [];
    let node = el;
    while (node && node !== document.documentElement) {
      chain.push(node);
      node = node.parentElement;
    }
    let bg = parseColor(getComputedStyle(document.documentElement).backgroundColor);
    if (!bg || bg.a === 0) bg = { r: 255, g: 255, b: 255, a: 1 };
    for (let i = chain.length - 1; i >= 0; i--) {
      const c = parseColor(getComputedStyle(chain[i]).backgroundColor);
      if (c && c.a > 0) bg = over(c, bg);
    }
    return bg;
  };

  /* ---- 1. 页面级 ---- */
  if (!document.documentElement.getAttribute('lang')) push('html-lang', '<html> 缺少 lang 属性');
  if (!(document.title || '').trim()) push('doc-title', '文档缺少 title');
  if (!document.querySelector('main')) push('landmark-main', '缺少 <main> 地标');
  if (!document.querySelector('h1')) push('heading-h1', '页面没有 <h1>');
  const nav = document.querySelector('nav');
  if (nav && !nav.getAttribute('aria-label') && !nav.getAttribute('aria-labelledby')) {
    push('nav-label', '<nav> 没有可访问名称');
  }
  if (!document.querySelector('[aria-live]')) push('aria-live', '没有 aria-live 区域用于播报动态内容');

  /* ---- 2. 标题层级 ---- */
  const heads = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].filter(visible).map((h) => Number(h.tagName[1]));
  for (let i = 1; i < heads.length; i++) {
    if (heads[i] - heads[i - 1] > 1) push('heading-order', '标题从 h' + heads[i - 1] + ' 跳到 h' + heads[i]);
  }

  /* ---- 3. 图片替代文本 ---- */
  document.querySelectorAll('img').forEach((img) => {
    if (!img.hasAttribute('alt')) push('img-alt', describe(img) + ' 缺少 alt 属性');
  });

  /* ---- 4. 可访问名称 + 触控目标 ---- */
  const interactiveSel =
    'button, a[href], input:not([type="hidden"]), select, textarea, summary, [role="switch"], [role="button"]';
  const interactive = [...document.querySelectorAll(interactiveSel)].filter(visible);
  interactive.forEach((el) => {
    if (!accessibleName(el)) push('accessible-name', describe(el) + ' 没有可访问名称');
    const r = el.getBoundingClientRect();
    const w = Math.round(r.width);
    const h = Math.round(r.height);
    // WCAG 2.2 对「行内文本链接」有豁免
    const inlineLink = el.tagName === 'A' && Boolean(el.closest('p, li, .fineprint, .meta-line'));
    if (!inlineLink && (w < 44 || h < 44)) {
      push('target-size', describe(el) + ' 为 ' + w + '×' + h + 'px（要求 ≥44×44）');
    }
  });

  /* ---- 5. 对比度 ---- */
  const textEls = [...document.querySelectorAll('body *')].filter((el) => {
    if (!visible(el)) return false;
    if (el.getAttribute('aria-hidden') === 'true') return false;
    if (el.closest('[disabled], [aria-disabled="true"]')) return false; // WCAG 豁免不可用控件
    return [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
  });
  const seen = new Set();
  textEls.forEach((el) => {
    const cs = getComputedStyle(el);
    const fg = parseColor(cs.color);
    if (!fg || fg.a === 0) return;
    const bg = effectiveBg(el);
    const fgOver = fg.a < 1 ? over(fg, bg) : fg;
    const cr = ratio(fgOver, bg);
    const size = parseFloat(cs.fontSize);
    const weight = Number(cs.fontWeight) || 400;
    const large = size >= 24 || (size >= 18.66 && weight >= 700);
    const min = large ? 3 : 4.5;
    if (cr < min - 0.02) {
      const key = describe(el) + '|' + min;
      if (!seen.has(key)) {
        seen.add(key);
        push('contrast', describe(el) + ' 对比度 ' + cr.toFixed(2) + ':1（要求 ' + min + ':1）');
      }
    }
  });

  /* ---- 6. 横向溢出 ---- */
  const doc = document.documentElement;
  if (doc.scrollWidth > doc.clientWidth + 1) {
    push('h-overflow', '内容横向溢出：' + doc.scrollWidth + ' > ' + doc.clientWidth);
  }

  return { violations, counts: { interactive: interactive.length, textNodes: textEls.length } };
}

/* ------------------------------------------------------------------ CDP 驱动 */

async function json(url, method = 'GET') {
  const res = await fetch(url, { method });
  return JSON.parse(await res.text());
}

class Page {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id);
        this.pending.delete(m.id);
        if (m.error) reject(new Error(m.error.message));
        else resolve(m.result);
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
          reject(new Error('CDP timeout: ' + method));
        }
      }, 30000);
    });
  }
  async evaluate(expression) {
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (r.exceptionDetails) throw new Error('Eval: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result?.value;
  }
  async waitFor(expression, timeout = 15000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      if (await this.evaluate('Boolean(' + expression + ')').catch(() => false)) return true;
      await sleep(150);
    }
    throw new Error('等待超时: ' + expression);
  }
}

const AUDIT_EXPR = '(' + auditPage.toString() + ')()';

async function main() {
  const results = [];
  const target = await json(`http://127.0.0.1:${CDP_PORT}/json/new?about:blank`, 'PUT');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', rej, { once: true });
  });
  const page = new Page(ws);

  await page.send('Page.enable');
  await page.send('Runtime.enable');
  await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

  // 干净状态 + 建账号 + 设档案
  await page.send('Page.navigate', { url: BASE + '/index.html' });
  await sleep(800);
  await page.send('Storage.clearDataForOrigin', { origin: `http://localhost:${PORT}`, storageTypes: 'all' });
  await page.send('Page.navigate', { url: BASE + '/index.html' });
  await page.waitFor("document.querySelector('.auth-title')");

  await page.evaluate(`
    (() => {
      const sw = [...document.querySelectorAll('button')].find((b) => /create an account/i.test(b.textContent));
      sw.click();
      document.querySelector('#email').value = 'a11y${Date.now()}@dundee.ac.uk';
      document.querySelector('#password').value = 'testpass123';
      document.querySelector('form.form').requestSubmit();
      return true;
    })()
  `);
  await page.waitFor("location.hash.includes('/scan')");
  await page.evaluate("location.hash = '#/profile'; true");
  await page.waitFor("document.querySelector('.chip-grid')");
  await page.evaluate(`
    (() => {
      const chips = [...document.querySelectorAll('.toggle-chip')];
      chips.find((c) => c.textContent.trim() === 'Milk')?.click();
      chips.find((c) => c.textContent.trim() === 'Tree nuts')?.click();
      const kw = document.querySelector('#keyword');
      kw.value = 'coconut';
      kw.form.requestSubmit();
      [...document.querySelectorAll('button')].find((b) => /save profile/i.test(b.textContent)).click();
      return true;
    })()
  `);
  await page.waitFor("location.hash.includes('/scan')");

  const pages = [
    { id: 'scan', hash: '#/scan', wait: "document.querySelector('.scanner-card, .card')" },
    { id: 'product', hash: '#/product/3017620422003', wait: "document.querySelector('.verdict') || document.querySelector('.banner-error')", timeout: 25000 },
    { id: 'history', hash: '#/history', wait: "document.querySelector('.history-list, .empty-state')" },
    { id: 'profile', hash: '#/profile', wait: "document.querySelector('.chip-grid')" },
    { id: 'settings', hash: '#/settings', wait: "document.querySelector('.switch')" },
    { id: 'diagnostics', hash: '#/diagnostics', wait: "document.querySelectorAll('.diag-row').length > 2 && !/Checking/.test(document.querySelector('.diag-list').textContent)" },
  ];

  const runPhase = async (phase, pageIds, media = null) => {
    await page.send('Emulation.setEmulatedMedia', { features: media ? [{ name: 'prefers-color-scheme', value: media }] : [] });
    for (const id of pageIds) {
      const p = pages.find((x) => x.id === id);
      await page.evaluate('location.hash = ' + JSON.stringify(p.hash) + '; true');
      await page.waitFor(p.wait, p.timeout || 15000);
      await sleep(250);
      const audit = await page.evaluate(AUDIT_EXPR);
      results.push({ phase, page: id, ...audit });
      console.log(`[${phase}] ${id}: ${audit.violations.length} 处问题 / ${audit.counts.interactive} 个交互元素`);
    }
  };

  await runPhase('light', ['scan', 'product', 'history', 'profile', 'settings', 'diagnostics'], 'light');
  await runPhase('dark', ['product', 'settings'], 'dark');

  // 高对比模式
  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
  await page.evaluate("location.hash = '#/settings'; true");
  await page.waitFor("document.querySelector('.switch')");
  await page.evaluate(`
    (() => {
      const s = [...document.querySelectorAll('.switch')].find((x) => /high contrast/i.test(x.closest('.setting-row')?.textContent || ''));
      s.click(); return true;
    })()
  `);
  await sleep(400);
  await runPhase('high-contrast', ['scan', 'product', 'settings', 'diagnostics']);

  // 160% 字号
  // 注意：不能假设上一阶段结束停在设置页（阶段末页会变），必须显式导航。
  await page.evaluate("location.hash = '#/settings'; true");
  await page.waitFor("document.querySelector('.switch')");
  await page.evaluate(`
    (() => {
      const s = [...document.querySelectorAll('.switch')].find((x) => /high contrast/i.test(x.closest('.setting-row')?.textContent || ''));
      s.click();
      const r = document.querySelector('#font-scale');
      r.value = '1.6';
      r.dispatchEvent(new Event('input', { bubbles: true }));
      r.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()
  `);
  await sleep(500);
  await runPhase('font-160', ['scan', 'product', 'history', 'profile', 'settings', 'diagnostics']);

  /* ---- 审计工具自检 ----
   * 一个永远返回"0 违规"的审计器毫无价值。这里注入 5 类已知缺陷，
   * 验证审计确实能把它们检出来 —— 即"测试这个测试工具本身"。 */
  let selftest = null;
  if (process.argv.includes('--selftest')) {
    await page.evaluate("location.hash = '#/scan'; true");
    await page.waitFor("document.querySelector('.scanner-card, .card')");
    await page.evaluate(`
      (() => {
        const host = document.createElement('div');
        host.id = 'selftest-host';
        host.innerHTML = [
          '<button id="st-small" style="width:20px;height:20px">tiny</button>',
          '<button id="st-noname"><span aria-hidden="true">x</span></button>',
          '<img id="st-img" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7">',
          '<h5 id="st-head">skipped heading</h5>',
          '<p id="st-contrast" style="color:#eeeeee;background:#ffffff">low contrast text</p>'
        ].join('');
        document.querySelector('main#view').append(host);
        return true;
      })()
    `);
    const injected = await page.evaluate(AUDIT_EXPR);
    const expected = ['target-size', 'accessible-name', 'img-alt', 'heading-order', 'contrast'];
    const found = new Set(injected.violations.map((v) => v.rule));
    selftest = {
      expected,
      detected: expected.filter((r) => found.has(r)),
      missed: expected.filter((r) => !found.has(r)),
    };
    console.log(
      '[selftest] 注入 5 类已知缺陷 → 检出 ' + selftest.detected.length + '/5' +
        (selftest.missed.length ? '（漏检: ' + selftest.missed.join(', ') + '）' : '（全部检出）')
    );
    await page.evaluate("document.getElementById('selftest-host')?.remove(); true");
  }

  /* ---- 汇总 ---- */
  const byRule = {};
  let total = 0;
  for (const r of results) {
    for (const v of r.violations) {
      total++;
      byRule[v.rule] = byRule[v.rule] || [];
      byRule[v.rule].push(`[${r.phase}/${r.page}] ${v.detail}`);
    }
  }

  const ruleTitles = {
    'target-size': '触控目标尺寸（≥44×44）',
    'accessible-name': '可访问名称',
    'img-alt': '图片替代文本',
    'heading-order': '标题层级跳跃',
    'heading-h1': '页面缺少 h1',
    'landmark-main': '缺少 main 地标',
    'nav-label': 'nav 无可访问名称',
    'aria-live': '缺少 aria-live 播报区',
    'contrast': '文字对比度（WCAG AA）',
    'h-overflow': '横向溢出',
    'html-lang': 'html lang',
    'doc-title': '文档标题',
  };

  const md = [];
  md.push('# SafeBite — Accessibility Audit');
  md.push('');
  md.push('Generated by `tools/a11y-audit.mjs` — an automated audit driven through the Chrome');
  md.push('DevTools Protocol at a 390 × 844 mobile viewport. Every number below is measured from');
  md.push('the rendered page, not asserted by hand.');
  md.push('');
  md.push('## Method');
  md.push('');
  md.push('| Check | Criterion |');
  md.push('|---|---|');
  md.push('| Touch target size | ≥ 44 × 44 CSS px for every interactive control (WCAG 2.2 SC 2.5.8 asks for 24 px; this project holds to 44 px, Apple/Android guidance) |');
  md.push('| Accessible name | Every button, link, input, select, textarea, switch and summary resolves a name from `aria-label`, `aria-labelledby`, `<label>`, text content or `title` |');
  md.push('| Image alternatives | Every `<img>` carries an `alt` attribute |');
  md.push('| Heading order | No skipped heading levels |');
  md.push('| Page structure | `<main>`, an `<h1>`, a named `<nav>`, an `aria-live` region, `lang`, `title` |');
  md.push('| Contrast | 4.5:1 for normal text, 3:1 for large text (WCAG 2.2 SC 1.4.3), computed against the composited effective background |');
  md.push('| Horizontal overflow | No horizontal scrolling at 100 % and at 160 % text size |');
  md.push('');
  md.push('Phases: **light**, **dark**, **high-contrast** (forced BT.709-wide palette) and **font-160** (text size at 160 %).');
  md.push('');
  md.push('## Result');
  md.push('');
  if (total === 0) {
    md.push('**0 violations across ' + results.length + ' page-audits.**');
  } else {
    md.push('**' + total + ' violations across ' + results.length + ' page-audits.**');
  }
  md.push('');
  md.push('| Page audit | Interactive elements | Text nodes checked | Violations |');
  md.push('|---|---|---|---|');
  for (const r of results) {
    md.push(`| ${r.phase} / ${r.page} | ${r.counts.interactive} | ${r.counts.textNodes} | ${r.violations.length} |`);
  }
  md.push('');
  if (selftest) {
    md.push('## Audit self-test');
    md.push('');
    md.push('An audit that cannot fail proves nothing, so the tool was itself validated: five known');
    md.push('defects were injected into the live page and each had to be detected.');
    md.push('');
    md.push('| Injected defect | Rule | Detected |');
    md.push('|---|---|---|');
    const labels = {
      'target-size': 'a 20 × 20 px button',
      'accessible-name': 'a button whose only content is `aria-hidden`',
      'img-alt': 'an `<img>` with no `alt`',
      'heading-order': 'an h5 placed after h2s',
      contrast: 'text at roughly 1.15:1 contrast',
    };
    for (const rule of selftest.expected) {
      md.push(`| ${labels[rule] || rule} | \`${rule}\` | ${selftest.detected.includes(rule) ? 'yes' : '**NO**'} |`);
    }
    md.push('');
    md.push(selftest.missed.length === 0 ? 'All five were detected.' : '**Missed: ' + selftest.missed.join(', ') + '**');
    md.push('');
  }
  if (total > 0) {
    md.push('## Violations by rule');
    md.push('');
    for (const [rule, items] of Object.entries(byRule)) {
      md.push(`### ${ruleTitles[rule] || rule} (${items.length})`);
      md.push('');
      for (const it of items.slice(0, 40)) md.push('- ' + it);
      if (items.length > 40) md.push(`- …and ${items.length - 40} more`);
      md.push('');
    }
  }
  md.push('## Scope and limitations');
  md.push('');
  md.push('Automated checks cannot prove accessibility. They reliably catch missing names, undersized');
  md.push('targets, low contrast and broken structure — the failures that are most common — but they');
  md.push('cannot judge whether the reading order is sensible, whether a screen reader announcement is');
  md.push('*useful*, or whether the app is usable with a real assistive technology. Those were checked');
  md.push('manually with TalkBack on a physical Android device; see `Device_Test_Log.md` (B21).');
  md.push('');
  md.push('Two known measurement limits: elements rendered at reduced `opacity` (disabled buttons) are');
  md.push('excluded from the contrast check, matching the WCAG exemption for inactive controls; and');
  md.push('gradient backgrounds (the loading skeleton) are compared against their base colour only.');
  md.push('');

  await mkdir(path.dirname(OUT_MD), { recursive: true });
  await writeFile(OUT_MD, md.join('\n'), 'utf8');
  await writeFile(OUT_JSON, JSON.stringify({ generatedAt: new Date().toISOString(), total, byRule, selftest, results }, null, 2), 'utf8');

  console.log('\n===== 审计汇总 =====');
  console.log('页面审计次数: ' + results.length + '，问题总数: ' + total);
  for (const [rule, items] of Object.entries(byRule)) console.log('  ' + (ruleTitles[rule] || rule) + ': ' + items.length);
  console.log('报告: ' + OUT_MD);

  ws.close();
  await sleep(150);
  const selftestOk = !selftest || selftest.missed.length === 0;
  process.exit(total === 0 && selftestOk ? 0 : 1);
}

main().catch((err) => {
  console.error('审计失败:', err.message);
  setTimeout(() => process.exit(2), 200);
});
