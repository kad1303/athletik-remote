'use strict';

/* ============================================================
   Start, Anmeldung, Einladung, Navigation, Profil.
   Spieler-Ansichten: player.js · Trainer-Ansichten (Alex): admin.js
   ============================================================ */

// Bei jeder Änderung hochzählen – und gleich in version.json eintragen.
const APP_VERSION = '17';

// Vorschau mit Beispieldaten: ohne Datenbank automatisch, sonst über ?demo (bzw. ?demo=spieler / ?demo=trainer)
const DEMO_PARAM = new URLSearchParams(location.search).get('demo');
const DEMO = !Auth.configured() || DEMO_PARAM !== null;
const DB = DEMO ? Demo.load() : Remote;
const INVITE_KEY = 'athletik:invite';
const DEMO_ROLE_KEY = 'athletik:demo-role';

const App = { me: null, badge: 0 };

const TABS = {
  player: [['start', 'home', 'Start'], ['plan', 'file', 'Plan'], ['videos', 'play', 'Trainingsvideos'], ['profil', 'user', 'Profil']],
  admin: [['spieler', 'users', 'Spieler'], ['inhalte', 'play', 'Trainingsvideos'], ['profil', 'user', 'Profil']],
};

function inviteUrl(code) { return `${location.origin}${location.pathname}#einladung=${code}`; }
function newCode() { return uuid().replace(/-/g, ''); }

/* ---------- Start ---------- */
async function boot() {
  const m = location.hash.match(/einladung=([\w-]+)/);
  if (m) {
    sessionStorage.setItem(INVITE_KEY, m[1]);
    history.replaceState(null, '', location.pathname + location.search);
  }
  const invite = sessionStorage.getItem(INVITE_KEY);

  if (DEMO) {
    // ?demo=spieler / ?demo=trainer öffnet direkt die Ansicht (nur einmal, damit „wechseln“ weiter geht)
    if (/^(spieler|trainer)$/.test(new URLSearchParams(location.search).get('demo') || '')) {
      sessionStorage.setItem(DEMO_ROLE_KEY, DEMO_PARAM === 'spieler' ? 'player' : 'admin');
      history.replaceState(null, '', `${location.pathname}?demo${location.hash}`);
    }
    const role = sessionStorage.getItem(DEMO_ROLE_KEY);
    if (!role) return renderDemoLogin();
    Demo.role = role;
    const uid = role === 'admin' ? 'demo-admin' : 'demo-player';
    const [mem] = await DB.list('members', { user_id: uid });
    App.me = { ...mem, email: role === 'admin' ? 'alex@demo' : 'lena@demo' };
    return startShell();
  }

  Auth.load();
  if (!Auth.session) return invite ? renderInvite(invite) : renderLogin();
  try {
    let [mem] = await DB.list('members', { user_id: Auth.session.user.id });
    if (invite) {
      // Schon angemeldet: Einladung NICHT mit diesem Zugang einlösen (sonst wird z. B. aus Alex ein Spieler)
      if (mem) return renderInviteWhileLoggedIn(invite, mem);
      try { await Remote.rpc('redeem_invite', { p_code: invite }); }
      catch (e) { if (!/invalid_invite|already_member/.test(String(e.message))) throw e; }
      sessionStorage.removeItem(INVITE_KEY);
      [mem] = await DB.list('members', { user_id: Auth.session.user.id });
    }
    if (!mem) return renderNoAccess();
    App.me = { ...mem, email: Auth.session.user.email };
    startShell();
  } catch (e) {
    if (!Auth.session) return renderLogin('Bitte melde dich erneut an.');
    renderError(e);
  }
}

function renderFrame(inner) {
  $('#app').innerHTML = `<main class="auth-wrap"><div class="auth-card">
    <div class="brand-big"><img class="brand-logo" src="icons/logo-skfb.png" alt="SK Fitness Base"><span>Athletiktraining Remote</span></div>
    ${inner}</div></main>`;
}

function renderError(e) {
  renderFrame(`<p class="err-box">${esc(friendlyAuthError(e))}</p><button class="btn primary block" id="retry">Nochmal versuchen</button>`);
  $('#retry').onclick = boot;
}

