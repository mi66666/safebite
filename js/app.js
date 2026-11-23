/**
 * app.js — 应用外壳、路由与视图
 *
 * 架构说明（报告"设计决策"一节可以直接引用）：
 *  - 无框架的 ES Module 单页应用：课程教的就是原生 HTML/CSS/JS，避免为了脚手架而牺牲可解释性
 *  - hash 路由：PWA 在 GitHub Pages 这类静态托管下刷新不 404
 *  - 底部标签栏导航：4 个顶层页面，扫码是默认页（主任务优先）
 *  - 所有用户数据来自 IndexedDB，档案字段加密；摄像头画面只在本机内存处理
 */

import { initPrefs, getPrefs, setPref, announce } from './a11y.js';
import * as voice from './voice.js';
import { el, clear, toast, verdictMeta, relativeTime, placeholderImage } from './ui.js';
import { validateBarcode, assessProduct, nutriScoreInfo, novaInfo, buildSpeechText, humanizeTags, ALLERGENS, DIETS } from './logic.js';
import { fetchProduct, toAssessmentInput } from './api.js';
import { currentUser, login, register, logout, loadProfile, saveProfile, deleteAccount, lastEmail, isValidEmail } from './auth.js';
import { getScans, clearScans } from './db.js';
import { startScanner, stopScanner, isDetectorSupported, supportedFormats, haptic } from './scan.js';

const state = {
  session: null,
  profile: { allergens: [], diets: [], keywords: [] },
  route: { name: 'scan', param: null },
  lastProduct: null,
  scanBusy: false,
};

const DEMO_BARCODES = [
  { code: '3017620422003', label: 'Nutella (contains milk, nuts)' },
  { code: '5449000000996', label: 'Coca-Cola (no allergens declared)' },
  { code: '5000159484695', label: 'Snickers (contains milk, peanuts)' },
];

/* ---------------------------------------------------------------- 路由 */

const app = () => document.getElementById('app');
const view = () => document.getElementById('view');

