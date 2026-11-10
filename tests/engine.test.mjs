// 퀴즈 엔진 테스트 — node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { shuffle, randInt, pickQuestionIds, makeSession, recordAnswer, accuracy, summarize } from '../js/engine.js';

const meta = JSON.parse(readFileSync(new URL('../data/meta.json', import.meta.url), 'utf8'));
const general = JSON.parse(readFileSync(new URL('../data/general.json', import.meta.url), 'utf8'));
const ids = meta.modes.general.ids;

test('셔플은 원소를 잃거나 복제하지 않는다', () => {
  const a = [...Array(100).keys()];
  const s = shuffle(a);
  assert.equal(s.length, 100);
  assert.deepEqual([...s].sort((x, y) => x - y), a);
  assert.notStrictEqual(s, a);
});

test('randInt 범위와 대략적 균등성', () => {
  const counts = [0, 0, 0, 0];
  for (let i = 0; i < 40000; i++) counts[randInt(4)]++;
  for (const c of counts) assert.ok(c > 9000 && c < 11000, `count ${c}`);
});

test('게임을 반복해도 이전에 출제된 문제는 다시 나오지 않는다 (1,000문제 전부 소진)', () => {
  const seen = new Set();
  let games = 0;
  while (true) {
    const pick = pickQuestionIds(ids, seen, 20);
    if (!pick.length) break;
    assert.equal(new Set(pick).size, pick.length, '같은 게임 안 중복');
    for (const id of pick) { assert.ok(!seen.has(id), `재출제: ${id}`); seen.add(id); }
    games++;
    // 예시: 1게임 후 980, 2게임 후 960 남음
    if (games === 1) assert.equal(ids.length - seen.size, 980);
    if (games === 2) assert.equal(ids.length - seen.size, 960);
  }
  assert.equal(games, 50);
  assert.equal(seen.size, 1000);
  assert.equal(pickQuestionIds(ids, seen, 10).length, 0, '모두 풀면 더 이상 출제되지 않음');
});

test('남은 문제가 요청 수보다 적으면 남은 만큼만 출제', () => {
  const seen = new Set(ids.slice(0, 993));
  const pick = pickQuestionIds(ids, seen, 20);
  assert.equal(pick.length, 7);
  assert.ok(pick.every((id) => !seen.has(id)));
  assert.equal(pickQuestionIds(ids, seen, 'all').length, 7);
});

test('출제 기록에 없는 ID(데이터 업데이트로 사라진 ID)가 있어도 정상 동작', () => {
  const seen = new Set(['G9999', ...ids.slice(0, 10)]);
  assert.equal(pickQuestionIds(ids, seen, 'all').length, 990);
});

test('답안은 한 번만 기록되고 수정할 수 없다 (중복 점수 방지)', () => {
  const qById = new Map(general.map((q) => [q.id, q]));
  const s = makeSession({ mode: 'general', ids: ids.slice(0, 3) });
  const q = qById.get(s.items[0].id);
  const displayOfCorrect = s.items[0].order.indexOf(q.correctIndex);
  const a1 = recordAnswer(s, q, displayOfCorrect);
  assert.equal(a1.correct, true);
  assert.equal(recordAnswer(s, q, (displayOfCorrect + 1) % 4), null);
  assert.equal(s.answers[0].correct, true);
});

test('보기 순서를 섞어도 정답 판정이 정확하다 (전 문항)', () => {
  for (const q of general) {
    const s = makeSession({ mode: 'general', ids: [q.id] });
    const d = s.items[0].order.indexOf(q.correctIndex);
    assert.equal(recordAnswer(s, q, d).correct, true, q.id);
    assert.equal(q.options[s.items[0].order[d]], q.answer, q.id);
  }
});

test('같은 세션에 중복 ID를 넣으면 거부', () => {
  assert.throws(() => makeSession({ mode: 'general', ids: ['G0001', 'G0001'] }));
});

test('정답률 계산과 0 나누기 방지', () => {
  assert.equal(accuracy(0, 0), 0);
  assert.equal(accuracy(7, 10), 70);
  assert.equal(accuracy(1, 3), 33.3);
});

test('결과 요약: 분야별 정답률과 약한 분야', () => {
  const qById = new Map(general.map((q) => [q.id, q]));
  const s = makeSession({ mode: 'general', ids: ids.slice(0, 10) });
  s.items.forEach((it, i) => {
    s.index = i;
    const q = qById.get(it.id);
    const d = it.order.indexOf(q.correctIndex);
    recordAnswer(s, q, i < 6 ? d : (d + 1) % 4);
  });
  const sum = summarize(s, qById);
  assert.equal(sum.total, 10);
  assert.equal(sum.correct, 6);
  assert.equal(sum.wrong, 4);
  assert.equal(sum.rate, 60);
  const total = Object.values(sum.byCat).reduce((a, v) => a + v.total, 0);
  assert.equal(total, 10);
  assert.ok(sum.weakest);
});
