/* ===== Экспедиция «Полюс-6» — движок (форк «Агентства „Логика"») ===== */
'use strict';

const STORE_KEY = 'pole6V1';
let store = loadStore();
migrateStore(store);
function migrateStore(s) {
  let changed = false;
  Object.values(s.profiles).forEach(p => {
    if (!p.mysteryV2) {          // профиль со времён первого шифра
      p.mysteryV2 = true;
      if (p.mysterySolved) {     // старый раскрытый шифр зачли, новый закрыт
        p.solvedV1 = true;
        p.mysterySolved = false;
      }
      changed = true;
    }
  });
  if (changed) { try { saveStore(); } catch (e) {} }
}
let safeModalQueue = [];
let examTimer = null;

/* ---------- утилиты ---------- */
function $(id) { return document.getElementById(id); }
function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function today(off) { const d = new Date(); if (off) d.setDate(d.getDate() + off); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function norm(v) {
  return String(v).toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
}
function normHard(v) {
  return String(v).toLowerCase().replace(/ё/g, 'е').replace(/[^0-9a-zа-я\-]/g, '');
}
function loadStore() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { /* повреждённые данные — начинаем с чистого листа */ }
  return { profiles: {}, currentId: null, admin: { pin: null, prizes: {} }, ui: { theme: 'desk' } };
}
function saveStore() { localStorage.setItem(STORE_KEY, JSON.stringify(store)); }
function P() { return store.profiles[store.currentId] || null; }
function newProfile(name, emoji) {
  const id = 'p' + Date.now();
  store.profiles[id] = {
    name, emoji, created: today(), briefed: false,
    points: 0,
    problems: {},   // 'c1/p1' -> {status:'solved'|'reviewed', hints, solution, got, first, lastDay}
    notes: {},      // 'c1/p7' -> черновик полярника (текст), 'c1/boss' -> черновик перевала
    bosses: {},     // c1 -> {done:true, got}
    earlyUnlock: {},// c2 -> true
    letters: [],    // индексы открытых букв слова шифровки
    mysterySolved: false,
    mysteryV2: true,
    junctions: {},  // j1 -> {choice, coins}
    achievements: [],
    activity: [],
    views: {},      // 'c1/p1' -> дата первого просмотра
    exam: { best: null, started: null, answers: {}, submitted: false },
    safesOpened: []
  };
  store.currentId = id;
  saveStore();
}
function applyTheme() {
  store.ui = store.ui || {};
  if (!['desk', 'night', 'day'].includes(store.ui.theme)) store.ui.theme = 'desk';
  document.body.dataset.theme = store.ui.theme;
}
const THEMES = [
  { id: 'desk', name: 'Полярная ночь', desc: 'тёмный лёд и снежная бумага', colors: ['#0e2233', '#f2f7fa', '#e8b35a'] },
  { id: 'night', name: 'Северное сияние', desc: 'тёмный, с индиго-акцентами', colors: ['#0d1017', '#1b2231', '#8b9dff'] },
  { id: 'day', name: 'Белый день', desc: 'светлый минимализм', colors: ['#eef1f8', '#ffffff', '#5a5fd6'] }
];
function titleFor(points) {
  let t = DATA.titles[0].name;
  for (const x of DATA.titles) if (points >= x.min) t = x.name;
  return t;
}

/* ---------- телеметрия (статистика для родителей) ---------- */
const TL = {
  endpoint: 'https://game-metrics.kirillovd.workers.dev/track',
  q: [], timer: null, logged: false, curCase: null,
  send: function (t, d) {
    try {
      const p = P();
      this.q.push({ t: t, g: 'pole6', u: (window.PLATFORM ? PLATFORM.identity().uid : ''), p: p ? p.name : '—', d: String(d || '').slice(0, 150), ts: Date.now() });
      if (this.q.length >= 10) this.flush();
      else if (!this.timer) this.timer = setTimeout(() => this.flush(), 7000);
    } catch (e) { /* тише едешь — статистика целее */ }
  },
  flush: function () {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (!this.q.length) return;
    const body = JSON.stringify({ events: this.q.splice(0, 60) });
    try {
      fetch(this.endpoint, { method: 'POST', keepalive: true, headers: { 'Content-Type': 'text/plain' }, body: body })
        .catch(() => { try { navigator.sendBeacon(this.endpoint, body); } catch (e2) {} });
    } catch (e) {
      try { navigator.sendBeacon(this.endpoint, body); } catch (e2) {}
    }
  }
};
window.addEventListener('pagehide', () => TL.flush());

/* ---------- похвала, локальная история, письма Капитана ---------- */
const PRAISE = ['Ты гений! 🔥', 'Блестяще!', 'Гениально!', 'Великолепно!', 'Такое решают единицы!', 'Капитан снял шапку!', 'Это талант полярника!', 'Виртуозно!'];
const PRAISE_GRIT = ['Вот это упорство! 💪', 'Настоящий полярник не сдаётся!', 'Ошибка — ступенька. Ты выше!', 'Упорство дороже скорости!'];
function praiseToast(extra) { toast(PRAISE[Math.floor(Math.random() * PRAISE.length)] + (extra ? ' ' + extra : '')); }
function hist(k, x) {
  const p = P();
  p.history = p.history || [];
  p.history.push({ d: today(), k: k, x: String(x || '').slice(0, 90) });
  if (p.history.length > 400) p.history.splice(0, p.history.length - 400);
  saveStore();
}
function noteAttempts(cid, pid) {
  const p = P();
  p.attempts = p.attempts || {};
  const k = entryKey(cid, pid);
  p.attempts[k] = (p.attempts[k] || 0) + 1;
  return p.attempts[k];
}
function pushRecent(h) {
  const p = P();
  p.recent = (p.recent || []).slice(-5);
  p.recent.push(h);
  saveStore();
}
function adaptiveNudge() {
  const p = P();
  const r = p.recent || [];
  if (r.length < 3) return;
  const last3 = r.slice(-3);
  if (last3.every(h => h === 0)) toast('🔥 Ты на кураже — перевал дрожит! Держи темп!', 'ach');
  else if (last3.every(h => h >= 2)) toast('💡 Совет капитана: следующую попробуй максимум с одной наводкой — ты сможешь!');
}
function buildLetter(cid) {
  const c = DATA.caseList.find(x => x.id === cid);
  const p = P();
  let solvedN = 0, clean = 0, hintsSum = 0, attSum = 0;
  c.problems.forEach(pr => {
    const e = p.problems[entryKey(cid, pr.id)];
    if (!e || e.status !== 'solved') return;
    solvedN++;
    if (e.hints === 0 && !e.solution) clean++;
    hintsSum += e.hints || 0;
    attSum += (p.attempts || {})[entryKey(cid, pr.id)] || 0;
  });
  let strong;
  if (clean >= 8) strong = 'ты закрыл(а) ' + clean + ' задач без единой подсказки — это уровень мастера. Такое я видел(а) только у лучших полярников.';
  else if (clean >= 5) strong = 'больше половины задач — чистой работой, без подсказок. Твой ум работает как часы в мороз.';
  else strong = 'ты дошёл(ла) до перевала и взял(а) его. Упорство дороже скорости — и оно у тебя есть.';
  const avgH = solvedN ? hintsSum / solvedN : 0;
  const avgA = solvedN ? attSum / solvedN : 0;
  let advice;
  if (avgH >= 1.5) advice = 'Один совет: когда рука тянется ко второй наводке — выдержи ещё одну минуту тишины. Твои «чистые» решения у тебя получаются, я видел(а).';
  else if (avgA >= 2) advice = 'Один совет: перед третьей попыткой перечитай условие вслух — половина ответов прячется в формулировке.';
  else advice = 'Тебе пора на «десерты» и перевалы потруднее — обычным задачам ты тесно.';
  return '<p>Полярник <b>' + esc(p.name) + '</b>, этап №' + c.num + ' «' + esc(c.title) + '» пройден — и вот что я скажу.</p>' +
    '<p>' + strong + '</p><p>' + advice + '</p>' +
    '<div style="text-align:right;font-style:italic;margin-top:8px">Курс на полюс.<br>Твой Капитан ⚓</div>';
}

/* ---------- ИИ-наставник «Спросить капитана» ---------- */
let askState = { ctx: '', history: [], busy: false };
function askOpen(ctx) {
  askState = { ctx: ctx, history: [], busy: false };
  showModal(`
    <h2>🤖 Спросить Капитана</h2>
    <p class="small" style="color:var(--ink-soft)">Капитан не даст ответ — он умеет только подталкивать к идее. Спрашивай, что непонятно.</p>
    <div id="ask-log" style="text-align:left;max-height:40vh;overflow:auto;margin:10px 0"></div>
    <div class="answer-row" style="justify-content:center">
      <input type="text" id="ask-input" placeholder="Спроси Капитана…" autocomplete="off" style="flex:1;min-width:180px">
      <button class="gold" data-act="askSend">Спросить</button>
    </div>
    <div style="margin-top:8px"><button class="small-btn ghost" data-act="closeModal">Закрыть</button></div>
  `);
  renderAskLog();
  setTimeout(() => { const i = $('ask-input'); if (i) i.focus(); }, 50);
}
function renderAskLog() {
  const box = $('ask-log');
  if (!box) return;
  box.innerHTML = askState.history.map(m => m.role === 'user'
    ? `<div style="background:var(--note-bg);border-radius:10px;padding:8px 12px;margin:6px 0;color:var(--note-ink)"><b>Ты:</b> ${esc(m.text)}</div>`
    : `<div style="background:var(--hint-bg);border-radius:10px;padding:8px 12px;margin:6px 0"><b>Капитан:</b> ${esc(m.text)}</div>`).join('')
    + (askState.busy ? '<div class="small muted">Капитан думает…</div>' : '');
  box.scrollTop = box.scrollHeight;
}
async function askSend() {
  const inp = $('ask-input');
  if (!inp || askState.busy) return;
  const q = inp.value.trim();
  if (!q) return;
  inp.value = '';
  askState.history.push({ role: 'user', text: q });
  askState.busy = true;
  renderAskLog();
  const p = P();
  try {
    const r = await fetch('https://game-metrics.kirillovd.workers.dev/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: q, ctx: askState.ctx, g: 'pole6', p: p ? p.name : '' })
    });
    const d = await r.json();
    askState.history.push({ role: 'bot', text: d.answer || 'Хм. Перечитай условие — и расскажи мне, что уже заметил(а).' });
  } catch (e) {
    askState.history.push({ role: 'bot', text: 'Связь с капитаном пропала — попробуй ещё раз.' });
  }
  askState.busy = false;
  renderAskLog();
}

