/**
 * db.js — IndexedDB 封装（无第三方依赖）
 *
 * 存储设计：
 *  users    keyPath: email      {email, saltB64, verifierB64, createdAt}
 *  profile  keyPath: email      {email, enc:{iv,ct}}     ← 忌口档案，AES-GCM 加密后存放
 *  scans    autoIncrement id    {email, barcode, ts, name, brand, verdict, snapshot}
 *  cache    keyPath: barcode    {barcode, payload, fetchedAt}   ← 商品数据离线缓存
 *  prefs    keyPath: key        {key, value}                    ← 无障碍/外观偏好
 *  session  keyPath: key        {key:'active', email, dataKey}  ← dataKey 是 CryptoKey 对象
 */

const DB_NAME = 'safebite';
const DB_VERSION = 1;

let dbPromise = null;

export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('users')) db.createObjectStore('users', { keyPath: 'email' });
      if (!db.objectStoreNames.contains('profile')) db.createObjectStore('profile', { keyPath: 'email' });
      if (!db.objectStoreNames.contains('scans')) {
        const s = db.createObjectStore('scans', { keyPath: 'id', autoIncrement: true });
        s.createIndex('byEmail', 'email');
        s.createIndex('byEmailTs', ['email', 'ts']);
      }
      if (!db.objectStoreNames.contains('cache')) db.createObjectStore('cache', { keyPath: 'barcode' });
      if (!db.objectStoreNames.contains('prefs')) db.createObjectStore('prefs', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('session')) db.createObjectStore('session', { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(store, mode, fn) {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(store, mode);
        const s = t.objectStore(store);
        let result;
        try {
          result = fn(s);
        } catch (err) {
          reject(err);
          return;
        }
        t.oncomplete = () => resolve(result && result.__req ? result.__req.result : result);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error || new Error('transaction aborted'));
      })
  );
}

const wrap = (req) => ({ __req: req });

export const get = (store, key) => tx(store, 'readonly', (s) => wrap(s.get(key)));
export const getAll = (store) => tx(store, 'readonly', (s) => wrap(s.getAll()));
export const put = (store, value) => tx(store, 'readwrite', (s) => wrap(s.put(value)));
export const del = (store, key) => tx(store, 'readwrite', (s) => wrap(s.delete(key)));
export const clear = (store) => tx(store, 'readwrite', (s) => wrap(s.clear()));

/** 按索引取一个 store 里的全部记录 */
export function getAllByIndex(store, indexName, value) {
  return tx(store, 'readonly', (s) => wrap(s.index(indexName).getAll(value)));
}

/** 取某用户的扫码历史，按时间倒序 */
export async function getScans(email, limit = 100) {
  const rows = await getAllByIndex('scans', 'byEmail', email);
  return rows.sort((a, b) => b.ts - a.ts).slice(0, limit);
}

/** 删除某用户的全部扫码记录 */
export async function clearScans(email) {
  const rows = await getAllByIndex('scans', 'byEmail', email);
  await Promise.all(rows.map((r) => del('scans', r.id)));
  return rows.length;
}
