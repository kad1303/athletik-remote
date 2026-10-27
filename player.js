'use strict';

/* ============================================================
   Spieler-Ansicht (schlank): Start · Plan (PDF zum Ausfüllen) · Trainingsvideos · Profil.
   ============================================================ */

const PAGE_LOGO = '<img class="page-logo" src="icons/logo-skfb.png" alt="SK Fitness Base">';

const Player = {
  route(page) {
    return { start: (v, a, live) => this.home(v, live), plan: (v, a, live) => a[0] === 'videos' ? this.planVideos(v, live) : this.plan(v, live), videos: (v, a, live) => this.videos(v, live) }[page];
  },

  /* ---------- Start: Hallo, Woche Mo–Fr, Weg zum Plan ---------- */
  async home(view, live) {
    await this.withData(live, d => this.drawHome(view, d));
  },

  drawHome(view, { plan, values: vals, week: wp = [] }) {
    const today = Dates.today();
    // Sonntags zeigt die Startseite schon die kommende Woche, sobald Alex sie eingetragen hat
    let ws = Dates.monday(today);
    const next = Dates.add(ws, 7);
    const showNext = Dates.weekday(today) === 7 && wp.some(r => r.week_start === next);
    if (showNext) ws = next;
    const partOf = d => (wp.find(r => r.week_start === ws && r.weekday === Dates.weekday(d)) || {}).text || '';
    // Mo–Fr, Samstag/Sonntag nur wenn dort etwas geplant ist
    const week = Dates.week(ws).filter((d, i) => i < 5 || partOf(d));
    // Tage, an denen etwas in den Plan eingetragen wurde
    const active = new Set(vals.filter(v => v.value).map(v => Dates.iso(new Date(v.updated_at))));
    const first = String(App.me.name || '').split(' ')[0];
    const hasPlan = plan && plan.file_url;
    // Plan schon im Hintergrund laden, damit der Reiter „Plan“ sofort da ist
    if (hasPlan) PdfView.load(plan.file_url).catch(() => {});

    view.innerHTML = `<div class="page narrow">
      ${PAGE_LOGO}
      <header class="page-head"><div><h1>Hallo ${esc(first)}</h1><p class="muted">${Dates.long(today)}</p></div></header>
      <section class="card">
        <h2>${showNext ? 'Nächste Woche' : 'Diese Woche'}</h2>
        <div class="week5" style="--n:${week.length}">${week.map(d => `<div class="wk-day ${d === today ? 'today' : ''} ${active.has(d) ? 'done' : ''} ${partOf(d) ? 'has-part' : ''}">
          <span>${WD[Dates.weekday(d) - 1]}</span><strong>${Dates.parse(d).getDate()}</strong>${partOf(d) ? `<em>${esc(partOf(d))}</em>` : ''}<i>${active.has(d) ? icon('check') : ''}</i></div>`).join('')}</div>
      </section>
      ${hasPlan ? `<a class="start-card" href="#/plan">
          <span class="eyebrow">Dein Trainingsplan</span>
          <h2>${esc(plan.title)}</h2>
          <span class="go">Hier geht's zu deinem Trainingsplan ${icon('next')}</span>
        </a>`
        : `<section class="card empty">${icon('file', 'big')}<h2>Dein Plan kommt gleich</h2><p class="muted">Alex lädt deinen Trainingsplan hier hoch.</p></section>`}
      ${hasPlan && plan.notes ? `<section class="card note"><h2>Hinweis von Alex</h2><p>${richText(plan.notes)}</p></section>` : ''}
    </div>`;
  },

  pid() { return App.me.player_id; },

  /* Alles, was die Spielerseiten brauchen, in einem Rutsch: Plan (mit Feldern) + eigene Einträge.
     Der letzte Stand liegt im Gerät → Seiten erscheinen sofort, frische Daten kommen im Hintergrund. */
  snap: null,
  snapKey() { return `athletik:snap:${this.pid()}`; },
  cached() {
    if (this.snap && this.snap.pid === this.pid()) return this.snap;
    try { return (this.snap = JSON.parse(localStorage.getItem(this.snapKey()))); } catch { return null; }
  },
  keep(d) {
    d.pid = this.pid();
    this.snap = d;
    try { localStorage.setItem(this.snapKey(), JSON.stringify(d)); } catch {}
  },
  async fresh() {
    let plan, fields, values;
    // Wochenplan von Alex: diese und nächste Woche
    const mon = Dates.monday(Dates.today());
    const weekQ = DB.list('week_plans', { player_id: this.pid(), week_start: [mon, Dates.add(mon, 7)] }, { select: 'week_start,weekday,text' }).catch(() => []);
    if (DEMO) {
      [plan] = await DB.list('plans', { player_id: this.pid(), active: true }, { order: '-created_at', limit: 1 });
      fields = plan ? await DB.list('pdf_fields', { plan_id: plan.id }) : [];
      values = await DB.list('pdf_values', { player_id: this.pid() });
    } else {
      const [plans, vals] = await Promise.all([
        DB.list('plans', { player_id: this.pid(), active: true }, { order: '-created_at', limit: 1, select: '*,pdf_fields(id,page,kind,x,y,w,h)' }),
        DB.list('pdf_values', { player_id: this.pid() }, { select: 'field_id,value,updated_at' }),
      ]);
      plan = plans[0] || null;
      fields = plan ? plan.pdf_fields || [] : [];
      if (plan) delete plan.pdf_fields;
      values = vals;
    }
    const ids = new Set(fields.map(f => f.id));
    const week = (await weekQ).map(r => ({ week_start: r.week_start, weekday: r.weekday, text: r.text }));
    const d = { plan: plan || null, fields, week, values: values.filter(v => ids.has(v.field_id)).map(v => ({ field_id: v.field_id, value: v.value, updated_at: v.updated_at })) };
    this.keep(d);
    return d;
  },
  sig(d) { return JSON.stringify([d.plan && [d.plan.id, d.plan.title, d.plan.file_url, d.plan.notes], d.fields.map(f => f.id), d.values.map(v => [v.field_id, v.value]), d.week]); },
  // Zeichnet sofort aus dem Speicher und noch einmal, falls sich online etwas geändert hat
  async withData(live, draw) {
    const old = this.cached();
    if (old) draw(old);
    let d;
    try { d = await this.fresh(); }
    catch (e) { if (old) { console.warn('Aktualisieren fehlgeschlagen', e); return; } throw e; }
    if (live() && (!old || this.sig(old) !== this.sig(d))) draw(d);
  },

  // Umschalter im Reiter Plan: PDF ↔ Videos zu den Übungen im Plan
  planTabs(on) {
    return `<div class="seg"><a href="#/plan" class="${on === 'plan' ? 'on' : ''}">Plan</a><a href="#/plan/videos" class="${on === 'videos' ? 'on' : ''}">Videos zum Plan</a></div>`;
  },

  /* ---------- Videos zum Plan: Abgleich Übungen in der PDF ↔ Video-Datenbank ---------- */
  async planVideos(view, live) {
    const { plan } = this.cached() || await this.fresh();
    if (!live()) return;
    if (!plan || !plan.file_url) { location.hash = '#/plan'; return; }
    view.innerHTML = `<div class="page narrow">
      <header class="page-head"><div><h1>${esc(plan.title)}</h1></div></header>
      ${this.planTabs('videos')}
      <div id="pv"><div class="spinner"></div></div>
    </div>`;
    const [videos, exercises] = await Promise.all([
      this.videoList(),
      PlanVideos.exercises(plan.file_url),
    ]);
    if (!live()) return;
    const hits = PlanVideos.match(exercises, videos).filter(m => m.video);
    $('#pv').innerHTML = hits.length
      ? `<div class="content-list">${hits.map(m => `<article class="card content-card">
          <div class="cc-head"><h3>${esc(m.name)}</h3></div>
          <button class="chip-btn" data-video="${esc(m.video.url)}" data-title="${esc(m.video.title)}">${icon('play')} ${esc(m.video.title)}</button>
        </article>`).join('')}</div>`
      : `<section class="card empty">${icon('play', 'big')}<p class="muted">Zu den Übungen in deinem Plan gibt es noch keine Videos.</p></section>`;
    bindContent(view);
  },

  /* ---------- Plan: die PDF von Alex, Kreuze und Gewichte direkt eintragen ---------- */
  async plan(view, live) {
    await this.withData(live, d => this.drawPlan(view, d));
  },

  drawPlan(view, { plan, fields, values: vals }) {
    if (!plan || !plan.file_url) {
      const first = String(App.me.name || '').split(' ')[0];
      view.innerHTML = `<div class="page narrow"><header class="page-head"><h1>Plan</h1></header>
        <section class="card empty">${icon('file', 'big')}<h2>Dein Plan kommt gleich</h2><p class="muted">Alex lädt deinen Trainingsplan hier hoch. Sobald er da ist, kannst du ihn direkt ausfüllen.</p></section></div>`;
      return;
    }
    view.innerHTML = `<div class="page pdf-page-wrap">
      <header class="page-head">
        <div><h1>${esc(plan.title)}</h1></div>
        <span class="save-state" id="save-state"></span>
      </header>
      ${this.planTabs('plan')}
      <div id="pdf-box" class="pdf-box"></div>
    </div>`;
    const saveState = $('#save-state');
    PdfView.mount($('#pdf-box'), plan.file_url, {
      mode: 'fill', fields, values: Object.fromEntries(vals.map(v => [v.field_id, v.value])),
      onValue: async (f, value) => {
        saveState.textContent = 'Speichert …';
        saveState.className = 'save-state';
        try {
          const updated_at = new Date().toISOString();
          await DB.upsert('pdf_values', { field_id: f.id, player_id: this.pid(), value, updated_at }, 'field_id,player_id');
          // Gerätespeicher mitziehen, damit beim nächsten Öffnen der neue Wert sofort da ist
          const s = this.cached();
          if (s) { s.values = s.values.filter(v => v.field_id !== f.id).concat({ field_id: f.id, value, updated_at }); this.keep(s); }
          saveState.textContent = 'Gespeichert';
          saveState.className = 'save-state ok';
        } catch (x) {
          saveState.textContent = 'Nicht gespeichert';
          saveState.className = 'save-state bad';
          toast(friendlyAuthError(x), 'err');
        }
      },
    }).catch(x => { const box = $('#pdf-box', view); if (box) box.innerHTML = `<p class="err-box">${esc(friendlyAuthError(x))}</p>`; });
  },

  // Video-Liste: letzter Stand sofort, frischer Stand im Hintergrund
  async videoList(onFresh) {
    const key = 'athletik:videos';
    let old = null;
    try { old = JSON.parse(localStorage.getItem(key)); } catch {}
    const load = DB.list('content', { section: 'videos' }, { order: 'sort,-created_at' }).then(list => {
      try { localStorage.setItem(key, JSON.stringify(list)); } catch {}
      if (onFresh && old && JSON.stringify(old) !== JSON.stringify(list)) onFresh(list);
      return list;
    });
    if (old) { load.catch(e => console.warn(e)); return old; }
    return load;
  },

  /* ---------- Trainingsvideos ---------- */
  async videos(view, live) {
    const draw = items => { if (live()) this.drawVideos(view, items); };
    draw(await this.videoList(draw));
  },

  drawVideos(view, items) {
    view.innerHTML = `<div class="page narrow">
      <header class="page-head"><div><h1>Trainingsvideos</h1></div></header>
      <section class="card upload-card">
        <h2>Video an Alex schicken</h2>
        <p class="muted small">Z. B. zur Technik-Kontrolle. Am besten kurz halten (max. ${MAX_UPLOAD_MB} MB).</p>
        <form class="form" id="my-up">
          <input name="title" placeholder="Worum geht's? z. B. Kniebeuge Satz 3">
          <label class="btn block upload-btn">${icon('upload')} <span class="fname">Video auswählen</span><input type="file" name="file" accept="video/*" hidden></label>
          <button class="btn primary block" type="submit" disabled>Senden</button>
        </form>
        <div id="my-videos"></div>
      </section>
      ${items.length ? videoGroups(items, c => contentCard(c)) : `<section class="card empty">${icon('play', 'big')}<p class="muted">Hier ist noch nichts – Alex lädt bald Videos hoch.</p></section>`}
    </div>`;
    bindContent(view);
    this.bindUpload(view);
  },

  /* ---------- Eigene Videos an Alex ---------- */
  async drawMyVideos(view) {
    const box = $('#my-videos', view);
    if (!box) return;
    const list = await DB.list('player_videos', { player_id: this.pid() }, { order: '-created_at', limit: 20 }).catch(() => []);
    if (!box.isConnected) return;
    box.innerHTML = list.length ? `<h3 class="group-title">Deine Videos</h3><ul class="my-videos">${list.map(v => `<li>
        <button class="chip-btn" data-video="${esc(v.url)}" data-title="${esc(v.title || 'Dein Video')}">${icon('play')} ${esc(v.title || 'Video')}</button>
        <span class="muted small">${Dates.short(v.created_at)}${v.coach_seen ? ' · von Alex angesehen' : ''}</span></li>`).join('')}</ul>` : '';
    bindContent(box);
  },

  bindUpload(view) {
    const f = $('#my-up', view);
    if (!f) return;
    const inp = f.elements.file, btn = f.querySelector('[type=submit]');
    inp.onchange = () => {
      const file = inp.files[0];
      if (file && file.size > MAX_UPLOAD_MB * 1048576) { toast(`Das Video ist größer als ${MAX_UPLOAD_MB} MB – bitte kürzer aufnehmen.`, 'err'); inp.value = ''; }
      $('.fname', f).textContent = inp.files[0] ? inp.files[0].name : 'Video auswählen';
      btn.disabled = !inp.files[0];
    };
    f.onsubmit = async e => {
      e.preventDefault();
      const file = inp.files[0];
      if (!file) return;
      btn.disabled = true;
      btn.textContent = 'Wird hochgeladen …';
      try {
        const url = await DB.upload(`spieler/${this.pid()}/${uuid()}-${safeName(file.name)}`, file);
        await DB.insert('player_videos', { player_id: this.pid(), title: f.elements.title.value.trim() || null, url });
        toast('Video ist bei Alex angekommen');
        f.reset();
        $('.fname', f).textContent = 'Video auswählen';
        this.drawMyVideos(view);
      } catch (x) { toast(friendlyAuthError(x), 'err'); }
      btn.textContent = 'Senden';
      btn.disabled = !inp.files[0];
    };
    this.drawMyVideos(view);
  },
};

// Feste Rubriken der Trainingsvideos (Reihenfolge = Anzeige)
const VIDEO_CATS = ['Würfe und Sprünge', 'Prep', 'Krafttraining', 'Auxiliary', 'Bonus'];
// Videos nach Rubriken gruppiert anzeigen; Videos ohne Rubrik landen unter „Weitere“
function videoGroups(items, card) {
  const groups = [...VIDEO_CATS, 'Weitere'].map(cat => [cat, items.filter(c => (VIDEO_CATS.includes(c.category) ? c.category : 'Weitere') === cat)]);
  return groups.filter(([, list]) => list.length)
    .map(([cat, list]) => `<section><h2 class="group-title">${esc(cat)}</h2><div class="content-list">${list.map(card).join('')}</div></section>`).join('');
}

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
