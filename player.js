'use strict';

/* ============================================================
   Spieler-Ansicht (schlank): Plan (PDF zum Ausfüllen) · Trainingsvideos · Profil.
   ============================================================ */

const PAGE_LOGO = '<img class="page-logo" src="icons/logo-skfb.png" alt="SK Fitness Base">';

const Player = {
  route(page) {
    return { plan: (v, a, live) => this.plan(v, live), videos: (v, a, live) => this.videos(v, live) }[page];
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
      view.innerHTML = `<div class="page narrow">${PAGE_LOGO}<header class="page-head"><h1>Hallo ${esc(first)}</h1></header>
        <section class="card empty">${icon('file', 'big')}<h2>Dein Plan kommt gleich</h2><p class="muted">Alex lädt deinen Trainingsplan hier hoch. Sobald er da ist, kannst du ihn direkt ausfüllen.</p></section></div>`;
      return;
    }
    const fields = await DB.list('pdf_fields', { plan_id: plan.id });
    const vals = await DB.list('pdf_values', { player_id: this.pid(), field_id: fields.map(f => f.id) });
    if (!live()) return;
    view.innerHTML = `<div class="page pdf-page-wrap">
      ${PAGE_LOGO}
      <header class="page-head">
        <div><h1>${esc(plan.title)}</h1><p class="muted small">${fields.length ? 'Kästchen antippen zum Abhaken, kg-Felder antippen zum Eintragen.' : 'Dein Trainingsplan'}</p></div>
        <span class="save-state" id="save-state"></span>
      </header>
      ${plan.notes ? `<p class="card note">${richText(plan.notes)}</p>` : ''}
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