function parseRoute() {
  const hash = location.hash.replace(/^#\/?/, '');
  const [name, param] = hash.split('/');
  return { name: name || 'scan', param: param || null };
}

function navigate(path) {
  if (location.hash === `#/${path}`) render();
  else location.hash = `#/${path}`;
}

function render() {
  const route = parseRoute();

  // 任何整页重渲染都会替换 <video> 元素，而摄像头流仍绑在旧元素上。
  // 必须先释放，否则会出现「预览黑屏、但相机指示灯一直亮」——既难用也是隐私问题。
  stopScanner();
  state.scanBusy = false;
  state.route = route;

  if (!state.session) {
    renderLogin();
    return;
  }

  clear(app());
  app().append(buildHeader(), el('main', { id: 'view', tabindex: '-1' }), buildTabBar(), buildOfflineStrip());

  const target = view();
  switch (route.name) {
    case 'product':
      renderProduct(target, route.param);
      break;
    case 'history':
      renderHistory(target);
      break;
    case 'profile':
      renderProfile(target);
      break;
    case 'settings':
      renderSettings(target);
      break;
    case 'diagnostics':
      renderDiagnostics(target);
      break;
    default:
      renderScan(target);
  }
  target.focus({ preventScroll: true });
}

function buildHeader() {
  const titles = {
    scan: 'SafeBite',
    product: 'Result',
    history: 'History',
    profile: 'My profile',
    settings: 'Settings',
    diagnostics: 'Device check',
  };

  // 语音开关就地更新按钮状态，不触发整页重渲染：
  // 重渲染会换掉 <video> 元素，而摄像头流仍绑定在旧元素上，
  // 表现为预览黑屏但相机指示灯常亮。
  const voiceBtn = el('button', {
    class: 'icon-btn',
    type: 'button',
    'aria-label': getPrefs().voice ? 'Turn voice off' : 'Turn voice on',
    'aria-pressed': String(getPrefs().voice),
    title: 'Toggle voice announcements',
    onClick: async () => {
      const next = !getPrefs().voice;
      await setPref('voice', next);
      voice.setEnabled(next);
      voiceBtn.textContent = next ? '🔊' : '🔇';
      voiceBtn.setAttribute('aria-label', next ? 'Turn voice off' : 'Turn voice on');
      voiceBtn.setAttribute('aria-pressed', String(next));
      toast(next ? 'Voice announcements on' : 'Voice announcements off');
    },
  }, [getPrefs().voice ? '🔊' : '🔇']);

  return el('header', { class: 'app-header' }, [
    el('div', { class: 'brand' }, [
      el('span', { class: 'brand-mark', 'aria-hidden': 'true' }, ['🥗']),
      el('span', { class: 'brand-name' }, [titles[state.route.name] || 'SafeBite']),
    ]),
    voiceBtn,
  ]);
}

function buildTabBar() {
  const tabs = [
    { id: 'scan', label: 'Scan', icon: '📷' },
    { id: 'history', label: 'History', icon: '🕘' },
    { id: 'profile', label: 'Profile', icon: '👤' },
    { id: 'settings', label: 'More', icon: '⚙️' },
  ];
  const active = state.route.name === 'product' ? 'scan' : state.route.name;
  return el('nav', { class: 'tabbar', 'aria-label': 'Main navigation' },
    tabs.map((tab) =>
      el('a', {
        class: `tab ${active === tab.id ? 'tab-active' : ''}`,
        href: `#/${tab.id}`,
        'aria-current': active === tab.id ? 'page' : null,
      }, [
        el('span', { class: 'tab-icon', 'aria-hidden': 'true' }, [tab.icon]),
        el('span', { class: 'tab-label' }, [tab.label]),
      ])
    )
  );
}

function buildOfflineStrip() {
  const strip = el('div', { class: 'offline-strip', id: 'offline-strip', hidden: true, role: 'status' }, [
    'You are offline — saved products and history still work.',
  ]);
  if (navigator.onLine === false) strip.hidden = false;
  return strip;
}

/* ------------------------------------------------------------ 登录/注册 */

function renderLogin() {
  let mode = 'login';
  const emailInput = el('input', {
    id: 'email', type: 'email', name: 'email', autocomplete: 'username',
    placeholder: 'you@dundee.ac.uk', required: true, value: lastEmail(),
  });
  const passwordInput = el('input', {
    id: 'password', type: 'password', name: 'password', autocomplete: 'current-password',
    placeholder: 'At least 8 characters', required: true,
  });
  const errorBox = el('p', { class: 'form-error', role: 'alert', hidden: true });
  const submitBtn = el('button', { class: 'btn btn-primary', type: 'submit' }, ['Sign in']);
  const switchBtn = el('button', { class: 'btn btn-ghost', type: 'button' }, ['Create an account instead']);

  const form = el('form', { class: 'card form', novalidate: true }, [
    el('label', { for: 'email' }, ['Email']),
    emailInput,
    el('label', { for: 'password' }, ['Password']),
    passwordInput,
    errorBox,
    submitBtn,
  ]);

  switchBtn.addEventListener('click', () => {
    mode = mode === 'login' ? 'register' : 'login';
    submitBtn.textContent = mode === 'login' ? 'Sign in' : 'Create account';
    passwordInput.setAttribute('autocomplete', mode === 'login' ? 'current-password' : 'new-password');
    switchBtn.textContent = mode === 'login' ? 'Create an account instead' : 'I already have an account';
    errorBox.hidden = true;
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    errorBox.hidden = true;
    submitBtn.disabled = true;
    const original = submitBtn.textContent;
    submitBtn.textContent = mode === 'login' ? 'Signing in…' : 'Creating account…';
    try {
      if (!isValidEmail(emailInput.value)) throw new Error('Please enter a valid email address.');
      if (mode === 'login') await login(emailInput.value, passwordInput.value);
      else await register(emailInput.value, passwordInput.value);
      await startSession();
      navigate('scan');
    } catch (err) {
      errorBox.textContent = err?.message || 'Something went wrong.';
      errorBox.hidden = false;
      passwordInput.value = '';
      passwordInput.focus();
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = original;
    }
  });

  clear(app());
  app().append(
    el('main', { class: 'auth-screen', id: 'view' }, [
      el('div', { class: 'auth-hero' }, [
        el('span', { class: 'auth-logo', 'aria-hidden': 'true' }, ['🥗']),
        el('h1', { class: 'auth-title' }, ['SafeBite']),
        el('p', { class: 'auth-sub' }, ['Scan a barcode to check a product against your allergies and diet.']),
      ]),
      form,
      switchBtn,
      el('p', { class: 'fineprint' }, [
        'Accounts and allergy profiles stay on this device. Passwords are never stored — only a salted, ',
        'stretched hash, and your profile is encrypted with a key derived from your password.',
      ]),
    ])
  );
  emailInput.focus();
}

/* ------------------------------------------------------------- 扫码页 */

function renderScan(target) {
  const supported = isDetectorSupported();
  const emptyProfile = !state.profile.allergens.length && !state.profile.diets.length && !state.profile.keywords.length;

  const video = el('video', { class: 'scanner-video', id: 'scanner', playsinline: true, muted: true, 'aria-label': 'Camera preview for barcode scanning' });
  const status = el('p', { class: 'scanner-status', role: 'status' }, [supported ? 'Point the camera at a barcode.' : 'Camera scanning is not supported in this browser — type the barcode below.']);
  const manualInput = el('input', {
    id: 'manual-code', class: 'input-code', type: 'text', inputmode: 'numeric',
    pattern: '[0-9]*', placeholder: 'e.g. 3017620422003', 'aria-label': 'Barcode number',
  });

  const scanButton = el('button', { class: 'btn btn-primary' }, [supported ? 'Start camera' : 'Camera unavailable']);
  if (!supported) scanButton.disabled = true;

  scanButton.addEventListener('click', async () => {
    if (state.scanBusy) {
      stopScanner();
      state.scanBusy = false;
      scanButton.textContent = 'Start camera';
      status.textContent = 'Camera stopped.';
      return;
    }
    scanButton.disabled = true;
    scanButton.textContent = 'Starting…';
    const ok = await startScanner(video, {
      onDetect: (code) => {
        if (getPrefs().haptics) haptic(60);
        stopScanner();
        state.scanBusy = false;
        announce('Barcode detected. Looking up product.');
        navigate(`product/${code}`);
      },
      onError: (message) => {
        state.scanBusy = false;
        scanButton.disabled = false;
        scanButton.textContent = 'Try camera again';
        status.textContent = message;
        toast(message, 'error', 5000);
      },
    });
    state.scanBusy = ok;
    scanButton.disabled = !ok;
    if (ok) {
      scanButton.textContent = 'Stop camera';
      status.textContent = 'Scanning… hold the barcode inside the frame.';
    }
  });

  const manualForm = el('form', { class: 'inline-form' }, [
    el('label', { for: 'manual-code', class: 'sr-only' }, ['Barcode number']),
    manualInput,
    el('button', { class: 'btn btn-secondary', type: 'submit' }, ['Look up']),
  ]);
  manualForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const check = validateBarcode(manualInput.value);
    if (!check.valid) {
      const reason = check.reason === 'checksum' ? 'That barcode checksum is invalid — check the digits.' : 'Enter a valid 8, 12 or 13 digit barcode.';
      toast(reason, 'error');
      manualInput.focus();
      return;
    }
    navigate(`product/${check.code}`);
  });

  const demo = el('details', { class: 'demo-box' }, [
    el('summary', {}, ['Demo barcodes (for testing without a camera)']),
    el('ul', { class: 'demo-list' }, DEMO_BARCODES.map((item) =>
      el('li', {}, [
        el('button', { class: 'link-btn', type: 'button', onClick: () => navigate(`product/${item.code}`) },
          [`${item.code} — ${item.label}`]),
      ])
    )),
  ]);

  target.append(
    el('h1', { class: 'page-title' }, ['Scan a product']),
    emptyProfile
      ? el('div', { class: 'banner banner-warn' }, [
          el('strong', {}, ['Your profile is empty. ']),
          'Add your allergies so scans can warn you. ',
          el('a', { href: '#/profile', class: 'inline-link' }, ['Set up profile']),
        ])
      : null,
    supported
      ? el('section', { class: 'scanner-card' }, [
          el('div', { class: 'scanner-frame' }, [video, el('div', { class: 'scanner-reticle', 'aria-hidden': 'true' })]),
          status,
          scanButton,
        ])
      : el('section', { class: 'card' }, [
          el('h2', { class: 'card-title' }, ['Camera scanning is not available here']),
          el('p', { class: 'meta-line' }, [
            'This browser does not support the BarcodeDetector API. Open SafeBite in Chrome on Android to scan with the camera —',
            ' the live demo runs there.',
          ]),
          el('p', { class: 'meta-line' }, ['You can still check any product by typing its barcode below.']),
        ]),
    el('section', { class: 'card' }, [
      el('h2', { class: 'card-title' }, [supported ? 'Or type the number' : 'Type a barcode']),
      manualForm,
      demo,
    ])
  );
}

