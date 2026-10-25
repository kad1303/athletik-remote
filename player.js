'use strict';

/* ============================================================
   Spieler-Ansicht: Heute + Woche, Trainingstag (Gewichte, abhaken, Feedback),
   Videos, Bonus, Verlauf.
   ============================================================ */

const Player = {
  data: null,   // { player, plan, days, exercises }

  route(page) {
    return { heute: v => this.home(v), tag: (v, a, live) => this.day(v, a, live), videos: v => this.library(v, 'videos'), bonus: v => this.library(v, 'bonus'), verlauf: (v, a, live) => this.history(v, a, live) }[page];
  },

  pid() { return App.me.player_id; },

  async load() {
    const [player] = await DB.list('players', { id: this.pid() });
    const [plan] = await DB.list('plans', { player_id: this.pid(), active: true }, { order: '-created_at', limit: 1 });
    const days = plan ? await DB.list('plan_days', { plan_id: plan.id }, { order: 'sort' }) : [];
    const exercises = await DB.list('exercises', { day_id: days.map(d => d.id) }, { order: 'sort' });
    this.data = { player, plan, days, exercises };
    return this.data;
  },

  exercisesOf(dayId) { return this.data.exercises.filter(e => e.day_id === dayId); },

  // erledigt = Feedback abgeschickt oder alle Übungen abgehakt
  status(day, date, logs, feedback) {
    const total = this.exercisesOf(day.id).length;
    const done = new Set(logs.filter(l => l.day_id === day.id && l.date === date && l.done).map(l => l.exercise_id)).size;
    const fb = feedback.some(f => f.day_id === day.id && f.date === date);
    if (fb || (total && done >= total)) return { key: 'done', done, total };
    if (done) return { key: 'partial', done, total };
    return { key: date < Dates.today() ? 'missed' : 'open', done, total };
  },

  statusIcon(st) {
    if (st.key === 'done') return `<span class="st done" title="Erledigt">${icon('check')}</span>`;
    if (st.key === 'partial') return `<span class="st partial" title="Angefangen">${st.done}/${st.total}</span>`;
    if (st.key === 'missed') return '<span class="st missed" title="Nicht erledigt"></span>';
    return '<span class="st open"></span>';
  },

  /* ---------- Startseite ---------- */
  async home(view) {
    const { player, plan, days } = await this.load();
    const today = Dates.today();
    const week = Dates.week(today);
    const [logs, feedback, unread] = await Promise.all([
      DB.list('logs', { player_id: this.pid(), date: { gte: week[0], lte: week[6] } }),
      DB.list('feedback', { player_id: this.pid(), date: { gte: week[0], lte: week[6] } }),
      DB.list('feedback', { player_id: this.pid(), player_seen: false }),
    ]);
    const first = String(player?.name || App.me.name).split(' ')[0];

    if (!plan) {
      view.innerHTML = `<div class="page narrow"><header class="page-head"><h1>Hallo ${esc(first)}</h1></header>
        <section class="card empty">${icon('clock', 'big')}<h2>Dein Plan kommt gleich</h2><p class="muted">Alex stellt gerade deinen Trainingsplan zusammen. Sobald er fertig ist, siehst du ihn hier.</p></section></div>`;
      return;
    }

    let weekInfo = '';
    if (plan.start_date) {
      const wk = Math.floor(Dates.diffDays(plan.start_date, today) / 7) + 1;
      if (wk < 1) weekInfo = `startet ${Dates.short(plan.start_date)}`;
      else weekInfo = plan.weeks ? `Woche ${Math.min(wk, plan.weeks)} von ${plan.weeks}` : `Woche ${wk}`;
    }
    const todayWd = Dates.weekday(today);
    const todays = days.filter(d => d.weekday === todayWd);
    const flex = days.filter(d => !d.weekday);
    const fixed = days.filter(d => d.weekday);
    const next = fixed.map(d => ({ d, n: (d.weekday - todayWd + 7) % 7 || 7 })).sort((a, b) => a.n - b.n)[0];
    const planned = week.reduce((n, date) => n + fixed.filter(d => d.weekday === Dates.weekday(date)).length, 0);
    // Einheiten zählen auch, wenn sie an einem anderen Tag als geplant gemacht wurden
    const active = (d, date) => !['open', 'missed'].includes(this.status(d, date, logs, feedback).key);
    const doneCount = week.reduce((n, date) => n + days.filter(d => this.status(d, date, logs, feedback).key === 'done').length, 0);

    const todayCard = d => {
      const st = this.status(d, today, logs, feedback);
      const n = this.exercisesOf(d.id).length;
      return `<a class="today-card ${st.key}" href="#/tag/${d.id}/${today}">
        <div><span class="eyebrow">Heute dran</span><h2>${esc(d.title)}</h2><span class="muted">${plural(n, 'Übung', 'Übungen')}${st.key === 'partial' ? ` · ${st.done} erledigt` : ''}</span></div>
        <span class="go">${st.key === 'done' ? `${icon('check')} Erledigt` : st.key === 'partial' ? 'Weiter' : 'Los geht\'s'} ${icon('next')}</span></a>`;
    };

    view.innerHTML = `<div class="page narrow">
      <header class="page-head"><div><h1>Hallo ${esc(first)}</h1><p class="muted">${esc(plan.title)}${weekInfo ? ` · ${weekInfo}` : ''}</p></div>
        <div class="ring" style="--p:${planned ? Math.min(1, doneCount / planned) : 0}" title="Diese Woche erledigt"><span class="num">${doneCount}/${planned}</span></div></header>
      ${unread.length ? `<a class="notice" href="#/verlauf">${icon('msg')}<span><strong>Alex hat geantwortet</strong> auf ${unread.length === 1 ? 'dein Feedback' : `${unread.length} Feedbacks`}</span>${icon('next')}</a>` : ''}
      <p class="date-line">${Dates.long(today)}</p>
      ${todays.length ? todays.map(todayCard).join('') : `<section class="card rest"><h2>Heute: trainingsfrei</h2>
        <p class="muted">Regeneration gehört dazu.${next ? ` Nächste Einheit: <strong>${esc(next.d.title)}</strong> am ${WD_LONG[next.d.weekday - 1]}.` : ''}</p></section>`}

      <section class="card">
        <h2>Diese Woche</h2>
        <ol class="week">
          ${week.map(date => {
            const ds = fixed.filter(d => d.weekday === Dates.weekday(date));
            const extra = days.filter(d => !ds.includes(d) && active(d, date));
            return `<li class="${date === today ? 'is-today' : ''} ${date < today ? 'past' : ''}">
              <span class="wd"><strong>${WD[Dates.weekday(date) - 1]}</strong><span>${Dates.parse(date).getDate()}.</span></span>
              <div class="wd-items">${ds.length || extra.length ? [...ds, ...extra].map(d => `<a class="wd-item" href="#/tag/${d.id}/${date}">${this.statusIcon(this.status(d, date, logs, feedback))}<span>${esc(d.title)}</span></a>`).join('') : '<span class="muted small">frei</span>'}</div>
            </li>`;
          }).join('')}
        </ol>
      </section>

      ${flex.length ? `<section class="card"><h2>Jederzeit</h2><p class="muted small">Mach diese Einheiten, wann es in deine Woche passt.</p>
        <div class="flex-list">${flex.map(d => {
          const times = week.filter(date => this.status(d, date, logs, feedback).key === 'done').length;
          return `<a class="wd-item big" href="#/tag/${d.id}/${today}">${times ? `<span class="st done">${icon('check')}</span>` : '<span class="st open"></span>'}<span>${esc(d.title)}<small class="muted">${times ? ` · diese Woche ${times}×` : ''}</small></span>${icon('next')}</a>`;
        }).join('')}</div></section>` : ''}

      ${plan.notes ? `<section class="card note"><h2>Hinweise von Alex</h2><p>${richText(plan.notes)}</p></section>` : ''}
    </div>`;
  },

  /* ---------- Trainingstag ---------- */
  async day(view, [dayId, date = Dates.today()], live) {
    if (!this.data || !this.data.days.some(d => d.id === dayId)) await this.load();
    const day = this.data.days.find(d => d.id === dayId);
    if (!day) { view.innerHTML = '<div class="page narrow"><p class="err-box">Diesen Trainingstag gibt es nicht mehr.</p><a class="btn" href="#/heute">Zurück</a></div>'; return; }
    const exs = this.exercisesOf(day.id);
    const ids = exs.map(e => e.id);
    const [logs, prev, [fb]] = await Promise.all([
      DB.list('logs', { player_id: this.pid(), exercise_id: ids, date }),
      DB.list('logs', { player_id: this.pid(), exercise_id: ids, date: { lt: date } }, { order: '-date', limit: 300 }),
      DB.list('feedback', { player_id: this.pid(), day_id: day.id, date }),
    ]);
    if (!live()) return;
    const logOf = id => logs.find(l => l.exercise_id === id);
    const lastOf = id => prev.find(l => l.exercise_id === id && (l.sets || []).some(s => s.kg || s.reps));
    const state = Object.fromEntries(exs.map(e => {
      const l = logOf(e.id);
      const n = Math.max(e.sets || 1, (l?.sets || []).length);
      const sets = Array.from({ length: n }, (_, i) => ({ kg: l?.sets?.[i]?.kg || '', reps: l?.sets?.[i]?.reps || '' }));
      return [e.id, { sets, done: !!l?.done }];
    }));

    const repsHint = e => (String(e.reps || '').match(/\d+/) || [''])[0];
    const kgHint = (e, last, i) => last?.sets?.[i]?.kg || last?.sets?.[0]?.kg || (String(e.load || '').match(/^\s*([\d.,]+)\s*kg/i) || [])[1] || '';

    view.innerHTML = `<div class="page narrow">
      <header class="page-head sub-head">
        <a class="icon-btn" href="#/heute" aria-label="Zurück">${icon('back')}</a>
        <div><h1>${esc(day.title)}</h1>
          <label class="date-pick">${Dates.long(date)}<input type="date" id="day-date" value="${date}" max="${Dates.today()}"></label></div>
        <span class="save-state" id="save-state"></span>
      </header>
      <div class="progress"><div class="bar" id="bar"></div><span id="prog-text"></span></div>
      ${day.notes ? `<p class="card note">${richText(day.notes)}</p>` : ''}
      ${exs.length ? '' : '<p class="card muted">Für diesen Tag sind noch keine Übungen eingetragen.</p>'}
      ${exs.map((e, i) => {
        const last = lastOf(e.id);
        return `<article class="card ex" data-ex="${e.id}">
          <div class="ex-head">
            <span class="ex-num">${i + 1}</span>
            <div class="ex-title"><h3>${esc(e.name)}</h3>
              <p class="target">${esc(target(e))}${e.rest ? ` · Pause ${esc(e.rest)}` : ''}</p></div>
            <button class="check" data-check aria-pressed="${state[e.id].done}" aria-label="Erledigt">${icon('check')}</button>
          </div>
          ${e.notes ? `<p class="ex-notes">${richText(e.notes)}</p>` : ''}
          <div class="ex-tools">
            ${e.video_url ? `<button class="chip-btn" data-video="${esc(e.video_url)}" data-title="${esc(e.name)}">${icon('play')} Video</button>` : ''}
            <button class="chip-btn" data-fill title="Graue Vorschläge in leere Felder übernehmen">${icon('copy')} Vorschlag übernehmen</button>
          </div>
          ${last ? `<p class="last">Letztes Mal (${Dates.short(last.date)}): ${esc(setsText(last.sets))}</p>` : ''}
          <div class="sets">
            <div class="set-row head"><span>Satz</span><span>kg</span><span>Wdh</span></div>
            ${state[e.id].sets.map((s, si) => `<div class="set-row">
              <span class="set-no">${si + 1}</span>
              <input inputmode="decimal" data-set="${si}" data-f="kg" value="${esc(s.kg)}" placeholder="${esc(kgHint(e, last, si))}" aria-label="Satz ${si + 1} Gewicht">
              <input inputmode="numeric" data-set="${si}" data-f="reps" value="${esc(s.reps)}" placeholder="${esc(repsHint(e))}" aria-label="Satz ${si + 1} Wiederholungen">
            </div>`).join('')}
          </div>
        </article>`;
      }).join('')}

      <section class="card feedback" id="fb">
        <h2>Wie war's?</h2>
        <p class="muted small">Dein Feedback geht direkt an Alex.</p>
        <div class="rpe-label"><span>Anstrengung</span><strong id="rpe-text">${fb?.rpe ? `${fb.rpe} – ${RPE[fb.rpe]}` : 'bitte wählen'}</strong></div>
        <div class="rpe">${Array.from({ length: 10 }, (_, i) => `<button data-rpe="${i + 1}" class="${fb?.rpe === i + 1 ? 'on' : ''}" style="--h:${i}">${i + 1}</button>`).join('')}</div>
        <textarea id="fb-text" rows="3" placeholder="Wie hat es sich angefühlt? Schmerzen, Probleme, Fragen an Alex …">${esc(fb?.text || '')}</textarea>
        <button class="btn primary block" id="fb-send">${fb ? 'Feedback aktualisieren' : 'Training abschließen & senden'}</button>
        ${fb?.reply ? `<div class="reply"><span class="avatar sm">A</span><div><strong>Alex</strong> <span class="muted small">${Dates.stamp(fb.replied_at)}</span><p>${richText(fb.reply)}</p></div></div>` : ''}
      </section>
    </div>`;

    $('#day-date').onchange = e => { if (e.target.value) location.hash = `#/tag/${day.id}/${e.target.value}`; };

    const saveState = $('#save-state');
    const progress = () => {
      const done = exs.filter(e => state[e.id].done).length;
      $('#bar').style.width = exs.length ? `${(done / exs.length) * 100}%` : '0';
      $('#prog-text').textContent = `${done} von ${exs.length} erledigt`;
    };
    progress();
    const save = async (e) => {
      saveState.textContent = 'Speichert …';
      saveState.className = 'save-state';
      try {
        await DB.upsert('logs', { player_id: this.pid(), exercise_id: e.id, exercise_name: e.name, day_id: day.id, date, sets: state[e.id].sets, done: state[e.id].done }, 'player_id,exercise_id,date');
        saveState.textContent = 'Gespeichert';
        saveState.className = 'save-state ok';
      } catch (x) {
        saveState.textContent = 'Nicht gespeichert';
        saveState.className = 'save-state bad';
        toast(friendlyAuthError(x), 'err');
      }
    };
    const savers = Object.fromEntries(exs.map(e => [e.id, debounce(() => save(e), 700)]));

    $$('.ex', view).forEach(card => {
      const e = exs.find(x => x.id === card.dataset.ex);
      const st = state[e.id];
      const btn = card.querySelector('[data-check]');
      const setDone = v => { st.done = v; btn.setAttribute('aria-pressed', v); card.classList.toggle('is-done', v); progress(); };
      card.classList.toggle('is-done', st.done);
      btn.onclick = () => { setDone(!st.done); savers[e.id].flush(); };
      card.querySelectorAll('input[data-set]').forEach(inp => {
        inp.addEventListener('input', () => {
          st.sets[+inp.dataset.set][inp.dataset.f] = inp.value.trim().replace(',', '.');
          // Alle Sätze mit Wiederholungen ausgefüllt → automatisch abhaken
          if (!st.done && st.sets.every(s => s.reps)) setDone(true);
          savers[e.id]();
        });
      });
      // Vorschläge (grau) in alle leeren Felder übernehmen
      const fill = card.querySelector('[data-fill]');
      if (fill) fill.onclick = () => card.querySelectorAll('input[data-set]').forEach(inp => {
        if (!inp.value && inp.placeholder) { inp.value = inp.placeholder; inp.dispatchEvent(new Event('input')); }
      });
    });
    $$('[data-video]', view).forEach(b => b.onclick = () => Media.open(b.dataset.video, b.dataset.title));

    let rpe = fb?.rpe || null;
    $$('[data-rpe]', view).forEach(b => b.onclick = () => {
      rpe = +b.dataset.rpe;
      $$('[data-rpe]', view).forEach(x => x.classList.toggle('on', x === b));
      $('#rpe-text').textContent = `${rpe} – ${RPE[rpe]}`;
    });
    $('#fb-send').onclick = async () => {
      const text = $('#fb-text').value.trim();
      if (!rpe && !text) { toast('Bitte Anstrengung wählen oder kurz etwas schreiben.'); return; }
      const btn = $('#fb-send');
      btn.disabled = true;
      try {
        Object.values(savers).forEach(s => s.flush());
        await DB.upsert('feedback', { player_id: this.pid(), day_id: day.id, day_title: day.title, date, rpe, text }, 'player_id,day_id,date');
        toast('Danke! Feedback ist bei Alex.');
        location.hash = '#/heute';
      } catch (x) {
        toast(friendlyAuthError(x), 'err');
        btn.disabled = false;
      }
    };
  },

  /* ---------- Videos & Bonus ---------- */
  async library(view, section) {
    if (!this.data) await this.load();
    const items = await DB.list('content', { section }, { order: 'sort,-created_at' });
    const planVideos = section === 'videos' ? this.data.exercises.filter(e => e.video_url) : [];
    const groups = {};
    items.forEach(c => (groups[c.category || 'Allgemein'] = groups[c.category || 'Allgemein'] || []).push(c));
    const title = section === 'videos' ? 'Videos' : 'Bonus';
    const seen = new Set();
    view.innerHTML = `<div class="page narrow">
      <header class="page-head"><div><h1>${title}</h1><p class="muted">${section === 'videos' ? 'Technik, Aufwärmen und alle Übungen aus deinem Plan.' : 'Zusätzliche Inhalte von Alex – Ernährung, Regeneration, Extras.'}</p></div></header>
      ${planVideos.length ? `<section><h2 class="group-title">Aus deinem Plan</h2><div class="tiles">
        ${planVideos.filter(e => !seen.has(e.video_url) && seen.add(e.video_url)).map(e => `<button class="tile" data-video="${esc(e.video_url)}" data-title="${esc(e.name)}">${icon('play', 'tile-ic')}<strong>${esc(e.name)}</strong></button>`).join('')}
      </div></section>` : ''}
      ${Object.entries(groups).map(([cat, list]) => `<section><h2 class="group-title">${esc(cat)}</h2>
        <div class="content-list">${list.map(c => contentCard(c)).join('')}</div></section>`).join('')}
      ${!items.length && !planVideos.length ? `<section class="card empty">${icon(section === 'videos' ? 'play' : 'star', 'big')}<p class="muted">Hier ist noch nichts – Alex lädt bald Inhalte hoch.</p></section>` : ''}
    </div>`;
    bindContent(view);
  },

  /* ---------- Verlauf ---------- */
  async history(view, _, live) {
    const since = Dates.add(Dates.today(), -180);
    const [feedback, logs] = await Promise.all([
      DB.list('feedback', { player_id: this.pid() }, { order: '-date', limit: 40 }),
      DB.list('logs', { player_id: this.pid(), date: { gte: since } }, { order: 'date' }),
    ]);
    if (!live()) return;
    const byEx = {};
    logs.forEach(l => {
      const kgs = (l.sets || []).map(s => parseFloat(s.kg)).filter(x => !isNaN(x));
      if (!kgs.length) return;
      (byEx[l.exercise_name] = byEx[l.exercise_name] || []).push({ date: l.date, max: Math.max(...kgs), sets: l.sets });
    });
    const sessions = new Set(logs.filter(l => l.done).map(l => `${l.day_id}|${l.date}`)).size;
    view.innerHTML = `<div class="page narrow">
      <header class="page-head"><div><h1>Verlauf</h1><p class="muted">${plural(sessions, 'Einheit', 'Einheiten')} in den letzten 6 Monaten</p></div></header>
      <section class="card"><h2>Feedback & Antworten</h2>
        ${feedback.length ? `<ul class="fb-list">${feedback.map(f => `<li class="${f.reply && !f.player_seen ? 'new' : ''}">
          <div class="fb-meta"><strong>${esc(f.day_title || 'Training')}</strong><span class="muted small">${Dates.short(f.date)}${f.rpe ? ` · Anstrengung ${f.rpe}/10` : ''}</span></div>
          ${f.text ? `<p>${richText(f.text)}</p>` : ''}
          ${f.reply ? `<div class="reply"><span class="avatar sm">A</span><div><strong>Alex</strong>${!f.player_seen ? ' <span class="pill">neu</span>' : ''}<p>${richText(f.reply)}</p></div></div>` : ''}
        </li>`).join('')}</ul>` : '<p class="muted">Noch kein Feedback geschickt.</p>'}
      </section>
      <section class="card"><h2>Gewichte</h2>
        ${Object.keys(byEx).length ? `<div class="prog-list">${Object.entries(byEx).map(([name, list]) => {
          const best = Math.max(...list.map(x => x.max));
          const last = list[list.length - 1];
          return `<div class="prog"><div><strong>${esc(name)}</strong><span class="muted small">zuletzt ${Dates.short(last.date)}: ${esc(setsText(last.sets))}</span></div>
            ${sparkline(list.map(x => x.max))}<span class="best num">${String(best).replace('.', ',')} kg</span></div>`;
        }).join('')}</div>` : '<p class="muted">Sobald du Gewichte einträgst, siehst du hier deine Entwicklung.</p>'}
      </section>
    </div>`;
    const unseen = feedback.filter(f => f.reply && !f.player_seen);
    for (const f of unseen) await DB.update('feedback', f.id, { player_seen: true }).catch(() => {});
  },
};

function sparkline(vals) {
  if (vals.length < 2) return '<span class="spark"></span>';
  const w = 90, h = 28, min = Math.min(...vals), max = Math.max(...vals), r = max - min || 1;
  const pts = vals.map((v, i) => `${(i / (vals.length - 1)) * (w - 4) + 2},${h - 3 - ((v - min) / r) * (h - 6)}`).join(' ');
  const [lx, ly] = pts.split(' ').pop().split(',');
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/><circle cx="${lx}" cy="${ly}" r="2.5" fill="currentColor"/></svg>`;
}

// Inhalts-Karte (Videos/Bonus) – auch in der Trainer-Ansicht benutzt
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
