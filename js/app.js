// WORLD QUIZ — 앱 UI
import * as S from './store.js';
import { pickQuestionIds, makeSession, recordAnswer, summarize, accuracy, shuffle } from './engine.js';

const REPO_URL = 'https://github.com/Charaing/world-quiz';
const $app = document.getElementById('app');
const $sheet = document.getElementById('sheet-root');
const $toast = document.getElementById('toast');

const MODE_ORDER = ['general', 'surprising', 'expert'];
const MODES = {
  general: { name: '일반 상식', desc: '과학부터 스포츠까지, 세계를 이해하는 기본 지식', color: 'var(--mode-general)', counts: [10, 20, 30], timeLimit: 30 },
  surprising: { name: '의외의 상식', desc: '“이게 진짜라고?” 싶은, 검증 가능한 사실들', color: 'var(--mode-surprising)', counts: [10, 20, 30], timeLimit: 35 },
  expert: { name: '초고난도', desc: '전문 지식과 다단계 추론이 필요한 문제', color: 'var(--mode-expert)', counts: [5, 10, 20, 30], timeLimit: 90 },
};
const DIFF = { 1: '쉬움', 2: '보통', 3: '어려움', 4: '최상' };
const VERIFY_LABEL = {
  source_record_checked: '출처 기록 대조 완료',
  pending_full_human_review: '사람 전수 검수 대기',
  passed: '통과',
};

const ICON = {
  back: '<svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg>',
  close: '<svg viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg>',
  x: '<svg viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg>',
  star: '<svg viewBox="0 0 24 24"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z"/></svg>',
  flag: '<svg viewBox="0 0 24 24"><path d="M5 21V4m0 0h11l-2 4 2 4H5"/></svg>',
  text: '<svg viewBox="0 0 24 24"><path d="M4 18 9 6l5 12M5.7 14h6.6M15 18l3-7 3 7m-5.1-2h4.2"/></svg>',
  clock: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
};

const FONT_STEPS = [0.9, 1, 1.12, 1.25];