/* ------------------------------------------------------------ 结果页 */

async function renderProduct(target, barcode) {
  const check = validateBarcode(barcode);
  if (!check.valid) {
    target.append(el('div', { class: 'banner banner-error' }, ['That barcode is not valid.']));
    return;
  }

  target.append(el('div', { class: 'skeleton-card' }, [
    el('div', { class: 'skeleton skeleton-title' }),
    el('div', { class: 'skeleton skeleton-line' }),
    el('div', { class: 'skeleton skeleton-line short' }),
  ]));
  announce('Looking up product.');

  const result = await fetchProduct(check.code);
  state.lastProduct = result.product;

  clear(target);
  target.append(el('p', { class: 'source-note' }, [sourceNote(result)]));

  if (result.status !== 'ok') {
    target.append(
      el('div', { class: `banner ${result.status === 'offline' ? 'banner-warn' : 'banner-error'}` }, [
        result.status === 'not-found'
          ? 'This barcode is not in the Open Food Facts database yet.'
          : result.message || 'Could not load this product.',
      ]),
      el('button', { class: 'btn btn-primary', onClick: () => navigate('scan') }, ['Scan another product'])
    );
    announce(result.status === 'not-found' ? 'Product not found in database.' : 'Could not load product.');
    return;
  }

  const product = result.product;
  const assessment = assessProduct(toAssessmentInput(product), state.profile);
  const meta = verdictMeta(assessment.verdict);
  const speech = buildSpeechText({
    productName: product.name || product.brands,
    verdict: assessment.verdict,
    contains: assessment.contains,
    traces: assessment.traces,
    textHits: assessment.textHits,
    dietFlags: assessment.dietFlags,
    keywordHits: assessment.keywordHits,
  });

  // 写入历史（同一商品 60 秒内不重复记）
  void saveScan(product, assessment);

  target.append(
    el('section', { class: `verdict ${meta.cls}`, 'aria-label': `Verdict: ${meta.label}` }, [
      el('span', { class: 'verdict-icon', 'aria-hidden': 'true' }, [meta.icon]),
      el('div', {}, [
        el('h1', { class: 'verdict-label' }, [meta.label]),
        el('p', { class: 'verdict-hint' }, [meta.hint]),
      ]),
      el('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Read result aloud', onClick: () => {
        const ok = voice.speak(speech);
        toast(ok ? 'Reading aloud…' : 'Voice is unavailable or turned off.', ok ? 'info' : 'error');
      } }, ['🔊']),
    ]),
    el('section', { class: 'card product-card' }, [
      el('img', {
        class: 'product-image', src: product.image || placeholderImage(product.name || '?'),
        alt: product.name ? `Photo of ${product.name}` : 'No product photo available',
        loading: 'lazy',
        onError: (e) => { e.target.src = placeholderImage(product.name || '?'); },
      }),
      el('div', { class: 'product-meta' }, [
        el('h2', { class: 'product-name' }, [product.name || 'Unnamed product']),
        el('p', { class: 'product-brand' }, [[product.brands, product.quantity].filter(Boolean).join(' · ') || '—']),
        el('div', { class: 'chip-row' }, [
          chip(
            `Nutri-Score ${nutriScoreInfo(product.nutriscoreGrade).label}`,
            product.nutriscoreGrade ? `chip-score chip-score-${String(product.nutriscoreGrade).toLowerCase()}` : 'chip-muted'
          ),
          chip(`NOVA ${novaInfo(product.novaGroup).group ?? '?'}`, product.novaGroup ? `chip-muted chip-nova-${numOrX(product.novaGroup)}` : 'chip-muted'),
          product.additives.length ? chip(`${product.additives.length} additives`, 'chip-muted') : null,
        ]),
      ]),
    ]),
    buildFindings(assessment),
    el('section', { class: 'card' }, [
      el('h2', { class: 'card-title' }, ['Ingredients']),
      el('p', { class: 'ingredients' }, [product.ingredientsText || 'No ingredient list available for this product.']),
      el('p', { class: 'meta-line' }, [`Declared allergens: ${humanizeTags(product.allergensTags)}`]),
      el('p', { class: 'meta-line' }, [`Traces: ${humanizeTags(product.tracesTags)}`]),
      product.ingredientsText
        ? el('button', { class: 'btn btn-secondary', type: 'button', onClick: () => voice.speak(product.ingredientsText, { rate: 0.9 }) }, ['🔊 Read ingredients aloud'])
        : null,
    ]),
    el('div', { class: 'btn-row' }, [
      el('button', { class: 'btn btn-primary', onClick: () => navigate('scan') }, ['Scan another']),
      el('button', { class: 'btn btn-secondary', onClick: () => navigate('history') }, ['View history']),
    ]),
    el('p', { class: 'fineprint' }, [
      'Data from Open Food Facts (ODbL). Always double-check the physical label — manufacturer recipes change and database entries can be incomplete.',
    ])
  );

  announce(`Result: ${meta.label}. ${speech}`);
  if (getPrefs().voice) voice.speak(speech);
}

