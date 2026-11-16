/**
 * logic.js — 纯函数逻辑层（无 DOM 依赖，可被 node:test 直接测试）
 * 职责：条码校验、过敏原比对、营养分级、语音播报文案生成
 */

/** EU 14 类法定过敏原 + Open Food Facts 的标签别名映射
 *  words: 配料表文本兜底识别用的关键词（当数据库漏填 allergens_tags 时救命）
 */
export const ALLERGENS = [
  {
    id: 'gluten',
    label: 'Cereals containing gluten',
    tags: ['gluten', 'wheat', 'barley', 'oats', 'rye', 'spelt', 'kamut'],
    words: ['wheat', 'barley', 'rye', 'oat', 'spelt', 'kamut', 'semolina', 'couscous', 'bulgur', 'malt', 'flour'],
  },
  { id: 'crustaceans', label: 'Crustaceans', tags: ['crustaceans'], words: ['crab', 'prawn', 'shrimp', 'lobster', 'crayfish', 'langoustine', 'crustacean'] },
  { id: 'eggs', label: 'Eggs', tags: ['eggs', 'egg'], words: ['egg', 'albumen', 'ovalbumin', 'mayonnaise'] },
  { id: 'fish', label: 'Fish', tags: ['fish'], words: ['fish', 'anchovy', 'cod', 'salmon', 'tuna', 'haddock', 'sardine', 'fishmeal'] },
  { id: 'peanuts', label: 'Peanuts', tags: ['peanuts', 'peanut'], words: ['peanut', 'groundnut', 'arachis'] },
  { id: 'soybeans', label: 'Soybeans', tags: ['soybeans', 'soy', 'soya'], words: ['soy', 'soya', 'tofu', 'edamame', 'tempeh'] },
  {
    id: 'milk',
    label: 'Milk',
    tags: ['milk', 'lactose'],
    words: ['milk', 'cream', 'butter', 'cheese', 'whey', 'casein', 'caseinate', 'lactose', 'yoghurt', 'yogurt', 'ghee', 'buttermilk', 'curd'],
  },
  {
    id: 'nuts',
    label: 'Tree nuts',
    tags: ['nuts', 'almonds', 'hazelnuts', 'walnuts', 'cashews', 'pecans', 'brazil-nuts', 'macadamia-nuts', 'pistachio-nuts', 'chestnuts'],
    words: ['almond', 'hazelnut', 'walnut', 'cashew', 'pecan', 'brazil nut', 'macadamia', 'pistachio', 'chestnut', 'praline', 'marzipan'],
  },
  { id: 'celery', label: 'Celery', tags: ['celery'], words: ['celery', 'celeriac'] },
  { id: 'mustard', label: 'Mustard', tags: ['mustard'], words: ['mustard'] },
  { id: 'sesame', label: 'Sesame seeds', tags: ['sesame-seeds', 'sesame'], words: ['sesame', 'tahini'] },
  { id: 'sulphites', label: 'Sulphur dioxide and sulphites', tags: ['sulphur-dioxide-and-sulphites', 'sulphites'], words: ['sulphite', 'sulfite', 'metabisulphite', 'metabisulfite', 'e220', 'e221', 'e222', 'e223', 'e224', 'e225', 'e226', 'e227', 'e228'] },
  { id: 'lupin', label: 'Lupin', tags: ['lupin'], words: ['lupin'] },
  { id: 'molluscs', label: 'Molluscs', tags: ['molluscs'], words: ['squid', 'mussel', 'oyster', 'clam', 'scallop', 'octopus', 'snail', 'whelk', 'mollusc'] },
];

/**
 * 文本兜底的排除规则：这些写法虽然包含关键词，但并非该过敏原。
 * 例：coconut milk 不含乳蛋白，cocoa butter 不是乳制品，rice flour 不含麸质，
 *     "milk-free" 是反向声明。宁可漏判也不要把"椰子奶"报成"含牛奶"，
 *     因为误报会让用户对整个 app 失去信任。
 */
const TEXT_EXCLUSIONS = {
  milk: [
    /(coconut|oat|soya?|almond|rice|cashew|hazelnut|hemp|pea|potato|seed)\s*milk/,
    /(cocoa|shea|peanut|nut|apple|sunflower|seed)\s*butter/,
    /milk\s*thistle/,
    /(non-?dairy|dairy\s*-?\s*free|milk\s*-?\s*free|free\s+from\s+[a-z\s]{0,14}$)/,
  ],
  gluten: [
    /(rice|corn|maize|potato|coconut|almond|chickpea|gram|tapioca|buckwheat|soya?|oat)\s*flour/,
    /(gluten\s*-?\s*free|free\s+from\s+[a-z\s]{0,14}$)/,
  ],
  nuts: [/(nutmeg|nut\s*butter alternatives|shea\s*nut)/],
  eggs: [/eggplant|egg\s*-?\s*free/],
  soybeans: [/(soy|soya)\s*(sauce)?\s*-?\s*free/],
};


