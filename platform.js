/* ===== platform.js — общие аккаунты, доступ и статистика для тренажёров =====
   Подключение: <script src="platform.js?v=N"></script> ПОСЛЕ data.js, ПЕРЕД app.js.
   API: PLATFORM.register/login/logout/recover/me/redeem/stage/manifest/identity/panelHtml/openAuth/openRedeem.
*/
(function () {
  'use strict';

  const API = 'https://game-platform.kirillovd.workers.dev';
  const TOKEN_KEY = 'platformToken';
  const USER_KEY = 'platformUser';
  const REC_KEY = 'platformRecoveryShown';

  function getToken() { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; } }
  function setToken(t) { try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch (e) {} }
  function getUser() { try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); } catch (e) { return null; } }
  function setUser(u) { try { u ? localStorage.setItem(USER_KEY, JSON.stringify(u)) : localStorage.removeItem(USER_KEY); } catch (e) {} }

  async function api(path, opts) {
    opts = opts || {};
    const headers = { 'Content-Type': 'application/json' };
    const t = getToken();
    if (t) headers['Authorization'] = 'Bearer ' + t;
    const res = await fetch(API + path, {
      method: opts.method || 'GET',
      headers: headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    let data = {};
    try { data = await res.json(); } catch (e) {}
    if (!res.ok) {
      const err = new Error(data.message || data.error || ('Ошибка ' + res.status));
      err.code = data.error || ('http_' + res.status);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  const PLATFORM = {
    api: api,
    API: API,
    get token() { return getToken(); },
    get user() { return getUser(); },
    identity: function () {
      const u = getUser();
      return u ? { uid: u.id, name: u.name, email: u.email } : { uid: '', name: '', email: '' };
    },
    onChange: null,

    register: async function (email, password, name) {
      const d = await api('/auth/register', { method: 'POST', body: { email: email, password: password, name: name } });
      setToken(d.token); setUser(d.user);
      if (this.onChange) this.onChange(d.user);
      return d;
    },
    login: async function (email, password) {
      const d = await api('/auth/login', { method: 'POST', body: { email: email, password: password } });
      setToken(d.token); setUser(d.user);
      if (this.onChange) this.onChange(d.user);
      return d;
    },
    logout: async function () {
      try { await api('/auth/logout', { method: 'POST' }); } catch (e) {}
      setToken(''); setUser(null);
      if (this.onChange) this.onChange(null);
    },
    refresh: async function () {
      if (!getToken()) return null;
      try {
        const d = await api('/auth/me');
        setUser(d.user);
        if (this.onChange) this.onChange(d.user);
        return d.user;
      } catch (e) {
        if (e.status === 401) { setToken(''); setUser(null); if (this.onChange) this.onChange(null); }
        return null;
      }
    },
    recover: async function (email, code, password) {
      const d = await api('/auth/recover', { method: 'POST', body: { email: email, code: code, password: password } });
      setToken(d.token); setUser(d.user);
      if (this.onChange) this.onChange(d.user);
      return d;
    },
    forgot: function (email) { return api('/auth/forgot', { method: 'POST', body: { email: email } }); },
    redeem: async function (code) {
      const d = await api('/redeem', { method: 'POST', body: { code: code } });
      setUser(d.user);
      if (this.onChange) this.onChange(d.user);
      return d;
    },
    has: function (product, stage) {
      const u = getUser();
      if (!u || !u.ent) return false;
      return u.ent.indexOf(product + ':all') >= 0 || u.ent.indexOf(product + ':' + stage) >= 0;
    },
    manifest: function (product) { return api('/manifest?product=' + encodeURIComponent(product) + '&t=' + Date.now()); },
    stage: function (product, id) { return api('/stage?product=' + encodeURIComponent(product) + '&id=' + encodeURIComponent(id) + '&t=' + Date.now()); },

    /* ---------- UI ---------- */
    panelHtml: function () {
      const u = getUser();
      if (u) {
        return '<div class="pf-panel">' +
          '<div><b>' + esc(u.name) + '</b> <span class="pf-muted">' + esc(u.email) + '</span></div>' +
          '<div class="pf-muted" style="margin:4px 0">Доступ: ' + esc(entLabel(u.ent)) + '</div>' +
          '<div class="pf-row"><button class="pf-btn" data-pf-act="logout">Выйти</button>' +
          '<button class="pf-btn ghost" data-pf-act="redeem">У меня есть код доступа</button></div>' +
          '</div>';
      }
      return '<div class="pf-panel">' +
        '<div>Аккаунт нужен, чтобы прогресс и покупки были на всех устройствах, а пароль можно было восстановить.</div>' +
        '<div class="pf-row" style="margin-top:8px">' +
        '<button class="pf-btn gold" data-pf-act="login">Войти</button>' +
        '<button class="pf-btn" data-pf-act="register">Создать аккаунт</button>' +
        '<button class="pf-btn ghost" data-pf-act="redeem">Ввести код</button></div>' +
        '</div>';
    },

    openAuth: function (mode) {
      const m = mode || 'login';
      const box = ensureOverlay();
      box.innerHTML = '<div class="pf-modal">' +
        '<button class="pf-x" data-pf-act="close">×</button>' +
        '<h2>' + (m === 'register' ? 'Создать аккаунт' : m === 'recover' ? 'Восстановление доступа' : 'Вход') + '</h2>' +
        (m === 'register' ? '<p class="pf-note">Логин — почта. Имя — как тебя называть в игре.</p>' : '') +
        '<label class="pf-label">Почта</label><input class="pf-input" id="pf-email" type="email" autocomplete="email" placeholder="name@example.com">' +
        '<label class="pf-label">Имя в игре</label>' +
        (m === 'register' ? '<input class="pf-input" id="pf-name" maxlength="30" placeholder="Например, Милла">' : '') +
        (m === 'recover' ? '<label class="pf-label">Код восстановления</label><input class="pf-input" id="pf-code" placeholder="XXXXX-XXXXX">' : '') +
        '<label class="pf-label">' + (m === 'recover' ? 'Новый пароль' : 'Пароль') + '</label>' +
        '<input class="pf-input" id="pf-pass" type="password" autocomplete="' + (m === 'register' ? 'new-password' : 'current-password') + '" placeholder="минимум 8 символов">' +
        '<div class="pf-err" id="pf-err"></div>' +
        '<div class="pf-row">' +
        '<button class="pf-btn gold" data-pf-act="submit" data-mode="' + m + '">' + (m === 'register' ? 'Создать аккаунт' : m === 'recover' ? 'Сменить пароль' : 'Войти') + '</button>' +
        (m === 'recover' ? '<button class="pf-btn ghost" data-pf-act="forgot">Прислать код на почту</button>' : '') +
        (m !== 'login' ? '<button class="pf-btn ghost" data-pf-act="login">У меня есть пароль</button>' : '') +
        (m !== 'register' ? '<button class="pf-btn ghost" data-pf-act="register">Регистрация</button>' : '') +
        (m === 'login' ? '<button class="pf-btn ghost" data-pf-act="recover">Забыли пароль?</button>' : '') +
        '</div>' +
        (m === 'recover' ? '<p class="pf-note">Код восстановления был показан при регистрации. Если он потерян — кнопка выше отправит ссылку на почту (когда подключена почтовая служба).</p>' : '') +
        '</div>';
      box.classList.add('show');
      setTimeout(function () { const el = document.getElementById('pf-email'); if (el) el.focus(); }, 40);
    },

    openRedeem: function () {
      const box = ensureOverlay();
      box.innerHTML = '<div class="pf-modal">' +
        '<button class="pf-x" data-pf-act="close">×</button>' +
        '<h2>Код доступа</h2>' +
        '<p class="pf-note">Код продаётся на один этап или на всю экспедицию. Вводится один раз.</p>' +
        '<input class="pf-input" id="pf-redeem" placeholder="PL6-XXXXX-XXXXX" style="text-transform:uppercase">' +
        '<div class="pf-err" id="pf-err"></div>' +
        '<div class="pf-row"><button class="pf-btn gold" data-pf-act="redeem-submit">Активировать</button></div>' +
        '</div>';
      box.classList.add('show');
      setTimeout(function () { const el = document.getElementById('pf-redeem'); if (el) el.focus(); }, 40);
    },

    showRecovery: function (code) {
      const box = ensureOverlay();
      box.innerHTML = '<div class="pf-modal">' +
        '<h2>Код восстановления</h2>' +
        '<p class="pf-note">Если забудете пароль — этот код вернёт доступ. Показываем один раз.</p>' +
        '<div class="pf-code" id="pf-recovery">' + esc(code) + '</div>' +
        '<div class="pf-row">' +
        '<button class="pf-btn gold" data-pf-act="copy-recovery">Скопировать</button>' +
        '<button class="pf-btn" data-pf-act="close">Я сохранил(а)</button>' +
        '</div>' +
        '<p class="pf-note" style="margin-top:10px">Можно переписать в блокнот или отправить себе на почту.</p>' +
        '</div>';
      box.classList.add('show');
    },
  };

  /* ---------- служебное ---------- */
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function entLabel(ent) {
    if (!ent || !ent.length) return 'бесплатные этапы';
    const map = { pole6: 'Полюс-6', math: 'Агентство «Логика»', prestol: 'Престол эпох' };
    return ent.map(function (e) {
      const parts = String(e).split(':');
      const prod = map[parts[0]] || parts[0];
      return parts[1] === 'all' ? 'вся игра «' + prod + '»' : 'этап ' + parts[1] + ' «' + prod + '»';
    }).join(', ');
  }
  function err(text) { const e = document.getElementById('pf-err'); if (e) e.textContent = text || ''; }
  function ensureOverlay() {
    let b = document.getElementById('platform-overlay');
    if (!b) {
      b = document.createElement('div');
      b.id = 'platform-overlay';
      document.body.appendChild(b);
      injectCss();
    }
    return b;
  }
  function close() {
    const b = document.getElementById('platform-overlay');
    if (b) { b.classList.remove('show'); b.innerHTML = ''; }
  }
  function injectCss() {
    if (document.getElementById('platform-css')) return;
    const s = document.createElement('style');
    s.id = 'platform-css';
    s.textContent = `
      #platform-overlay{position:fixed;inset:0;background:rgba(6,14,22,.72);display:none;align-items:center;justify-content:center;padding:16px;z-index:9999}
      #platform-overlay.show{display:flex}
      #platform-overlay .pf-modal{background:#f4f8fb;color:#16283a;border-radius:14px;padding:22px;max-width:430px;width:100%;box-shadow:0 18px 50px rgba(0,0,0,.45);position:relative;font-family:Georgia,'Segoe UI',sans-serif}
      .pf-modal h2{margin:0 0 8px;font-size:1.35em;color:#12324a}
      .pf-label{display:block;font-size:.82em;color:#4d6478;margin:10px 0 3px}
      .pf-input{width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid #b9c7d2;border-radius:9px;font:inherit;background:#fff}
      .pf-input:focus{outline:2px solid #7ebee2;border-color:#7ebee2}
      .pf-btn{padding:9px 14px;border-radius:9px;border:1px solid #b9c7d2;background:#fff;font:inherit;cursor:pointer}
      .pf-btn.gold{background:#e8b35a;border-color:#c9933c;font-weight:bold}
      .pf-btn.ghost{background:transparent;border-color:transparent;color:#2f6f96;text-decoration:underline;padding:9px 6px}
      .pf-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:14px}
      .pf-x{position:absolute;right:10px;top:6px;border:0;background:transparent;font-size:1.6em;line-height:1;cursor:pointer;color:#7c8b99}
      .pf-err{color:#b8452f;font-size:.9em;min-height:1.2em;margin-top:8px}
      .pf-note{color:#4d6478;font-size:.88em;margin:6px 0}
      .pf-muted{color:#4d6478;font-size:.85em}
      .pf-code{font-family:Consolas,monospace;font-size:1.6em;letter-spacing:.08em;text-align:center;background:#eaf4fb;border:2px dashed #7ebee2;border-radius:10px;padding:14px;margin:12px 0}
      .pf-panel{border-left:4px solid #7ebee2;background:#eaf4fb;border-radius:8px;padding:10px 12px;margin:8px 0}
    `;
    document.head.appendChild(s);
  }

  document.addEventListener('click', async function (ev) {
    const el = ev.target.closest('[data-pf-act]');
    if (!el) {
      if (ev.target.id === 'platform-overlay') close();
      return;
    }
    const act = el.dataset.pfAct;
    if (act === 'close') { close(); return; }
    if (act === 'login') { PLATFORM.openAuth('login'); return; }
    if (act === 'register') { PLATFORM.openAuth('register'); return; }
    if (act === 'recover') { PLATFORM.openAuth('recover'); return; }
    if (act === 'redeem') {
      if (!getUser()) { PLATFORM.openAuth('login'); return; }
      PLATFORM.openRedeem(); return;
    }
    if (act === 'logout') {
      await PLATFORM.logout();
      if (typeof window.onPlatformChange === 'function') window.onPlatformChange(null);
      return;
    }
    if (act === 'forgot') {
      const email = (document.getElementById('pf-email') || {}).value || '';
      err('');
      try {
        const d = await PLATFORM.forgot(email.trim());
        err(d.message || (d.email_sent ? 'Письмо отправлено. Проверьте почту.' : 'Почта пока не подключена.'));
      } catch (e) { err(e.message || 'Не удалось отправить письмо'); }
      return;
    }
    if (act === 'copy-recovery') {      const t = document.getElementById('pf-recovery');
      if (t) {
        try { await navigator.clipboard.writeText(t.textContent); el.textContent = 'Скопировано ✓'; } catch (e) { el.textContent = 'Выделите и скопируйте вручную'; }
      }
      return;
    }
    if (act === 'submit') {
      const mode = el.dataset.mode;
      const email = (document.getElementById('pf-email') || {}).value || '';
      const pass = (document.getElementById('pf-pass') || {}).value || '';
      const name = (document.getElementById('pf-name') || {}).value || '';
      const code = (document.getElementById('pf-code') || {}).value || '';
      err('');
      el.disabled = true;
      try {
        let d;
        if (mode === 'register') d = await PLATFORM.register(email.trim(), pass, name.trim());
        else if (mode === 'recover') d = await PLATFORM.recover(email.trim(), code.trim(), pass);
        else d = await PLATFORM.login(email.trim(), pass);
        if (d && d.recoveryCode) { PLATFORM.showRecovery(d.recoveryCode); }
        else close();
        if (typeof window.onPlatformChange === 'function') window.onPlatformChange(getUser());
      } catch (e) {
        err(e.message || 'Не получилось. Проверьте данные');
      } finally { el.disabled = false; }
      return;
    }
    if (act === 'redeem-submit') {
      const code = (document.getElementById('pf-redeem') || {}).value || '';
      err('');
      el.disabled = true;
      try {
        await PLATFORM.redeem(code.trim());
        close();
        if (typeof window.onPlatformChange === 'function') window.onPlatformChange(getUser());
        alert('Код активирован! Доступ открыт.');
      } catch (e) {
        err(e.message || 'Код не подошёл');
      } finally { el.disabled = false; }
    }
  });

  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape') close();
  });

  window.PLATFORM = PLATFORM;
})();