/**
 * 结果来源说明 —— 必须与实际发生的事一致。
 * 曾经的真实 bug：抓取失败（status !== 'ok'）时落到了默认分支，
 * 于是在"没连上网络"的页面上方写着 "Fetched live from Open Food Facts."
 * —— 这与本应用"绝不谎报"的设计原则直接矛盾。
 */
function sourceNote(result) {
  if (result.status === 'ok') {
    if (result.source === 'cache') {
      return result.stale
        ? 'Showing a saved copy — offline or unreachable.'
        : 'Loaded from this device’s saved copy.';
    }
    return 'Fetched live from Open Food Facts.';
  }
  if (result.status === 'offline') return 'Offline — no saved copy of this product.';
  if (result.status === 'not-found') return 'Checked live — this barcode is not in Open Food Facts.';
  return 'Could not reach Open Food Facts.';
}

function buildFindings(assessment) {
  const rows = [];
  if (assessment.contains.length) {
    rows.push(findingBlock('Contains', 'danger', assessment.contains.map((c) => c.label)));
  }
  if (assessment.keywordHits.length) {
    rows.push(findingBlock('Ingredient mentions', 'danger', assessment.keywordHits.map((k) => k.keyword)));
  }
  const dietDanger = assessment.dietFlags.filter((d) => d.level === 'contains');
  if (dietDanger.length) rows.push(findingBlock('Diet conflict', 'danger', dietDanger.map((d) => d.label)));
  if (assessment.traces.length) {
    rows.push(findingBlock('May contain traces of', 'caution', assessment.traces.map((t) => t.label)));
  }
  if (assessment.textHits && assessment.textHits.length) {
    rows.push(
      el('section', { class: 'card finding finding-caution' }, [
        el('h2', { class: 'card-title' }, ['Ingredient list mentions']),
        el('ul', { class: 'finding-list' }, assessment.textHits.map((hit) =>
          el('li', {}, [`${hit.label} — found “${hit.words.join('”, “')}”`])
        )),
        el('p', { class: 'meta-line' }, [
          'This database entry has no allergen declaration, so the ingredient text was searched instead. Check the pack before eating.',
        ]),
      ])
    );
  }
  const dietWarn = assessment.dietFlags.filter((d) => d.level === 'traces');
  if (dietWarn.length) rows.push(findingBlock('Diet status unclear', 'caution', dietWarn.map((d) => d.label)));

  if (!rows.length) {
    let note = 'None of your avoided allergens appear in the declared allergen list or traces.';
    if (assessment.dataQuality === 'missing') {
      note = 'This product has no allergen data in the database, so it could not be checked. Treat it as unknown.';
    } else if (assessment.dataQuality === 'partial') {
      note = 'This entry has no declared allergen list. Only the ingredient text was searched, so treat this result with caution.';
    }
    rows.push(el('section', { class: 'card findings-empty' }, [
      el('h2', { class: 'card-title' }, ['Nothing matched your profile']),
      el('p', {}, [note]),
    ]));
  }
  return el('div', { class: 'findings' }, rows);
}

