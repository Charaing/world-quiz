// 데이터 완성도 자동 검증 — node scripts/validate.mjs
// 결과를 콘솔과 VALIDATION.md에 기록하고, 필수 조건이 하나라도 실패하면 종료 코드 1.
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const load = (f) => JSON.parse(readFileSync(join(ROOT, 'data', f), 'utf8'));
const meta = load('meta.json');
const modes = { general: load('general.json'), surprising: load('surprising.json'), expert: load('expert.json') };
const all = Object.values(modes).flat();

const checks = [];
const check = (name, ok, detail = '') => checks.push({ name, ok, detail });
const norm = (s) => s.normalize('NFC').toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
// 보기 비교용: 공백만 정규화 (−8과 8, 10⁷과 10¹¹ 같은 기호 차이를 보존)
const normOpt = (s) => s.normalize('NFC').trim().replace(/\s+/g, ' ');

check('일반 상식 1,000개', modes.general.length === 1000, `${modes.general.length}`);
check('의외의 상식 200개', modes.surprising.length === 200, `${modes.surprising.length}`);
check('초고난도 30개', modes.expert.length === 30, `${modes.expert.length}`);
check('총합 1,230개', all.length === 1230, `${all.length}`);
check('meta.json 총합·ID 목록 일치', meta.total === all.length && Object.entries(modes).every(([m, l]) => JSON.stringify(meta.modes[m].ids) === JSON.stringify(l.map((q) => q.id))), `${meta.total}`);

const ids = all.map((q) => q.id);
check('문제 ID 중복 0개', new Set(ids).size === ids.length, `${ids.length - new Set(ids).size}개 중복`);
const prefixOk = all.every((q) => ({ general: /^G\d{4}$/, surprising: /^U\d{4}$/, expert: /^X\d{4}$/ })[q.mode].test(q.id));
check('ID 형식·모드 접두사 일치', prefixOk);

const qmap = new Map();
let exactDup = 0;
for (const q of all) { const k = norm(q.question); if (qmap.has(k)) exactDup++; else qmap.set(k, q.id); }
check('완전히 동일한 문제 0개 (공백·문장부호 정규화)', exactDup === 0, `${exactDup}개`);

const fk = all.map((q) => q.factKey);
check('동일 사실 키(fact_key) 0개', new Set(fk).size === fk.length, `${fk.length - new Set(fk).size}개`);

// 의미 중복 후보: 같은 정답 + 질문 문자 bigram 자카드 유사도 ≥ 0.6
const bigrams = (s) => { const t = norm(s); const b = new Set(); for (let i = 0; i < t.length - 1; i++) b.add(t.slice(i, i + 2)); return b; };
const jac = (a, b) => { let n = 0; for (const x of a) if (b.has(x)) n++; return n / (a.size + b.size - n || 1); };
const byAnswer = new Map();
for (const q of all) { const k = normOpt(q.options[q.correctIndex]); (byAnswer.get(k) || byAnswer.set(k, []).get(k)).push(q); }
const semantic = [];
for (const group of byAnswer.values()) {
  for (let i = 0; i < group.length; i++) for (let j = i + 1; j < group.length; j++) {
    const s = jac(bigrams(group[i].question), bigrams(group[j].question));
    if (s >= 0.6) semantic.push({ a: group[i].id, b: group[j].id, sim: Math.round(s * 100) / 100, answer: group[i].options[group[i].correctIndex], qa: group[i].question, qb: group[j].question });
  }
}