/** 饮食偏好 → 判定规则 */
export const DIETS = [
  { id: 'vegan', label: 'Vegan' },
  { id: 'vegetarian', label: 'Vegetarian' },
  { id: 'halal', label: 'Halal' },
  { id: 'no-palm-oil', label: 'No palm oil' },
];

const stripPrefix = (tag) => String(tag || '').replace(/^[a-z]{2}:/i, '').trim().toLowerCase();

/** 把 Open Food Facts 的 *_tags 数组标准化为裸标签集合 */
export function normalizeTags(tags) {
  const out = new Set();
  for (const t of tags || []) out.add(stripPrefix(t));
  return out;
}

/**
 * 校验并规范化条码。支持 EAN-13 / EAN-8 / UPC-A(EAN-13 补零)。
 * @returns {{valid: boolean, code: string, type: string|null, reason: string|null}}
 */
export function validateBarcode(raw) {
  const code = String(raw ?? '').replace(/[\s-]/g, '');
  if (!code) return { valid: false, code, type: null, reason: 'empty' };
  if (!/^\d+$/.test(code)) return { valid: false, code, type: null, reason: 'non-numeric' };

  const len = code.length;
  if (![8, 12, 13].includes(len)) {
    return { valid: false, code, type: null, reason: 'unsupported-length' };
  }

  // UPC-A 是 12 位，在 Open Food Facts 里以 EAN-13 补前导 0 存储
  const ean = len === 12 ? '0' + code : code;
  const expected = eanCheckDigit(ean.slice(0, -1));
  const actual = Number(ean.slice(-1));
  if (expected !== actual) {
    return { valid: false, code, type: null, reason: 'checksum' };
  }

  const type = ean.length === 13 ? (len === 12 ? 'UPC-A' : 'EAN-13') : 'EAN-8';
  return { valid: true, code: ean, type, reason: null };
}

/** 按 GS1 规则计算校验位 */
export function eanCheckDigit(body) {
  const digits = String(body).split('').map(Number);
  if (digits.some(Number.isNaN)) throw new TypeError('body must be digits only');
  // 从右往左，奇数位 ×3
  let sum = 0;
  for (let i = digits.length - 1, w = 3; i >= 0; i--, w = w === 3 ? 1 : 3) {
    sum += digits[i] * w;
  }
  return (10 - (sum % 10)) % 10;
}

/**
 * 在配料文本里查找某个过敏原的证据。
 * 逐个关键词扫描，命中后取上下文窗口，若窗口命中排除规则则继续找下一个出现位置。
 * @returns {string[]} 命中的关键词（已排除误报）
 */
export function findTextEvidence(allergen, ingredientsText) {
  const hay = String(ingredientsText || '').toLowerCase();
  if (!hay || !Array.isArray(allergen.words)) return [];
  const exclusions = TEXT_EXCLUSIONS[allergen.id] || [];
  const hits = [];

  for (const word of allergen.words) {
    let idx = hay.indexOf(word);
    while (idx !== -1) {
      const window = hay.slice(Math.max(0, idx - 30), idx + word.length + 16);
      const excluded = exclusions.some((re) => re.test(window));
      if (!excluded) {
        hits.push(word);
        break; // 同一关键词只需命中一次
      }
      idx = hay.indexOf(word, idx + word.length);
    }
  }
  return hits;
}

/**
 * 核心：把商品数据与用户档案比对，得出结论。
 * @param {object} product Open Food Facts 商品对象
 * @param {{allergens?: string[], diets?: string[], keywords?: string[]}} profile 用户档案
 * @returns {{verdict:'danger'|'caution'|'safe'|'unknown', contains:Array, traces:Array, textHits:Array, dietFlags:Array, keywordHits:Array, dataQuality:string}}
 */