function renderInviteWhileLoggedIn(code, mem) {
  renderFrame(`<h1>Einladungslink</h1>
    <p class="muted">Du bist gerade angemeldet als <strong>${esc(mem.name)}</strong> (${esc(Auth.session.user.email)}, ${mem.role === 'admin' ? 'Trainer' : 'Spieler'}).
      Ein Einladungslink ist für einen <strong>neuen</strong> Zugang gedacht.</p>
    <button class="btn primary block" id="inv-new">Abmelden und neuen Zugang anlegen</button>
    <button class="btn block" id="inv-stay">Angemeldet bleiben</button>`);
  $('#inv-new').onclick = async () => { await Auth.signOut(); renderInvite(code); };
  $('#inv-stay').onclick = () => { sessionStorage.removeItem(INVITE_KEY); boot(); };
}

function renderNoAccess() {
  renderFrame(`<h1>Noch kein Zugang</h1><p class="muted">Du bist angemeldet, aber noch keinem Spieler zugeordnet. Bitte öffne den Einladungslink, den du von Alex bekommen hast.</p>
    <button class="btn block" id="out">Abmelden</button>`);
  $('#out').onclick = async () => { await Auth.signOut(); boot(); };
}

function renderDemoLogin() {
  renderFrame(`<h1>Demo ansehen</h1>
    <p class="muted">Vorschau mit Beispieldaten – echte Daten werden nicht angezeigt oder verändert. Änderungen bleiben nur in diesem Browser.</p>
    <div class="demo-pick">
      <button class="pick" data-role="player">${icon('user')}<strong>Als Spielerin</strong><span>Lena – Plan als PDF ausfüllen, Trainingsvideos</span></button>
      <button class="pick" data-role="admin">${icon('users')}<strong>Als Trainer</strong><span>Alex – alle Spieler, Pläne, Trainingsvideos</span></button>
    </div>`);
  $$('.pick').forEach(b => b.onclick = () => { sessionStorage.setItem(DEMO_ROLE_KEY, b.dataset.role); location.hash = ''; boot(); });
}

function renderLogin(msg = '') {
  renderFrame(`<h1>Anmelden</h1>
    <form id="login" class="form">
      <label>E-Mail<input name="email" type="email" autocomplete="username" required></label>
      <label>Passwort<input name="pw" type="password" autocomplete="current-password" required></label>
      <p class="err" id="err">${esc(msg)}</p>
      <button class="btn primary block" type="submit">Anmelden</button>
    </form>
    <p class="muted small">Neu dabei? Öffne den Einladungslink von Alex. Passwort vergessen? Kurz Alex Bescheid geben – er schickt dir einen neuen Link.</p>`);
  const f = $('#login');
  f.onsubmit = async e => {
    e.preventDefault();
    const btn = f.querySelector('button');
    btn.disabled = true;
    try { await Auth.signIn(f.email.value, f.pw.value); boot(); }
    catch (x) { $('#err').textContent = friendlyAuthError(x); btn.disabled = false; }
  };
}

async function renderInvite(code) {
  renderFrame('<div class="spinner"></div>');
  let info = null;
  try { info = await Remote.rpc('invite_info', { p_code: code }, true); } catch (e) { console.warn(e); }
  if (!info) {
    sessionStorage.removeItem(INVITE_KEY);
    return renderLogin('Dieser Einladungslink ist nicht mehr gültig. Bitte Alex um einen neuen – oder einfach anmelden.');
  }
  const first = String(info.name).split(' ')[0];
  renderFrame(`<h1>Hallo ${esc(first)}!</h1>
    <p class="muted">${info.role === 'admin' ? 'Du wurdest als Trainer eingeladen.' : 'Alex hat dich zum Athletiktraining eingeladen.'} Lege jetzt deinen Zugang an – das brauchst du nur einmal.</p>
    <form id="inv" class="form">
      <label>E-Mail<input name="email" type="email" autocomplete="username" required></label>
      <label>Passwort (mind. 8 Zeichen)<input name="pw" type="password" autocomplete="new-password" minlength="8" required></label>
      <label>Passwort wiederholen<input name="pw2" type="password" autocomplete="new-password" minlength="8" required></label>
      <p class="err" id="err"></p>
      <button class="btn primary block" type="submit">Zugang anlegen</button>
    </form>
    <button class="link-btn" id="have">Ich habe schon einen Zugang</button>`);
  const f = $('#inv');
  f.onsubmit = async e => {
    e.preventDefault();
    if (f.pw.value !== f.pw2.value) { $('#err').textContent = 'Die beiden Passwörter sind nicht gleich.'; return; }
    const btn = f.querySelector('button');
    btn.disabled = true;
    try {
      const ok = await Auth.signUp(f.email.value, f.pw.value);
      if (!ok) { $('#err').textContent = 'Supabase verlangt noch eine E-Mail-Bestätigung – bitte „Confirm email“ ausschalten (siehe README).'; btn.disabled = false; return; }
      boot();
    } catch (x) { $('#err').textContent = friendlyAuthError(x); btn.disabled = false; }
  };
  $('#have').onclick = () => renderLogin();
}