check('보기가 4개가 아닌 문제 0개', all.every((q) => Array.isArray(q.options) && q.options.length === 4), `${all.filter((q) => q.options?.length !== 4).length}개`);
check('보기 내용 중복 0개 (문항 내부)', all.every((q) => new Set(q.options.map(normOpt)).size === 4), `${all.filter((q) => new Set(q.options.map(normOpt)).size !== 4).map((q) => q.id).join(', ')}`);
check('빈 보기 0개', all.every((q) => q.options.every((o) => typeof o === 'string' && o.trim())));
check('정답 인덱스 오류 0개 (0~3 정수)', all.every((q) => Number.isInteger(q.correctIndex) && q.correctIndex >= 0 && q.correctIndex < 4));
check('정답 누락 0개 (정답 텍스트 = 보기[정답 인덱스])', all.every((q) => q.answer && q.options[q.correctIndex] === q.answer), `${all.filter((q) => q.options[q.correctIndex] !== q.answer).map((q) => q.id).join(', ')}`);
check('해설이 없는 문제 0개', all.every((q) => typeof q.explanation === 'string' && q.explanation.trim().length > 0));
check('빈 문제 문장 0개', all.every((q) => q.question?.trim()));
check('출처가 없는 문제 0개', all.every((q) => q.sources?.length > 0 && q.sources.every((s) => s.name && /^https?:\/\//.test(s.url))), `${all.filter((q) => !q.sources?.length).length}개`);
check('카테고리 누락 0개', all.every((q) => q.category));
check('예시 문구·더미 텍스트 0개', !all.some((q) => /검증된 실제 문제|선택지 [1-4]|lorem|TODO|더미/i.test(q.question + q.options.join() + q.explanation)));

// 정보성 항목 (실패로 처리하지 않음)
const status = {}; for (const q of all) status[q.verificationStatus] = (status[q.verificationStatus] || 0) + 1;
const editorial = {}; for (const q of all) editorial[q.editorialReview] = (editorial[q.editorialReview] || 0) + 1;
const pos = [0, 0, 0, 0]; for (const q of all) pos[q.correctIndex]++;
const leak = all.filter((q) => { const a = norm(q.answer); return a.length >= 3 && norm(q.question).includes(a); });
const cats = {}; for (const q of all) { const k = `${q.mode} · ${q.category}`; cats[k] = (cats[k] || 0) + 1; }

const failed = checks.filter((c) => !c.ok);
const lines = [];
lines.push('# 데이터 검증 결과', '', `- 실행: ${new Date().toISOString()}`, `- 데이터 버전: ${meta.version}`, `- 결과: **${checks.length - failed.length} / ${checks.length} 통과**`, '');
lines.push('| 검사 | 결과 | 값 |', '| --- | --- | --- |');
for (const c of checks) lines.push(`| ${c.name} | ${c.ok ? '통과' : '**실패**'} | ${c.detail || ''} |`);
lines.push('', '## 검증 상태 (원본 데이터 기록 그대로)', '');
for (const [k, v] of Object.entries(status)) lines.push(`- verificationStatus \`${k}\`: ${v}개`);
for (const [k, v] of Object.entries(editorial)) lines.push(`- editorialReview \`${k}\`: ${v}개`);
lines.push('', '> 모든 문항은 출처 기록 대조(`source_record_checked`)를 거쳤지만, **사람이 1,230문항 전체를 읽고 최종 승인하는 전수 검수는 완료되지 않았습니다** (`pending_full_human_review`). 앱에도 이 상태를 그대로 표시합니다.');
lines.push('', `## 저장된 정답 위치 분포`, '', `첫째 ${pos[0]} / 둘째 ${pos[1]} / 셋째 ${pos[2]} / 넷째 ${pos[3]} (출제 시에는 매번 다시 섞음)`);
lines.push('', '## 분야별 문항 수', '');
for (const [k, v] of Object.entries(cats)) lines.push(`- ${k}: ${v}`);
lines.push('', `## 의미 중복 후보 (같은 정답 + 질문 유사도 ≥ 0.6): ${semantic.length}쌍`, '');
lines.push('자동 검사로 찾은 후보이며 사람이 확인해야 합니다. 같은 정답을 다른 각도로 묻는 정상 문항도 포함될 수 있습니다.', '');
for (const s of semantic) lines.push(`- ${s.a} ↔ ${s.b} (유사도 ${s.sim}, 정답 “${s.answer}”)\n  - ${s.qa}\n  - ${s.qb}`);
lines.push('', `## 질문에 정답 문자열이 포함된 문항 (정답 암시 가능성): ${leak.length}개`, '');
for (const q of leak) lines.push(`- ${q.id}: ${q.question} → ${q.answer}`);
lines.push('', '## 원본에 없어 비워 둔 항목', '', '- 문항별 난이도 수치: 원본은 모드(일반/의외/초고난도)만 편집상 분류로 제공하므로 임의로 만들지 않았습니다.', '- 추가 배경 지식(extraFact): 원본에 해당 필드가 없어 비워 두었고, 앱은 해설과 출처만 표시합니다.');
writeFileSync(join(ROOT, 'VALIDATION.md'), lines.join('\n') + '\n');

for (const c of checks) console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? '  (' + c.detail + ')' : ''}`);
console.log(`semantic-duplicate candidates: ${semantic.length}, answer-in-question: ${leak.length}`);
console.log(`status: ${JSON.stringify(status)} editorial: ${JSON.stringify(editorial)}`);
if (failed.length) { console.error(`${failed.length} check(s) failed`); process.exit(1); }
