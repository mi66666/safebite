/**
 * crypto.test.mjs — 安全层单元测试
 * 在 Node 里跑的是同一个 WebCrypto 实现，因此测的正是浏览器里跑的那套代码。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { deriveFromPassword, encryptJSON, decryptJSON, safeEqual, randomSalt, passwordIssues, toB64, fromB64 } from '../js/crypto.js';

const enc = new TextEncoder();

test('base64 round-trips arbitrary bytes', () => {
  const bytes = new Uint8Array([0, 1, 2, 250, 255, 128]);
  assert.deepEqual([...fromB64(toB64(bytes))], [...bytes]);
});

test('same password + same salt derives the same verifier', async () => {
  const salt = randomSalt(16);
  const a = await deriveFromPassword('correct-horse-1', salt);
  const b = await deriveFromPassword('correct-horse-1', salt);
  assert.equal(a.verifier, b.verifier);
});

test('different salt derives a different verifier', async () => {
  const a = await deriveFromPassword('correct-horse-1', randomSalt(16));
  const b = await deriveFromPassword('correct-horse-1', randomSalt(16));
  assert.notEqual(a.verifier, b.verifier);
});

test('different password derives a different verifier', async () => {
  const salt = randomSalt(16);
  const a = await deriveFromPassword('correct-horse-1', salt);
  const b = await deriveFromPassword('correct-horse-2', salt);
  assert.notEqual(a.verifier, b.verifier);
});

test('profile payload encrypts and decrypts with the derived data key', async () => {
  const salt = randomSalt(16);
  const { dataKey } = await deriveFromPassword('correct-horse-1', salt);
  const profile = { allergens: ['milk', 'nuts'], diets: ['vegan'], keywords: ['coconut'] };
  const payload = await encryptJSON(dataKey, profile);
  assert.ok(payload.ct.length > 0);
  // 密文里不应出现明文内容
  assert.equal(payload.ct.includes('milk'), false);
  const back = await decryptJSON(dataKey, payload);
  assert.deepEqual(back, profile);
});

test('a wrong key cannot decrypt the payload', async () => {
  const good = await deriveFromPassword('correct-horse-1', randomSalt(16));
  const bad = await deriveFromPassword('wrong-password-9', randomSalt(16));
  const payload = await encryptJSON(good.dataKey, { allergens: ['milk'] });
  await assert.rejects(() => decryptJSON(bad.dataKey, payload));
});

test('tampered ciphertext is rejected by AES-GCM', async () => {
  const { dataKey } = await deriveFromPassword('correct-horse-1', randomSalt(16));
  const payload = await encryptJSON(dataKey, { allergens: ['milk'] });
  const bytes = fromB64(payload.ct);
  bytes[0] ^= 0xff;
  await assert.rejects(() => decryptJSON(dataKey, { iv: payload.iv, ct: toB64(bytes) }));
});

test('safeEqual compares without early exit', () => {
  assert.equal(safeEqual('abc', 'abc'), true);
  assert.equal(safeEqual('abc', 'abd'), false);
  assert.equal(safeEqual('abc', 'abcd'), false);
});

test('passwordIssues enforces the documented rules', () => {
  assert.deepEqual(passwordIssues('short1'), ['Use at least 8 characters']);
  assert.ok(passwordIssues('allletters').some((i) => /number/.test(i)));
  assert.ok(passwordIssues('12345678').some((i) => /letter/.test(i)));
  assert.deepEqual(passwordIssues('goodpass1'), []);
});
