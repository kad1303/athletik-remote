'use strict';

/* ============================================================
   Spieler-Ansicht (schlank): Start · Plan (PDF zum Ausfüllen) · Trainingsvideos · Profil.
   ============================================================ */

const PAGE_LOGO = '<img class="page-logo" src="icons/logo-skfb.png" alt="SK Fitness Base">';

const Player = {
  route(page) {
    return { start: (v, a, live) => this.home(v, live), plan: (v, a, live) => this.plan(v, live), videos: (v, a, live) => this.videos(v, live) }[page];
  },

  /* ---------- Start: Hallo, Woche Mo–Fr, Weg zum Plan ---------- */
  async home(view, live) {
    const plan = await this.activePlan();
    const [fields, videos] = await Promise.all([
      plan && plan.file_url ? DB.list('pdf_fields', { plan_id: plan.id }, { select: 'id' }) : [],
      DB.list('content', { section: 'videos' }, { select: 'id' }),
    ]);
    const vals = fields.length ? await DB.list('pdf_values', { player_id: this.pid(), field_id: fields.map(f => f.id) }, { select: 'value,updated_at' }) : [];
    if (!live()) return;
    const today = Dates.today();
    const week = Dates.week(today).slice(0, 5);
    // Tage, an denen etwas in den Plan eingetragen wurde
    const active = new Set(vals.filter(v => v.value).map(v => Dates.iso(new Date(v.updated_at))));
    const filled = vals.filter(v => v.value).length;
    const first = String(App.me.name || '').split(' ')[0];
    const hasPlan = plan && plan.file_url;

    view.innerHTML = `<div class="page narrow">
      ${PAGE_LOGO}
      <header class="page-head"><div><h1>Hallo ${esc(first)}</h1><p class="muted">${Dates.long(today)}</p></div></header>
      <section class="card">
        <h2>Diese Woche</h2>
        <div class="week5">${week.map(d => `<div class="wk-day ${d === today ? 'today' : ''} ${active.has(d) ? 'done' : ''}">
          <span>${WD[Dates.weekday(d) - 1]}</span><strong>${Dates.parse(d).getDate()}</strong><i>${active.has(d) ? icon('check') : ''}</i></div>`).join('')}</div>
        <p class="muted small">${week.some(d => active.has(d)) ? 'Ein Haken zeigt, an welchen Tagen du etwas in deinen Plan eingetragen hast.' : 'Sobald du in deinem Plan etwas einträgst, erscheint hier ein Haken.'}</p>
      </section>
      ${hasPlan ? `<a class="start-card" href="#/plan">
          <span class="eyebrow">Dein Trainingsplan</span>
          <h2>${esc(plan.title)}</h2>
          ${fields.length ? `<div class="mini-progress"><i style="width:${Math.round(filled / fields.length * 100)}%"></i></div><span class="small">${filled} von ${fields.length} Feldern ausgefüllt</span>` : ''}
          <span class="go">Hier geht's zu deinem Trainingsplan ${icon('next')}</span>
        </a>`
        : `<section class="card empty">${icon('file', 'big')}<h2>Dein Plan kommt gleich</h2><p class="muted">Alex lädt deinen Trainingsplan hier hoch.</p></section>`}
      ${videos.length ? `<a class="card link-card" href="#/videos">${icon('play')}<span><strong>Trainingsvideos</strong><small class="muted">${plural(videos.length, 'Video', 'Videos')} von Alex</small></span>${icon('next')}</a>` : ''}
      ${hasPlan && plan.notes ? `<section class="card note"><h2>Hinweis von Alex</h2><p>${richText(plan.notes)}</p></section>` : ''}
    </div>`;
  },

  pid() { return App.me.player_id; },

  async activePlan() {
    const [plan] = await DB.list('plans', { player_id: this.pid(), active: true }, { order: '-created_at', limit: 1 });
    return plan || null;
  },

  /* ---------- Plan: die PDF von Alex, Kreuze und Gewichte direkt eintragen ---------- */
  async plan(view, live) {
    const plan = await this.activePlan();
    if (!live()) return;
    if (!plan || !plan.file_url) {
      const first = String(App.me.name || '').split(' ')[0];
      view.innerHTML = `<div class="page narrow"><header class="page-head"><h1>Plan</h1></header>
        <section class="card empty">${icon('file', 'big')}<h2>Dein Plan kommt gleich</h2><p class="muted">Alex lädt deinen Trainingsplan hier hoch. Sobald er da ist, kannst du ihn direkt ausfüllen.</p></section></div>`;
      return;
    }
    const fields = await DB.list('pdf_fields', { plan_id: plan.id });
    const vals = await DB.list('pdf_values', { player_id: this.pid(), field_id: fields.map(f => f.id) });
    if (!live()) return;
    view.innerHTML = `<div class="page pdf-page-wrap">
      <header class="page-head">
        <div><h1>${esc(plan.title)}</h1><p class="muted small">${fields.length ? 'Kästchen antippen zum Abhaken, kg-Felder antippen zum Eintragen.' : 'Dein Trainingsplan'}</p></div>
        <span class="save-state" id="save-state"></span>
      </header>
      <div id="pdf-box" class="pdf-box"></div>
    </div>`;
    const saveState = $('#save-state');
    await PdfView.mount($('#pdf-box'), plan.file_url, {
      mode: 'fill', fields, values: Object.fromEntries(vals.map(v => [v.field_id, v.value])),
      onValue: async (f, value) => {
        saveState.textContent = 'Speichert …';
        saveState.className = 'save-state';
        try {
          await DB.upsert('pdf_values', { field_id: f.id, player_id: this.pid(), value, updated_at: new Date().toISOString() }, 'field_id,player_id');
          saveState.textContent = 'Gespeichert';
          saveState.className = 'save-state ok';
        } catch (x) {
          saveState.textContent = 'Nicht gespeichert';
          saveState.className = 'save-state bad';
          toast(friendlyAuthError(x), 'err');
        }
      },
    });
  },

  /* ---------- Trainingsvideos ---------- */
  async videos(view, live) {
    const items = await DB.list('content', { section: 'videos' }, { order: 'sort,-created_at' });
    if (!live()) return;
    view.innerHTML = `<div class="page narrow">
      <header class="page-head"><div><h1>Trainingsvideos</h1></div></header>
      ${items.length ? `<div class="content-list">${items.map(c => contentCard(c)).join('')}</div>` : `<section class="card empty">${icon('play', 'big')}<p class="muted">Hier ist noch nichts – Alex lädt bald Videos hoch.</p></section>`}
    </div>`;
    bindContent(view);
  },
};

// Video-Karte – auch in der Trainer-Ansicht benutzt
function contentCard(c, adminTools = '') {
  return `<article class="card content-card">
    <div class="cc-head"><h3>${esc(c.title)}</h3>${adminTools}</div>
    ${c.body ? `<p class="cc-body">${richText(c.body)}</p>` : ''}
    ${c.url ? `<button class="chip-btn" data-video="${esc(c.url)}" data-title="${esc(c.title)}">${icon(Media.kind(c.url) === 'video' ? 'play' : Media.kind(c.url) === 'link' ? 'link' : 'file')} ${Media.label(c.url)}</button>` : ''}
  </article>`;
}
function bindContent(root) {
  $$('[data-video]', root).forEach(b => b.onclick = () => Media.open(b.dataset.video, b.dataset.title));
}