function findingBlock(title, level, items) {
  return el('section', { class: `card finding finding-${level}` }, [
    el('h2', { class: 'card-title' }, [title]),
    el('ul', { class: 'finding-list' }, items.map((label) => el('li', {}, [label]))),
  ]);
}

function chip(text, cls = '') {
  return el('span', { class: `chip ${cls}`.trim() }, [text]);
}

/** NOVA 分组只在 1–4 之间有意义，其余归为 x */
function numOrX(value) {
  const n = Number(value);
  return [1, 2, 3, 4].includes(n) ? String(n) : 'x';
}

async function saveScan(product, assessment) {
  try {
    const { put, getAllByIndex } = await import('./db.js');
    const existing = await getAllByIndex('scans', 'byEmail', state.session.email);
    const recent = existing.find((r) => r.barcode === product.barcode && Date.now() - r.ts < 60_000);
    if (recent) return;
    await put('scans', {
      email: state.session.email,
      barcode: product.barcode,
      ts: Date.now(),
      name: product.name,
      brand: product.brands,
      image: product.image,
      verdict: assessment.verdict,
      snapshot: {
        allergensTags: product.allergensTags,
        tracesTags: product.tracesTags,
        ingredientsText: product.ingredientsText,
      },
    });
  } catch {
    /* 写历史失败不影响结果展示 */
  }
}

/* ------------------------------------------------------------- 历史页 */

async function renderHistory(target) {
  const rows = await getScans(state.session.email).catch(() => []);
  const head = el('div', { class: 'row-between' }, [
    el('h1', { class: 'page-title' }, ['Scan history']),
    rows.length
      ? el('button', { class: 'btn btn-danger btn-sm', type: 'button', onClick: async () => {
          if (!confirm(`Delete all ${rows.length} saved scans from this device?`)) return;
          const removed = await clearScans(state.session.email);
          toast(`Deleted ${removed} scans`);
          render();
        } }, ['Clear'])
      : null,
  ]);

  target.append(head);

  if (!rows.length) {
    target.append(el('div', { class: 'card empty-state' }, [
      el('p', {}, ['No scans yet.']),
      el('a', { class: 'btn btn-primary', href: '#/scan' }, ['Scan your first product']),
    ]));
    return;
  }

  target.append(el('p', { class: 'meta-line' }, [
    `${rows.length} saved scan${rows.length === 1 ? '' : 's'} · available offline`,
  ]));

  const list = el('ul', { class: 'history-list' });
  for (const row of rows) {
    const meta = verdictMeta(row.verdict);
    list.append(
      el('li', { class: 'history-item' }, [
        el('a', { class: `history-link ${meta.cls}`, href: `#/product/${row.barcode}` }, [
          el('img', {
            class: 'history-thumb',
            src: row.image || placeholderImage(row.name || '?'),
            alt: '',
            loading: 'lazy',
            onError: (e) => { e.target.src = placeholderImage(row.name || '?'); },
          }),
          el('div', { class: 'history-text' }, [
            el('p', { class: 'history-name' }, [row.name || row.barcode]),
            el('p', { class: 'history-sub' }, [`${meta.label} · ${relativeTime(row.ts)}`]),
          ]),
          el('span', { class: 'history-chevron', 'aria-hidden': 'true' }, ['›']),
        ]),
      ])
    );
  }
  target.append(list);
}

/* ------------------------------------------------------------- 档案页 */

