// IndexedDB 저장소 — 출제 기록 / 문제별 기록 / 게임 기록 / 진행 중 게임 / 북마크 / 신고 / 메타
// 출제 기록(seen)과 진행 중 게임(session)은 별도 저장소로 분리한다.

const DB_NAME = 'world-quiz';
const DB_VERSION = 1;
const STORES = {
  seen: { keyPath: 'id', indexes: ['mode'] },        // 출제 기록 (영구, ID 기준)
  qstats: { keyPath: 'id', indexes: ['mode'] },      // 문제별 정오답 기록, 오답 노트
  games: { keyPath: 'id', indexes: ['mode'] },       // 완료된 게임
  session: { keyPath: 'key' },                       // 진행 중 게임 (mode별)
  bookmarks: { keyPath: 'id' },
  reports: { keyPath: 'rid', autoIncrement: true },
  meta: { keyPath: 'key' },
};

let dbp = null;
export function openDB() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const [name, cfg] of Object.entries(STORES)) {
        if (db.objectStoreNames.contains(name)) continue;
        const os = db.createObjectStore(name, { keyPath: cfg.keyPath, autoIncrement: !!cfg.autoIncrement });
        for (const ix of cfg.indexes || []) os.createIndex(ix, ix);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('IndexedDB blocked'));
  });
  return dbp;
}

function wrap(req) {
  return new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });
}
async function tx(names, mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(names, mode);
    let out;
    Promise.resolve(fn(t)).then((v) => { out = v; }, reject);
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('transaction aborted'));
  });
}

export const get = (store, key) => tx([store], 'readonly', (t) => wrap(t.objectStore(store).get(key)));
export const getAll = (store) => tx([store], 'readonly', (t) => wrap(t.objectStore(store).getAll()));
export const put = (store, val) => tx([store], 'readwrite', (t) => wrap(t.objectStore(store).put(val)));
export const del = (store, key) => tx([store], 'readwrite', (t) => wrap(t.objectStore(store).delete(key)));
export const getAllByMode = (store, mode) =>
  tx([store], 'readonly', (t) => wrap(t.objectStore(store).index('mode').getAll(mode)));

/** 출제 기록 등록 — 이미 있으면 최초 시각 유지 (멱등) */
export function markSeen(id, mode, now = Date.now()) {
  return tx(['seen'], 'readwrite', async (t) => {
    const os = t.objectStore('seen');
    const cur = await wrap(os.get(id));
    if (!cur) os.put({ id, mode, at: now });
  });
}
export async function seenSet(mode) {
  const rows = mode ? await getAllByMode('seen', mode) : await getAll('seen');
  return new Set(rows.map((r) => r.id));
}
/** 해당 모드 출제 기록 초기화 — UI에서 모드를 모두 푼 경우에만 호출 */
export function clearSeen(mode) {
  return tx(['seen'], 'readwrite', async (t) => {
    const os = t.objectStore('seen');
    const keys = await wrap(os.index('mode').getAllKeys(mode));
    for (const k of keys) os.delete(k);
  });
}

/** 답안 반영: 문제별 기록 + 연속 정답 메타를 하나의 트랜잭션으로 */
export function applyAnswer({ q, correct, review }, now = Date.now()) {
  return tx(['qstats', 'meta'], 'readwrite', async (t) => {
    const os = t.objectStore('qstats');
    const s = (await wrap(os.get(q.id))) || {
      id: q.id, mode: q.mode, category: q.category,
      first: null, correctCount: 0, wrongCount: 0, reviewCorrect: 0, reviewWrong: 0,
      inWrongNote: false, lastAt: 0,
    };
    s.category = q.category;
    if (review) { correct ? s.reviewCorrect++ : s.reviewWrong++; }
    else if (s.first === null) s.first = correct;
    correct ? s.correctCount++ : s.wrongCount++;
    if (!correct) s.inWrongNote = true;
    s.lastResult = correct; s.lastAt = now;
    os.put(s);

    const ms = t.objectStore('meta');
    const st = (await wrap(ms.get('streak'))) || { key: 'streak', current: 0, best: 0 };
    st.current = correct ? st.current + 1 : 0;
    st.best = Math.max(st.best, st.current);
    ms.put(st);
    return s;
  });
}

export async function removeFromWrongNote(id) {
  const s = await get('qstats', id);
  if (s) { s.inWrongNote = false; await put('qstats', s); }
}

export async function getMeta(key, fallback = null) {
  const r = await get('meta', key);
  return r ? r.value ?? r : fallback;
}
export const setMeta = (key, value) => put('meta', { key, value });

/* ---------- 내보내기 / 가져오기 ---------- */
export async function exportAll() {
  const out = { app: 'world-quiz', format: 1, exportedAt: new Date().toISOString() };
  for (const name of Object.keys(STORES)) out[name] = await getAll(name);
  return out;
}

/** 병합 방식 가져오기: 기존 기록을 지우지 않고 합친다 */
export async function importAll(data) {
  if (!data || data.app !== 'world-quiz' || !Array.isArray(data.seen)) throw new Error('WORLD QUIZ 기록 파일이 아닙니다.');
  const counts = { seen: 0, qstats: 0, games: 0, bookmarks: 0 };
  await tx(Object.keys(STORES), 'readwrite', async (t) => {
    const merge = async (name, rows, pick) => {
      if (!Array.isArray(rows)) return;
      const os = t.objectStore(name);
      for (const r of rows) {
        if (!r || typeof r !== 'object') continue;
        const key = r[os.keyPath];
        if (key == null) continue;
        const cur = await wrap(os.get(key));
        const next = cur ? pick(cur, r) : r;
        if (next !== cur) { os.put(next); if (name in counts) counts[name]++; }
      }
    };
    await merge('seen', data.seen, (a, b) => (b.at < a.at ? b : a));
    await merge('qstats', data.qstats, (a, b) => {
      const ta = a.correctCount + a.wrongCount, tb = b.correctCount + b.wrongCount;
      return tb > ta ? b : a;
    });
    await merge('games', data.games, (a) => a);
    await merge('bookmarks', data.bookmarks, (a) => a);
    await merge('session', data.session, (a, b) => (b.updatedAt > (a.updatedAt || 0) ? b : a));
    await merge('meta', (data.meta || []).filter((m) => m.key === 'streak'), (a, b) => ({ ...a, best: Math.max(a.best || 0, b.best || 0) }));
    if (Array.isArray(data.reports)) {
      const os = t.objectStore('reports');
      for (const r of data.reports) { if (r && r.qid) { const { rid, ...rest } = r; os.add(rest); } }
    }
  });
  return counts;
}

export async function wipeAll() {
  await tx(Object.keys(STORES), 'readwrite', (t) => { for (const n of Object.keys(STORES)) t.objectStore(n).clear(); });
}