/* ---------- Rahmen mit Navigation ---------- */
function startShell() {
  const tabs = TABS[App.me.role === 'admin' ? 'admin' : 'player'];
  $('#app').innerHTML = `
    ${DEMO ? `<div class="demo-bar">Demo-Modus · ${App.me.role === 'admin' ? 'Trainer-Ansicht' : 'Spieler-Ansicht'} <button class="link-btn" id="demo-switch">wechseln</button></div>` : ''}
    <div class="shell">
      <nav class="tabbar" aria-label="Hauptmenü">
        <div class="tab-brand"><img class="brand-logo" src="icons/logo-skfb.png" alt="SK Fitness Base"></div>
        ${tabs.map(([id, ic, label]) => `<a href="#/${id}" class="tab" data-tab="${id}">${icon(ic)}<span>${label}</span>${id === 'feedback' ? '<i class="badge" id="fb-badge" hidden></i>' : ''}</a>`).join('')}
      </nav>
      <main id="view" class="view"></main>
    </div>`;
  if (DEMO) $('#demo-switch').onclick = () => { sessionStorage.removeItem(DEMO_ROLE_KEY); location.hash = ''; boot(); };
  window.onhashchange = route;
  route();
  if (App.me.role === 'admin') Admin.refreshBadge();
}

let routeSeq = 0;
async function route() {
  if (!App.me) return;
  if (App.guard && location.hash !== App.guard.hash) {
    if (!App.guard.ok()) { history.pushState(null, '', App.guard.hash); return; }
    App.guard = null;
    window.onbeforeunload = null;
  }
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const admin = App.me.role === 'admin';
  const page = parts[0] || (admin ? 'spieler' : 'start');
  const tab = (admin ? { plan: 'spieler', pdf: 'spieler' } : {})[page] || page;
  $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  const view = $('#view');
  const seq = ++routeSeq;
  view.innerHTML = '<div class="spinner"></div>';
  view.dataset.page = page;
  view.onclick = view.oninput = view.onchange = null;
  view.classList.remove('dirty');
  try {
    const handler = page === 'profil' ? renderProfile : admin ? Admin.route(page) : Player.route(page);
    if (!handler) { location.hash = admin ? '#/spieler' : '#/start'; return; }
    await handler(view, parts.slice(1), () => seq === routeSeq);
    if (seq === routeSeq) window.scrollTo(0, 0);
  } catch (e) {
    console.error(e);
    if (seq === routeSeq) view.innerHTML = `<div class="page"><p class="err-box">${esc(friendlyAuthError(e))}</p><button class="btn" onclick="route()">Nochmal laden</button></div>`;
  }
}