function renderProfile(target) {
  const selected = new Set(state.profile.allergens || []);
  const diets = new Set(state.profile.diets || []);
  const keywords = [...(state.profile.keywords || [])];

  const allergenGrid = el('div', { class: 'chip-grid', role: 'group', 'aria-label': 'Allergens to avoid' },
    ALLERGENS.map((allergen) => {
      const pressed = selected.has(allergen.id);
      const btn = el('button', {
        type: 'button',
        class: `toggle-chip ${pressed ? 'is-on' : ''}`,
        'aria-pressed': String(pressed),
        onClick: () => {
          const nowPressed = btn.getAttribute('aria-pressed') !== 'true';
          btn.setAttribute('aria-pressed', String(nowPressed));
          btn.classList.toggle('is-on', nowPressed);
          if (nowPressed) selected.add(allergen.id);
          else selected.delete(allergen.id);
        },
      }, [allergen.label]);
      return btn;
    })
  );

  const dietGrid = el('div', { class: 'chip-grid', role: 'group', 'aria-label': 'Dietary preferences' },
    DIETS.map((diet) => {
      const pressed = diets.has(diet.id);
      const btn = el('button', {
        type: 'button',
        class: `toggle-chip ${pressed ? 'is-on' : ''}`,
        'aria-pressed': String(pressed),
        onClick: () => {
          const nowPressed = btn.getAttribute('aria-pressed') !== 'true';
          btn.setAttribute('aria-pressed', String(nowPressed));
          btn.classList.toggle('is-on', nowPressed);
          if (nowPressed) diets.add(diet.id);
          else diets.delete(diet.id);
        },
      }, [diet.label]);
      return btn;
    })
  );

  const keywordInput = el('input', {
    id: 'keyword', type: 'text', placeholder: 'e.g. coconut, sesame oil, MSG', 'aria-label': 'Custom ingredient to avoid',
  });
  const keywordList = el('ul', { class: 'keyword-list' });

  const paintKeywords = () => {
    clear(keywordList);
    if (!keywords.length) {
      keywordList.append(el('li', { class: 'meta-line' }, ['No custom ingredients yet.']));
      return;
    }
    for (const word of keywords) {
      keywordList.append(el('li', { class: 'keyword-item' }, [
        el('span', {}, [word]),
        el('button', {
          type: 'button', class: 'icon-btn small', 'aria-label': `Remove ${word}`,
          onClick: () => {
            const idx = keywords.indexOf(word);
            if (idx >= 0) keywords.splice(idx, 1);
            paintKeywords();
          },
        }, ['✕']),
      ]));
    }
  };
  paintKeywords();

  const keywordForm = el('form', { class: 'inline-form' }, [
    keywordInput,
    el('button', { class: 'btn btn-secondary', type: 'submit' }, ['Add']),
  ]);
  keywordForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const word = keywordInput.value.trim().toLowerCase();
    if (!word) return;
    if (!keywords.includes(word)) keywords.push(word);
    keywordInput.value = '';
    paintKeywords();
  });

  const saveBtn = el('button', { class: 'btn btn-primary btn-block', type: 'button' }, ['Save profile']);
  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';
    try {
      state.profile = { allergens: [...selected], diets: [...diets], keywords };
      await saveProfile(state.session, state.profile);
      toast('Profile saved and encrypted on this device');
      announce('Profile saved.');
      navigate('scan');
    } catch (err) {
      toast(err?.message || 'Could not save profile', 'error');
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save profile';
    }
  });

  target.append(
    el('h1', { class: 'page-title' }, ['My profile']),
    el('p', { class: 'page-sub' }, ['Everything here is encrypted with a key derived from your password and never leaves this device.']),
    el('section', { class: 'card' }, [
      el('h2', { class: 'card-title' }, ['Allergens to avoid']),
      el('p', { class: 'meta-line' }, ['The 14 allergens UK/EU law requires to be declared.']),
      allergenGrid,
    ]),
    el('section', { class: 'card' }, [
      el('h2', { class: 'card-title' }, ['Dietary preferences']),
      dietGrid,
    ]),
    el('section', { class: 'card' }, [
      el('h2', { class: 'card-title' }, ['Other ingredients to flag']),
      keywordList,
      keywordForm,
    ]),
    saveBtn
  );
}

/* ------------------------------------------------------------- 设置页 */

function renderSettings(target) {
  const prefs = getPrefs();

  const fontSlider = el('input', {
    type: 'range', min: '1', max: '1.6', step: '0.1', value: String(prefs.fontScale),
    class: 'range', id: 'font-scale', 'aria-label': 'Text size',
  });
  const fontValue = el('output', { class: 'range-value', for: 'font-scale' }, [`${Math.round(prefs.fontScale * 100)}%`]);
  fontSlider.addEventListener('input', () => {
    fontValue.textContent = `${Math.round(Number(fontSlider.value) * 100)}%`;
  });
  fontSlider.addEventListener('change', async () => {
    await setPref('fontScale', Number(fontSlider.value));
  });

  const makeToggle = (label, key, hint) => {
    const labelId = `setting-${key}`;
    const btn = el('button', {
      type: 'button',
      role: 'switch',
      class: `switch ${prefs[key] ? 'is-on' : ''}`,
      'aria-checked': String(Boolean(prefs[key])),
      // 开关里只有装饰性图形，没有任何文本 → 必须显式给出可访问名称，
      // 否则屏幕阅读器只会读出"按钮"。
      'aria-labelledby': labelId,
      onClick: async () => {
        const next = btn.getAttribute('aria-checked') !== 'true';
        btn.setAttribute('aria-checked', String(next));
        btn.classList.toggle('is-on', next);
        await setPref(key, next);
        if (key === 'voice') {
          voice.setEnabled(next);
          if (next) voice.speak('Voice announcements on');
        }
      },
    }, [el('span', { class: 'switch-thumb', 'aria-hidden': 'true' })]);
    return el('div', { class: 'setting-row' }, [
      el('div', {}, [
        el('p', { class: 'setting-label', id: labelId }, [label]),
        hint ? el('p', { class: 'setting-hint' }, [hint]) : null,
      ]),
      btn,
    ]);
  };

  const exportBtn = el('button', { class: 'btn btn-secondary', type: 'button' }, ['Export my data (JSON)']);
  exportBtn.addEventListener('click', async () => {
    const scans = await getScans(state.session.email).catch(() => []);
    const payload = {
      exportedAt: new Date().toISOString(),
      account: state.session.email,
      profile: state.profile,
      scans: scans.map(({ name, brand, barcode, verdict, ts }) => ({ name, brand, barcode, verdict, ts })),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: 'safebite-export.json' });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    toast('Data exported');
  });

  const signOutBtn = el('button', { class: 'btn btn-secondary', type: 'button' }, ['Sign out']);
  signOutBtn.addEventListener('click', async () => {
    await logout();
    state.session = null;
    state.profile = { allergens: [], diets: [], keywords: [] };
    toast('Signed out');
    render();
  });

  const deleteBtn = el('button', { class: 'btn btn-danger', type: 'button' }, ['Delete account and all data']);
  deleteBtn.addEventListener('click', async () => {
    if (!confirm('This permanently deletes your account, profile and scan history from this device. Continue?')) return;
    await deleteAccount(state.session);
    state.session = null;
    state.profile = { allergens: [], diets: [], keywords: [] };
    toast('Account deleted');
    render();
  });

  target.append(
    el('h1', { class: 'page-title' }, ['Settings']),
    el('section', { class: 'card' }, [
      el('h2', { class: 'card-title' }, ['Display']),
      el('div', { class: 'setting-row column' }, [
        el('div', { class: 'row-between' }, [
          el('label', { class: 'setting-label', for: 'font-scale' }, ['Text size']),
          fontValue,
        ]),
        fontSlider,
      ]),
      makeToggle('High contrast', 'highContrast', 'Boosts contrast for low vision'),
      makeToggle('Reduce motion', 'reduceMotion', 'Turns off animations and transitions'),
    ]),
    el('section', { class: 'card' }, [
      el('h2', { class: 'card-title' }, ['Audio and feedback']),
      makeToggle('Speak results aloud', 'voice', 'Reads the verdict using your device voice'),
      makeToggle('Vibration on scan', 'haptics', 'Short buzz when a barcode is detected'),
      el('button', { class: 'btn btn-secondary btn-block', type: 'button', onClick: () => {
        voice.speak('SafeBite. Scan a product to check it against your allergies.');
      } }, ['🔊 Test voice']),
    ]),
    el('section', { class: 'card' }, [
      el('h2', { class: 'card-title' }, ['Account']),
      el('p', { class: 'meta-line' }, [`Signed in as ${state.session.email}`]),
      el('div', { class: 'btn-row' }, [exportBtn, signOutBtn]),
      deleteBtn,
    ]),
    el('section', { class: 'card' }, [
      el('h2', { class: 'card-title' }, ['About']),
      el('p', { class: 'meta-line' }, ['SafeBite checks a scanned product against your own allergy profile.']),
      el('p', { class: 'meta-line' }, ['Product data: Open Food Facts (ODbL). Camera frames never leave this device.']),
      el('p', { class: 'meta-line' }, [`Version 1.0 · ${isDetectorSupported() ? 'Camera scanning supported' : 'Camera scanning unavailable in this browser'}`]),
      el('a', { class: 'btn btn-secondary btn-block', href: '#/diagnostics' }, ['Open device check']),
    ])
  );
}