export function assessProduct(product, profile = {}) {
  const contains = [];
  const traces = [];
  const textHits = [];
  const dietFlags = [];
  const keywordHits = [];

  if (!product || typeof product !== 'object') {
    return { verdict: 'unknown', contains, traces, textHits, dietFlags, keywordHits, dataQuality: 'no-product' };
  }

  const allergenTags = normalizeTags(product.allergens_tags);
  const traceTags = normalizeTags(product.traces_tags);
  const analysisTags = normalizeTags(product.ingredients_analysis_tags);
  const ingredientsText = String(product.ingredients_text || product.ingredients_text_en || '');
  const wanted = new Set(profile.allergens || []);

  for (const allergen of ALLERGENS) {
    if (!wanted.has(allergen.id)) continue;
    const hit = allergen.tags.find((t) => allergenTags.has(t));
    if (hit) {
      contains.push({ id: allergen.id, label: allergen.label, tag: hit });
      continue;
    }
    const traceHit = allergen.tags.find((t) => traceTags.has(t));
    if (traceHit) {
      traces.push({ id: allergen.id, label: allergen.label, tag: traceHit });
      continue;
    }
    // 关键兜底：社区数据库常常漏填 allergens_tags。
    // 如果配料表里明确写了 milk powder，却因为标签缺失就说"安全"，那是最危险的错误。
    const words = findTextEvidence(allergen, ingredientsText);
    if (words.length) textHits.push({ id: allergen.id, label: allergen.label, words });
  }

  // 饮食偏好
  for (const diet of profile.diets || []) {
    if (diet === 'vegan') {
      if (analysisTags.has('non-vegan')) dietFlags.push({ id: 'vegan', label: 'Not vegan', level: 'contains' });
      else if (analysisTags.has('maybe-vegan') || analysisTags.has('vegan-status-unknown')) {
        dietFlags.push({ id: 'vegan', label: 'Vegan status unclear', level: 'traces' });
      }
    }
    if (diet === 'vegetarian') {
      if (analysisTags.has('non-vegetarian')) dietFlags.push({ id: 'vegetarian', label: 'Not vegetarian', level: 'contains' });
      else if (analysisTags.has('maybe-vegetarian') || analysisTags.has('vegetarian-status-unknown')) {
        dietFlags.push({ id: 'vegetarian', label: 'Vegetarian status unclear', level: 'traces' });
      }
    }
    if (diet === 'halal') {
      // 无权威 halal 标记，用配料文本做保守提示
      if (/\b(pork|ham|bacon|gelatine|gelatin|lard)\b/i.test(ingredientsText)) {
        dietFlags.push({ id: 'halal', label: 'May not be halal (pork/gelatine)', level: 'contains' });
      }
    }
    if (diet === 'no-palm-oil') {
      if (analysisTags.has('palm-oil')) dietFlags.push({ id: 'no-palm-oil', label: 'Contains palm oil', level: 'contains' });
    }
  }

  // 用户自定义关键词
  const haystack = ingredientsText.toLowerCase();
  for (const kw of profile.keywords || []) {
    const needle = String(kw).trim().toLowerCase();
    if (needle && haystack.includes(needle)) keywordHits.push({ keyword: kw });
  }

  // 数据质量：没有过敏原信息也没有配料表 → 不能判定为安全
  const hasData = allergenTags.size > 0 || traceTags.size > 0 || ingredientsText.trim().length > 0;
  let dataQuality = 'complete';
  if (!hasData) dataQuality = 'missing';
  else if (allergenTags.size === 0 && traceTags.size === 0) dataQuality = 'partial';

  let verdict = 'safe';
  if (contains.length || dietFlags.some((d) => d.level === 'contains') || keywordHits.length) verdict = 'danger';
  else if (traces.length || textHits.length || dietFlags.some((d) => d.level === 'traces')) verdict = 'caution';
  else if (!hasData) verdict = 'unknown';

  return { verdict, contains, traces, textHits, dietFlags, keywordHits, dataQuality };
}

const NUTRI_SCORE = {
  a: { label: 'A', text: 'Excellent nutritional quality' },
  b: { label: 'B', text: 'Good nutritional quality' },
  c: { label: 'C', text: 'Average nutritional quality' },
  d: { label: 'D', text: 'Poor nutritional quality' },
  e: { label: 'E', text: 'Very poor nutritional quality' },
  unknown: { label: '?', text: 'Nutri-Score not available' },
};

export function nutriScoreInfo(grade) {
  const key = String(grade || '').toLowerCase();
  return NUTRI_SCORE[key] || NUTRI_SCORE.unknown;
}

export function novaInfo(group) {
  const map = {
    1: 'Unprocessed or minimally processed',
    2: 'Processed culinary ingredients',
    3: 'Processed',
    4: 'Ultra-processed',
  };
  return { group: Number(group) || null, text: map[Number(group)] || 'NOVA group not available' };
}

/** 生成给屏幕阅读器 / 语音朗读的整句播报文本 */
export function buildSpeechText({ productName, verdict, contains, traces, textHits, dietFlags, keywordHits }) {
  const name = productName || 'This product';
  const bits = [];
  if (verdict === 'danger') bits.push('Warning.');
  else if (verdict === 'caution') bits.push('Caution.');
  else if (verdict === 'unknown') bits.push('Not enough information.');
  else bits.push('No match with your profile.');

  if (contains?.length) bits.push(`Contains ${contains.map((c) => c.label).join(', ')}.`);
  if (keywordHits?.length) bits.push(`Ingredients mention ${keywordHits.map((k) => k.keyword).join(', ')}.`);
  const dangerDiets = (dietFlags || []).filter((d) => d.level === 'contains');
  if (dangerDiets.length) bits.push(`${dangerDiets.map((d) => d.label).join(', ')}.`);
  if (textHits?.length) {
    bits.push(
      `The ingredient list mentions ${textHits.map((t) => t.label).join(', ')}, although this entry has no allergen declaration.`
    );
  }
  if (traces?.length) bits.push(`May contain ${traces.map((t) => t.label).join(', ')}.`);
  return `${name}. ${bits.join(' ')}`.replace(/\s+/g, ' ').trim();
}

/** 格式化过敏原标签为人类可读短句 */
export function humanizeTags(tags, limit = 8) {
  const list = [...normalizeTags(tags)].map((t) => t.replace(/-/g, ' '));
  if (!list.length) return 'None declared';
  const shown = list.slice(0, limit).join(', ');
  return list.length > limit ? `${shown} +${list.length - limit} more` : shown;
}
