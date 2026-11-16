/**
 * logic.test.mjs — 单元测试（node:test，零依赖）
 * 运行：cd "F:\dsh\mobile app\safebite" && node --test tests/
 *
 * 这些测试对应报告里 "Testing Strategy → unit tests" 一节的证据。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  validateBarcode,
  eanCheckDigit,
  assessProduct,
  nutriScoreInfo,
  novaInfo,
  buildSpeechText,
  humanizeTags,
  normalizeTags,
  findTextEvidence,
  ALLERGENS,
} from '../js/logic.js';

test('EAN-13 check digit matches GS1 rule', () => {
  // 真实商品条码：Nutella 3017620422003
  assert.equal(eanCheckDigit('301762042200'), 3);
  // Coca-Cola 5449000000996
  assert.equal(eanCheckDigit('544900000099'), 6);
});

test('validateBarcode accepts a real EAN-13', () => {
  const r = validateBarcode('3017620422003');
  assert.equal(r.valid, true);
  assert.equal(r.type, 'EAN-13');
  assert.equal(r.code, '3017620422003');
});

test('validateBarcode tolerates spaces and hyphens', () => {
  const r = validateBarcode(' 3017-6204-22003 ');
  assert.equal(r.valid, true);
  assert.equal(r.code, '3017620422003');
});

test('validateBarcode pads UPC-A (12 digits) to EAN-13', () => {
  const upc = '123456789012';
  const expectedCheck = eanCheckDigit('0' + upc.slice(0, -1));
  const fixed = upc.slice(0, -1) + expectedCheck;
  const r = validateBarcode(fixed);
  assert.equal(r.valid, true);
  assert.equal(r.type, 'UPC-A');
  assert.equal(r.code, '0' + fixed);
});

test('validateBarcode rejects a bad checksum', () => {
  const r = validateBarcode('3017620422004'); // 末位被改错
  assert.equal(r.valid, false);
  assert.equal(r.reason, 'checksum');
});

test('validateBarcode rejects wrong lengths and non-digits', () => {
  assert.equal(validateBarcode('12345').reason, 'unsupported-length');
  assert.equal(validateBarcode('abc123456789').reason, 'non-numeric');
  assert.equal(validateBarcode('').reason, 'empty');
});

test('normalizeTags strips language prefixes', () => {
  const tags = normalizeTags(['en:milk', 'en:nuts', 'fr:gluten']);
  assert.ok(tags.has('milk'));
  assert.ok(tags.has('nuts'));
  assert.ok(tags.has('gluten'));
});

test('assessProduct flags a declared allergen as danger', () => {
  const product = {
    allergens_tags: ['en:milk', 'en:nuts'],
    traces_tags: [],
    ingredients_text: 'Sugar, palm oil, hazelnuts, milk powder',
    ingredients_analysis_tags: ['en:vegetarian'],
  };
  const result = assessProduct(product, { allergens: ['milk'], diets: [], keywords: [] });
  assert.equal(result.verdict, 'danger');
  assert.equal(result.contains.length, 1);
  assert.equal(result.contains[0].id, 'milk');
});

test('assessProduct maps specific nut tags onto the tree-nut allergen', () => {
  const product = { allergens_tags: ['en:hazelnuts'], traces_tags: [], ingredients_text: 'hazelnuts' };
  const result = assessProduct(product, { allergens: ['nuts'] });
  assert.equal(result.verdict, 'danger');
  assert.equal(result.contains[0].id, 'nuts');
});

test('assessProduct downgrades traces to caution', () => {
  const product = { allergens_tags: [], traces_tags: ['en:peanuts'], ingredients_text: 'sugar, cocoa' };
  const result = assessProduct(product, { allergens: ['peanuts'] });
  assert.equal(result.verdict, 'caution');
  assert.equal(result.traces.length, 1);
});

test('assessProduct returns safe when nothing matches', () => {
  const product = { allergens_tags: ['en:milk'], traces_tags: [], ingredients_text: 'water, sugar' };
  const result = assessProduct(product, { allergens: ['peanuts'] });
  assert.equal(result.verdict, 'safe');
});

test('assessProduct returns unknown when product has no allergen data', () => {
  const product = { allergens_tags: [], traces_tags: [], ingredients_text: '' };
  const result = assessProduct(product, { allergens: ['milk'] });
  assert.equal(result.verdict, 'unknown');
  assert.equal(result.dataQuality, 'missing');
});

test('assessProduct detects custom keyword in ingredients', () => {
  const product = { allergens_tags: [], ingredients_text: 'Water, coconut milk, sugar' };
  const result = assessProduct(product, { allergens: [], keywords: ['coconut'] });
  assert.equal(result.verdict, 'danger');
  assert.equal(result.keywordHits[0].keyword, 'coconut');
});

test('assessProduct flags non-vegan products for vegan users', () => {
  const product = { allergens_tags: [], ingredients_text: 'milk', ingredients_analysis_tags: ['en:non-vegan'] };
  const result = assessProduct(product, { allergens: [], diets: ['vegan'] });
  assert.equal(result.verdict, 'danger');
  assert.equal(result.dietFlags[0].id, 'vegan');
});

test('assessProduct treats unclear vegan status as caution', () => {
  const product = { allergens_tags: [], ingredients_text: 'sugar', ingredients_analysis_tags: ['en:maybe-vegan'] };
  const result = assessProduct(product, { allergens: [], diets: ['vegan'] });
  assert.equal(result.verdict, 'caution');
});

test('assessProduct handles a null product without throwing', () => {
  const result = assessProduct(null, { allergens: ['milk'] });
  assert.equal(result.verdict, 'unknown');
});

test('nutriScoreInfo maps grades and falls back safely', () => {
  assert.equal(nutriScoreInfo('a').label, 'A');
  assert.equal(nutriScoreInfo('E').label, 'E');
  assert.equal(nutriScoreInfo('').label, '?');
  assert.equal(nutriScoreInfo(undefined).label, '?');
});

test('novaInfo describes ultra-processed food', () => {
  assert.match(novaInfo(4).text, /Ultra-processed/);
  assert.equal(novaInfo(null).group, null);
});

test('humanizeTags summarises long lists', () => {
  const tags = ['en:a', 'en:b', 'en:c', 'en:d', 'en:e', 'en:f', 'en:g', 'en:h', 'en:i'];
  assert.match(humanizeTags(tags, 3), /\+6 more/);
  assert.equal(humanizeTags([]), 'None declared');
});

test('buildSpeechText produces an actionable sentence', () => {
  const text = buildSpeechText({
    productName: 'Nutella',
    verdict: 'danger',
    contains: [{ label: 'Milk' }],
    traces: [{ label: 'Nuts' }],
    dietFlags: [],
    keywordHits: [],
  });
  assert.match(text, /^Nutella\./);
  assert.match(text, /Warning/);
  assert.match(text, /Contains Milk/);
  assert.match(text, /May contain Nuts/);
});

/* ------------------------------------------------------------------
 * 配料文本兜底：社区数据库常常漏填 allergens_tags，
 * 此时若只说"安全"就是最危险的错误。以下用例锁住这个行为。
 * ------------------------------------------------------------------ */