/* --------------------------------------------------------- 设备自检页 */

/** 采集本机能力状态，用于真机测试与演示前检查 */
async function collectDiagnostics() {
  const rows = [];
  const push = (label, value, status = 'ok') => rows.push({ label, value, status });

  const ua = navigator.userAgent;
  const chromeVersion = (ua.match(/Chrome\/([\d.]+)/) || [])[1] || 'unknown';
  push('Browser', `Chrome ${chromeVersion}`, 'ok');
  push('Platform', navigator.platform || 'unknown', 'ok');

  const detector = isDetectorSupported();
  push('BarcodeDetector API', detector ? 'supported' : 'not supported — type the barcode instead', detector ? 'ok' : 'warn');
  if (detector) {
    const formats = await supportedFormats();
    push('Barcode formats', formats.join(', ') || 'none reported', formats.length ? 'ok' : 'warn');
  }

  const hasCameraApi = Boolean(navigator.mediaDevices?.getUserMedia);
  push('Camera API', hasCameraApi ? 'available' : 'unavailable', hasCameraApi ? 'ok' : 'warn');
  if (navigator.mediaDevices?.enumerateDevices) {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const cams = devices.filter((d) => d.kind === 'videoinput').length;
      push('Video inputs', String(cams), cams > 0 ? 'ok' : 'warn');
    } catch {
      push('Video inputs', 'permission needed', 'warn');
    }
  }

  if ('serviceWorker' in navigator) {
    const reg = await navigator.serviceWorker.getRegistration().catch(() => null);
    push(
      'Service worker',
      reg?.active ? `active (${reg.active.state})` : reg ? 'registered, not yet active' : 'not registered',
      reg?.active ? 'ok' : 'fail'
    );
    const keys = await caches.keys().catch(() => []);
    const shell = keys.find((k) => k.startsWith('safebite-shell-'));
    let shellCount = 0;
    if (shell) {
      const cache = await caches.open(shell);
      shellCount = (await cache.keys()).length;
    }
    push('App shell cache', shell ? `${shellCount} files in ${shell}` : 'none', shellCount >= 10 ? 'ok' : 'warn');
  } else {
    push('Service worker', 'not supported', 'fail');
  }

  try {
    const { getAll } = await import('./db.js');
    const [scans, cached, users] = await Promise.all([
      getAll('scans').catch(() => []),
      getAll('cache').catch(() => []),
      getAll('users').catch(() => []),
    ]);
    push('Saved scans', String(scans.length), 'ok');
    push('Products available offline', String(cached.length), cached.length ? 'ok' : 'warn');
    push('Local accounts', String(users.length), 'ok');
  } catch (err) {
    push('Local storage', `error: ${err.message}`, 'fail');
  }

  if (navigator.storage?.estimate) {
    const est = await navigator.storage.estimate().catch(() => null);
    if (est?.quota) {
      push('Storage used', `${(est.usage / 1048576).toFixed(1)} MB of ${(est.quota / 1048576).toFixed(0)} MB`, 'ok');
    }
  }

  push('Network', navigator.onLine === false ? 'offline' : 'online', navigator.onLine === false ? 'warn' : 'ok');
  return rows;
}