/* ---------- прогресс по задачам ---------- */
function entryKey(cid, pid) { return cid + '/' + pid; }
function getEntry(cid, pid) { const p = P(); return p ? p.problems[entryKey(cid, pid)] || null : null; }
function setEntry(cid, pid, obj) { P().problems[entryKey(cid, pid)] = obj; saveStore(); }
function getNote(key) { const p = P(); return (p.notes && p.notes[key]) || ''; }
function saveNote(key, text) { const p = P(); if (!p.notes) p.notes = {}; p.notes[key] = text; saveStore(); }
function caseStats(c) {
  const closed = c.problems.filter(pr => getEntry(c.id, pr.id)).length;
  return { closed, total: c.problems.length, boss: !!(P().bosses[c.id] && P().bosses[c.id].done) };
}
/* ---------- задача дня и календарь огня ---------- */
function dateStr(offset) {
  const d = new Date();
  d.setDate(d.getDate() + (offset || 0));
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function dayTaskFor(dstr) {
  const n = Math.floor(Date.parse(dstr) / 86400000);
  return DATA.dayTasks[n % DATA.dayTasks.length];
}
function flameOf() {
  const p = P();
  if (!p.flame) p.flame = { last: null, streak: 0, best: 0, days: {} };
  return p.flame;
}
function flameOnSolve() {
  const f = flameOf();
  const d = today();
  if (f.last === d) return;
  f.streak = (f.last === dateStr(-1)) ? f.streak + 1 : 1;
  f.last = d;
  f.best = Math.max(f.best, f.streak);
  f.days[d] = true;
  const keys = Object.keys(f.days).sort();
  while (keys.length > 30) delete f.days[keys.shift()];
  saveStore();
  if (f.streak >= 3) unlockAch('a_streak3');
}
function daySolvedToday() {
  const p = P();
  return !!(p.flame && p.flame.days && p.flame.days[today()]);
}
function flameStripHtml() {
  const p = P();
  const f = p.flame || { streak: 0, best: 0, days: {} };
  const names = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];
  let cells = '';
  for (let i = 6; i >= 0; i--) {
    const d = dateStr(-i);
    const lit = !!(f.days && f.days[d]);
    const wd = names[(new Date(d).getDay() + 6) % 7];
    cells += `<div class="flame-cell ${lit ? 'lit' : ''} ${i === 0 ? 'today' : ''}"><span class="f-ico">${lit ? '🔥' : '·'}</span><span class="f-day">${wd}</span></div>`;
  }
  return `<div class="flame-strip">${cells}</div>`;
}
function dayTaskCardHtml() {
  const f = P().flame || { streak: 0, best: 0 };
  const solved = daySolvedToday();
  return `
  <div class="paper day-card">
    <h4>🔥 Задача дня</h4>
    <div class="day-row">
      <div class="flame-info">серия: <b>${f.streak || 0}</b> 🔥 · рекорд: <b>${f.best || 0}</b></div>
      ${flameStripHtml()}
      ${solved
        ? '<span class="result-ok">✔ решено сегодня — возвращайся завтра!</span>'
        : '<button class="gold" data-act="dayOpen">Решить задачу дня 🔥</button>'}
    </div>
  </div>`;
}
let daySession = { hints: 0 };
function dayOpen() {
  daySession = { hints: 0 };
  const t = dayTaskFor(today());
  showModal(`
    <h2>🔥 Задача дня</h2>
    <p>${t.q}</p>
    <div class="answer-row" style="justify-content:center">
      <input type="text" id="day-ans" placeholder="${t.answerNote || 'ответ'}" autocomplete="off">
      <button class="gold" data-act="dayCheck">Проверить</button>
    </div>
    <div id="day-hints"></div>
    <div id="day-res"></div>
    <div style="margin-top:8px">
      <button class="small-btn ghost" data-act="dayHint" data-arg="1">💡 Наводка</button>
      <button class="small-btn ghost" data-act="dayHint" data-arg="2">💡 Ещё наводка</button>
    </div>
    <p class="small" style="color:var(--ink-soft);margin-top:6px">Награда: 15 🪙 без подсказок · 8 🪙 с наводками</p>
  `);
  $('day-ans').focus();
}
function dayHint(level) {
  if (level <= daySession.hints) return;
  const t = dayTaskFor(today());
  daySession.hints = level;
  $('day-hints').innerHTML += `<div class="hint-item" style="text-align:left">${level === 1 ? t.hint1 : (t.hint2 || t.hint1)}</div>`;
}
function dayCheck() {
  const t = dayTaskFor(today());
  const val = $('day-ans').value;
  const ok = t.answers.some(a => normHard(a) === normHard(val)) || t.answers.some(a => norm(a) === norm(val));
  if (!ok) {
    TL.send('daytask', '✘ ' + (daySession.hints ? '(с наводкой)' : ''));
    $('day-res').innerHTML = '<span class="result-bad">Пока не сходится — попробуй ещё!</span>';
    return;
  }
  const got = daySession.hints ? 8 : 15;
  flameOnSolve();
  addPoints(got, true);
  hist('day', 'задача дня ✔ +' + got + ' (серия ' + P().flame.streak + ')');
  TL.send('daytask', '✔ +' + got + ' 🪙 серия=' + P().flame.streak);
  confetti();
  showModal(`
    <h2>🔥 Верно!</h2>
    <div class="big">🔥</div>
    <p>+${got} 🪙 в казну${P().flame.streak > 1 ? ' · серия: ' + P().flame.streak + ' дней 🔥' : ''}</p>
    <div class="hist-note" style="text-align:left">${t.explain}</div>
    <button class="gold" data-act="dayDone">Отлично!</button>`);
}
function caseUnlocked(idx) {
  if (idx === 0) return true;
  const prev = DATA.caseList[idx - 1];
  return caseStats(prev).boss || !!(P().earlyUnlock[DATA.caseList[idx].id]);
}
function factorFor(hints) { return hints === 0 ? 1 : (hints === 1 ? 0.66 : 0.33); }

/* ---------- баллы и ящики ---------- */
function addPoints(n, silent) {
  const p = P();
  p.points += n;
  saveStore();
  if (!silent) toast('+' + n + ' 🪙 за работу полярника');
  checkSafes();
}
function checkSafes() {
  const p = P();
  DATA.safes.forEach((thr, i) => {
    if (p.points >= thr && p.safesOpened.indexOf(i) < 0) {
      p.safesOpened.push(i);
      safeModalQueue.push(i);
    }
  });
  saveStore();
  if (safeModalQueue.length) showNextSafe();
}
function safePrize(i) {
  const custom = store.admin.prizes[i];
  return custom && custom.text ? custom : { text: 'Приз №' + (i + 1) + ' — подойди к родителям за получением!', img: '' };
}
function showNextSafe() {
  if ($('modal-root').classList.contains('show')) return; // дождёмся закрытия текущего окна
  const i = safeModalQueue.shift();
  if (i === undefined) return;
  const prize = safePrize(i);
  confetti();
  showModal(`
    <h2>Ящик открыт!</h2>
    <div class="big">🗄️✨</div>
    <p>Ты набрал(а) ${DATA.safes[i]} 🪙 — ящик №${i + 1} поддался!</p>
    <div style="background:#f7efd9;border:2px dashed var(--gold);border-radius:8px;padding:14px;margin:10px 0;">
      <div style="font-size:2em">🎁</div>
      <p style="font-size:1.15em"><b>${esc(prize.text)}</b></p>
      ${prize.img ? `<img src="${esc(prize.img)}" style="max-width:100%;border-radius:8px;">` : ''}
      <p class="small" style="color:var(--ink-soft)">Получи приз у родителей и возвращайся в экспедиция!</p>
    </div>
    <button class="gold" onclick="closeModal()">Продолжить поход</button>
  `);
}

/* ---------- достижения ---------- */
function unlockAch(id) {
  const p = P();
  if (!p || p.achievements.indexOf(id) >= 0) return;
  const a = DATA.achievements.find(x => x.id === id);
  if (!a) return;
  p.achievements.push(id);
  saveStore();
  toast(`${a.emoji} Награда полярника: «${a.title}»`, 'ach');
}
function checkStreak() {
  const p = P();
  if (!p) return;
  const days = p.activity.slice().sort();
  if (days.length < 3) return;
  let run = 1, best = 1;
  for (let i = 1; i < days.length; i++) {
    const prev = new Date(days[i - 1]), cur = new Date(days[i]);
    const diff = (cur - prev) / 86400000;
    run = (diff === 1) ? run + 1 : 1;
    if (run > best) best = run;
  }
  if (best >= 3) unlockAch('a_streak3');
}
function touchActivity() {
  const p = P();
  if (!p) return;
  if (p.activity.indexOf(today()) < 0) { p.activity.push(today()); saveStore(); }
  checkStreak();
}
function countCleanSolved() {
  const p = P();
  return Object.keys(p.problems).filter(k => {
    const e = p.problems[k];
    return e.status === 'solved' && e.hints === 0 && !e.solution;
  }).length;
}
function afterProblemSolved(cid, pid, hints, sawSolution) {
  const p = P();
  unlockAch('a_first');
  if (countCleanSolved() >= 10) unlockAch('a_ten_clean');
  const firstView = p.views[entryKey(cid, pid)];
  if (firstView && firstView < today()) unlockAch('a_comeback');
  const c = DATA.caseList.find(x => x.id === cid);
  if (c) {
    const st = caseStats(c);
    if (st.closed === st.total) {
      const allClean = c.problems.every(pr => {
        const e = p.problems[entryKey(cid, pr.id)];
        return e && e.status === 'solved' && e.hints === 0 && !e.solution;
      });
      if (allClean) unlockAch('a_no_hints');
    }
  }
}