test('ingredient text catches an undeclared allergen as caution', () => {
  const product = {
    allergens_tags: [], // 条目漏填了过敏原声明
    traces_tags: [],
    ingredients_text: 'Sugar, wheat flour, milk powder, emulsifier (soya lecithin)',
  };
  const result = assessProduct(product, { allergens: ['milk'] });
  assert.equal(result.verdict, 'caution', '未声明的牛奶不能判为 safe');
  assert.equal(result.textHits.length, 1);
  assert.equal(result.textHits[0].id, 'milk');
  assert.equal(result.dataQuality, 'partial');
});

test('declared allergen still wins over text evidence', () => {
  const product = { allergens_tags: ['en:milk'], traces_tags: [], ingredients_text: 'milk powder' };
  const result = assessProduct(product, { allergens: ['milk'] });
  assert.equal(result.verdict, 'danger');
  assert.equal(result.contains.length, 1);
  assert.equal(result.textHits.length, 0, '已声明时不应重复计入文本证据');
});

test('plant "milks" are not treated as dairy', () => {
  for (const phrase of ['coconut milk', 'oat milk', 'soya milk', 'almond milk', 'rice milk', 'cashew milk']) {
    const result = assessProduct({ allergens_tags: [], ingredients_text: `Water, ${phrase}, sugar` }, { allergens: ['milk'] });
    assert.equal(result.verdict, 'safe', `${phrase} 不应被判为含乳`);
    assert.equal(result.textHits.length, 0, `${phrase} 不该产生文本证据`);
  }
});

test('non-dairy butters and dairy-free wording are excluded', () => {
  for (const phrase of ['cocoa butter', 'shea butter', 'peanut butter', 'milk thistle', 'milk-free recipe', 'dairy-free']) {
    const result = assessProduct({ allergens_tags: [], ingredients_text: `Water, ${phrase}, salt` }, { allergens: ['milk'] });
    assert.equal(result.textHits.length, 0, `${phrase} 不该被判为含乳`);
  }
});

test('gluten is found in wheat flour but not in rice flour', () => {
  const wheat = assessProduct({ allergens_tags: [], ingredients_text: 'wheat flour, water' }, { allergens: ['gluten'] });
  assert.equal(wheat.verdict, 'caution');
  assert.equal(wheat.textHits[0].id, 'gluten');

  const rice = assessProduct({ allergens_tags: [], ingredients_text: 'rice flour, water' }, { allergens: ['gluten'] });
  assert.equal(rice.verdict, 'safe');
  assert.equal(rice.textHits.length, 0);
});

test('findTextEvidence reports the matched keyword', () => {
  const milk = ALLERGENS.find((a) => a.id === 'milk');
  assert.deepEqual(findTextEvidence(milk, 'Ingredients: whey powder, sugar'), ['whey']);
  assert.deepEqual(findTextEvidence(milk, 'Ingredients: water, salt'), []);
  assert.deepEqual(findTextEvidence(milk, ''), []);
});

test('speech text explains text-only evidence', () => {
  const text = buildSpeechText({
    productName: 'Cereal bar',
    verdict: 'caution',
    contains: [],
    traces: [],
    textHits: [{ label: 'Milk' }],
    dietFlags: [],
    keywordHits: [],
  });
  assert.match(text, /Caution/);
  assert.match(text, /ingredient list mentions Milk/i);
  assert.match(text, /no allergen declaration/i);
});
