/**
 * ui.js — 轻量 DOM 工具与通用 UI 片段（不引入框架，保持课程教学的技术栈）
 */

/** 创建元素：el('div', {class:'x', onClick:fn, dataset:{a:1}}, [child, 'text']) */
export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value);
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'html') node.innerHTML = value; // 仅用于受信任的静态图标
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of [].concat(children)) {
    if (child == null || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

const VERDICT_META = {
  danger: { label: 'Avoid', icon: '⛔', cls: 'verdict-danger', hint: 'Matches something in your profile' },
  caution: { label: 'Caution', icon: '⚠️', cls: 'verdict-caution', hint: 'May contain, or status unclear' },
  safe: { label: 'No match', icon: '✅', cls: 'verdict-safe', hint: 'Nothing in your profile matched' },
  unknown: { label: 'Unknown', icon: '❔', cls: 'verdict-unknown', hint: 'Not enough data on this product' },
};

export function verdictMeta(verdict) {
  return VERDICT_META[verdict] || VERDICT_META.unknown;
}

let toastTimer = null;

export function toast(message, kind = 'info', ms = 3200) {
  let host = document.getElementById('toast-host');
  if (!host) {
    host = el('div', { id: 'toast-host', class: 'toast-host', role: 'status', 'aria-live': 'polite' });
    document.body.append(host);
  }
  clear(host);
  host.append(el('div', { class: `toast toast-${kind}` }, [message]));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => clear(host), ms);
}

export function relativeTime(ts) {
  const diff = Date.now() - Number(ts || 0);
  const min = Math.round(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const hours = Math.round(min / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} d ago`;
  return new Date(Number(ts)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** 首字母占位图，避免商品缺图时布局塌陷 */
export function placeholderImage(label = '?') {
  const letter = String(label).trim().charAt(0).toUpperCase() || '?';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" role="img" aria-label="No product photo">
    <rect width="96" height="96" rx="16" fill="#e8eaf0"/>
    <text x="48" y="60" font-family="system-ui,sans-serif" font-size="40" font-weight="600" fill="#8a90a2" text-anchor="middle">${letter}</text>
  </svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** 简易防抖，用于输入框实时校验 */
export function debounce(fn, ms = 300) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}