/* ---------- маршрутизация ---------- */
function route() {
  if (examTimer) { clearInterval(examTimer); examTimer = null; }
  const h = location.hash.replace(/^#/, '');
  const p = P();
  if (!p) { renderProfiles(); return; }
  touchActivity();
  if (!h.startsWith('case/')) TL.curCase = null;
  if (!TL.logged) { TL.logged = true; TL.send('login', 'монет: ' + p.points + ', дел закрыто: ' + Object.keys(p.bosses).length); }
  if (!p.briefed && h !== 'admin' && h !== 'brief') { renderBrief(); return; }
  if (h === 'brief') { renderBrief(); return; }
  if (h === '' || h === 'map') renderMap();
  else if (h.startsWith('case/')) renderCase(h.split('/')[1]);
  else if (h === 'exam') renderExam();
  else if (h === 'mystery') renderMystery();
  else if (h === 'ach') renderAch();
  else if (h === 'admin') renderAdmin();
  else if (h === 'profile') renderProfilePage();
  else renderMap();
}
window.addEventListener('hashchange', route);

/* ---------- шапка ---------- */
function headerHtml(active) {
  const p = P();
  const nextSafeIdx = DATA.safes.findIndex((thr, i) => p.safesOpened.indexOf(i) < 0);
  let safeBar = '';
  if (nextSafeIdx >= 0) {
    const prev = nextSafeIdx === 0 ? 0 : DATA.safes[nextSafeIdx - 1];
    const thr = DATA.safes[nextSafeIdx];
    const pct = Math.min(100, Math.round((p.points - prev) / (thr - prev) * 100));
    safeBar = `
      <div class="safe-progress">
        <span>🗄️ Ящик №${nextSafeIdx + 1}</span>
        <div class="bar"><i style="width:${pct}%"></i></div>
        <span>${p.points} / ${thr} 🪙</span>
      </div>`;
  } else {
    safeBar = `<div class="safe-progress"><span>🗄️ Все ящики вскрыты — ты легенда экспедиции!</span></div>`;
  }
  const links = [['map', '🗺️ Маршрут'], ['brief', '📣 Приказ'], ['exam', '📝 Штурм-контрольная'], ['mystery', '🗝️ Шифровка'], ['ach', '🏅 Награды']];
  const nav = links.map(([id, label]) => `<a href="#${id}" ${active === id ? 'style="font-weight:bold"' : ''}>${label}</a>`).join(' · ');
  return `
    <div class="topbar">
      <span class="brand"><span class="em">🧭</span> Полюс-6</span>
      <span class="agent-chip">${p.emoji} <b>${esc(p.name)}</b> · ${titleFor(p.points)}</span>
      <span class="spacer"></span>
      <span class="agent-chip">${window.PLATFORM && PLATFORM.user ? '👤 ' + esc(PLATFORM.user.name) : '<a href="#" data-pf-act="login">Войти в аккаунт</a>'}</span>
      <span class="points-chip"><span class="coin">🪙</span> ${p.points}</span>
    </div>
    <div style="margin-bottom:8px;" class="small">${nav} · <a href="#profile">👤 Профиль</a> · <a href="#admin">🔑 Родителям</a></div>
    ${safeBar}`;
}
function footerHtml() {
  return `<footer class="site-foot">${DATA.credits}<br>Прогресс хранится в этом браузере. Кнопка «сохранить в файл» — на странице профиля.</footer>`;
}

/* ---------- экран профилей ---------- */
function renderProfiles() {
  const list = Object.keys(store.profiles).map(id => {
    const p = store.profiles[id];
    return `<div class="profile-card" data-act="pickProfile" data-arg="${id}">
      <div class="avatar">${p.emoji}</div>
      <b>${esc(p.name)}</b><br><small>${titleFor(p.points)} · 🪙 ${p.points}</small>
    </div>`;
  }).join('');
  $('app').innerHTML = `
    <div class="topbar"><span class="brand"><span class="em">🧭</span> Полюс-6</span></div>
    <p class="board-intro">Математическая экспедиция к полюсу. Выбери полярника — или заведи нового.</p>
    <div class="profile-grid">${list || '<span class="muted">Пока никто не записан в экспедицию.</span>'}</div>
    <div class="paper" style="max-width:460px">
      <h4>Новый полярник</h4>
      <p class="small">Как тебя записать в бортовом журнале?</p>
      <input type="text" id="np-name" maxlength="20" placeholder="Имя полярника" style="width:100%">
      <div class="emoji-pick" id="np-emoji"></div>
      <button class="gold" data-act="createProfile">Записать в экспедицию ✒️</button>
    </div>
    ${footerHtml()}`;
  const avatars = ['🧭', '🐧', '🦭', '🐻‍❄️', '🦌', '🦉', '🧊', '👩‍✈️', '🐕', '🦅'];
  const box = $('np-emoji');
  box.innerHTML = avatars.map((a, i) => `<button data-act="pickEmoji" data-arg="${i}" class="${i === 0 ? 'sel' : ''}">${a}</button>`).join('');
  box.dataset.sel = '0';
}

/* ---------- брифинг (вербовка) ---------- */
function renderBrief() {
  const p = P();
  const titlesList = DATA.titles.map(t => t.name).join(' → ');
  $('app').innerHTML = `
  <div class="topbar">
    <span class="brand"><span class="em">🧭</span> Полюс-6</span>
    <span class="spacer"></span>
    <span class="agent-chip">${p.emoji} <b>${esc(p.name)}</b></span>
  </div>
  <div class="paper" style="max-width:640px;margin:10px auto 0;transform:rotate(-.4deg)">
    <div style="text-align:right;color:var(--ink-soft);font-size:.85em">ПРИКАЗ №1 · ЗАЧИСЛЕНИЕ · ПОЛЯРНАЯ СТАНЦИЯ</div>
    <h4 style="font-size:1.2em">Приказ о зачислении</h4>
    <p>Полярник ${esc(p.name)}, добро пожаловать на борт. Я капитан экспедиции «Полюс-6» — мы идём к полюсу сквозь лёд, метели и трещины, и на карте у нас больше белых пятен, чем линий.</p>
    <p>До нас здесь гибли отряды, которые не умели главного: считать. Когда до полюса сотни километров, а в баке сто сорок литров, ошибка в долях пути — это не двойка в дневнике, а ночёвка в снегу. Поэтому в этой экспедиции решают не силу, а <b>ум</b>: масштаб карты, доли припасов, скорости на переходах.</p>
    <p>Каждый этап — новый участок маршрута. Тебя ждут теория, разборы вместе со мной и задачи, которые становятся всё хитрее — вплоть до олимпиадных «десертов». А между этапами — развилки: выбор, у которого есть последствия.</p>
    <p>Ты зачислен(а). Прочти правила — и выходим на лёд.</p>
    <div style="text-align:right;font-style:italic;color:var(--ink-soft)">— Капитан ⚓</div>
  </div>
  <div class="paper" style="max-width:640px;margin:14px auto;transform:rotate(.3deg)">
    <h4>Как устроен каждый этап</h4>
    <ul style="margin:6px 0;padding-left:20px">
      <li><b>Брифинг</b> — короткая теория: два-три приёма на будущее.</li>
      <li><b>Разборы</b> — три задачи, которые капитан решает вместе с тобой. Сначала подумай сам(а)!</li>
      <li><b>Задачи</b> — двенадцать задач, сложность растёт от разминки до десерта.</li>
      <li><b>Перевал</b> — испытание в конце этапа. Взял(а) — этап пройден, штамп в бортовом журнале, буква шифровки у тебя.</li>
    </ul>
    <h4 style="margin-top:14px">Правила полярника</h4>
    <ul style="margin:6px 0;padding-left:20px">
      <li>🧠 <b>Ошибка — это не провал, а разведка.</b> Неверный ответ ничего не отнимает: пробуй ещё столько, сколько нужно.</li>
      <li>💡 <b>Наводки — законный инструмент.</b> Подсмотрел(а) идею и добил(а) — тоже победа: с одной наводкой задача даёт ⅔ монет, с двумя — треть.</li>
      <li>🔓 <b>Решение капитана откроется всегда</b> — но тогда задача закроется без монет. Сначала попробуй сам(а).</li>
      <li>📝 <b>«Бумажные» задачи</b> — значок 📝: ответ в них не число, а способ. Веди черновик в блокноте под задачей и жми «Я решил(а) сам(а)!». Честное слово полярника — главный закон экспедиции.</li>
      <li>🗄️ <b>Монеты открывают ящики.</b> В ящиках лежат настоящие призы — за ними идти к родителям. Родители настроили призы на своей странице (🔑 внизу).</li>
      <li>🌊 <b>Развилки.</b> Между этапами маршрут предлагает выбор. Правильного ответа нет — есть решения и их последствия.</li>
    </ul>
    <h4 style="margin-top:14px">Что ещё можно заслужить</h4>
    <ul style="margin:6px 0;padding-left:20px">
      <li>⭐ Звания: ${titlesList}.</li>
      <li>🏅 ${DATA.achievements.length} наград полярника — от «Первой вехи» до «Главного слова».</li>
      <li>🗝️ Буквы слова-шифровки из шести букв — за перевалы и контрольную. Соберёшь все — узнаешь главный пароль экспедиции.</li>
      <li>📝 Штурм-контрольная: 8 задач и таймер на 90 минут — как настоящая контрольная, только без нервов.</li>
    </ul>
    <p class="note" style="margin-top:12px">И последнее. Здесь не бывает «слишком глупых вопросов» и «слишком странных идей»: все великие открытия начинались со странной мысли в черновике. Экспедиция верит в тебя.</p>
  </div>
  <div style="text-align:center;margin:18px 0 30px">
    <button class="gold" style="font-size:1.15em;padding:12px 26px" data-act="briefGo">Выходим на маршрут 🧭</button>
    <div style="margin-top:8px"><button class="linklike small" data-act="briefSkip">прочитаю подробнее позже — сразу к этапам</button></div>
  </div>
  ${footerHtml()}`;
}

/* ---------- платные этапы с сервера ---------- */
DATA.remoteStages = DATA.remoteStages || [];
let remoteLoading = false;
async function loadRemoteManifest() {
  if (!window.PLATFORM) return;
  try {
    const m = await PLATFORM.manifest('pole6');
    DATA.remoteStages = (m.stages || []).filter(s => !DATA.caseList.some(c => c.id === s.id));
  } catch (e) { DATA.remoteStages = []; }
  if (location.hash === '' || location.hash === '#map') renderMap();
}
function remoteUnlocked(s) {
  return !!(s.free || (window.PLATFORM && PLATFORM.has('pole6', s.id)));
}
function remoteCardHtml(s) {
  const unlocked = remoteUnlocked(s);
  return `<div class="case-card">
    <div class="pin">${unlocked ? '🧭' : '🔒'}</div>
    <div class="case-paper" style="${unlocked ? '' : 'opacity:.85'}">
      <h3>Этап №${esc(s.id)}. ${esc(s.title || 'Новый этап')}</h3>
      <div class="case-sub">${esc(s.subtitle || '')}</div>
      <div class="case-meta">
        <span>${unlocked ? '🌟 доступ открыт' : '💳 платный этап'}</span>
        ${unlocked
          ? `<button class="primary" data-act="openRemote" data-arg="${esc(s.id)}">Открыть этап</button>`
          : `<button class="gold" data-pf-act="${window.PLATFORM && PLATFORM.user ? 'redeem' : 'login'}">${window.PLATFORM && PLATFORM.user ? 'Ввести код доступа' : 'Войти и открыть'}</button>`}
      </div>
    </div>
  </div>`;
}
async function openRemoteStage(id) {
  const local = DATA.caseList.find(c => c.id === id);
  if (local) { location.hash = '#case/' + id; route(); return; }
  const ordered = DATA.caseList.slice().sort((a, b) => a.num - b.num)
    .concat((DATA.remoteStages || []).filter(s => !DATA.caseList.some(c => c.id === s.id))
      .map(s => ({ id: s.id, num: Number(s.id), title: s.title }))
      .sort((a, b) => a.num - b.num));
  const pos = ordered.findIndex(s => String(s.id) === String(id));
  const prev = pos > 0 ? ordered[pos - 1] : null;
  const prevDone = prev && P().bosses[prev.id] && P().bosses[prev.id].done;
  if (prev && !prevDone) {
    showModal(`<h2>Сначала этап №${prev.num}</h2>
      <p>Маршрут идёт по порядку: этап №${id} откроется, когда будет взят перевал этапа №${prev.num} «${esc(prev.title)}». Так задачи не обгонят друг друга.</p>
      <button class="gold" onclick="closeModal()">Понятно</button>`);
    return;
  }
  if (!window.PLATFORM) { toast('Аккаунты не подключены'); return; }
  if (remoteLoading) return;
  remoteLoading = true;
  showModal('<h2>Загружаю этап…</h2><p class="small">Тянем контент с сервера.</p>');
  try {
    const d = await PLATFORM.stage('pole6', id);
    const st = d.stage || {};
    if (!st.problems || !st.problems.length) throw new Error('Пустой этап');
    const caseObj = Object.assign({}, st, { id: String(id), num: Number(id) || DATA.caseList.length + 1 });
    DATA.caseList.push(caseObj);
    closeModal();
    location.hash = '#case/' + caseObj.id;
    route();
  } catch (e) {
    const msg = e.status === 401 ? 'Нужно войти в аккаунт.'
      : e.status === 402 ? 'Этот этап открывается кодом доступа.'
      : 'Не удалось загрузить этап. Проверьте интернет и попробуйте ещё раз.';
    closeModal();
    showModal(`<h2>Этап закрыт</h2><p>${msg}</p>
      <button class="gold" data-pf-act="${e.status === 402 ? 'redeem' : 'login'}" onclick="closeModal()">${e.status === 402 ? 'Ввести код' : 'Войти'}</button>
      <button class="ghost" onclick="closeModal()">Позже</button>`);
  } finally { remoteLoading = false; }
}

/* ---------- развилки ---------- */
function junctionAfter(cid) { return (DATA.junctions || []).find(j => j.afterCase === cid); }
function junctionDone(jid) { const p = P(); return !!(p.junctions && p.junctions[jid]); }
function junctionCardHtml(j) {
  const st = P().junctions && P().junctions[j.id];
  if (st) {
    return `<div class="paper junction done">
      <h4>${j.emoji} ${esc(j.title)} · пройдено</h4>
      <p class="small muted">Решение: <b>${esc(j.options[st.choice].label)}</b>${st.coins ? ' · +' + st.coins + ' 🪙' : ''}</p>
      <p>${j.options[st.choice].outcome}</p>
    </div>`;
  }
  const opts = j.options.map((o, i) =>
    `<button class="junction-opt" data-act="junctionChoose" data-arg="${j.id}|${i}">
      <b>${esc(o.label)}</b>${o.coins ? `<span class="small muted"> · +${o.coins} 🪙</span>` : ''}
    </button>`).join('');
  return `<div class="paper junction">
    <h4>${j.emoji} Развилка: ${esc(j.title)}</h4>
    <p>${j.text}</p>
    <div class="junction-opts">${opts}</div>
    <p class="small muted">Здесь нет «правильного» ответа — есть решение и его последствия. Выбор останется в бортовом журнале.</p>
  </div>`;
}
function junctionChoose(jid, idx) {
  const j = (DATA.junctions || []).find(x => x.id === jid);
  if (!j || junctionDone(jid)) return;
  const p = P();
  p.junctions = p.junctions || {};
  const opt = j.options[idx];
  p.junctions[jid] = { choice: idx, coins: opt.coins || 0, claimed: false };
  saveStore();
  TL.send('junction', jid + ' → ' + opt.label);
  hist('junction', jid + ' → ' + opt.label);
  confetti();
  showModal(`<h2>${j.emoji} ${esc(j.title)}</h2>
    <p style="text-align:left">${opt.outcome}</p>
    ${opt.coins ? `<p><b>+${opt.coins} 🪙</b> в общий котёл экспедиции</p>` : ''}
    <button class="gold" data-act="junctionClaim" data-arg="${jid}">Идём дальше</button>`);
}
function junctionClaim(jid) {
  const p = P();
  const st = p.junctions && p.junctions[jid];
  if (!st || st.claimed) { closeModal(); renderMap(); return; }
  st.claimed = true;
  saveStore();
  if (st.coins) addPoints(st.coins, true);
  closeModal();
  renderMap();
}

function renderMap() {
  const p = P();
  if (window.PLATFORM && !DATA.remoteLoaded) { DATA.remoteLoaded = true; loadRemoteManifest(); }
  let cards = '';
  DATA.caseList.forEach((c, idx) => {
    if (!caseUnlocked(idx)) {
      cards += `
      <div class="case-card">
        <div class="pin">🔒</div>
        <div class="case-paper" style="opacity:.75">
          <h3>Этап №${c.num}. ${esc(c.title)}</h3>
          <div class="case-sub">${esc(c.subtitle)}</div>
          <p class="small">Капитан советует сначала пройти этап №${DATA.caseList[idx - 1].num}. Но смелых экспедиция не держит.</p>
          <button class="ghost" data-act="earlyUnlock" data-arg="${c.id}">Открыть досрочно 🔓</button>
        </div>
      </div>`;
      return;
    }
    const st = caseStats(c);
    const pct = Math.round(st.closed / st.total * 100);
    cards += `
      <div class="case-card">
        <div class="pin ${st.boss ? 'done' : ''}">${st.boss ? '✅' : c.emoji}</div>
        <div class="case-paper">
          ${st.boss ? '<div class="stamp ok">Этап пройден</div>' : ''}
          <h3>Этап №${c.num}. ${esc(c.title)}</h3>
          <div class="case-sub">${esc(c.subtitle)}</div>
          <div class="case-meta">
            <div class="progress-mini"><i style="width:${pct}%"></i></div>
            <span>${st.closed}/${st.total} задач</span>
            <span>${st.boss ? '🌟' : '⚔️'} ${st.boss ? 'перевал взят' : 'перевал впереди'}</span>
            <button class="primary" data-act="goto" data-arg="#case/${c.id}">Открыть этап</button>
          </div>
        </div>
      </div>`;
    const j = junctionAfter(c.id);
    if (j && st.boss) cards += junctionCardHtml(j);
  });
  (DATA.remoteStages || []).forEach(s => {
    if (DATA.caseList.some(c => c.id === s.id)) return;
    cards += remoteCardHtml(s);
  });
  const safesRow = DATA.safes.map((thr, i) => {
    const opened = p.safesOpened.indexOf(i) >= 0;
    return `<div class="safe-box ${opened ? 'open' : ''}" title="${thr} 🪙" ${opened ? `data-act="showSafe" data-arg="${i}"` : ''}>${opened ? '🎁' : '🔒'}</div>`;
  }).join('');
  $('app').innerHTML = headerHtml('map') + `
    ${dayTaskCardHtml()}
    <p class="board-intro">Карта маршрута: теория → разборы → задачи → перевал, и дальше по льду. Ящики открываются сами, когда набираются монеты 🪙.</p>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px;">${safesRow}</div>
    <div class="path">${cards}</div>
    <div class="paper">
      <h4>Штурм-контрольная 📝</h4>
      <p>Когда почувствуешь силу — проверь себя: 8 задач, 90 минут, без наводок. <a href="#exam">В штурманскую рубку</a>.</p>
    </div>
    ${footerHtml()}`;
}

/* ---------- страница дела ---------- */
function renderCase(cid) {
  const c = DATA.caseList.find(x => x.id === cid);
  if (!c) { location.hash = 'map'; return; }
  const cIdx = DATA.caseList.indexOf(c);
  if (!caseUnlocked(cIdx)) { location.hash = 'map'; return; }
  const p = P();
  const st = caseStats(c);
  if (TL.curCase !== cid) { TL.curCase = cid; TL.send('case_open', cid + ' закрыто ' + st.closed + '/' + st.total); }
  const bossNeed = Math.max(1, c.problems.length - 3);
  const bossLocked = st.closed < bossNeed;

  const examples = c.examples.map((e, i) => `
    <div class="problem">
      <div class="problem-top"><span class="badge-num">РАЗБОР ${i + 1}</span></div>
      <p class="stmt">${e.statement}</p>
      <details><summary>Показать решение капитана</summary><div class="solution-item">${e.solution}</div></details>
    </div>`).join('');

  const problems = c.problems.map((pr, i) => {
    const e = getEntry(c.id, pr.id);
    if (!p.views[entryKey(c.id, pr.id)]) { p.views[entryKey(c.id, pr.id)] = today(); }
    const closed = !!(e && e.status);
    const stars = closed ? (e.status === 'solved' ? (e.hints === 0 && !e.solution ? '⭐⭐⭐' : (e.hints === 1 ? '⭐⭐' : '⭐')) : '📖') : '';
    let controls = '';
    if (!closed) {
      const hintsShown = e ? e.hints : 0;
      if (pr.type === 'answer') {
        controls = `
          <div class="answer-row">
            <input type="text" id="ans-${pr.id}" placeholder="${pr.answerNote || 'ответ'}" autocomplete="off">
            <button class="gold" data-act="checkAnswer" data-arg="${c.id}|${pr.id}">Проверить</button>
            <span class="points-note">до ${pr.points} 🪙</span>
          </div>
          <div id="res-${pr.id}"></div>`;
      } else {
        controls = `
          <div class="open-note">Ответ здесь — не число, а <b>способ или рассуждение</b>. Веди черновик в блокноте ниже — как настоящий полярник. Потом открой <b>решение капитана</b>, сравни ход мыслей — и честно нажми кнопку.</div>
          <textarea data-note="${c.id}/${pr.id}" placeholder="Тут твой черновик: пиши мысли, догадки, попытки — даже неполные. Всё пригодится капитану!">${esc(getNote(c.id + '/' + pr.id))}</textarea>
          <div class="answer-row" id="open-${pr.id}">
            <button class="gold" data-act="selfSolved" data-arg="${c.id}|${pr.id}">Я решил(а) сам(а)! ✋</button>
            <span class="points-note">до ${pr.points} 🪙</span>
          </div>`;
      }
    } else {
      controls = `<div class="answer-row"><span class="${e.status === 'solved' ? 'result-ok' : 'badge-rev'}">${e.status === 'solved' ? '✔ Решено' : '▪ Разобрано с капитаном'} · +${e.got} 🪙</span></div>`;
      if (pr.type === 'open') {
        const note = getNote(c.id + '/' + pr.id);
        if (note) controls += `<div class="small" style="margin-top:6px;color:var(--ink-soft)">Твой черновик: <i>${esc(note)}</i></div>`;
      }
    }
    const entryHints = e ? e.hints : 0;
    const entrySol = e ? e.solution : false;
    return `
    <div class="problem ${closed ? (e.status === 'solved' ? 'solved' : 'reviewed') : ''}">
      <div class="problem-top">
        <span class="badge-num">ЗАДАЧА ${i + 1}</span>
        ${pr.type === 'open' ? '<span class="badge-num badge-paper">📝 бумага</span>' : '<span class="badge-num" style="background:#5c5342;">🔢 ответ — число</span>'}
        ${stars ? `<span class="badge-star">${stars}</span>` : ''}
        ${closed ? `<span class="badge-ok">закрыто</span>` : ''}
      </div>
      <p class="stmt">${pr.statement}</p>
      <div class="hints">
        ${entryHints >= 1 || !closed ? `<button class="small-btn ghost" data-act="hint" data-arg="${c.id}|${pr.id}|1" ${closed ? 'disabled' : ''}>💡 Наводка 1</button>` : ''}
        ${entryHints >= 2 || !closed ? `<button class="small-btn ghost" data-act="hint" data-arg="${c.id}|${pr.id}|2" ${closed ? 'disabled' : ''}>💡 Наводка 2</button>` : ''}
        <button class="small-btn ghost" data-act="viewSolution" data-arg="${c.id}|${pr.id}">🔓 Показать решение</button>
        ${closed ? '' : `<button class="small-btn ghost" data-act="askProblem" data-arg="${c.id}|${pr.id}">🤖 Спросить капитана</button>`}
      </div>
      <div id="hints-${pr.id}">
        ${entryHints >= 1 && pr.hint1 ? `<div class="hint-item"><b>Наводка 1.</b> ${pr.hint1}</div>` : ''}
        ${entryHints >= 2 && pr.hint2 ? `<div class="hint-item"><b>Наводка 2.</b> ${pr.hint2}</div>` : ''}
        ${entrySol ? `<div class="solution-item"><b>Решение.</b> ${pr.solution}</div>` : ''}
      </div>
      ${controls}
    </div>`;
  }).join('');
  saveStore();

  const boss = c.boss;
  const bossDone = st.boss;
  let bossHtml;
  if (bossLocked) {
    bossHtml = `
    <div class="boss" style="opacity:.7">
      <h3>${esc(boss.title)}</h3>
      <p>Перевал появится, когда ты закроешь хотя бы ${bossNeed} из ${c.problems.length} задач (сейчас ${st.closed}). Решение можно закрыть и разбором с капитаном — главное вникнуть.</p>
    </div>`;
  } else {
    bossHtml = `
    <div class="boss">
      <h3>${esc(boss.title)} ${bossDone ? '· ВЗЯТ ✅' : ''}</h3>
      <p>${boss.statement}</p>
      <p class="small" style="color:#e8c9a0;">Перевал — «бумажная» задача: ответ не число, а рассуждение. Веди план штурма в блокноте ниже, при нужде сверься с наводками и решением — потом жми кнопку.</p>
      <p class="boss-reward">Награда: до ${boss.points} 🪙 + буква слова шифровки 🗝️</p>
      ${bossDone ? '' : `<textarea data-note="${c.id}/boss" placeholder="План штурма перевала: идеи, расчёты, шаги…">${esc(getNote(c.id + '/boss'))}</textarea>`}
      ${bossDone && getNote(c.id + '/boss') ? `<div class="small" style="color:#e8c9a0">Твой черновик: <i>${esc(getNote(c.id + '/boss'))}</i></div>` : ''}
      ${bossDone ? '' : `
      <div class="hints" style="margin-top:10px">
        <button class="small-btn ghost" data-act="bossHint" data-arg="${c.id}|1">💡 Наводка 1</button>
        <button class="small-btn ghost" data-act="bossHint" data-arg="${c.id}|2">💡 Наводка 2</button>
        <button class="small-btn ghost" data-act="bossSolution" data-arg="${c.id}">🔓 Решение</button>
        <button class="small-btn ghost" data-act="askBoss" data-arg="${c.id}">🤖 Спросить капитана</button>
      </div>
      <div id="boss-hints"></div>
      <div class="answer-row" style="margin-top:12px">
        <button class="gold" data-act="bossWin" data-arg="${c.id}">Я взял(а) перевал! 🏆</button>
        <button class="ghost" data-act="bossReview" data-arg="${c.id}">Разобрал(а) разбор — засчитать</button>
      </div>`}
    </div>`;
  }

  $('app').innerHTML = headerHtml() + `
    <div class="case-head">
      <h2>Этап №${c.num}. ${esc(c.title)}</h2>
      <span class="backlink"><a href="#map">← к маршруту</a></span>
    </div>
    <div class="paper">
      <h4>Брифинг · ${esc(c.subtitle)}</h4>
      <p>${c.intro}</p>
      <div class="theory-box">${c.theory.map(t => '<p style="margin:6px 0">' + t + '</p>').join('')}</div>
    </div>
    <div class="paper">
      <h4>Разборы с капитаном</h4>
      <p class="note">Сначала подумай над разбором сам(а) — потом открывай решение.</p>
    </div>
    ${examples}
    <div class="paper"><h4>Задачи — решай по порядку, сложность растёт</h4>
    <p class="note">Подсказки не портят репутацию: подсмотрел идею и добил — тоже победа (просто чуть меньше монет). Неверный ответ ничем не наказывается — пробуй ещё!</p></div>
    ${problems}
    ${bossHtml}
    ${bossDone && p.sheinLetters && p.sheinLetters[cid] ? `<div class="paper" style="border:2px solid var(--gold)"><h4>📩 Записка от капитана</h4>${p.sheinLetters[cid]}</div>` : ''}
    ${bossDone ? `<div class="paper" style="text-align:center"><h4>ШТАМП: ЭТАП №${c.num} ПРОЙДЕН</h4><p>Буква слова шифровки получена — загляни на страницу <a href="#mystery">Шифровки</a>. Дальше по маршруту — развилка.</p></div>` : ''}
    ${footerHtml()}`;
}

/* ---------- действия с задачами ---------- */
function hintPressed(cid, pid, level) {
  const c = DATA.caseList.find(x => x.id === cid);
  const pr = c.problems.find(x => x.id === pid);
  const e = getEntry(cid, pid) || { status: null, hints: 0, solution: false, got: 0 };
  if (e.hints >= level) return;
  e.hints = level;
  setEntry(cid, pid, e);
  TL.send('hint', cid + '/' + pid + ' уровень ' + level);
  renderCase(cid);
}
function solutionPressed(cid, pid) {
  const c = DATA.caseList.find(x => x.id === cid);
  const pr = c.problems.find(x => x.id === pid);
  showModal(`<h2>Открыть решение?</h2>
    <p>Капитан раскроет всё до конца — задача закроется с 0 монет, но этап двинется дальше. Сначала попробуй наводки!</p>
    <button class="gold" data-act="confirmSolution" data-arg="${cid}|${pid}">Показать решение</button>
    <button data-act="closeModal">Я ещё подумаю</button>`);
}
function confirmSolution(cid, pid) {
  const e = getEntry(cid, pid) || { status: null, hints: 0, solution: false, got: 0 };
  if (!e.status) { e.status = 'reviewed'; }
  e.solution = true;
  e.got = 0;
  setEntry(cid, pid, e);
  closeModal();
  TL.send('solution', cid + '/' + pid);
  renderCase(cid);
}
function checkAnswer(cid, pid) {
  const c = DATA.caseList.find(x => x.id === cid);
  const pr = c.problems.find(x => x.id === pid);
  const val = $('ans-' + pid).value;
  const ok = pr.answers.some(a => normHard(a) === normHard(val)) ||
             pr.answers.some(a => norm(a) === norm(val));
  const box = $('res-' + pid);
  if (ok) {
    const e = getEntry(cid, pid) || { status: null, hints: 0, solution: false, got: 0 };
    const got = Math.round(pr.points * factorFor(e.hints || 0));
    e.status = 'solved';
    e.got = Math.max(e.got || 0, got);
    setEntry(cid, pid, e);
    addPoints(got, true);
    afterProblemSolved(cid, pid, e.hints, false);
    praiseToast('+' + got + ' 🪙');
    hist('solve', cid + '/' + pid + (e.hints === 0 && !e.solution ? ' чисто' : ' подсказки: ' + (e.hints || 0)));
    TL.send('answer', cid + '/' + pid + ' ✔ подсказок: ' + (e.hints || 0));
    pushRecent(e.hints || 0);
    adaptiveNudge();
    renderCase(cid);
  } else {
    const att = noteAttempts(cid, pid);
    TL.send('answer', cid + '/' + pid + ' ✘');
    if (att >= 2) toast(PRAISE_GRIT[Math.floor(Math.random() * PRAISE_GRIT.length)]);
    box.innerHTML = '<span class="result-bad">Пока не сходится. Попробуй ещё раз — ошибаться здесь не стыдно!</span>';
    $('ans-' + pid).select();
  }
}
function selfSolved(cid, pid, force) {
  const c = DATA.caseList.find(x => x.id === cid);
  const pr = c.problems.find(x => x.id === pid);
  const ta = document.querySelector(`textarea[data-note="${cid}/${pid}"]`);
  const note = ta ? ta.value : getNote(cid + '/' + pid);
  if (note && note.trim()) saveNote(cid + '/' + pid, note);
  if (!force && (!note || note.trim().length < 10)) {
    showModal(`<h2>Сначала — черновик!</h2>
      <p>Капитан просит записать хотя бы пару строк: как ты рассуждал(а)? Без записи он не увидит красоту мысли и не сможет рассказать родителям, какая ты умница.</p>
      <button class="gold" data-act="closeModal">Хорошо, запишу</button>
      <button class="ghost" data-act="selfSolvedForce" data-arg="${cid}|${pid}">Всё равно засчитать</button>`);
    return;
  }
  const e = getEntry(cid, pid) || { status: null, hints: 0, solution: false, got: 0 };
  const got = Math.round(pr.points * factorFor(e.hints || 0));
  e.status = 'solved';
  e.got = got;
  setEntry(cid, pid, e);
  addPoints(got, true);
  afterProblemSolved(cid, pid, e.hints, false);
  praiseToast('+' + got + ' 🪙 честным словом!');
  hist('selfsolved', cid + '/' + pid);
  TL.send('selfsolved', cid + '/' + pid);
  closeModal();
  renderCase(cid);
}

/* ---------- перевал ---------- */
function bossHintPressed(cid, level) {
  const c = DATA.caseList.find(x => x.id === cid);
  const box = $('boss-hints');
  const item = level === 1
    ? `<div class="hint-item"><b>Наводка 1.</b> ${c.boss.hint1}</div>`
    : `<div class="hint-item"><b>Наводка 2.</b> ${c.boss.hint2}</div>`;
  box.innerHTML += item;
}
function bossSolutionPressed(cid) {
  const c = DATA.caseList.find(x => x.id === cid);
  $('boss-hints').innerHTML += `<div class="solution-item"><b>Решение.</b> ${c.boss.solution}</div>`;
}
function bossWin(cid, reviewed, force) {
  const c = DATA.caseList.find(x => x.id === cid);
  const p = P();
  if (p.bosses[cid] && p.bosses[cid].done) return;
  if (!reviewed && !force) {
    const ta = document.querySelector(`textarea[data-note="${cid}/boss"]`);
    const note = ta ? ta.value : getNote(cid + '/boss');
    if (note && note.trim()) saveNote(cid + '/boss', note);
    if (!note || note.trim().length < 10) {
      showModal(`<h2>Перевал не даётся только с черновиком!</h2>
        <p>Запиши в блокнот хотя бы пару строк плана поимки — капитан хочет видеть ход мысли.</p>
        <button class="gold" data-act="closeModal">Запишу</button>
        <button class="ghost" data-act="bossWinForce" data-arg="${cid}">Всё равно победил(а)!</button>`);
      return;
    }
  }
  const got = reviewed ? Math.round(c.boss.points / 3) : c.boss.points;
  p.bosses[cid] = { done: true, got };
  if (typeof c.boss.letter === 'number' && p.letters.indexOf(c.boss.letter) < 0) {
    p.letters.push(c.boss.letter);
  }
  saveStore();
  unlockAch('a_boss');
  TL.send('boss', cid + ' ' + (reviewed ? '(разбор)' : '(победа)'));
  hist('boss', 'Этап ' + cid + ' пройден');
  const p2 = P();
  p2.sheinLetters = p2.sheinLetters || {};
  p2.sheinLetters[cid] = buildLetter(cid);
  saveStore();
  addPoints(got, true);
  const hasLetter = typeof c.boss.letter === 'number';
  const letter = hasLetter ? DATA.mystery.word[c.boss.letter] : '';
  const isFinal = c.id === '6';
  confetti();
  showModal(`<h2>${isFinal ? 'ПОЛЮС ДОСТИГНУТ! 🧭' : 'Перевал взят! 🏆'}</h2>
    <div class="big">${c.emoji}✨</div>
    <p>Этап №${c.num} ${isFinal ? 'пройден — экспедиция дошла до полюса!' : 'закрыт.'} +${got} 🪙</p>
    ${hasLetter ? `<div style="background:#f7efd9;border:2px dashed var(--gold);border-radius:8px;padding:14px;margin:10px 0;">
      <p>Ты получаешь букву слова шифровки:</p>
      <div style="font-size:2.2em;font-weight:bold;color:#241c08">«${letter}»</div>
      <p class="small" style="color:var(--ink-soft)">Загляни на страницу <a href="#mystery" onclick="closeModal()">🗝️ Шифровки</a>, когда соберёшь ещё буквы.</p>
    </div>` : `<div style="background:#f7efd9;border:2px dashed var(--gold);border-radius:8px;padding:14px;margin:10px 0;">
      <p>Это была последняя остановка маршрута. Пять перевалов и штурм-контрольная дают все шесть букв — самое время разгадать слово и забрать главный приз.</p>
      <p class="small" style="color:var(--ink-soft)"><a href="#mystery" onclick="closeModal()">К шифровке</a></p>
    </div>`}
    <button class="gold" onclick="closeModal()">${isFinal ? 'На полюсе!' : 'Отлично!'}</button>`);
  renderCase(cid);
}

/* ---------- экзамен ---------- */
function renderExam() {
  const p = P();
  const ex = p.exam;
  if (!ex.started) {
    $('app').innerHTML = headerHtml('exam') + `
      <div class="paper">
        <h4>${DATA.exam.title} · ${DATA.exam.subtitle}</h4>
        <p>${DATA.exam.intro}</p>
        <button class="gold" data-act="examStart">Начать экзамен ⏱</button>
      </div>
      <p class="muted small">${DATA.exam.source}</p>
      ${footerHtml()}`;
    return;
  }
  if (ex.submitted) { renderExamResults(); return; }
  const left = examMinutesLeft();
  const qs = DATA.exam.problems.map((q, i) => `
    <div class="problem exam-q">
      <div class="problem-top"><span class="badge-num">ЗАДАЧА ${i + 1}</span></div>
      <p class="stmt">${q.statement}</p>
      <div class="answer-row">
        <input type="text" id="ex-${q.id}" placeholder="${q.answerNote || 'ответ'}" value="${esc(ex.answers[q.id] || '')}" autocomplete="off">
        <button class="small-btn" data-act="examSave" data-arg="${q.id}">Занести в протокол</button>
        <span class="points-note" id="exok-${q.id}"></span>
      </div>
    </div>`).join('');
  $('app').innerHTML = headerHtml('exam') + `
    <div class="case-head"><h2>${DATA.exam.title}</h2><span class="exam-timer" id="exam-timer">⏱ --:--</span></div>
    <p class="muted small">Ответы заносятся в протокол по ходу. Жми «Сдать работу», когда закончишь — или когда время выйдет.</p>
    ${qs}
    <button class="primary" data-act="examSubmit">Сдать работу 📤</button>
    ${footerHtml()}`;
  updateExamTimer();
  examTimer = setInterval(updateExamTimer, 1000);
}
function examMinutesLeft() {
  const p = P();
  const end = p.exam.started + DATA.exam.timeMin * 60000;
  return Math.max(0, Math.ceil((end - Date.now()) / 60000));
}
function updateExamTimer() {
  const el = $('exam-timer');
  if (!el) { if (examTimer) clearInterval(examTimer); return; }
  const left = examMinutesLeft();
  el.textContent = '⏱ ' + (left >= 60 ? Math.floor(left / 60) + ' ч ' : '') + (left % 60) + ' мин';
  el.className = 'exam-timer' + (left <= 10 ? ' low' : '');
  if (left <= 0) examSubmit();
}
function examStart() {
  const p = P();
  p.exam = { best: p.exam.best, started: Date.now(), answers: {}, submitted: false };
  saveStore();
  renderExam();
}
function examSave(qid) {
  const p = P();
  p.exam.answers[qid] = $('ex-' + qid).value;
  saveStore();
  $('exok-' + qid).textContent = '✓ записано';
  setTimeout(() => { const el = $('exok-' + qid); if (el) el.textContent = ''; }, 1500);
}
function examSubmit() {
  const p = P();
  if (p.exam.submitted) return;
  if (examTimer) { clearInterval(examTimer); examTimer = null; }
  // дозаписываем всё из полей
  DATA.exam.problems.forEach(q => { const el = $('ex-' + q.id); if (el) p.exam.answers[q.id] = el.value; });
  let score = 0;
  DATA.exam.problems.forEach(q => {
    const v = p.exam.answers[q.id] || '';
    if (q.answers.some(a => normHard(a) === normHard(v)) || q.answers.some(a => norm(a) === norm(v))) score++;
  });
  p.exam.submitted = true;
  p.exam.score = score;
  if (p.exam.best === null || score > p.exam.best) p.exam.best = score;
  if (score >= 5 && p.letters.indexOf(5) < 0) p.letters.push(5);
  saveStore();
  TL.send('exam', score + ' из 8 верных');
  hist('exam', 'экзамен: ' + score + ' из 8');
  addPoints(score * DATA.exam.pointsPerTask, true);
  if (score >= 5) unlockAch('a_exam');
  renderExamResults();
}
function renderExamResults() {
  const p = P();
  const ex = p.exam;
  const rows = DATA.exam.problems.map((q, i) => {
    const v = ex.answers[q.id] || '';
    const ok = q.answers.some(a => normHard(a) === normHard(v)) || q.answers.some(a => norm(a) === norm(v));
    return `<div class="problem ${ok ? 'solved' : 'reviewed'}">
      <div class="problem-top"><span class="badge-num">ЗАДАЧА ${i + 1}</span> ${ok ? '<span class="badge-ok">✔</span>' : '<span class="result-bad">✘</span>'}</div>
      <p class="stmt">${q.statement}</p>
      <p class="small">Твой ответ: <b>${esc(v || '—')}</b> ${ok ? '' : '· правильный: <b>' + esc(q.answers[0]) + '</b>'}</p>
      <div class="solution-item"><b>Разбор.</b> ${q.solution}</div>
    </div>`;
  }).join('');
  $('app').innerHTML = headerHtml('exam') + `
    <div class="paper" style="text-align:center">
      <h4>Протокол экзамена</h4>
      <p class="exam-result">Верно <b>${ex.score} из ${DATA.exam.problems.length}</b> · +${ex.score * DATA.exam.pointsPerTask} 🪙</p>
      <p>${ex.score >= 6 ? 'Блестяще, полярник! Капитан аплодирует.' : ex.score >= 4 ? 'Достойно! Разбери нерешённое — и в следующий раз будет больше.' : 'Экзамен — это тренировка. Пройдись по разборам, они внизу.'}</p>
      ${ex.score >= 5 ? '<p>🗝️ Получена буква слова шифровки! <a href="#mystery">К Тайне</a>.</p>' : ''}
      <button class="gold" data-act="examAgain">Пройти заново 🔄</button>
    </div>
    ${rows}
    ${footerHtml()}`;
}

/* ---------- тайна ---------- */
function renderMystery() {
  const p = P();
  const word = DATA.mystery.word;
  const letters = [...word].map((ch, i) =>
    `<div class="mletter ${p.letters.indexOf(i) >= 0 ? '' : 'unknown'}" ${p.letters.indexOf(i) >= 0 ? '' : 'title="ещё не получена"'}>${p.letters.indexOf(i) >= 0 ? ch : '?'}</div>`).join('');
  const sources = [
    { i: 0, txt: 'Взять перевал этапа №1 «Старая карта»' },
    { i: 1, txt: 'Взять перевал этапа №2 «Доли и дроби»' },
    { i: 2, txt: 'Взять перевал этапа №3 «Проценты на льду»' },
    { i: 3, txt: 'Взять перевал этапа №4 «Отрицательные широты»' },
    { i: 4, txt: 'Взять перевал этапа №5 «Ледяная геометрия»' },
    { i: 5, txt: 'Сдать штурм-контрольную на 5 из 8 и выше' }
  ].map(s => `<li ${p.letters.indexOf(s.i) >= 0 ? 'style="color:#7fae5f"' : 'class="muted"'}>${p.letters.indexOf(s.i) >= 0 ? '✓' : '○'} ${s.txt}</li>`).join('');
  const got = p.letters.length;
  let finale = '';
  if (p.mysterySolved) {
    finale = `<div class="paper" style="text-align:center;border:2px solid var(--gold)">
      <h4>ШИФРОВКА РАЗГАДАНА 🗝️✨</h4>
      <p style="font-size:1.3em"><b>${word}</b></p>
      <p>${DATA.mystery.prizeNote}</p>
    </div>`;
  } else if (got < 3) {
    finale = `<div class="paper">
      <h4>Этот шифр не угадаешь</h4>
      <p>Старый пароль экспедиции прочли слишком легко, и радист сменил шифр. Новое слово не выспросишь и не подберёшь — его можно только <b>добыть по буквам</b>: бери перевалы и сдай контрольную. Когда букв станет три, здесь появится место для ввода.</p>
      <p class="note">Добыто букв: ${got} из 6.</p>
    </div>`;
  } else {
    finale = `<div class="paper">
      <h4>Знаешь слово целиком?</h4>
      ${got >= 4 ? `<p class="note">${DATA.mystery.hint}</p>` : ''}
      <div class="answer-row">
        <input type="text" id="mystery-word" placeholder="введи слово" style="text-transform:uppercase">
        <button class="gold" data-act="mysteryTry">Попробовать</button>
      </div>
      <div id="mystery-res"></div>
    </div>`;
  }
  $('app').innerHTML = headerHtml('mystery') + `
    <div class="case-head"><h2>🗝️ Шифровка</h2></div>
    <p class="mystery-note">${DATA.mystery.prompt}</p>
    <div class="mystery-letters">${letters}</div>
    <div class="paper"><h4>Где добывают буквы</h4><ul>${sources}</ul></div>
    ${finale}
    ${footerHtml()}`;
}
function mysteryTry() {
  const p = P();
  if (p.letters.length < 3) return;   // шифр второго уровня не принимают на слух
  const v = normHard($('mystery-word').value);
  if (v === normHard(DATA.mystery.word)) {
    p.mysterySolved = true;
    saveStore();
    unlockAch('a_mystery');
    TL.send('mystery', 'слово шифровки разгадано');
    confetti();
    renderMystery();
    showModal(`<h2>Шифровка разгадана! 🗝️</h2><div class="big">✨🧭✨</div>
      <p>${DATA.mystery.prizeNote}</p>
      <button class="gold" onclick="closeModal()">Гордиться собой</button>`);
  } else {
    $('mystery-res').innerHTML = '<span class="result-bad">Не то слово. Собери больше букв или подумай ещё!</span>';
  }
}

/* ---------- награды ---------- */
function renderAch() {
  const p = P();
  const cards = DATA.achievements.map(a => {
    const has = p.achievements.indexOf(a.id) >= 0;
    return `<div class="ach-card ${has ? '' : 'locked'}">
      <div class="em">${a.emoji}</div>
      <div><b>${a.title}</b><span class="small">${a.desc}</span></div>
    </div>`;
  }).join('');
  const t = titleFor(p.points);
  $('app').innerHTML = headerHtml('ach') + `
    <div class="case-head"><h2>🏅 Награды полярника</h2></div>
    <div class="paper"><h4>Звание</h4><p>Сейчас: <b>${t}</b> (${p.points} 🪙).</p>
    <p class="small muted">${DATA.titles.map(x => x.min + ' — ' + x.name).join(' · ')}</p></div>
    <div class="ach-grid">${cards}</div>
    ${footerHtml()}`;
}

/* ---------- профиль ---------- */
function renderProfilePage() {
  const p = P();
  const others = Object.keys(store.profiles).filter(id => id !== store.currentId)
    .map(id => `<button data-act="pickProfile" data-arg="${id}">${store.profiles[id].emoji} ${esc(store.profiles[id].name)}</button>`).join(' ');
  $('app').innerHTML = headerHtml('profile') + `
    <div class="case-head"><h2>👤 Профиль</h2></div>
    <div class="paper">
      <h4>Полярник ${esc(p.name)} ${p.emoji}</h4>
      <p>Звание: <b>${titleFor(p.points)}</b> · Монеты: <b>${p.points} 🪙</b> · Наград: ${p.achievements.length}/${DATA.achievements.length} · Ящиков вскрыто: ${p.safesOpened.length}/${DATA.safes.length}</p>
      <p class="small muted">В экспедиции с ${p.created}.</p>
      <div class="answer-row">
        <button data-act="goto" data-arg="#map">К маршруту</button>
        ${others ? `<span class="small muted">Сменить полярника:</span> ${others}` : ''}
        <button class="ghost" data-act="saveProgress">💾 Сохранить прогресс в файл</button>
        <button class="ghost" data-act="resetProgress">🗑 Начать заново</button>
      </div>
    </div>
    <div class="paper">
      <h4>Аккаунт полярника</h4>
      ${window.PLATFORM ? PLATFORM.panelHtml() : '<p class="small muted">Аккаунты не подключены.</p>'}
      <p class="small muted" style="margin-top:8px">Один аккаунт работает во всех наших тренажёрах: «Полюс-6», «Агентство „Логика“», «Престол эпох».</p>
    </div>
    <div class="paper">
      <h4>Оформление штаба</h4>
      <p class="small">Выбери, как выглядит штаб экспедиции. Менять можно в любой момент.</p>
      <div class="theme-grid">
        ${THEMES.map(t => `
        <button class="theme-card ${store.ui.theme === t.id ? 'sel' : ''}" data-act="setTheme" data-arg="${t.id}">
          <div class="swatch">${t.colors.map(c => `<i style="background:${c}"></i>`).join('')}</div>
          <div class="t-label"><b>${t.name}</b><br><span class="small muted">${t.desc}</span></div>
        </button>`).join('')}
      </div>
    </div>
    <div class="paper">
      <h4>Перенос прогресса</h4>
      <p class="small">Прогресс живёт в этом браузере. Чтобы перенести его на другой ноут — сохрани в файл, а там загрузи (страница «Родителям» → «Загрузить сохранение»).</p>
    </div>
    ${footerHtml()}`;
}
function saveProgress() {
  const blob = new Blob([JSON.stringify(store, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'polyus-6-' + (P() ? P().name : 'save') + '-' + today() + '.json';
  a.click();
  toast('Файл сохранён — смотри в загрузки 💾');
}

/* ---------- родительская страница ---------- */
function weekReportHtml() {
  const p = P();
  const H = p.history || [];
  const days = [];
  for (let i = 6; i >= 0; i--) days.push(today(-i));
  const names = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
  const rows = days.map(d => {
    const evs = H.filter(h => h.d === d);
    const wd = names[new Date(d).getDay()];
    if (!evs.length) return '<div class="prize-row"><span class="small muted">' + wd + ' ' + d.slice(5) + ' — тишина</span></div>';
    const solves = evs.filter(h => h.k === 'solve');
    const clean = solves.filter(h => h.x.indexOf('чисто') >= 0).length;
    const others = evs.filter(h => h.k !== 'solve').map(h => esc(h.x));
    return '<div class="prize-row"><div style="flex:1;min-width:0"><b>' + wd + ' ' + d.slice(5) + '</b> <span class="small">— задач решено: ' + solves.length + ' (без подсказок: ' + clean + ')</span>' +
      (others.length ? '<div class="small muted">' + others.join(' · ') + '</div>' : '') + '</div></div>';
  });
  const active = days.filter(d => H.some(h => h.d === d)).length;
  return rows.join('') + '<p class="small muted">Дней с занятиями за неделю: ' + active + ' из 7. Серия задачи дня: ' + ((p.flame && p.flame.streak) || 0) + ' 🔥 (рекорд ' + ((p.flame && p.flame.best) || 0) + ').</p>';
}
function adminNotesHtml() {
  const p = P();
  if (!p) return '<p class="small">Профиль не выбран.</p>';
  const rows = [];
  DATA.caseList.forEach(c => {
    c.problems.forEach((pr, i) => {
      if (pr.type !== 'open') return;
      const note = getNote(c.id + '/' + pr.id);
      if (!note || !note.trim()) return;
      const e = getEntry(c.id, pr.id);
      const st = e ? (e.status === 'solved' ? '✔ решена' : '▪ разобрана') : '— не закрыта';
      rows.push(`<div class="prize-row" style="align-items:flex-start">
        <div style="flex:1;min-width:0">
          <b>Этап №${c.num}, задача ${i + 1}</b> <span class="small" style="color:#8d8268">(${st})</span>
          <div class="small" style="color:#8d8268">${esc(pr.statement.slice(0, 90))}…</div>
          <div style="white-space:pre-wrap;margin-top:4px;background:rgba(0,0,0,.2);border-radius:6px;padding:8px 10px;">${esc(note)}</div>
        </div>
      </div>`);
    });
    const bossNote = getNote(c.id + '/boss');
    if (bossNote && bossNote.trim()) {
      const done = p.bosses[c.id] && p.bosses[c.id].done;
      rows.push(`<div class="prize-row" style="align-items:flex-start">
        <div style="flex:1;min-width:0">
          <b>Этап №${c.num}, ГЛАВАРЬ</b> <span class="small" style="color:#8d8268">(${done ? '✔ повержен' : '— ещё не побеждён'})</span>
          <div style="white-space:pre-wrap;margin-top:4px;background:rgba(0,0,0,.2);border-radius:6px;padding:8px 10px;">${esc(bossNote)}</div>
        </div>
      </div>`);
    }
  });
  return rows.length ? rows.join('') : '<p class="small">Пока ни одной записи: полярник ещё не писал(а) ход мысли в блокноты задач.</p>';
}
function renderAdmin() {
  const pin = store.admin.pin;
  if (pin === null) {
    $('app').innerHTML = `
      <div class="topbar"><span class="brand"><span class="em">🔑</span> Родителям</span><span class="spacer"></span><a href="#map" class="small">← назад</a></div>
      <div class="admin-box">
        <h3>Установка PIN</h3>
        <p class="small">Придумайте 4-значный PIN — он защитит эту страницу от любопытных полярников.</p>
        <div class="answer-row"><input type="password" id="pin1" maxlength="4" placeholder="PIN"> <input type="password" id="pin2" maxlength="4" placeholder="ещё раз"> <button class="gold" data-act="pinSet">Сохранить</button></div>
        <div id="pin-res"></div>
      </div>`;
    return;
  }
  if (!store.adminAuthed) {
    $('app').innerHTML = `
      <div class="topbar"><span class="brand"><span class="em">🔑</span> Родителям</span><span class="spacer"></span><a href="#map" class="small">← назад</a></div>
      <div class="admin-box"><h3>Введите PIN</h3>
      <div class="answer-row"><input type="password" id="pin" maxlength="4" placeholder="PIN"> <button class="gold" data-act="pinCheck">Войти</button></div><div id="pin-res"></div></div>`;
    return;
  }
  const prizeRows = DATA.safes.map((thr, i) => {
    const pr = store.admin.prizes[i] || {};
    return `<div class="prize-row">
      <span class="thr">Ящик №${i + 1}<br><small>${thr} 🪙</small></span>
      <input type="text" data-prize="${i}" value="${esc(pr.text || '')}" placeholder="Например: поход в кино / 300 ₽ / выбор десерта">
      <input type="text" data-prizeimg="${i}" value="${esc(pr.img || '')}" placeholder="ссылка на картинку (необязательно)">
    </div>`;
  }).join('');
  $('app').innerHTML = `
    <div class="topbar"><span class="brand"><span class="em">🔑</span> Родителям</span><span class="spacer"></span><a href="#map" class="small">← назад</a></div>
    <div class="admin-box">
      <h3>Призы в ящиках</h3>
      <p class="small">Ящик открывается сам, когда полярник набирает указанные монеты. Впишите, что лежит в каждом (текст хранится только в этом браузере и не попадает в интернет). Пустое поле = нейтральная надпись «получи у родителей».</p>
      ${prizeRows}
      <div class="answer-row"><button class="gold" data-act="prizesSave">Сохранить призы</button><span id="prizes-res"></span></div>
    </div>
    <div class="admin-box">
      <h3>Записи полярника</h3>
      ${adminNotesHtml()}
    </div>
    <div class="admin-box">
      <h3>Отчёт за неделю</h3>
      ${weekReportHtml()}
    </div>
    <div class="admin-box">
      <h3>Полезно знать</h3>
      <ul class="small">
        <li>Слово шифровки: <b>${DATA.mystery.word}</b> — не подсказывайте, но если угадает, сдержите главный приз 🙂</li>
        <li>Подсказки не наказание: с одной наводкой задача даёт ⅔ монет, с двумя — треть. Разбор = 0, но этап двигается.</li>
        <li>Звание растёт: ${DATA.titles.map(t => t.name + ' (' + t.min + '🪙)').join(' → ')}.</li>
      </ul>
    </div>
    <div class="admin-box">
      <h3>Обслуживание</h3>
      <div class="answer-row" style="flex-direction:column;align-items:flex-start;gap:8px">
        <button data-act="saveProgress">💾 Сохранить всё в файл (прогресс + призы)</button>
        <label class="small">📥 Загрузить сохранение: <input type="file" id="restore-file" accept=".json"></label>
        <button class="ghost" data-act="pinReset">Сбросить PIN</button>
      </div>
      <div id="admin-res"></div>
    </div>
    <footer class="site-foot">${DATA.credits}</footer>`;
}

/* ---------- модальные окна, тосты, конфетти ---------- */
function showModal(html) {
  $('modal-root').innerHTML = `<div class="modal">${html}</div>`;
  $('modal-root').classList.add('show');
}
function closeModal() {
  $('modal-root').classList.remove('show');
  $('modal-root').innerHTML = '';
  if (safeModalQueue.length) showNextSafe();
}
function toast(text, cls) {
  const wrap = $('toast-wrap');
  for (const el of [...wrap.children]) if (el.textContent === text) return;
  while (wrap.children.length >= 3) wrap.removeChild(wrap.firstChild);
  const t = document.createElement('div');
  t.className = 'toast ' + (cls || '');
  t.textContent = text;
  wrap.appendChild(t);
  setTimeout(() => t.remove(), 4200);
}
function confetti() {
  const box = document.createElement('div');
  box.className = 'confetti';
  const parts = ['🪙', '✨', '🎉', '📜', '🗝️', '⭐'];
  for (let i = 0; i < 40; i++) {
    const s = document.createElement('span');
    s.textContent = parts[Math.floor(Math.random() * parts.length)];
    s.style.left = Math.random() * 100 + 'vw';
    s.style.animationDuration = (1.8 + Math.random() * 1.6) + 's';
    s.style.animationDelay = (Math.random() * 0.6) + 's';
    s.style.fontSize = (14 + Math.random() * 14) + 'px';
    box.appendChild(s);
  }
  document.body.appendChild(box);
  setTimeout(() => box.remove(), 4200);
}

/* ---------- обработчик кликов ---------- */
document.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act, arg = el.dataset.arg;
  switch (act) {
    case 'goto': location.hash = arg.slice(1); break;
    case 'briefGo':
    case 'briefSkip': {
      const p = P();
      if (p) { p.briefed = true; saveStore(); }
      location.hash = '';
      route();
      break;
    }
    case 'pickProfile': store.currentId = arg; store.adminAuthed = false; saveStore(); location.hash = ''; route(); break;
    case 'pickEmoji': {
      const box = $('np-emoji');
      box.querySelectorAll('button').forEach(b => b.classList.remove('sel'));
      el.classList.add('sel');
      box.dataset.sel = el.dataset.arg;
      break;
    }
    case 'createProfile': {
      const name = $('np-name').value.trim();
      if (!name) { $('np-name').focus(); return; }
      const av = ['🧭', '🐧', '🦭', '🐻‍❄️', '🦌', '🦉', '🧊', '👩‍✈️', '🐕', '🦅'][$('np-emoji').dataset.sel || 0];
      newProfile(name, av);
      location.hash = '';
      route();
      toast('Добро пожаловать на борт, ' + name + '!');
      break;
    }
    case 'earlyUnlock': {
      const cid = arg;
      showModal(`<h2>Открыть этап досрочно?</h2><p>Капитан рекомендует порядок, но не запрещает смелость. Открыть?</p>
        <button class="gold" data-act="confirmEarly" data-arg="${cid}">Открываю!</button>
        <button data-act="closeModal">Лучше по порядку</button>`);
      break;
    }
    case 'confirmEarly': P().earlyUnlock[arg] = true; saveStore(); closeModal(); route(); break;
    case 'junctionChoose': { const [jid, idx] = arg.split('|'); junctionChoose(jid, +idx); break; }
    case 'junctionClaim': junctionClaim(arg); break;
    case 'openRemote': openRemoteStage(arg); break;
    case 'hint': { const [cid, pid, lvl] = arg.split('|'); hintPressed(cid, pid, +lvl); break; }
    case 'viewSolution': { const [cid, pid] = arg.split('|'); solutionPressed(cid, pid); break; }
    case 'confirmSolution': { const [cid, pid] = arg.split('|'); confirmSolution(cid, pid); break; }
    case 'askProblem': {
      const [cid, pid] = arg.split('|');
      const c = DATA.caseList.find(x => x.id === cid);
      const pr = c && c.problems.find(x => x.id === pid);
      if (pr) askOpen(pr.statement);
      break;
    }
    case 'askBoss': {
      const c = DATA.caseList.find(x => x.id === arg);
      if (c) askOpen(c.boss.statement);
      break;
    }
    case 'askSend': askSend(); break;
    case 'dayOpen': dayOpen(); break;
    case 'dayHint': dayHint(+arg); break;
    case 'dayCheck': dayCheck(); break;
    case 'dayDone': closeModal(); route(); break;
    case 'closeModal': closeModal(); break;
    case 'checkAnswer': { const [cid, pid] = arg.split('|'); checkAnswer(cid, pid); break; }
    case 'selfSolved': { const [cid, pid] = arg.split('|'); selfSolved(cid, pid, false); break; }
    case 'selfSolvedForce': { const [cid, pid] = arg.split('|'); selfSolved(cid, pid, true); break; }
    case 'bossHint': { const [cid, lvl] = arg.split('|'); bossHintPressed(cid, +lvl); break; }
    case 'bossSolution': bossSolutionPressed(arg); break;
    case 'bossWin': bossWin(arg, false, false); break;
    case 'bossWinForce': bossWin(arg, false, true); break;
    case 'bossReview': bossWin(arg, true); break;
    case 'examStart': examStart(); break;
    case 'examSave': examSave(arg); break;
    case 'examSubmit':
      showModal(`<h2>Сдать работу?</h2><p>Проверить протокол и показать разборы? Вернуться к задачам уже не получится.</p>
        <button class="gold" data-act="confirmExamSubmit">Сдаю 📤</button> <button data-act="closeModal">Ещё думаю</button>`);
      break;
    case 'confirmExamSubmit': closeModal(); examSubmit(); break;
    case 'examAgain': examStart(); break;
    case 'mysteryTry': mysteryTry(); break;
    case 'saveProgress': saveProgress(); break;
    case 'setTheme': {
      store.ui = store.ui || {};
      store.ui.theme = arg;
      saveStore();
      applyTheme();
      route();
      toast('Оформление: ' + (THEMES.find(t => t.id === arg) || {}).name);
      break;
    }
    case 'resetProgress':
      showModal(`<h2>Начать заново?</h2>
        <p>Весь прогресс полярника <b>${esc(P().name)}</b> — баллы, закрытые задачи, награды, ящики, буквы — обнулится. Имя останется. Отменить будет нельзя.</p>
        <button class="primary" data-act="confirmReset">Да, обнулить</button>
        <button data-act="closeModal">Отмена</button>`);
      break;
    case 'confirmReset': {
      const old = P();
      store.profiles[store.currentId] = {
        name: old.name, emoji: old.emoji, created: today(), briefed: true,
        points: 0, problems: {}, notes: {}, bosses: {}, earlyUnlock: {},
        letters: [], mysterySolved: false, solvedV1: old.solvedV1, achievements: [],
        activity: [], views: {}, junctions: {},
        exam: { best: null, started: null, answers: {}, submitted: false },
        safesOpened: []
      };
      saveStore();
      closeModal();
      location.hash = '';
      route();
      toast('Чистый лист, полярник!');
      break;
    }
    case 'showSafe': { const pr = safePrize(+arg); showModal(`<h2>Ящик №${+arg + 1}</h2><div class="big">${'🗄️'}</div><p><b>${esc(pr.text)}</b></p>${pr.img ? `<img src="${esc(pr.img)}" style="max-width:100%;border-radius:8px;">` : ''}<button class="gold" onclick="closeModal()">Закрыть</button>`); break; }
    case 'pinSet': {
      const a = $('pin1').value, b = $('pin2').value;
      if (!/^\d{4}$/.test(a) || a !== b) { $('pin-res').innerHTML = '<span class="result-bad">PIN — 4 одинаковые цифры в обоих полях.</span>'; return; }
      store.admin.pin = btoa(a); store.adminAuthed = true; saveStore(); renderAdmin();
      break;
    }
    case 'pinCheck': {
      if (btoa($('pin').value) === store.admin.pin) { store.adminAuthed = true; saveStore(); renderAdmin(); }
      else $('pin-res').innerHTML = '<span class="result-bad">Неверный PIN.</span>';
      break;
    }
    case 'pinReset': store.admin.pin = null; store.adminAuthed = false; saveStore(); renderAdmin(); break;
    case 'prizesSave': {
      document.querySelectorAll('[data-prize]').forEach(inp => {
        const i = inp.dataset.prize;
        store.admin.prizes[i] = store.admin.prizes[i] || {};
        store.admin.prizes[i].text = inp.value.trim();
      });
      document.querySelectorAll('[data-prizeimg]').forEach(inp => {
        const i = inp.dataset.prizeimg;
        store.admin.prizes[i] = store.admin.prizes[i] || {};
        store.admin.prizes[i].img = inp.value.trim();
      });
      saveStore();
      $('prizes-res').innerHTML = '<span class="result-ok">Сохранено ✓</span>';
      break;
    }
  }
});
document.addEventListener('change', (ev) => {
  if (ev.target && ev.target.id === 'restore-file') {
    const f = ev.target.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const obj = JSON.parse(r.result);
        if (!obj.profiles) throw new Error('bad');
        store = obj;
        saveStore();
        $('admin-res').innerHTML = '<span class="result-ok">Сохранение загружено ✓</span>';
        toast('Прогресс восстановлен');
        route();
      } catch (e) { $('admin-res').innerHTML = '<span class="result-bad">Файл не похож на сохранение экспедиции.</span>'; }
    };
    r.readAsText(f);
  }
});
document.addEventListener('input', (ev) => {
  const ta = ev.target;
  if (ta && ta.dataset && ta.dataset.note) saveNote(ta.dataset.note, ta.value);
});
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter') {
    const el = ev.target;
    if (el && el.id === 'day-ans') { dayCheck(); return; }
    if (el && el.id === 'ask-input') { askSend(); return; }
    if (el && el.id && el.id.startsWith('ans-')) {
      const pid = el.id.slice(4);
      const btn = document.querySelector(`[data-act="checkAnswer"][data-arg$="|${pid}"]`);
      if (btn) btn.click();
    }
    if (el && el.id === 'mystery-word') mysteryTry();
  }
  if (ev.key === 'Escape') closeModal();
});

/* ---------- старт ---------- */
applyTheme();
route();
window.onPlatformChange = function () {
  if (window.PLATFORM) PLATFORM.refresh().then(function () { loadRemoteManifest(); route(); });
};
if (window.PLATFORM) { loadRemoteManifest(); PLATFORM.refresh(); }
