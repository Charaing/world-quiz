// 원본 문항 데이터(quiz_1230_ko.json) → 앱용 모드별 데이터(data/*.json, data/meta.json)
// 사용법: node scripts/import-source.mjs "<quiz_1230_ko.json 경로>"
// - 문항 ID(G0001, U0001, X0001 …)는 원본 그대로 유지한다. 학습 기록은 ID 기준이므로 데이터가 바뀌어도 기록이 이어진다.
// - 원본에 없는 값(난이도 수치, 추가 배경 지식)은 만들어 넣지 않는다.
// - 근거 발췌문(evidence)·스냅샷 경로는 앱 데이터에 넣지 않고 출처 제목·발행기관·URL·위치만 담는다.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const SRC = process.argv[2];
if (!SRC) { console.error('usage: node scripts/import-source.mjs <quiz_1230_ko.json>'); process.exit(1); }
const ROOT = resolve(import.meta.dirname, '..');
const OUT = join(ROOT, 'data');

const raw = JSON.parse(readFileSync(SRC, 'utf8'));
const PACK_TO_MODE = { general: 'general', unexpected: 'surprising', extreme: 'expert' };
const byMode = { general: [], surprising: [], expert: [] };

for (const q of raw.questions) {
  const mode = PACK_TO_MODE[q.pack];
  if (!mode) throw new Error(`unknown pack ${q.pack} (${q.id})`);
  byMode[mode].push({
    id: q.id,
    mode,
    category: q.category,
    difficulty: null, // 원본에 문항별 난이도 없음 (모드 자체가 편집상 분류)
    question: q.question,
    options: q.choices,
    correctIndex: q.answer_index,
    answer: q.answer,
    explanation: q.explanation,
    extraFact: '',
    sources: q.sources.map((s) => ({ name: s.title, publisher: s.publisher, url: s.url, locator: s.locator })),
    verificationStatus: q.verification.status,
    editorialReview: q.verification.editorial_review,
    referenceCheck: q.verification.reference_check,
    checkedAt: q.verification.checked_at,
    factKey: q.fact_key,
  });
}

mkdirSync(OUT, { recursive: true });
const meta = {
  version: raw.dataset_version,
  sourceSchema: raw.schema_version,
  total: 0,
  difficultyBasis: raw.difficulty_basis,
  verificationNotice: raw.verification_notice,
  modes: {},
  verification: {},
  editorial: {},
};
for (const [mode, list] of Object.entries(byMode)) {
  list.sort((a, b) => a.id.localeCompare(b.id));
  writeFileSync(join(OUT, `${mode}.json`), JSON.stringify(list));
  const categories = {};
  for (const q of list) (categories[q.category] ??= { label: q.category, count: 0 }).count++;
  meta.modes[mode] = { ids: list.map((q) => q.id), categories };
  meta.total += list.length;
  for (const q of list) {
    meta.verification[q.verificationStatus] = (meta.verification[q.verificationStatus] || 0) + 1;
    meta.editorial[q.editorialReview] = (meta.editorial[q.editorialReview] || 0) + 1;
  }
}
writeFileSync(join(OUT, 'meta.json'), JSON.stringify(meta));
console.log(`imported ${raw.dataset_version}: general ${byMode.general.length}, surprising ${byMode.surprising.length}, expert ${byMode.expert.length}, total ${meta.total}`);
