'use strict';

/* ============================================================
   Spieler-Ansicht (schlank): Start · Plan (PDF zum Ausfüllen) · Trainingsvideos · Profil.
   ============================================================ */

const PAGE_LOGO = '<img class="page-logo" src="icons/logo-skfb.png" alt="SK Fitness Base">';

const Player = {
  route(page) {
    return { start: (v, a, live) => this.home(v, live), plan: (v, a, live) => a[0] === 'videos' ? this.planVideos(v, live) : this.plan(v, a[0], live), videos: (v, a, live) => this.videos(v, live) }[page];
  },

  /* ---------- Start: Hallo, Woche Mo–Fr, Weg zum Plan ---------- */
  async home(view, live) {
    await this.withData(live, d => this.drawHome(view, d));
  },

  drawHome(view, { plans = [], values: vals, week: wp = [], fb = [] }) {
    const today = Dates.today();
    // Sonntags zeigt die Startseite schon die kommende Woche, sobald Alex sie eingetragen hat
    let ws = Dates.monday(today);
    const next = Dates.add(ws, 7);
    const showNext = Dates.weekday(today) === 7 && wp.some(r => r.week_start === next);
    if (showNext) ws = next;
    const partOf = d => (wp.find(r => r.week_start === Dates.monday(d) && r.weekday === Dates.weekday(d)) || {}).text || '';
    const week = Dates.week(ws);
    // Erledigt = Feedback gegeben oder etwas in den Plan eingetragen
    const active = new Set([...vals.filter(v => v.value).map(v => Dates.iso(new Date(v.updated_at))), ...fb.map(f => f.date)]);
    const fbToday = fb.find(f => f.date === today);
    const first = String(App.me.name || '').split(' ')[0];
    // Pläne schon im Hintergrund laden, damit der Reiter „Plan“ sofort da ist
    plans.forEach(pl => PdfView.load(pl.file_url).catch(() => {}));

    view.innerHTML = `<div class="page narrow">
      ${PAGE_LOGO}
      <header class="page-head"><div><h1>Hallo ${esc(first)}</h1><p class="muted">${Dates.long(today)}</p></div></header>
      <section class="card">
        <h2>${showNext ? 'Nächste Woche' : 'Diese Woche'}</h2>
        <ul class="wk-list">${week.map(d => `<li class="${d === today ? 'today' : ''} ${active.has(d) ? 'done' : ''}">
          <span class="wk-d"><strong>${WD[Dates.weekday(d) - 1]}</strong><small>${Dates.parse(d).getDate()}.${Dates.parse(d).getMonth() + 1}.</small></span>
          <span class="wk-t">${partOf(d) ? richText(partOf(d)) : '<span class="muted">–</span>'}</span>
          <span class="wk-c">${active.has(d) ? icon('check') : ''}</span></li>`).join('')}</ul>
      </section>
      ${plans.length ? plans.map((pl, i) => `<a class="start-card ${i ? 'second' : ''}" href="#/plan/${pl.id}">
          <span class="eyebrow">${i ? 'Weiterer Plan' : 'Dein Trainingsplan'}</span>
          <h2>${esc(pl.title)}</h2>
          <span class="go">${i ? 'Plan öffnen' : "Hier geht's zu deinem Trainingsplan"} ${icon('next')}</span>
        </a>`).join('')
        : `<section class="card empty">${icon('file', 'big')}<h2>Dein Plan kommt gleich</h2><p class="muted">Alex lädt deinen Trainingsplan hier hoch.</p></section>`}
      <section class="card fb-card">
        <h2>Einheit geschafft?</h2>
        ${fbToday ? `<p class="fb-done">${icon('check')} Feedback für heute gesendet${fbToday.duration_min ? ` · ${fbToday.duration_min} Min.` : ''}${fbToday.rpe != null ? ` · Intensität ${fbToday.rpe}/10` : ''}</p>` : '<p class="muted small">Nach jeder Einheit kurz Feedback an Alex: Dauer, Intensität und Kommentar.</p>'}
        <button class="btn ${fbToday ? '' : 'primary'} block" id="fb-open">${fbToday ? 'Weiteres Feedback geben' : 'Feedback geben'}</button>
      </section>
      ${plans.filter(pl => pl.notes).map(pl => `<section class="card note"><h2>Hinweis von Alex${plans.length > 1 ? ` · ${esc(pl.title)}` : ''}</h2><p>${richText(pl.notes)}</p></section>`).join('')}
    </div>`;
    $('#fb-open', view).onclick = () => this.feedbackSheet();
  },

  /* ---------- Feedback nach einer Einheit: Dauer, Intensität 0–10, Kommentar ---------- */
  feedbackSheet() {
    const today = Dates.today();
    // „Was hast du gemacht?“ aus Alex' Wochenplan für das gewählte Datum
    // Erst aus dem Gerätespeicher (diese + nächste Woche), sonst direkt aus der Datenbank
    const first = r => (r ? r.text.split('\n')[0].trim() : '');
    const partLocal = d => {
      const s = this.cached();
      return s && (s.week || []).find(x => x.week_start === Dates.monday(d) && x.weekday === Dates.weekday(d));
    };
    const partFor = async d => {
      const hit = partLocal(d);
      if (hit) return first(hit);
      const rows = await DB.list('week_plans', { player_id: this.pid(), week_start: Dates.monday(d), weekday: Dates.weekday(d) }, { select: 'text' }).catch(() => []);
      return first(rows[0]);
    };
    const part = first(partLocal(today));
    let rpe = null;
    const s = openSheet(`<h2>Feedback zur Einheit</h2>
      <form class="form" id="fbf">
        <div class="two">
          <label>Datum<input type="date" name="date" value="${today}" max="${today}" required></label>
          <label>Dauer (Minuten)<input type="number" name="dur" inputmode="numeric" min="1" max="600" placeholder="z. B. 60" required></label>
        </div>
        <label>Was hast du gemacht?<input name="part" value="${esc(part)}" placeholder="${part ? '' : 'Laut Wochenplan nichts – bitte eintragen'}"></label>
        <div class="rpe-label"><span>Intensität</span><strong id="rpe-text">bitte wählen</strong></div>
        <div class="rpe rpe11">${Array.from({ length: 11 }, (_, i) => `<button type="button" data-rpe="${i}" style="--h:${i}">${i}</button>`).join('')}</div>
        <label>Kommentar (freiwillig)<textarea name="text" rows="3"></textarea></label>
        <button class="btn primary block" type="submit">Feedback senden</button>
      </form>`);
    const partInp = $('[name=part]', s);
    let edited = false;
    partInp.oninput = () => { edited = true; };
    // Datum gewählt → Teil aus Alex' Wochenplan für diesen Tag eintragen (solange nicht selbst geändert)
    let asked = '';
    const fill = async d => {
      if (edited || !d || d === asked) return;
      asked = d;
      const v = await partFor(d);
      if (edited || asked !== d) return;
      partInp.value = v;
      partInp.placeholder = v ? '' : 'Laut Wochenplan nichts – bitte eintragen';
    };
    const dateInp = $('[name=date]', s);
    dateInp.addEventListener('input', () => fill(dateInp.value));
    dateInp.addEventListener('change', () => { fill(dateInp.value); dateInp.blur(); });
    if (!part) { asked = ''; fill(today); }   // heute nicht im Gerätespeicher → nachschauen
    $$('[data-rpe]', s).forEach(b => b.onclick = () => {
      rpe = +b.dataset.rpe;
      $$('[data-rpe]', s).forEach(x => x.classList.toggle('on', x === b));
      $('#rpe-text', s).textContent = `${rpe} von 10`;
    });
    $('#fbf', s).onsubmit = async e => {
      e.preventDefault();
      const f = e.target.elements;
      if (rpe === null) { toast('Bitte die Intensität wählen.'); return; }
      const btn = e.target.querySelector('[type=submit]');
      btn.disabled = true;
      try {
        await DB.insert('feedback', { player_id: this.pid(), day_id: null, day_title: f.part.value.trim() || 'Training', date: f.date.value || today, duration_min: +f.dur.value || null, rpe, text: f.text.value.trim() });
        closeSheet();
        toast('Danke! Dein Feedback ist bei Alex.');
        this.snap = null;
        route();
      } catch (x) { toast(friendlyAuthError(x), 'err'); btn.disabled = false; }
    };
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
    let plans, values;
    // Wochenplan von Alex: diese und nächste Woche
    const mon = Dates.monday(Dates.today());
    const weekQ = DB.list('week_plans', { player_id: this.pid(), week_start: [mon, Dates.add(mon, 7)] }, { select: 'week_start,weekday,text' }).catch(() => []);
    // Eigenes Feedback seit Wochenbeginn (für Haken im Kalender)
    const fbQ = DB.list('feedback', { player_id: this.pid(), date: { gte: mon } }, { select: 'date,rpe,duration_min' }).catch(() => []);
    // Alle aktiven Pläne (ältester zuerst = Hauptplan), jeweils mit ihren Ausfüllfeldern
    if (DEMO) {
      plans = await DB.list('plans', { player_id: this.pid(), active: true }, { order: 'created_at' });
      for (const pl of plans) pl.fields = await DB.list('pdf_fields', { plan_id: pl.id });
      values = await DB.list('pdf_values', { player_id: this.pid() });
    } else {
      [plans, values] = await Promise.all([
        DB.list('plans', { player_id: this.pid(), active: true }, { order: 'created_at', select: '*,pdf_fields(id,page,kind,x,y,w,h)' }),
        DB.list('pdf_values', { player_id: this.pid() }, { select: 'field_id,value,updated_at' }),
      ]);
      plans.forEach(pl => { pl.fields = pl.pdf_fields || []; delete pl.pdf_fields; });
    }
    plans = plans.filter(pl => pl.file_url);
    const ids = new Set(plans.flatMap(pl => pl.fields.map(f => f.id)));
    const week = (await weekQ).map(r => ({ week_start: r.week_start, weekday: r.weekday, text: r.text }));
    const fb = (await fbQ).map(f => ({ date: f.date, rpe: f.rpe, duration_min: f.duration_min }));
    const d = { plans, week, fb, values: values.filter(v => ids.has(v.field_id)).map(v => ({ field_id: v.field_id, value: v.value, updated_at: v.updated_at })) };
    this.keep(d);
    return d;
  },
  sig(d) { return JSON.stringify([(d.plans || []).map(pl => [pl.id, pl.title, pl.file_url, pl.notes, pl.fields.length]), d.values.map(v => [v.field_id, v.value]), d.week, d.fb]); },
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
  // Umschalter im Reiter Plan: jeder aktive Plan + „Videos zum Plan“
  planTabs(on, plans = []) {
    const tabs = plans.length > 1 ? plans.map(pl => `<a href="#/plan/${pl.id}" class="${on === pl.id ? 'on' : ''}">${esc(pl.title)}</a>`).join('') : `<a href="#/plan" class="${on !== 'videos' ? 'on' : ''}">Plan</a>`;
    return `<div class="seg plan-seg">${tabs}<a href="#/plan/videos" class="${on === 'videos' ? 'on' : ''}">Videos zum Plan</a></div>`;
  },

  /* ---------- Videos zum Plan: Abgleich Übungen in der PDF ↔ Video-Datenbank ---------- */
  async planVideos(view, live) {
    const { plans = [] } = this.cached() || await this.fresh();
    if (!live()) return;
    if (!plans.length) { location.hash = '#/plan'; return; }
    view.innerHTML = `<div class="page narrow">
      <header class="page-head"><div><h1>Videos zum Plan</h1></div></header>
      ${this.planTabs('videos', plans)}
      <div id="pv"><div class="spinner"></div></div>
    </div>`;
    const [videos, exercises] = await Promise.all([
      this.videoList(),
      Promise.all(plans.map(pl => PlanVideos.exercises(pl.file_url))).then(l => [...new Set(l.flat())]),
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
  async plan(view, id, live) {
    await this.withData(live, d => this.drawPlan(view, d, id));
  },

  drawPlan(view, { plans = [], values: vals }, id) {
    // gewählter Plan (sonst zuletzt angesehener, sonst Hauptplan)
    let last = null;
    try { last = sessionStorage.getItem('athletik:plan'); } catch {}
    const plan = plans.find(pl => pl.id === id) || plans.find(pl => pl.id === last) || plans[0];
    if (plan) try { sessionStorage.setItem('athletik:plan', plan.id); } catch {}
    const fields = plan ? plan.fields : [];
    if (!plan) {
      const first = String(App.me.name || '').split(' ')[0];
      view.innerHTML = `<div class="page narrow"><header class="page-head"><h1>Plan</h1></header>
        <section class="card empty">${icon('file', 'big')}<h2>Dein Plan kommt gleich</h2><p class="muted">Alex lädt deinen Trainingsplan hier hoch. Sobald er da ist, kannst du ihn direkt ausfüllen.</p></section></div>`;
      return;
    }
    view.innerHTML = `<div class="page pdf-page-wrap">
      <header class="page-head">
        <div><h1>${esc(plan.title)}</h1></div>
        <span class="save-state" id="save-state"></span>
        <button class="btn small primary" id="fb-open">Feedback geben</button>
      </header>
      ${this.planTabs(plans.length > 1 ? plan.id : 'plan', plans)}
      <div id="pdf-box" class="pdf-box"></div>
    </div>`;
    const saveState = $('#save-state');
    $('#fb-open', view).onclick = () => this.feedbackSheet();
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
    view.innerHTML = `<div class="page videos-page">
      <header class="page-head"><div><h1>Trainingsvideos</h1></div></header>
      <div class="videos-main">
      ${videoGroups(items, c => contentCard(c), true, true)}
      </div>
      <section class="card upload-card">
        <h2>Video an Alex schicken</h2>
        <p class="muted small">Z. B. zur Technik-Kontrolle. Am besten kurz halten (max. ${MAX_UPLOAD_MB} MB).</p>
        <form class="form" id="my-up">
          <label>Kommentar<textarea name="title" rows="2"></textarea></label>
          <label class="btn block upload-btn">${icon('upload')} <span class="fname">Video auswählen</span><input type="file" name="file" accept="video/*" hidden></label>
          <button class="btn primary block" type="submit" disabled>Senden</button>
        </form>
        <div id="my-videos"></div>
      </section>
    </div>`;
    bindContent(view);
    bindGroups(view);
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
// showEmpty: alle fünf Rubriken zeigen, auch ohne Videos
// folded: Rubriken zugeklappt, Klick auf die Überschrift öffnet sie.
// Welche offen sind, merkt sich das Gerät bis zum Schließen der App.
const OPEN_KEY = 'athletik:vopen';
function openGroups() { try { return JSON.parse(sessionStorage.getItem(OPEN_KEY)) || []; } catch { return []; } }
function videoGroups(items, card, showEmpty = false, folded = false) {
  const groups = [...VIDEO_CATS, 'Weitere'].map(cat => [cat, items.filter(c => (VIDEO_CATS.includes(c.category) ? c.category : 'Weitere') === cat)]);
  const open = openGroups();
  return groups.filter(([cat, list]) => list.length || (showEmpty && cat !== 'Weitere'))
    .map(([cat, list]) => {
      const inner = list.length ? `<div class="content-list">${list.map(card).join('')}</div>` : '<p class="card muted small empty-cat">Noch keine Videos.</p>';
      if (!folded) return `<section><h2 class="group-title">${esc(cat)}</h2>${inner}</section>`;
      return `<details class="vgroup" data-cat="${esc(cat)}" ${open.includes(cat) ? 'open' : ''}>
        <summary><span>${esc(cat)}</span><span class="pill">${list.length}</span>${icon('down')}</summary>${inner}</details>`;
    }).join('');
}
function bindGroups(root) {
  $$('details.vgroup', root).forEach(d => d.addEventListener('toggle', () => {
    const open = $$('details.vgroup[open]', root).map(x => x.dataset.cat);
    try { sessionStorage.setItem(OPEN_KEY, JSON.stringify(open)); } catch {}
  }));
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