/* ---------- Profil (für alle) ---------- */
async function renderProfile(view) {
  const admin = App.me.role === 'admin';
  view.innerHTML = `<div class="page narrow">
    <header class="page-head"><h1>Profil</h1></header>
    <section class="card">
      <div class="person"><span class="avatar">${esc(initials(App.me.name))}</span><div><strong>${esc(App.me.name)}</strong><span class="muted">${esc(App.me.email || '')} · ${admin ? 'Trainer (Admin)' : 'Spieler'}</span></div></div>
    </section>
    ${DEMO ? `<section class="card"><h2>Demo</h2><p class="muted">Beispieldaten liegen nur in diesem Browser.</p>
      <div class="row-btns"><button class="btn" id="demo-reset">Beispieldaten zurücksetzen</button></div></section>` : `
    <section class="card"><h2>Passwort ändern</h2>
      <form id="pwf" class="form">
        <label>Neues Passwort (mind. 8 Zeichen)<input name="pw" type="password" autocomplete="new-password" minlength="8" required></label>
        <p class="err" id="pw-err"></p>
        <button class="btn primary" type="submit">Speichern</button>
      </form></section>`}
    ${admin ? `<section class="card"><h2>Weiteren Trainer einladen</h2>
      <p class="muted">Trainer sehen alle Spieler und können Pläne und Inhalte bearbeiten.</p>
      <form id="adm" class="form inline"><input name="name" placeholder="Name" required><button class="btn" type="submit">Einladungslink erzeugen</button></form></section>` : ''}
    <button class="btn block ghost" id="logout">${icon('logout')} ${DEMO ? 'Demo verlassen' : 'Abmelden'}</button>
    <p class="muted small center">Version ${APP_VERSION}</p>
  </div>`;
  if (DEMO) $('#demo-reset').onclick = () => { Demo.reset(); toast('Beispieldaten zurückgesetzt'); route(); };
  else $('#pwf').onsubmit = async e => {
    e.preventDefault();
    try { await Auth.setPassword(e.target.pw.value); e.target.reset(); toast('Passwort geändert'); $('#pw-err').textContent = ''; }
    catch (x) { $('#pw-err').textContent = friendlyAuthError(x); }
  };
  if (admin) $('#adm').onsubmit = async e => {
    e.preventDefault();
    const name = e.target.elements.namedItem('name').value.trim();
    const code = newCode();
    await DB.insert('invites', { code, role: 'admin', name });
    e.target.reset();
    showInvite(name, code, 'Hi! Hier ist dein Trainer-Zugang für Athletik Remote:');
  };
  $('#logout').onclick = async () => {
    if (DEMO) { sessionStorage.removeItem(DEMO_ROLE_KEY); if (DEMO_PARAM !== null) { location.href = location.pathname; return; } } else await Auth.signOut();
    App.me = null;
    location.hash = '';
    boot();
  };
}

// Einladungslink anzeigen: kopieren oder direkt per WhatsApp schicken
function showInvite(name, code, intro) {
  const url = inviteUrl(code);
  const first = String(name).split(' ')[0];
  const text = `${intro || `Hi ${first}! Ab jetzt läuft dein Athletiktraining über unsere App. Hier ist dein persönlicher Zugang:`}\n${url}\n\nLink öffnen, E-Mail + Passwort festlegen – fertig. Tipp: Im Safari über „Teilen → Zum Home-Bildschirm“ als App speichern.`;
  openSheet(`<h2>Einladung für ${esc(name)}</h2>
    <p class="muted">Der Link funktioniert genau einmal. ${DEMO ? 'Im Demo-Modus nur zum Ansehen.' : ''}</p>
    <div class="invite-link">${esc(url)}</div>
    <div class="row-btns">
      <button class="btn" id="cp">${icon('copy')} Kopieren</button>
      <a class="btn wa" href="${waLink(text)}" target="_blank" rel="noopener">${icon('wa')} Per WhatsApp senden</a>
    </div>`);
  $('#cp').onclick = () => copyText(text);
}

/* ---------- Updates ---------- */
async function checkForUpdate() {
  if (location.protocol === 'file:' || !navigator.onLine) return;
  try {
    const res = await fetch(`version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return;
    const { version } = await res.json();
    if (version === APP_VERSION || $('.sheet-bg') || document.querySelector('.dirty')) return;
    // Schutz vor Endlos-Schleife, falls der Cache noch die alte Version liefert
    if (sessionStorage.getItem('ar-update-tried') === version) return;
    sessionStorage.setItem('ar-update-tried', version);
    const reg = await navigator.serviceWorker?.getRegistration();
    await reg?.update();
    location.reload();
  } catch (e) {
    console.warn('Update-Prüfung fehlgeschlagen', e);
  }
}

Auth.onExpired = () => { App.me = null; renderLogin('Bitte melde dich erneut an.'); };

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  checkForUpdate();
  if (App.me && App.me.role === 'admin') Admin.refreshBadge();
});

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(e => console.warn('Service Worker nicht registriert', e));
}
boot();
checkForUpdate();
