// 퀴즈 엔진 — DOM·저장소와 무관한 순수 로직 (Node 테스트 가능)

const cryptoObj = globalThis.crypto;

/** [0, n) 범위의 균등 난수 정수 (거부 샘플링으로 modulo bias 제거) */
export function randInt(n) {
  if (!Number.isInteger(n) || n <= 0) throw new RangeError('n must be a positive integer');
  if (!cryptoObj?.getRandomValues) return Math.floor(Math.random() * n);
  const max = 0x100000000;
  const limit = max - (max % n);
  const buf = new Uint32Array(1);
  let x;
  do { cryptoObj.getRandomValues(buf); x = buf[0]; } while (x >= limit);
  return x % n;
}

/** Fisher–Yates (Durstenfeld) 셔플 — 원본을 변경하지 않고 새 배열 반환 */
export function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 출제 기록(seen)에 없는 문제 ID만 */
export function unseenIds(allIds, seenSet) {
  return allIds.filter((id) => !seenSet.has(id));
}

/**
 * 새 게임에 사용할 문제 ID 선택.
 * - 출제 기록에 있는 문제는 절대 포함하지 않는다.
 * - 같은 게임 안에 중복이 없다 (Set으로 보장).
 * - 요청 수보다 남은 문제가 적으면 남은 만큼만.
 */
export function pickQuestionIds(allIds, seenSet, count) {
  const pool = Array.from(new Set(unseenIds(allIds, seenSet)));
  const n = count === 'all' ? pool.length : Math.min(Math.max(0, count | 0), pool.length);
  return shuffle(pool).slice(0, n);
}

/** 보기 표시 순서 (원래 인덱스의 순열) */
export function optionOrder(k = 4) {
  return shuffle([...Array(k).keys()]);
}

export function makeSession({ mode, kind = 'normal', ids, timer = false, timeLimit = 0, now = Date.now() }) {
  if (new Set(ids).size !== ids.length) throw new Error('duplicate question in session');
  return {
    id: `g-${now.toString(36)}-${randInt(1e6).toString(36)}`,
    mode, kind, timer, timeLimit,
    startedAt: now, updatedAt: now,
    index: 0,
    items: ids.map((id) => ({ id, order: optionOrder(4) })),
    answers: [],
  };
}

/** 답안 기록. 이미 응답한 문제면 null 반환(답 수정·중복 점수 방지). displayIdx=null 은 시간 초과. */
export function recordAnswer(session, question, displayIdx, now = Date.now()) {
  const i = session.index;
  if (session.answers[i]) return null;
  const item = session.items[i];
  if (!item || item.id !== question.id) throw new Error('question mismatch');
  const chosen = displayIdx == null ? null : item.order[displayIdx];
  const ans = { id: question.id, chosen, correct: chosen === question.correctIndex, timeout: displayIdx == null, at: now };
  session.answers[i] = ans;
  session.updatedAt = now;
  return ans;
}

/** 정답률 = 정답 / 응답 완료 × 100 (응답 0이면 0) */
export function accuracy(correct, answered) {
  if (!answered) return 0;
  return Math.round((correct / answered) * 1000) / 10;
}

export function summarize(session, qById) {
  const answered = session.answers.filter(Boolean);
  const correct = answered.filter((a) => a.correct).length;
  const byCat = {};
  for (const a of answered) {
    const q = qById.get(a.id);
    const c = q ? q.category : 'unknown';
    byCat[c] ??= { total: 0, correct: 0 };
    byCat[c].total++;
    if (a.correct) byCat[c].correct++;
  }
  let weakest = null;
  for (const [cat, v] of Object.entries(byCat)) {
    const r = accuracy(v.correct, v.total);
    if (v.total - v.correct > 0 && (!weakest || r < weakest.rate || (r === weakest.rate && v.total > weakest.total))) {
      weakest = { cat, rate: r, total: v.total };
    }
  }
  return {
    total: session.items.length,
    answered: answered.length,
    correct,
    wrong: answered.length - correct,
    rate: accuracy(correct, answered.length),
    byCat, weakest,
  };
}

/** 최장 연속 정답 (답안 배열 기준) */
export function longestStreak(results) {
  let best = 0, cur = 0;
  for (const r of results) { cur = r ? cur + 1 : 0; if (cur > best) best = cur; }
  return best;
}