function renderDiagnostics(target) {
  const list = el('ul', { class: 'diag-list' });
  const cameraResult = el('p', { class: 'meta-line', role: 'status' }, ['Camera not tested yet.']);

  const paint = async () => {
    clear(list);
    list.append(el('li', { class: 'diag-row' }, [el('span', { class: 'diag-label' }, ['Checking…'])]));
    const rows = await collectDiagnostics();
    clear(list);
    for (const row of rows) {
      list.append(
        el('li', { class: 'diag-row' }, [
          el('span', { class: 'diag-label' }, [row.label]),
          el('span', { class: `diag-value diag-${row.status}` }, [row.value]),
        ])
      );
    }
    return rows;
  };

  const preloadBtn = el('button', { class: 'btn btn-primary btn-block', type: 'button' }, ['Preload demo products for offline use']);
  preloadBtn.addEventListener('click', async () => {
    preloadBtn.disabled = true;
    preloadBtn.textContent = 'Downloading…';
    let ok = 0;
    const failed = [];
    for (const item of DEMO_BARCODES) {
      const res = await fetchProduct(item.code, { force: true });
      if (res.status === 'ok') ok += 1;
      else failed.push(item.code);
    }
    preloadBtn.disabled = false;
    preloadBtn.textContent = 'Preload demo products for offline use';
    toast(
      failed.length
        ? `Saved ${ok}/${DEMO_BARCODES.length} — could not reach ${failed.join(', ')}`
        : `All ${ok} demo products are saved on this device`,
      failed.length ? 'error' : 'info'
    );
    await paint();
  });

  const cameraBtn = el('button', { class: 'btn btn-secondary btn-block', type: 'button' }, ['Test camera (2 seconds)']);
  cameraBtn.addEventListener('click', async () => {
    cameraBtn.disabled = true;
    cameraResult.textContent = 'Requesting camera…';
    let stream = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } } });
      const track = stream.getVideoTracks()[0];
      const settings = track.getSettings ? track.getSettings() : {};
      cameraResult.textContent = `Camera OK — ${track.label || 'camera'} at ${settings.width || '?'}×${settings.height || '?'}.`;
      toast('Camera works');
    } catch (err) {
      cameraResult.textContent =
        err?.name === 'NotAllowedError'
          ? 'Camera permission denied. Allow it in Chrome site settings, then try again.'
          : `Camera failed: ${err?.message || err?.name}`;
      toast('Camera test failed', 'error');
    } finally {
      if (stream) for (const t of stream.getTracks()) t.stop();
      cameraBtn.disabled = false;
    }
  });

  const copyBtn = el('button', { class: 'btn btn-secondary btn-block', type: 'button' }, ['Copy report to clipboard']);
  copyBtn.addEventListener('click', async () => {
    const rows = await paint();
    const text = [
      `SafeBite device check — ${new Date().toISOString()}`,
      `User agent: ${navigator.userAgent}`,
      ...rows.map((r) => `${r.label}: ${r.value} [${r.status}]`),
    ].join('\n');
    try {
      await navigator.clipboard.writeText(text);
      toast('Report copied — paste it into the device test log');
    } catch {
      toast('Clipboard blocked — screenshot this page instead', 'error');
    }
  });

  target.append(
    el('h1', { class: 'page-title' }, ['Device check']),
    el('p', { class: 'page-sub' }, [
      'Live status of this device. Run it before the demo and when filling in the device test log.',
    ]),
    el('section', { class: 'card' }, [list]),
    el('section', { class: 'card' }, [
      el('h2', { class: 'card-title' }, ['Prepare for the demo']),
      el('p', { class: 'meta-line' }, [
        'Downloads the demo products so they work even if the venue Wi-Fi fails.',
      ]),
      el('div', { class: 'btn-stack' }, [preloadBtn, cameraBtn, copyBtn]),
      cameraResult,
    ])
  );

  void paint();
}

/* ------------------------------------------------------------- 启动 */

async function startSession() {
  state.session = await currentUser();
  if (state.session) {
    const profile = await loadProfile(state.session);
    state.profile = profile || { allergens: [], diets: [], keywords: [] };
  }
}

async function boot() {
  const prefs = await initPrefs();
  voice.setEnabled(prefs.voice);

  // 无障碍公告区（屏幕阅读器）
  document.body.append(el('div', { id: 'sr-announcer', class: 'sr-only', role: 'status', 'aria-live': 'polite' }));

  await startSession();
  render();

  window.addEventListener('hashchange', render);

  const updateOnline = () => {
    const strip = document.getElementById('offline-strip');
    if (strip) strip.hidden = navigator.onLine !== false;
  };
  window.addEventListener('online', updateOnline);
  window.addEventListener('offline', updateOnline);

  // 页面离开时释放摄像头
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopScanner();
  });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch((err) => {
      console.warn('Service worker registration failed', err);
    });
  }
}

boot().catch((err) => {
  console.error(err);
  app().append(el('div', { class: 'banner banner-error' }, [`Startup error: ${err.message}`]));
});