/* ---------------- 유틸 ---------------- */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtPct = (v) => `${Number.isInteger(v) ? v : v.toFixed(1)}%`;
const fmtDate = (t) => {
  if (!t) return '—';
  const d = new Date(t);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
};
const fmtDateTime = (t) => {
  const d = new Date(t);
  return `${fmtDate(t)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
const reduceMotion = () => document.documentElement.dataset.motion === 'reduce' || matchMedia('(prefers-reduced-motion: reduce)').matches;
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} };

function toast(msg) {
  $toast.textContent = msg;
  $toast.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => $toast.classList.remove('show'), 2200);
}

function countUp(el, to, suffix = '') {
  if (!el) return;
  if (reduceMotion()) { el.textContent = to + suffix; return; }
  const start = performance.now(), dur = 700;
  const step = (now) => {
    const p = Math.min(1, (now - start) / dur);
    const e = 1 - Math.pow(1 - p, 3);
    const v = to * e;
    el.textContent = (Number.isInteger(to) ? Math.round(v) : v.toFixed(1)) + suffix;
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/* ---------------- 데이터 ---------------- */
let META = null;
const QCACHE = new Map(); // mode -> { list, byId }

async function loadMeta() {
  if (META) return META;
  const r = await fetch('data/meta.json');
  if (!r.ok) throw new Error('meta.json을 불러오지 못했습니다');
  META = await r.json();
  return META;
}
async function loadMode(mode) {
  if (QCACHE.has(mode)) return QCACHE.get(mode);
  const r = await fetch(`data/${mode}.json`);
  if (!r.ok) throw new Error(`${mode} 문제를 불러오지 못했습니다`);
  const list = await r.json();
  const entry = { list, byId: new Map(list.map((q) => [q.id, q])) };
  QCACHE.set(mode, entry);
  return entry;
}
const modeOf = (id) => (id[0] === 'G' ? 'general' : id[0] === 'U' ? 'surprising' : 'expert');
async function getQuestion(id) { return (await loadMode(modeOf(id))).byId.get(id); }
const catLabel = (mode, cat) => META?.modes?.[mode]?.categories?.[cat]?.label || cat;

/* ---------------- 내비게이션 ---------------- */
let current = { view: 'home', params: {} };
let timerHandle = null;
const VIEWS = {};

function setTab(view) {
  const tabFor = { home: 'home', setup: 'home', play: null, result: 'records', records: 'records', stats: 'stats', settings: 'settings', complete: 'home' };
  const t = tabFor[view];
  document.querySelectorAll('.tab').forEach((b) => { if (b.dataset.tab === t) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  document.body.classList.toggle('playing', view === 'play');
}

async function go(view, params = {}, { replace = false, back = false } = {}) {
  stopTimer();
  closeSheet();
  current = { view, params };
  const state = { view, params };
  if (replace) history.replaceState(state, ''); else history.pushState(state, '');
  await render(back);
}
async function render(back = false) {
  setTab(current.view);
  try {
    const html = await VIEWS[current.view](current.params);
    if (typeof html === 'string') {
      $app.innerHTML = `<div class="view${back ? ' back' : ''}">${html}</div>`;
      VIEWS[current.view].mount?.(current.params);
    }
  } catch (err) {
    console.error(err);
    $app.innerHTML = `<div class="view"><div class="empty"><b>문제가 발생했습니다</b>${esc(err.message)}</div><div class="btn-row"><button class="btn" data-go="home">홈으로</button></div></div>`;
  }
  window.scrollTo({ top: 0 });
}
window.addEventListener('popstate', (e) => {
  stopTimer(); closeSheet();
  current = e.state || { view: 'home', params: {} };
  if (current.view === 'play') current = { view: 'home', params: {} };
  render(true);
});
document.getElementById('tabbar').addEventListener('click', (e) => {
  const b = e.target.closest('.tab');
  if (b) go(b.dataset.tab);
});
$app.addEventListener('click', (e) => {
  const g = e.target.closest('[data-go]');
  if (g) { e.preventDefault(); go(g.dataset.go, g.dataset.params ? JSON.parse(g.dataset.params) : {}); }
});

/* ---------------- 시트 ---------------- */
function openSheet(html, mount) {
  $sheet.innerHTML = `<div class="scrim" data-close></div><div class="sheet" role="dialog" aria-modal="true"><div class="grab"></div>${html}</div>`;
  const sheet = $sheet.querySelector('.sheet');
  $sheet.querySelectorAll('[data-close]').forEach((el) => el.addEventListener('click', closeSheet));
  mount?.(sheet);
  sheet.querySelector('button, [tabindex]')?.focus({ preventScroll: true });
}
function closeSheet() { $sheet.innerHTML = ''; }
const sheetOpen = () => !!$sheet.firstChild;
function confirmSheet({ title, body, ok = '확인', cancel = '취소', danger = false }) {
  return new Promise((resolve) => {
    openSheet(`<h2>${esc(title)}</h2><p>${body}</p><div class="btn-row two"><button class="btn" data-a="0">${esc(cancel)}</button><button class="btn ${danger ? 'danger' : 'primary'}" data-a="1">${esc(ok)}</button></div>`, (s) => {
      s.querySelectorAll('[data-a]').forEach((b) => b.addEventListener('click', () => { closeSheet(); resolve(b.dataset.a === '1'); }));
      $sheet.querySelector('.scrim').addEventListener('click', () => resolve(false));
    });
  });
}

/* ---------------- 공통 집계 ---------------- */
async function modeProgress() {
  const meta = await loadMeta();
  const [seenRows, games] = await Promise.all([S.getAll('seen'), S.getAll('games')]);
  const out = {};
  for (const m of MODE_ORDER) {
    const ids = meta.modes[m].ids;
    const idset = new Set(ids);
    const seen = seenRows.filter((r) => idset.has(r.id)).length;
    const mg = games.filter((g) => g.mode === m && g.kind === 'normal' && g.answered > 0);
    out[m] = {
      total: ids.length, seen, remaining: ids.length - seen,
      pct: ids.length ? Math.round((seen / ids.length) * 1000) / 10 : 0,
      best: mg.length ? Math.max(...mg.map((g) => g.rate)) : null,
    };
  }
  return out;
}

/* ================= 홈 ================= */
VIEWS.home = async () => {
  const [prog, sessions, qstats, bms] = await Promise.all([modeProgress(), S.getAll('session'), S.getAll('qstats'), S.getAll('bookmarks')]);
  const wrongCount = qstats.filter((s) => s.inWrongNote).length;
  const resumes = sessions
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((s) => {
      const done = s.answers.filter(Boolean).length;
      const name = s.kind === 'review' ? '오답 복습' : MODES[s.mode].name;
      return `<button class="resume" data-resume="${esc(s.key)}"><div><b>${esc(name)} 이어하기</b><span>${done} / ${s.items.length}문제 응답 · ${fmtDateTime(s.updatedAt)}</span></div><span class="go">계속 →</span></button>`;
    }).join('');

  const cards = MODE_ORDER.map((m) => {
    const p = prog[m], M = MODES[m];
    const doneBadge = p.remaining === 0 ? '<span class="badge good">모두 완료</span>' : '';
    return `<button class="mode" style="--c:${M.color}" data-mode="${m}">
      <div class="mode-head"><span class="mode-dot"></span><span class="mode-name">${M.name}</span>${doneBadge}<span class="mode-count">${p.total.toLocaleString()}문제</span></div>
      <p class="mode-desc">${M.desc}</p>
      <div class="mode-bar" role="progressbar" aria-label="${M.name} 완료율" aria-valuenow="${p.pct}" aria-valuemin="0" aria-valuemax="100"><i data-w="${p.pct}"></i></div>
      <div class="mode-meta">
        <div><b>${p.remaining.toLocaleString()}</b>남은 문제</div>
        <div><b>${fmtPct(p.pct)}</b>완료율</div>
        <div><b>${p.best == null ? '—' : fmtPct(p.best)}</b>최고 정답률</div>
      </div>
    </button>`;
  }).join('');

  return `
    <header class="brand"><div class="wordmark">WORLD<span> </span>QUIZ</div><p>한 번 나온 문제는 다시 나오지 않습니다.</p></header>
    ${resumes ? `<div class="mode-list" style="margin-bottom:8px">${resumes}</div>` : ''}
    <div class="section-label">게임 모드</div>
    <div class="mode-list">${cards}</div>
    <div class="section-label">학습</div>
    <div class="quick-row">
      <button class="quick" data-go="records" data-params='{"tab":"wrong"}'><b>${wrongCount}</b><span>오답 노트</span></button>
      <button class="quick" data-go="records" data-params='{"tab":"bookmarks"}'><b>${bms.length}</b><span>북마크</span></button>
    </div>`;
};
VIEWS.home.mount = () => {
  requestAnimationFrame(() => $app.querySelectorAll('.mode-bar i').forEach((i) => { i.style.width = i.dataset.w + '%'; }));
  $app.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', async () => {
    const m = b.dataset.mode;
    const prog = await modeProgress();
    if (prog[m].remaining === 0) go('complete', { mode: m });
    else go('setup', { mode: m });
  }));
  $app.querySelectorAll('[data-resume]').forEach((b) => b.addEventListener('click', () => go('play', { key: b.dataset.resume })));
};

/* ================= 게임 설정 ================= */
let setupState = { count: 10, timer: false };
VIEWS.setup = async ({ mode }) => {
  const M = MODES[mode];
  const prog = (await modeProgress())[mode];
  const existing = await S.get('session', `mode:${mode}`);
  setupState.timer = lsGet('wq-timer') === '1';
  const counts = [...M.counts, 'all'];
  if (!counts.includes(setupState.count) || (setupState.count !== 'all' && setupState.count > prog.remaining && prog.remaining >= Math.min(...M.counts))) setupState.count = M.counts[0];
  const choices = counts.map((c) => {
    const n = c === 'all' ? prog.remaining : Math.min(c, prog.remaining);
    const short = c !== 'all' && c > prog.remaining;
    const title = c === 'all' ? '남은 문제 모두' : `${c}문제`;
    const sub = c === 'all' ? `${prog.remaining}문제` : short ? `남은 ${prog.remaining}문제로 시작` : `약 ${Math.max(1, Math.round((c * 25) / 60))}분`;
    return `<button class="choice" data-count="${c}" aria-pressed="${setupState.count === c}"><b>${title}</b><span>${sub}</span></button>`;
  }).join('');
  return `
    <div class="topbar"><button class="icon-btn" data-go="home" aria-label="뒤로">${ICON.back}</button><h1>${M.name}</h1></div>
    ${existing ? `<button class="resume" data-resume="mode:${mode}"><div><b>진행 중인 게임이 있습니다</b><span>${existing.answers.filter(Boolean).length} / ${existing.items.length}문제 응답 · ${fmtDateTime(existing.updatedAt)}</span></div><span class="go">이어하기 →</span></button>` : ''}
    <div class="card" style="--c:${M.color};margin-top:${existing ? 12 : 0}px">
      <div class="row"><div class="grow"><div class="label">출제 가능한 문제</div><div class="sub">전체 ${prog.total}문제 중 아직 풀지 않은 문제</div></div><b style="font-size:22px;font-variant-numeric:tabular-nums">${prog.remaining}</b></div>
    </div>
    <div class="section-label">문제 수</div>
    <div class="choice-grid">${choices}</div>
    <div class="section-label">옵션</div>
    <div class="card">
      <div class="row"><div class="grow"><div class="label">시간제한</div><div class="sub">문제당 ${M.timeLimit}초 · 초과하면 오답 처리</div></div>
        <button class="switch" role="switch" aria-checked="${setupState.timer}" aria-label="시간제한" data-timer></button></div>
    </div>
    <p class="hint">한 번 화면에 나온 문제는 맞히든 틀리든 출제 기록에 남아 이 모드에서 다시 나오지 않습니다.</p>
    <div class="btn-row"><button class="btn primary" data-start>시작하기</button></div>`;
};
VIEWS.setup.mount = ({ mode }) => {
  $app.querySelectorAll('[data-count]').forEach((b) => b.addEventListener('click', () => {
    setupState.count = b.dataset.count === 'all' ? 'all' : Number(b.dataset.count);
    $app.querySelectorAll('[data-count]').forEach((x) => x.setAttribute('aria-pressed', x === b));
  }));
  $app.querySelector('[data-timer]').addEventListener('click', (e) => {
    setupState.timer = !setupState.timer;
    e.currentTarget.setAttribute('aria-checked', setupState.timer);
    lsSet('wq-timer', setupState.timer ? '1' : '0');
  });
  $app.querySelector('[data-resume]')?.addEventListener('click', () => go('play', { key: `mode:${mode}` }));
  $app.querySelector('[data-start]').addEventListener('click', () => startGame(mode));
};

async function startGame(mode) {
  const key = `mode:${mode}`;
  const existing = await S.get('session', key);
  if (existing) {
    const ok = await confirmSheet({
      title: '새 게임을 시작할까요?',
      body: '진행 중인 게임은 종료됩니다. 이미 화면에 나온 문제는 출제 기록에 남고, 아직 나오지 않은 문제는 다음 게임에 출제될 수 있습니다.',
      ok: '새 게임 시작',
    });
    if (!ok) return;
    await finishSession(existing, { silent: true });
  }
  const meta = await loadMeta();
  await loadMode(mode);
  const seen = await S.seenSet(mode);
  const ids = pickQuestionIds(meta.modes[mode].ids, seen, setupState.count);
  if (!ids.length) { go('complete', { mode }, { replace: true }); return; }
  const s = makeSession({ mode, kind: 'normal', ids, timer: setupState.timer, timeLimit: MODES[mode].timeLimit });
  s.key = key;
  await S.put('session', s);
  go('play', { key }, { replace: true });
}

async function startReview(ids) {
  if (!ids.length) { toast('복습할 문제가 없습니다'); return; }
  const key = 'review';
  const existing = await S.get('session', key);
  if (existing) {
    const ok = await confirmSheet({ title: '진행 중인 복습을 종료할까요?', body: '새 오답 복습을 시작하면 이전 복습 게임은 지금까지의 응답으로 마무리됩니다.', ok: '새로 시작' });
    if (!ok) return;
    await finishSession(existing, { silent: true });
  }
  const s = makeSession({ mode: 'review', kind: 'review', ids: shuffle(ids), timer: false });
  s.key = key;
  await S.put('session', s);
  go('play', { key });
}

/* ================= 완료 화면 ================= */
VIEWS.complete = async ({ mode }) => {
  const M = MODES[mode];
  const qstats = await S.getAllByMode('qstats', mode);
  const wrong = qstats.filter((s) => s.inWrongNote).length;
  const others = MODE_ORDER.filter((m) => m !== mode);
  return `
    <div class="topbar"><button class="icon-btn" data-go="home" aria-label="뒤로">${ICON.back}</button><h1>${M.name}</h1></div>
    <div class="score-hero"><div class="big" style="font-size:44px">모두 풀었습니다</div><p>${M.name}의 ${META.modes[mode].ids.length}문제를 전부 확인했습니다.<br>다음 중 하나를 선택하세요.</p></div>
    <div class="btn-row">
      <button class="btn accent" data-review ${wrong ? '' : 'disabled'}>틀린 문제 복습 (${wrong})</button>
      ${others.map((m) => `<button class="btn" data-go="setup" data-params='{"mode":"${m}"}'>${MODES[m].name} 플레이</button>`).join('')}
      <button class="btn danger" data-reset>${M.name} 출제 기록 초기화</button>
    </div>
    <p class="hint">출제 기록을 초기화해도 오답 노트, 북마크, 통계는 유지됩니다.</p>`;
};
VIEWS.complete.mount = ({ mode }) => {
  $app.querySelector('[data-review]').addEventListener('click', async () => {
    const qs = await S.getAllByMode('qstats', mode);
    startReview(qs.filter((s) => s.inWrongNote).map((s) => s.id));
  });
  $app.querySelector('[data-reset]').addEventListener('click', async () => {
    const ok = await confirmSheet({ title: '출제 기록을 초기화할까요?', body: `${MODES[mode].name}의 모든 문제가 다시 출제 대상이 됩니다. 되돌릴 수 없습니다.`, ok: '초기화', danger: true });
    if (!ok) return;
    const prog = (await modeProgress())[mode];
    if (prog.remaining !== 0) { toast('모든 문제를 푼 뒤에만 초기화할 수 있습니다'); return; }
    await S.clearSeen(mode);
    toast('출제 기록을 초기화했습니다');
    go('setup', { mode }, { replace: true });
  });
};

/* ================= 문제 풀이 ================= */
let play = null; // { session, qmap }

VIEWS.play = async ({ key }) => {
  const session = await S.get('session', key);
  if (!session) { go('home', {}, { replace: true }); return null; }
  const modes = session.kind === 'review' ? [...new Set(session.items.map((i) => modeOf(i.id)))] : [session.mode];
  const qmap = new Map();
  for (const m of modes) for (const [id, q] of (await loadMode(m)).byId) qmap.set(id, q);
  // 데이터 업데이트로 사라진 문제는 건너뛴다
  session.items = session.items.filter((it, idx) => qmap.has(it.id) || session.answers[idx]);
  if (!session.items.length) { await S.del('session', key); go('home', {}, { replace: true }); return null; }
  if (session.index >= session.items.length) { await finishSession(session); return null; }
  play = { session, qmap };
  return playHTML();
};

function playHTML() {
  const { session, qmap } = play;
  const i = session.index;
  const item = session.items[i];
  const q = qmap.get(item.id);
  const ans = session.answers[i];
  const total = session.items.length;
  const color = session.kind === 'review' ? 'var(--ink-2)' : MODES[session.mode].color;
  const mode = modeOf(q.id);
  const opts = item.order.map((orig, d) => {
    let cls = 'opt', mark = '';
    if (ans) {
      if (orig === q.correctIndex) { cls += ' correct'; mark = `<span class="mark">${ICON.check}정답</span>`; }
      else if (orig === ans.chosen) { cls += ' wrong'; mark = `<span class="mark">${ICON.x}선택</span>`; }
      else cls += ' dim';
    }
    return `<button class="${cls}" data-opt="${d}" ${ans ? 'disabled' : ''} aria-label="${d + 1}번 ${esc(q.options[orig])}"><span class="key">${d + 1}</span><span class="txt">${esc(q.options[orig])}</span>${mark}</button>`;
  }).join('');
  const verdict = ans
    ? ans.correct
      ? `<div class="verdict good" role="status">${ICON.check}정답입니다</div>`
      : `<div class="verdict bad" role="status">${ICON.x}${ans.timeout ? '시간 초과' : '오답입니다'} · 정답: ${esc(q.options[q.correctIndex])}</div>`
    : '';
  const explain = ans ? explainHTML(q) : '';
  const last = i === total - 1;
  return `
    <div class="q-top" style="--c:${color}">
      <button class="icon-btn" data-exit aria-label="나가기">${ICON.back}</button>
      <div class="q-progress-wrap">
        <div class="q-progress-meta"><span><b>${i + 1}</b> / ${total}</span><span>${session.kind === 'review' ? '오답 복습' : MODES[session.mode].name}</span></div>
        <div class="q-progress" role="progressbar" aria-label="진행률" aria-valuenow="${i + (ans ? 1 : 0)}" aria-valuemax="${total}"><i style="width:${((i + (ans ? 1 : 0)) / total) * 100}%"></i></div>
        ${session.timer && !ans ? '<div class="timer"><i></i></div>' : ''}
      </div>
      <button class="icon-btn" data-font aria-label="글자 크기">${ICON.text}</button>
    </div>
    <div class="q-body" data-qid="${q.id}">
      <div class="q-tags">
        <span class="badge">${esc(catLabel(mode, q.category))}</span>
        ${q.difficulty ? `<span class="badge">${DIFF[q.difficulty]}</span>` : ''}
        ${session.timer && !ans ? `<span class="badge warn" data-remaining>${ICON.clock.replace('<svg', '<svg width="12" height="12" style="fill:none;stroke:currentColor;stroke-width:2.4"')}<span>${session.timeLimit}초</span></span>` : ''}
      </div>
      <h2 class="q-text" id="qtext">${esc(q.question)}</h2>
      <div class="options" role="group" aria-labelledby="qtext">${opts}</div>
      ${verdict}
      ${explain}
      <div class="answer-tools">
        <button class="chip-btn" data-bookmark aria-pressed="false">${ICON.star}<span>북마크</span></button>
        <button class="chip-btn" data-report>${ICON.flag}<span>신고</span></button>
      </div>
    </div>
    <div class="next-bar">${ans ? `<button class="btn primary" data-next>${last ? '결과 보기' : '다음 문제'}</button>` : '<p class="hint" style="text-align:center;margin:0">보기를 선택하세요 · 키보드 1–4</p>'}</div>`;
}

function explainHTML(q) {
  const src = (q.sources || []).map((s) => {
    const name = esc(s.name) + (s.publisher ? ` <span style="opacity:.8">(${esc(s.publisher)})</span>` : '');
    return s.url ? `<a href="${esc(s.url)}" target="_blank" rel="noopener">${name}</a>` : name;
  }).join('<br>');
  return `<section class="explain" aria-label="해설">
    <h3>해설</h3><p>${esc(q.explanation)}</p>
    ${q.extraFact ? `<h3>더 알아보기</h3><p>${esc(q.extraFact)}</p>` : ''}
    <div class="src">출처<br>${src || '—'}<br><br>검증 상태: ${esc(VERIFY_LABEL[q.verificationStatus] || q.verificationStatus)}${q.editorialReview ? ` · ${esc(VERIFY_LABEL[q.editorialReview] || q.editorialReview)}` : ''} · ${esc(q.id)}</div>
  </section>`;
}

VIEWS.play.mount = async () => {
  if (!play) return;
  const { session, qmap } = play;
  const i = session.index;
  const item = session.items[i];
  const q = qmap.get(item.id);
  // 화면에 처음 표시된 순간 출제 기록 등록 (정답/오답과 무관)
  if (session.kind === 'normal') await S.markSeen(q.id, session.mode);
  const bm = await S.get('bookmarks', q.id);
  const bmBtn = $app.querySelector('[data-bookmark]');
  setBm(bmBtn, !!bm);
  bmBtn.addEventListener('click', async () => {
    const on = !(await S.get('bookmarks', q.id));
    if (on) await S.put('bookmarks', { id: q.id, at: Date.now() }); else await S.del('bookmarks', q.id);
    setBm(bmBtn, on);
    toast(on ? '북마크에 추가했습니다' : '북마크에서 뺐습니다');
  });
  $app.querySelector('[data-report]').addEventListener('click', () => reportSheet(q));
  $app.querySelector('[data-font]').addEventListener('click', cycleFont);
  $app.querySelector('[data-exit]').addEventListener('click', exitSheet);
  $app.querySelectorAll('[data-opt]').forEach((b) => b.addEventListener('click', () => answer(Number(b.dataset.opt))));
  $app.querySelector('[data-next]')?.addEventListener('click', next);
  if (session.timer && !session.answers[i]) startTimer(session.timeLimit);
};
function setBm(btn, on) {
  btn.classList.toggle('on', on);
  btn.setAttribute('aria-pressed', on);
  btn.querySelector('span').textContent = on ? '북마크됨' : '북마크';
}

let answering = false;
async function answer(displayIdx) {
  if (!play || answering) return;
  const { session, qmap } = play;
  const q = qmap.get(session.items[session.index].id);
  if (session.answers[session.index]) return; // 답 수정 금지
  answering = true;
  stopTimer();
  try {
    const ans = recordAnswer(session, q, displayIdx);
    if (!ans) return;
    await S.put('session', session);
    await S.applyAnswer({ q, correct: ans.correct, review: session.kind === 'review' });
    rerenderPlay();
  } finally { answering = false; }
}
function rerenderPlay() {
  const y = window.scrollY;
  $app.innerHTML = `<div class="view" style="animation:none">${playHTML()}</div>`;
  $app.querySelector('.q-body').style.animation = 'none';
  VIEWS.play.mount();
  window.scrollTo({ top: y });
  const ex = $app.querySelector('.explain');
  if (ex) {
    const r = ex.getBoundingClientRect();
    if (r.top > window.innerHeight - 120) ex.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'center' });
  }
}
async function next() {
  if (!play) return;
  const { session } = play;
  if (!session.answers[session.index]) return;
  session.index++;
  session.updatedAt = Date.now();
  if (session.index >= session.items.length) { await finishSession(session); return; }
  await S.put('session', session);
  $app.innerHTML = `<div class="view" style="animation:none">${playHTML()}</div>`;
  await VIEWS.play.mount();
  window.scrollTo({ top: 0 });
}

async function finishSession(session, { silent = false } = {}) {
  stopTimer();
  const modes = session.kind === 'review' ? [...new Set(session.items.map((i) => modeOf(i.id)))] : [session.mode];
  const qmap = new Map();
  for (const m of modes) for (const [id, q] of (await loadMode(m)).byId) qmap.set(id, q);
  const sum = summarize(session, qmap);
  await S.del('session', session.key);
  if (sum.answered === 0) { play = null; if (!silent) go('home', {}, { replace: true }); return null; }
  const game = {
    id: session.id, mode: session.mode, kind: session.kind,
    startedAt: session.startedAt, endedAt: Date.now(), timer: session.timer,
    total: session.items.length, answered: sum.answered, correct: sum.correct, wrong: sum.wrong, rate: sum.rate,
    byCat: sum.byCat, weakest: sum.weakest,
    items: session.answers.filter(Boolean).map((a) => ({ id: a.id, chosen: a.chosen, correct: a.correct, timeout: a.timeout })),
  };
  await S.put('games', game);
  play = null;
  if (!silent) go('result', { id: game.id, fresh: true }, { replace: true });
  return game;
}

function exitSheet() {
  const { session } = play;
  const done = session.answers.filter(Boolean).length;
  openSheet(`<h2>게임을 멈출까요?</h2><p>진행 상황은 자동 저장되어 홈에서 이어서 풀 수 있습니다.</p>
    <div class="btn-row">
      <button class="btn primary" data-a="save">저장하고 나가기</button>
      <button class="btn" data-a="end" ${done ? '' : 'disabled'}>여기서 끝내고 결과 보기 (${done}문제)</button>
      <button class="btn ghost" data-close>계속 풀기</button>
    </div>`, (s) => {
    s.querySelector('[data-a="save"]').addEventListener('click', () => { closeSheet(); play = null; go('home'); });
    s.querySelector('[data-a="end"]').addEventListener('click', async () => {
      closeSheet();
      // 응답하지 않은 문제는 제외하고 마감 (현재 표시 중인 문제는 이미 출제 기록에 등록됨)
      session.items = session.items.slice(0, done);
      await finishSession(session);
    });
  });
}

function startTimer(limit) {
  stopTimer();
  const bar = $app.querySelector('.timer i');
  const label = $app.querySelector('[data-remaining] span');
  const end = performance.now() + limit * 1000;
  timerHandle = setInterval(() => {
    const left = Math.max(0, end - performance.now());
    if (bar) bar.style.transform = `scaleX(${left / (limit * 1000)})`;
    if (label) label.textContent = `${Math.ceil(left / 1000)}초`;
    if (left <= 0) { stopTimer(); answer(null); }
  }, 100);
}
function stopTimer() { if (timerHandle) { clearInterval(timerHandle); timerHandle = null; } }

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && sheetOpen()) { closeSheet(); return; }
  if (current.view !== 'play' || !play || sheetOpen() || e.ctrlKey || e.metaKey || e.altKey) return;
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
  const n = Number(e.key);
  if (n >= 1 && n <= 4) { e.preventDefault(); answer(n - 1); }
  else if (e.key === 'Enter' || e.key === 'ArrowRight') {
    if (play.session.answers[play.session.index]) { e.preventDefault(); next(); }
  }
});

/* ================= 결과 ================= */
VIEWS.result = async ({ id, fresh }) => {
  const game = await S.get('games', id);
  if (!game) return `<div class="empty"><b>기록을 찾을 수 없습니다</b></div>`;
  const [prog, games, seenRows] = await Promise.all([modeProgress(), S.getAll('games'), S.getAll('seen')]);
  const modes = game.kind === 'review' ? [...new Set(game.items.map((i) => modeOf(i.id)))] : [game.mode];
  const qmap = new Map();
  for (const m of modes) for (const [qid, q] of (await loadMode(m)).byId) qmap.set(qid, q);
  const cumCorrect = games.reduce((a, g) => a + g.correct, 0);
  const title = game.kind === 'review' ? '오답 복습' : MODES[game.mode].name;
  const remaining = game.kind === 'review' ? null : prog[game.mode].remaining;
  const catMode = (cat) => game.kind === 'review' ? null : game.mode;
  const bars = Object.entries(game.byCat).sort((a, b) => accuracy(a[1].correct, a[1].total) - accuracy(b[1].correct, b[1].total)).map(([cat, v]) => {
    const r = accuracy(v.correct, v.total);
    const label = catMode(cat) ? catLabel(game.mode, cat) : labelAnyMode(cat);
    return `<div class="bar-row"><span class="name">${esc(label)}</span><span class="track"><i class="${r < 50 ? 'low' : ''}" data-w="${r}"></i></span><span class="val">${fmtPct(r)}<small>${v.correct}/${v.total}</small></span></div>`;
  }).join('');
  const weakLabel = game.weakest ? (catMode(game.weakest.cat) ? catLabel(game.mode, game.weakest.cat) : labelAnyMode(game.weakest.cat)) : null;
  const items = game.items.map((a, n) => {
    const q = qmap.get(a.id);
    if (!q) return '';
    return `<button class="qitem" data-detail="${a.id}" data-chosen="${a.chosen ?? ''}" data-res="${a.correct ? 1 : 0}" data-wrong="${a.correct ? 0 : 1}">
      <span class="st ${a.correct ? 'good' : 'bad'}">${a.correct ? ICON.check : ICON.x}</span>
      <span class="body"><span class="qt">${n + 1}. ${esc(q.question)}</span><span class="meta">${a.correct ? '정답' : a.timeout ? '시간 초과' : '오답'} · 정답: ${esc(q.options[q.correctIndex])}</span></span></button>`;
  }).join('');
  const sub = game.rate >= 80 ? '훌륭합니다.' : game.rate >= 50 ? '좋은 흐름입니다.' : '해설을 읽어두면 다음엔 맞힐 수 있습니다.';
  return `
    <div class="topbar"><button class="icon-btn" data-go="${fresh ? 'home' : 'records'}" data-params='${fresh ? '{}' : '{"tab":"games"}'}' aria-label="뒤로">${ICON.back}</button><h1>${esc(title)} 결과</h1></div>
    <div class="score-hero"><div class="big"><span data-count-to="${game.rate}">0</span><small>%</small></div><p>정답률 · ${sub}</p></div>
    <div class="kpis">
      <div class="kpi"><span>출제</span><b>${game.total}</b></div>
      <div class="kpi"><span>정답</span><b style="color:var(--good)">${game.correct}</b></div>
      <div class="kpi"><span>오답</span><b style="color:var(--bad)">${game.wrong}</b></div>
    </div>
    ${game.answered < game.total ? `<p class="hint">응답 완료 ${game.answered}문제 기준 정답률입니다.</p>` : ''}
    <div class="section-label">분야별 정답률</div>
    <div class="card"><div class="bars">${bars}</div>
      ${weakLabel ? `<div class="note-box">이번 게임에서 가장 어려워한 분야: <b>${esc(weakLabel)}</b> (${fmtPct(game.weakest.rate)})</div>` : '<div class="note-box">모든 분야에서 오답이 없었습니다.</div>'}
    </div>
    <div class="section-label">누적 기록</div>
    <div class="kpis">
      <div class="kpi"><span>누적 정답</span><b>${cumCorrect.toLocaleString()}</b></div>
      <div class="kpi"><span>풀어본 문제</span><b>${seenRows.length.toLocaleString()}</b></div>
      <div class="kpi"><span>${remaining == null ? '오답 노트' : '남은 문제'}</span><b>${remaining == null ? (await S.getAll('qstats')).filter((s) => s.inWrongNote).length : remaining.toLocaleString()}</b></div>
    </div>
    <div class="section-label" style="display:flex;justify-content:space-between;align-items:center">문제별 결과
      <span class="seg" role="group"><button aria-pressed="true" data-f="all">전체</button><button aria-pressed="false" data-f="wrong">틀린 문제 ${game.wrong}</button></span></div>
    <div class="qlist">${items}</div>
    <div class="btn-row two">
      ${game.wrong ? '<button class="btn" data-review-this>틀린 문제 복습</button>' : '<button class="btn" data-go="records">기록 보기</button>'}
      ${game.kind === 'review' ? '<button class="btn primary" data-go="home">홈으로</button>' : `<button class="btn primary" data-go="setup" data-params='{"mode":"${game.mode}"}'>다음 게임</button>`}
    </div>`;
};
VIEWS.result.mount = ({ id }) => {
  const el = $app.querySelector('[data-count-to]');
  countUp(el, Number(el.dataset.countTo));
  requestAnimationFrame(() => $app.querySelectorAll('.track i').forEach((i) => { i.style.width = i.dataset.w + '%'; }));
  $app.querySelectorAll('[data-f]').forEach((b) => b.addEventListener('click', () => {
    $app.querySelectorAll('[data-f]').forEach((x) => x.setAttribute('aria-pressed', x === b));
    $app.querySelectorAll('.qitem').forEach((it) => { it.hidden = b.dataset.f === 'wrong' && it.dataset.wrong !== '1'; });
  }));
  $app.querySelectorAll('[data-detail]').forEach((b) => b.addEventListener('click', () => detailSheet(b.dataset.detail, b.dataset.chosen === '' ? null : Number(b.dataset.chosen))));
  $app.querySelector('[data-review-this]')?.addEventListener('click', async () => {
    const g = await S.get('games', id);
    startReview(g.items.filter((a) => !a.correct).map((a) => a.id));
  });
};
function labelAnyMode(cat) {
  for (const m of MODE_ORDER) { const l = META.modes[m].categories[cat]; if (l) return l.label; }
  return cat;
}

/* ================= 문제 상세 / 신고 ================= */
async function detailSheet(id, chosen = null, { onRemove } = {}) {
  const q = await getQuestion(id);
  if (!q) return;
  const st = await S.get('qstats', id);
  const bm = await S.get('bookmarks', id);
  const mode = modeOf(id);
  const opts = q.options.map((o, k) => {
    const cls = k === q.correctIndex ? 'opt correct' : k === chosen ? 'opt wrong' : 'opt dim';
    const mark = k === q.correctIndex ? `<span class="mark">${ICON.check}정답</span>` : k === chosen ? `<span class="mark">${ICON.x}선택</span>` : '';
    return `<div class="${cls}" style="animation:none"><span class="key">${k + 1}</span><span class="txt">${esc(o)}</span>${mark}</div>`;
  }).join('');
  openSheet(`
    <div class="q-tags" style="margin-top:0"><span class="badge">${esc(MODES[mode].name)}</span><span class="badge">${esc(catLabel(mode, q.category))}</span>${q.difficulty ? `<span class="badge">${DIFF[q.difficulty]}</span>` : ''}</div>
    <h2 class="q-text" style="font-size:calc(18px * var(--fs))">${esc(q.question)}</h2>
    <div class="options">${opts}</div>
    <div style="margin-top:14px">${explainHTML(q)}</div>
    ${st ? `<p class="hint">틀린 횟수 ${st.wrongCount} · 맞힌 횟수 ${st.correctCount} · 복습 정답 ${st.reviewCorrect}회</p>` : ''}
    <div class="answer-tools">
      <button class="chip-btn ${bm ? 'on' : ''}" data-bm>${ICON.star}<span>${bm ? '북마크됨' : '북마크'}</span></button>
      <button class="chip-btn" data-rp>${ICON.flag}<span>신고</span></button>
      ${onRemove ? '<button class="chip-btn" data-rm>오답 노트에서 빼기</button>' : ''}
    </div>
    <div class="btn-row"><button class="btn" data-close>닫기</button></div>`, (s) => {
    s.querySelector('[data-bm]').addEventListener('click', async (e) => {
      const on = !(await S.get('bookmarks', id));
      if (on) await S.put('bookmarks', { id, at: Date.now() }); else await S.del('bookmarks', id);
      const b = e.currentTarget; b.classList.toggle('on', on); b.querySelector('span').textContent = on ? '북마크됨' : '북마크';
    });
    s.querySelector('[data-rp]').addEventListener('click', () => reportSheet(q));
    s.querySelector('[data-rm]')?.addEventListener('click', async () => { await S.removeFromWrongNote(id); closeSheet(); toast('오답 노트에서 뺐습니다'); onRemove(); });
  });
}

function reportSheet(q) {
  const reasons = ['정답이 틀렸습니다', '해설 내용이 부정확합니다', '문제가 모호합니다 / 정답이 둘 이상', '오타·표기 오류', '기타'];
  const wasPlaying = current.view === 'play';
  openSheet(`<h2>문제 신고</h2><p>${esc(q.id)} · 신고 내용은 이 기기에 저장되고, 원하면 GitHub 이슈로 보낼 수 있습니다.</p>
    <div class="radio-list">${reasons.map((r, k) => `<label><input type="radio" name="reason" value="${esc(r)}" ${k === 0 ? 'checked' : ''}>${esc(r)}</label>`).join('')}</div>
    <textarea placeholder="자세한 내용 (선택)" maxlength="1000"></textarea>
    <div class="btn-row two"><button class="btn" data-close>취소</button><button class="btn primary" data-send>신고 저장</button></div>`, (s) => {
    s.querySelector('[data-send]').addEventListener('click', async () => {
      const reason = s.querySelector('input[name="reason"]:checked').value;
      const note = s.querySelector('textarea').value.trim();
      await S.put('reports', { qid: q.id, reason, note, at: Date.now() });
      const url = `${REPO_URL}/issues/new?title=${encodeURIComponent(`[문제 신고] ${q.id} — ${reason}`)}&body=${encodeURIComponent(`문제 ID: ${q.id}\n사유: ${reason}\n\n${note}`)}`;
      openSheet(`<h2>신고를 저장했습니다</h2><p>설정 › 신고 내역에서 확인할 수 있습니다. 제작자에게 직접 알리려면 GitHub 이슈로 보내 주세요.</p>
        <div class="btn-row two"><button class="btn" data-close>닫기</button><a class="btn primary" href="${esc(url)}" target="_blank" rel="noopener" style="text-decoration:none">GitHub 이슈로 보내기</a></div>`,
        (s2) => s2.querySelector('a').addEventListener('click', closeSheet));
      if (wasPlaying) {/* 진행 상태는 그대로 */}
    });
  });
}

function cycleFont() {
  const cur = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--fs')) || 1;
  const idx = FONT_STEPS.findIndex((v) => Math.abs(v - cur) < 0.01);
  const nextV = FONT_STEPS[(idx + 1) % FONT_STEPS.length];
  setFont(nextV);
  toast(`글자 크기 ${['작게', '보통', '크게', '아주 크게'][FONT_STEPS.indexOf(nextV)]}`);
}
function setFont(v) {
  document.documentElement.style.setProperty('--fs', v);
  lsSet('wq-font', String(v));
}

/* ================= 기록 (오답 노트 / 북마크 / 게임 기록) ================= */
let recFilter = { mode: 'all', cat: 'all' };
VIEWS.records = async ({ tab = 'wrong' }) => {
  await loadMeta();
  const tabs = [['wrong', '오답 노트'], ['bookmarks', '북마크'], ['games', '게임 기록']];
  let body = '';
  if (tab === 'wrong' || tab === 'bookmarks') {
    const rows = tab === 'wrong'
      ? (await S.getAll('qstats')).filter((s) => s.inWrongNote).sort((a, b) => b.wrongCount - a.wrongCount || b.lastAt - a.lastAt)
      : (await S.getAll('bookmarks')).sort((a, b) => b.at - a.at);
    const needModes = [...new Set(rows.map((r) => modeOf(r.id)))];
    for (const m of needModes) await loadMode(m);
    const enriched = rows.map((r) => ({ r, q: QCACHE.get(modeOf(r.id))?.byId.get(r.id) })).filter((x) => x.q);
    const modeChips = ['all', ...MODE_ORDER.filter((m) => enriched.some((x) => modeOf(x.q.id) === m))];
    if (!modeChips.includes(recFilter.mode)) recFilter = { mode: 'all', cat: 'all' };
    const inMode = enriched.filter((x) => recFilter.mode === 'all' || modeOf(x.q.id) === recFilter.mode);
    const cats = recFilter.mode === 'all' ? [] : ['all', ...new Set(inMode.map((x) => x.q.category))];
    if (!cats.includes(recFilter.cat)) recFilter.cat = 'all';
    const shown = inMode.filter((x) => recFilter.cat === 'all' || x.q.category === recFilter.cat);
    const qstatsMap = tab === 'bookmarks' ? new Map((await S.getAll('qstats')).map((s) => [s.id, s])) : null;
    body = `
      <div class="filters" role="group" aria-label="모드 필터">${modeChips.map((m) => `<button data-fm="${m}" aria-pressed="${recFilter.mode === m}">${m === 'all' ? '전체' : MODES[m].name}</button>`).join('')}</div>
      ${cats.length > 2 ? `<div class="filters" role="group" aria-label="분야 필터">${cats.map((c) => `<button data-fc="${esc(c)}" aria-pressed="${recFilter.cat === c}">${c === 'all' ? '모든 분야' : esc(catLabel(recFilter.mode, c))}</button>`).join('')}</div>` : ''}
      ${tab === 'wrong' && shown.length ? `<div class="btn-row" style="margin:0 0 14px"><button class="btn accent" data-review-all>표시된 ${shown.length}문제 복습 퀴즈</button></div>` : ''}
      <div class="qlist">${shown.map(({ r, q }) => {
        const st = tab === 'wrong' ? r : qstatsMap.get(q.id);
        const rep = st && st.wrongCount >= 2;
        const meta = tab === 'wrong'
          ? `틀림 ${r.wrongCount}회 · 복습 정답 ${r.reviewCorrect}회${rep ? ' · <span class="rep">반복 오답</span>' : ''}`
          : `${esc(MODES[modeOf(q.id)].name)} · ${esc(catLabel(modeOf(q.id), q.category))}${st ? ` · ${st.lastResult ? '최근 정답' : '최근 오답'}` : ''}`;
        return `<button class="qitem" data-detail="${q.id}"><span class="st ${tab === 'wrong' ? 'bad' : 'good'}" style="${tab === 'bookmarks' ? 'background:var(--accent)' : ''}">${tab === 'wrong' ? ICON.x : ICON.star.replace('<svg', '<svg style="fill:#fff;stroke:none"')}</span>
          <span class="body"><span class="qt">${esc(q.question)}</span><span class="meta">${meta}</span></span></button>`;
      }).join('')}</div>
      ${shown.length ? '' : `<div class="empty"><b>${tab === 'wrong' ? '오답 노트가 비어 있습니다' : '북마크한 문제가 없습니다'}</b>${tab === 'wrong' ? '틀린 문제는 여기에 자동으로 모입니다.' : '문제 화면의 ☆ 버튼으로 저장하세요.'}</div>`}`;
    VIEWS.records._shown = shown.map((x) => x.q.id);
  } else {
    const games = (await S.getAll('games')).sort((a, b) => b.endedAt - a.endedAt);
    body = games.length ? `<div class="qlist">${games.map((g) => `
      <button class="qitem" data-go="result" data-params='{"id":"${g.id}"}'>
        <span class="st" style="background:${g.kind === 'review' ? 'var(--ink-3)' : MODES[g.mode].color}">${ICON.check}</span>
        <span class="body"><span class="qt">${g.kind === 'review' ? '오답 복습' : MODES[g.mode].name} · ${g.correct}/${g.answered} 정답 (${fmtPct(g.rate)})</span>
        <span class="meta">${fmtDateTime(g.endedAt)}${g.timer ? ' · 시간제한' : ''}</span></span></button>`).join('')}</div>`
      : '<div class="empty"><b>아직 완료한 게임이 없습니다</b>게임을 끝내면 결과가 여기에 쌓입니다.</div>';
  }
  return `<div class="topbar"><h1 style="font-size:22px">기록</h1></div>
    <div class="tabs" role="tablist">${tabs.map(([k, l]) => `<button role="tab" data-tab2="${k}" aria-selected="${tab === k}">${l}</button>`).join('')}</div>${body}`;
};
VIEWS.records.mount = ({ tab = 'wrong' }) => {
  const rerender = () => { current.params = { tab }; history.replaceState(current, ''); render(); };
  $app.querySelectorAll('[data-tab2]').forEach((b) => b.addEventListener('click', () => { current.params = { tab: b.dataset.tab2 }; history.replaceState(current, ''); render(); }));
  $app.querySelectorAll('[data-fm]').forEach((b) => b.addEventListener('click', () => { recFilter = { mode: b.dataset.fm, cat: 'all' }; rerender(); }));
  $app.querySelectorAll('[data-fc]').forEach((b) => b.addEventListener('click', () => { recFilter.cat = b.dataset.fc; rerender(); }));
  $app.querySelectorAll('[data-detail]').forEach((b) => b.addEventListener('click', () => detailSheet(b.dataset.detail, null, tab === 'wrong' ? { onRemove: rerender } : {})));
  $app.querySelector('[data-review-all]')?.addEventListener('click', () => startReview(VIEWS.records._shown || []));
};

/* ================= 통계 ================= */
VIEWS.stats = async () => {
  const meta = await loadMeta();
  const [games, qstats, prog, streak, seenRows] = await Promise.all([S.getAll('games'), S.getAll('qstats'), modeProgress(), S.get('meta', 'streak'), S.getAll('seen')]);
  const answered = games.reduce((a, g) => a + g.answered, 0);
  const correct = games.reduce((a, g) => a + g.correct, 0);
  const last = games.reduce((a, g) => Math.max(a, g.endedAt), 0);
  const recent = games.sort((a, b) => a.endedAt - b.endedAt).slice(-10);
  const modeBars = MODE_ORDER.map((m) => `<div class="bar-row"><span class="name">${MODES[m].name}</span><span class="track"><i style="background:${MODES[m].color}" data-w="${prog[m].pct}"></i></span><span class="val">${fmtPct(prog[m].pct)}<small>${prog[m].seen}/${prog[m].total}</small></span></div>`).join('');
  // 분야별 숙련도: 일반 플레이 첫 응답 기준
  const mastery = MODE_ORDER.map((m) => {
    const cats = meta.modes[m].categories;
    const rows = Object.entries(cats).map(([c, info]) => {
      const st = qstats.filter((s) => s.mode === m && s.category === c && s.first !== null);
      const ok = st.filter((s) => s.first).length;
      return { c, label: info.label, total: info.count, tried: st.length, ok, r: accuracy(ok, st.length) };
    }).filter((x) => x.tried > 0);
    if (!rows.length) return '';
    return `<div class="section-label">${MODES[m].name} · 분야별 숙련도</div><div class="card"><div class="bars">${rows.map((x) => `<div class="bar-row"><span class="name">${esc(x.label)}</span><span class="track"><i class="${x.r < 50 ? 'low' : ''}" data-w="${x.r}"></i></span><span class="val">${fmtPct(x.r)}<small>${x.ok}/${x.tried}</small></span></div>`).join('')}</div></div>`;
  }).join('');
  const maxH = 100;
  const recentHTML = recent.length ? `<div class="recent">${recent.map((g) => `<div class="col" title="${fmtDateTime(g.endedAt)} · ${fmtPct(g.rate)}"><span>${Math.round(g.rate)}</span><i style="--c:${g.kind === 'review' ? 'var(--ink-3)' : MODES[g.mode].color};height:0" data-h="${Math.max(3, (g.rate / 100) * maxH)}"></i></div>`).join('')}</div>
    <div class="legend">${MODE_ORDER.map((m) => `<span><i style="background:${MODES[m].color}"></i>${MODES[m].name}</span>`).join('')}<span><i style="background:var(--ink-3)"></i>오답 복습</span></div>` : '<div class="empty" style="padding:24px">아직 기록이 없습니다</div>';
  return `<div class="topbar"><h1 style="font-size:22px">통계</h1></div>
    <div class="stat-grid">
      <div class="stat"><span>누적 플레이</span><b>${games.length}<small>회</small></b></div>
      <div class="stat"><span>누적 출제 문제</span><b>${answered.toLocaleString()}<small>문제</small></b></div>
      <div class="stat"><span>누적 정답률</span><b>${fmtPct(accuracy(correct, answered))}</b></div>
      <div class="stat"><span>최고 연속 정답</span><b>${streak?.best || 0}<small>연속</small></b></div>
      <div class="stat"><span>풀어본 서로 다른 문제</span><b>${seenRows.length.toLocaleString()}<small>/ ${meta.total.toLocaleString()}</small></b></div>
      <div class="stat"><span>마지막 플레이</span><b style="font-size:18px">${fmtDate(last)}</b></div>
    </div>
    <div class="section-label">모드별 진행률</div><div class="card"><div class="bars">${modeBars}</div></div>
    <div class="section-label">최근 10게임 정답률</div><div class="card">${recentHTML}</div>
    ${mastery}
    <p class="hint">모든 수치는 이 기기에 저장된 실제 풀이 기록으로 계산합니다. 숙련도는 각 문제를 처음 풀었을 때의 정오답 기준입니다.</p>`;
};
VIEWS.stats.mount = () => {
  requestAnimationFrame(() => {
    $app.querySelectorAll('.track i').forEach((i) => { i.style.width = i.dataset.w + '%'; });
    $app.querySelectorAll('.recent i').forEach((i) => { i.style.height = i.dataset.h + 'px'; });
  });
};

/* ================= 설정 ================= */
VIEWS.settings = async () => {
  const meta = await loadMeta();
  const theme = lsGet('wq-theme') || 'system';
  const font = parseFloat(lsGet('wq-font') || '1');
  const motion = lsGet('wq-motion') || 'system';
  const reports = await S.getAll('reports');
  const vs = meta.verification;
  return `<div class="topbar"><h1 style="font-size:22px">설정</h1></div>
    <div class="card">
      <div class="row"><div class="grow"><div class="label">화면 테마</div></div>
        <div class="seg" role="group" aria-label="테마">${[['system', '자동'], ['light', '라이트'], ['dark', '다크']].map(([k, l]) => `<button data-theme="${k}" aria-pressed="${theme === k}">${l}</button>`).join('')}</div></div>
      <div class="row"><div class="grow"><div class="label">글자 크기</div><div class="sub">문제와 해설</div></div>
        <div class="seg" role="group" aria-label="글자 크기">${FONT_STEPS.map((v, k) => `<button data-font="${v}" aria-pressed="${Math.abs(font - v) < 0.01}" style="font-size:${12 + k * 1.5}px">가</button>`).join('')}</div></div>
      <div class="row"><div class="grow"><div class="label">애니메이션</div><div class="sub">‘자동’은 기기의 동작 줄이기 설정을 따릅니다</div></div>
        <div class="seg" role="group" aria-label="애니메이션">${[['system', '자동'], ['reduce', '줄이기']].map(([k, l]) => `<button data-motion="${k}" aria-pressed="${motion === k}">${l}</button>`).join('')}</div></div>
    </div>
    <div class="section-label">기록 백업</div>
    <div class="card">
      <div class="row"><div class="grow"><div class="label">기록 내보내기</div><div class="sub">출제 기록·오답 노트·통계를 JSON 파일로 저장</div></div><button class="chip-btn" data-export>내보내기</button></div>
      <div class="row"><div class="grow"><div class="label">기록 가져오기</div><div class="sub">다른 기기의 기록 파일과 병합 (기존 기록 유지)</div></div><button class="chip-btn" data-import>가져오기</button></div>
      <input type="file" accept="application/json,.json" hidden data-file>
    </div>
    <p class="hint">기록은 이 브라우저(IndexedDB)에만 저장됩니다. 브라우저 데이터를 지우거나 기기를 바꾸면 자동으로 옮겨지지 않으니 내보내기로 백업하세요.</p>
    <div class="section-label">신고 내역 (${reports.length})</div>
    <div class="card">${reports.length ? reports.slice(-20).reverse().map((r) => `<div class="row"><div class="grow"><div class="label" style="font-size:14px">${esc(r.qid)} · ${esc(r.reason)}</div><div class="sub">${fmtDateTime(r.at)}${r.note ? ' · ' + esc(r.note) : ''}</div></div></div>`).join('') : '<div class="row"><div class="sub">신고한 문제가 없습니다</div></div>'}</div>
    <div class="section-label">문제 데이터</div>
    <div class="card">
      <div class="row"><div class="grow"><div class="label">문제 수</div></div><b>${meta.total.toLocaleString()}</b></div>
      ${MODE_ORDER.map((m) => `<div class="row"><div class="grow"><div class="sub">${MODES[m].name}</div></div><span>${meta.modes[m].ids.length.toLocaleString()}</span></div>`).join('')}
      <div class="row"><div class="grow"><div class="label">검증 상태</div><div class="sub">${Object.entries(vs).map(([k, v]) => `${esc(VERIFY_LABEL[k] || k)} ${v}`).join(' · ')} / ${Object.entries(meta.editorial || {}).map(([k, v]) => `${esc(VERIFY_LABEL[k] || k)} ${v}`).join(' · ')}</div></div></div>
      <div class="row"><div class="grow"><div class="sub">데이터 버전 ${esc(meta.version)} · ${esc(meta.verificationNotice || '')} 틀린 내용을 발견하면 문제 화면의 ‘신고’로 알려 주세요.</div></div></div>
    </div>
    <div class="section-label">위험 구역</div>
    <div class="card"><div class="row"><div class="grow"><div class="label">모든 기록 삭제</div><div class="sub">출제 기록, 오답 노트, 통계를 모두 지웁니다</div></div><button class="chip-btn" style="color:var(--bad)" data-wipe>삭제</button></div></div>
    <p class="hint" style="text-align:center;margin-top:24px"><a href="${REPO_URL}" target="_blank" rel="noopener">WORLD QUIZ 소스 코드</a></p>`;
};
VIEWS.settings.mount = () => {
  $app.querySelectorAll('[data-theme]').forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.theme;
    lsSet('wq-theme', k === 'system' ? null : k);
    if (k === 'system') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = k;
    $app.querySelectorAll('[data-theme]').forEach((x) => x.setAttribute('aria-pressed', x === b));
  }));
  $app.querySelectorAll('[data-font]').forEach((b) => b.addEventListener('click', () => {
    setFont(Number(b.dataset.font));
    $app.querySelectorAll('[data-font]').forEach((x) => x.setAttribute('aria-pressed', x === b));
  }));
  $app.querySelectorAll('[data-motion]').forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.motion;
    lsSet('wq-motion', k === 'system' ? null : k);
    if (k === 'reduce') document.documentElement.dataset.motion = 'reduce'; else delete document.documentElement.dataset.motion;
    $app.querySelectorAll('[data-motion]').forEach((x) => x.setAttribute('aria-pressed', x === b));
  }));
  $app.querySelector('[data-export]').addEventListener('click', async () => {
    const data = await S.exportAll();
    const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `world-quiz-기록-${fmtDate(Date.now()).replace(/\./g, '')}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast(`출제 기록 ${data.seen.length}개를 내보냈습니다`);
  });
  const file = $app.querySelector('[data-file]');
  $app.querySelector('[data-import]').addEventListener('click', () => file.click());
  file.addEventListener('change', async () => {
    const f = file.files[0];
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      const c = await S.importAll(data);
      toast(`가져오기 완료 · 출제 기록 ${c.seen}개, 문제 기록 ${c.qstats}개, 게임 ${c.games}개 추가`);
      render();
    } catch (err) { toast(err.message || '파일을 읽을 수 없습니다'); }
    file.value = '';
  });
  $app.querySelector('[data-wipe]').addEventListener('click', async () => {
    const ok1 = await confirmSheet({ title: '모든 기록을 삭제할까요?', body: '출제 기록이 사라지면 이미 푼 문제가 다시 출제됩니다. 먼저 내보내기로 백업하는 것을 권장합니다.', ok: '계속', danger: true });
    if (!ok1) return;
    const ok2 = await confirmSheet({ title: '정말 삭제합니다', body: '이 작업은 되돌릴 수 없습니다.', ok: '모두 삭제', danger: true });
    if (!ok2) return;
    await S.wipeAll();
    toast('모든 기록을 삭제했습니다');
    go('home', {}, { replace: true });
  });
};

/* ================= 시작 ================= */
async function boot() {
  $app.innerHTML = '<div class="loading">불러오는 중…</div>';
  try {
    await S.openDB();
    await loadMeta();
    if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
  } catch (err) {
    $app.innerHTML = `<div class="empty"><b>앱을 시작할 수 없습니다</b>${esc(err.message)}<br>개인정보 보호 모드에서는 저장소가 제한될 수 있습니다.</div>`;
    return;
  }
  const init = history.state && history.state.view && history.state.view !== 'play' ? history.state : { view: 'home', params: {} };
  current = init;
  history.replaceState(current, '');
  render();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW 등록 실패', e));
  }
}
boot();

// 테스트/디버깅용 노출
window.__wq = { S, loadMeta, loadMode };
