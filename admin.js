'use strict';

/* ============================================================
   Trainer-Ansicht (Alex): Spieler, Spieler-Detail, Plan-Editor,
   Feedback beantworten, Trainingsvideos.
   ============================================================ */

const MAX_UPLOAD_MB = 50;   // Grenze im kostenlosen Supabase-Tarif

const Admin = {
  route(page) {
    return {
      spieler: (v, a, live) => a[0] ? this.player(v, a[0], live) : this.players(v, live),
      plan: (v, a, live) => this.editor(v, a[0], live),
      woche: (v, a, live) => this.week(v, a[0], live),
      pdf: (v, a, live) => this.pdfFilled(v, a[0], live),
      feedback: (v, a, live) => this.feedback(v, live),
      plaene: (v, a, live) => this.templates(v, live),
      inhalte: (v, a, live) => this.content(v, 'videos', live),
    }[page];
  },

  async refreshBadge() {
    try {
      const rows = await DB.list('feedback', { coach_seen: false }, { select: 'id' });
      App.badge = rows.length;
      const b = $('#fb-badge');
      if (b) { b.textContent = rows.length; b.hidden = !rows.length; }
    } catch (e) { console.warn(e); }
  },

  /* ---------- Spielerliste ---------- */
  async players(view, live) {
    await swr('spieler', async () => {
      const [players, plans, invites, vals, newVids, newFb] = await Promise.all([
        DB.list('players', {}, { order: 'name' }),
        DB.list('plans', { active: true, player_id: { not: 'is.null' } }, { select: 'id,player_id,title,file_url' }),
        DB.list('invites', { used_at: null, role: 'player' }, { select: 'player_id' }),
        // Letzter Eintrag in der Plan-PDF je Spieler
        DB.list('pdf_values', {}, { select: 'player_id,updated_at', order: '-updated_at', limit: 1000 }),
        DB.list('player_videos', { coach_seen: false }, { select: 'id,player_id,title,created_at', order: '-created_at' }).catch(() => []),
        DB.list('feedback', { coach_seen: false }, { select: 'id,player_id,date,day_title,rpe,duration_min,text', order: '-date' }).catch(() => []),
      ]);
      return { players, plans, invites, vals, newVids, newFb };
    }, d => this.drawPlayers(view, d), live);
  },

  drawPlayers(view, { players, plans, invites, vals, newVids = [], newFb = [] }) {
    const nameOf = id => (players.find(p => p.id === id) || {}).name || 'Spieler';
    const active = players.filter(p => p.active);
    const archived = players.filter(p => !p.active);

    const card = p => {
      const pp = plans.filter(x => x.player_id === p.id);
      const plan = pp[0];
      const last = vals.find(v => v.player_id === p.id);
      const access = p.user_id ? '' : invites.some(i => i.player_id === p.id) ? '<span class="pill warn">Einladung offen</span>' : '<span class="pill">Kein Zugang</span>';
      const planText = !plan ? '<span class="warn-text">kein aktiver Plan</span>' : pp.map(x => `${esc(x.title)}${x.file_url ? '' : ' (<span class="warn-text">ohne PDF</span>)'}`).join(' · ');
      return `<a class="card player-card" href="#/spieler/${p.id}">
        <span class="avatar">${esc(initials(p.name))}</span>
        <div class="pc-main">
          <div class="pc-name"><strong>${esc(p.name)}</strong>${newFb.some(v => v.player_id === p.id) ? '<span class="pill accent">neues Feedback</span>' : ''}${newVids.some(v => v.player_id === p.id) ? '<span class="pill accent">neues Video</span>' : ''}${access}</div>
          <span class="muted small">${esc(p.sport || '')}${p.sport ? ' · ' : ''}${planText}</span>
          <span class="small muted">${last ? `zuletzt eingetragen ${Dates.relative(last.updated_at.slice(0, 10))}` : 'noch nichts eingetragen'}</span>
        </div>${icon('next')}</a>`;
    };

    view.innerHTML = `<div class="page">
      <header class="page-head"><div><h1>Spieler</h1><p class="muted">${plural(active.length, 'aktiver Spieler', 'aktive Spieler')}</p></div>
        <button class="btn primary" id="add">${icon('plus')} Spieler</button></header>
      ${newFb.length || newVids.length ? `<section class="card inbox">
        <h2>Neu von den Spielern</h2>
        <ul class="inbox-list">
          ${newFb.map(f => `<li><a href="#/spieler/${f.player_id}">${icon('msg')}<span><strong>${esc(nameOf(f.player_id))}</strong> · Feedback ${Dates.short(f.date)}${f.day_title && f.day_title !== 'Training' ? ` (${esc(f.day_title)})` : ''}<small class="muted">${[f.duration_min ? `${f.duration_min} Min.` : '', f.rpe != null ? `Intensität ${f.rpe}/10` : '', f.text ? esc(f.text.slice(0, 80)) + (f.text.length > 80 ? ' …' : '') : ''].filter(Boolean).join(' · ')}</small></span>${icon('next')}</a></li>`).join('')}
          ${newVids.map(v => `<li><a href="#/spieler/${v.player_id}">${icon('play')}<span><strong>${esc(nameOf(v.player_id))}</strong> · Video ${Dates.short(v.created_at)}<small class="muted">${esc(v.title || 'ohne Kommentar')}</small></span>${icon('next')}</a></li>`).join('')}
        </ul>
      </section>` : ''}
      <div class="player-grid">${active.map(card).join('') || '<section class="card empty"><p class="muted">Noch keine Spieler. Leg den ersten an und schick ihm den Einladungslink per WhatsApp.</p></section>'}</div>
      ${archived.length ? `<details class="archive"><summary>Archiv (${archived.length})</summary><div class="player-grid">${archived.map(card).join('')}</div></details>` : ''}
    </div>`;
    $('#add').onclick = () => this.addPlayer();
  },

  async addPlayer() {
    const templates = await DB.list('plans', { player_id: null }, { order: 'title' });
    const s = openSheet(`<h2>Neuer Spieler</h2>
      <form class="form" id="np">
        <label>Name<input name="pname" required autocomplete="off"></label>
        <label>Sportart<input name="sport" value="Tennis" list="sports"></label>
        <datalist id="sports"><option>Tennis</option><option>Fußball</option><option>Padel</option><option>Leichtathletik</option></datalist>
        <label>Notizen (sieht nur der Trainer)<textarea name="notes" rows="2"></textarea></label>
        ${templates.length ? `<label>Startplan<select name="tpl"><option value="">– leer, mache ich selbst –</option>${templates.map(t => `<option value="${t.id}">${esc(t.title)}</option>`).join('')}</select></label>` : ''}
        <button class="btn primary block" type="submit">Anlegen & Einladungslink erzeugen</button>
      </form>`);
    s.querySelector('#np').onsubmit = async e => {
      e.preventDefault();
      const f = e.target.elements;
      e.target.querySelector("[type=submit]").disabled = true;
      try {
        const player = await DB.insert('players', { name: f.pname.value.trim(), sport: f.sport.value.trim(), notes: f.notes.value.trim(), active: true });
        if (f.tpl && f.tpl.value) await this.copyPlan(f.tpl.value, player.id, { start_date: Dates.monday(Dates.add(Dates.today(), 7)) });
        const code = newCode();
        await DB.insert('invites', { code, role: 'player', name: player.name, player_id: player.id });
        closeSheet();
        location.hash = `#/spieler/${player.id}`;
        setTimeout(() => showInvite(player.name, code), 300);
      } catch (x) { toast(friendlyAuthError(x), 'err'); e.target.querySelector("[type=submit]").disabled = false; }
    };
  },

  /* ---------- Spieler-Detail ---------- */
  async player(view, id, live) {
    await swr(`spieler:${id}`, async () => {
      const [[p], plans, invites] = await Promise.all([
        DB.list('players', { id }),
        DB.list('plans', { player_id: id }, { order: '-created_at' }),
        DB.list('invites', { player_id: id, used_at: null }, { order: '-created_at' }),
      ]);
      return { p: p || null, plans, invites };
    }, d => { this.drawPlayer(view, d); this.drawPlayerFeedback(view, id).then(() => this.drawPlayerVideos(view, id)); }, live);
  },

  // Feedback nach Einheiten (Dauer, Intensität 0–10, Kommentar); beim Ansehen als gelesen markieren
  async drawPlayerFeedback(view, id) {
    const list = await DB.list('feedback', { player_id: id }, { order: '-date,-created_at', limit: 30 }).catch(() => []);
    const anchor = $('#access', view);
    if (!anchor || !anchor.isConnected) return;
    $('#pfb', view)?.remove();
    const hot = r => r >= 9 ? 'hot' : r >= 7 ? 'warm' : '';
    anchor.insertAdjacentHTML('beforebegin', `<section class="card" id="pfb"><h2>Feedback zu Einheiten</h2>
      ${list.length ? `<ul class="fb-list">${list.map(f => `<li class="${f.coach_seen ? '' : 'new'}">
        <div class="fb-meta"><strong>${Dates.short(f.date)}</strong>${f.day_title ? `<span class="muted small">${esc(f.day_title)}</span>` : ''}
          ${f.duration_min ? `<span class="pill">${f.duration_min} Min.</span>` : ''}${f.rpe != null ? `<span class="pill ${hot(f.rpe)}">Intensität ${f.rpe}/10</span>` : ''}${f.coach_seen ? '' : '<span class="pill accent">neu</span>'}</div>
        ${f.text ? `<p>${richText(f.text)}</p>` : ''}</li>`).join('')}</ul>` : '<p class="muted">Noch kein Feedback.</p>'}
    </section>`);
    const unseen = list.filter(f => !f.coach_seen);
    if (unseen.length) Promise.all(unseen.map(f => DB.update('feedback', f.id, { coach_seen: true }))).catch(() => {});
  },

  // Videos, die der Spieler an Alex geschickt hat (neu = noch nicht angesehen)
  async drawPlayerVideos(view, id) {
    const list = await DB.list('player_videos', { player_id: id }, { order: '-created_at', limit: 30 }).catch(() => []);
    const anchor = $('#access', view);
    if (!anchor || !anchor.isConnected || !list.length) return;
    $('#pvids', view)?.remove();
    anchor.insertAdjacentHTML('beforebegin', `<section class="card" id="pvids"><h2>Videos vom Spieler</h2>
      <ul class="my-videos">${list.map(v => `<li class="${v.coach_seen ? '' : 'new'}">
        <button class="chip-btn" data-pv="${v.id}" data-video="${esc(v.url)}" data-title="${esc(v.title || 'Video')}">${icon('play')} ${esc(v.title || 'Video')}</button>
        <span class="muted small">${Dates.short(v.created_at)}</span>${v.coach_seen ? '' : '<span class="pill accent">neu</span>'}</li>`).join('')}</ul></section>`);
    $$('#pvids [data-video]', view).forEach(b => b.onclick = async () => {
      Media.open(b.dataset.video, b.dataset.title);
      const v = list.find(x => x.id === b.dataset.pv);
      if (v && !v.coach_seen) {
        v.coach_seen = true;
        b.closest('li').classList.remove('new');
        b.closest('li').querySelector('.pill')?.remove();
        DB.update('player_videos', v.id, { coach_seen: true }).catch(() => {});
      }
    });
  },

  drawPlayer(view, { p, plans, invites }) {
    if (!p) { view.innerHTML = '<div class="page"><p class="err-box">Spieler nicht gefunden.</p></div>'; return; }
    const actives = plans.filter(x => x.active);

    const access = p.user_id
      ? `<p><span class="pill ok">Hat Zugang</span></p><p class="muted small">Passwort vergessen oder neues Handy ohne Login? Zugang zurücksetzen – Einträge bleiben erhalten, ${esc(p.name.split(' ')[0])} bekommt einen neuen Link.</p>
         <div class="row-btns"><button class="btn" data-act="reset">Zugang zurücksetzen</button></div>`
      : invites.length
        ? `<p><span class="pill warn">Einladung offen</span> <span class="muted small">seit ${Dates.short(invites[0].created_at)}</span></p>
           <div class="row-btns"><button class="btn primary" data-act="show-invite">${icon('wa')} Link senden</button><button class="btn" data-act="new-invite">Neuer Link</button></div>`
        : `<p><span class="pill">Kein Zugang</span></p><div class="row-btns"><button class="btn primary" data-act="new-invite">Einladungslink erzeugen</button></div>`;

    view.innerHTML = `<div class="page narrow">
      <header class="page-head sub-head">
        <a class="icon-btn" href="#/spieler" aria-label="Zurück">${icon('back')}</a>
        <span class="avatar lg">${esc(initials(p.name))}</span>
        <div><h1>${esc(p.name)}</h1><p class="muted">${esc(p.sport || '')}${p.active ? '' : ' · archiviert'}</p></div>
        <button class="icon-btn" data-act="edit" aria-label="Spieler bearbeiten">${icon('edit')}</button>
      </header>
      ${p.notes ? `<p class="card note">${richText(p.notes)}</p>` : ''}
      <section class="card">
        <div class="card-head"><h2>${actives.length > 1 ? 'Trainingspläne' : 'Trainingsplan'}</h2><button class="btn small" data-act="new-plan">${icon('plus')} Neuer Plan</button></div>
        ${actives.length ? actives.map(plan => `<div class="plan-item">
            <a class="plan-box" href="#/plan/${plan.id}">
              <div><strong>${esc(plan.title)}${plan.file_url ? ' <span class="pill">PDF</span>' : ''}</strong></div>
              <span class="btn small">${icon('edit')} Bearbeiten</span></a>
            <div class="row-btns">${plan.file_url ? `<a class="btn small" href="#/pdf/${plan.id}">${icon('file')} Ausgefüllte PDF ansehen</a>` : '<span class="muted small">Noch keine PDF – der Spieler sieht den Plan erst mit PDF.</span>'}<button class="btn small ghost" data-act="archive" data-id="${plan.id}">Zu „Frühere Pläne“</button></div>
          </div>`).join('')
        : '<p class="muted">Noch kein aktiver Plan.</p>'}
        ${plans.filter(x => !x.active).length ? `<details class="older"><summary>Frühere Pläne (${plans.filter(x => !x.active).length})</summary>
          ${plans.filter(x => !x.active).map(x => `<div class="older-row"><a href="#/plan/${x.id}">${esc(x.title)}</a><span class="muted small">${Dates.short(x.created_at)}</span><button class="btn small" data-act="activate" data-id="${x.id}">Aktivieren</button><button class="icon-btn sm" data-act="delete-plan" data-id="${x.id}" aria-label="Plan löschen" title="Plan löschen">${icon('trash')}</button></div>`).join('')}
        </details>` : ''}
      </section>
      <section class="card" id="access">
        <div class="card-head"><h2>Zugang</h2></div>
        ${access}
      </section>
    </div>`;

    view.onclick = async e => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const act = b.dataset.act;
      try {
        if (act === 'edit') this.editPlayer(p);
        if (act === 'new-plan') this.newPlan(p, plans);
        if (act === 'show-invite') showInvite(p.name, invites[0].code);
        if (act === 'new-invite') {
          await DB.remove('invites', { player_id: p.id, used_at: null });
          const code = newCode();
          await DB.insert('invites', { code, role: 'player', name: p.name, player_id: p.id });
          await route();
          showInvite(p.name, code);
        }
        if (act === 'reset') {
          if (!(await confirmSheet(`Zugang von ${p.name} zurücksetzen? Das alte Login funktioniert danach nicht mehr.`, 'Zurücksetzen'))) return;
          await DB.rpc('reset_access', { p_player: p.id });
          const code = newCode();
          await DB.insert('invites', { code, role: 'player', name: p.name, player_id: p.id });
          await route();
          showInvite(p.name, code, `Hi ${p.name.split(' ')[0]}! Hier ist dein neuer Zugang zu Athletik Remote:`);
        }
        if (act === 'delete-plan') {
          const pl = plans.find(x => x.id === b.dataset.id);
          if (!pl || !(await confirmSheet(`Plan „${pl.title}“ endgültig löschen? Alles, was ${p.name.split(' ')[0]} darin eingetragen hat, ist danach weg.`))) return;
          await DB.remove('plans', { id: pl.id });
          // PDF aus der Ablage löschen, wenn kein anderer Plan sie noch nutzt
          if (pl.file_url && pl.file_url.startsWith('file:') && !(await DB.list('plans', { file_url: pl.file_url }, { select: 'id' })).length) await DB.removeFile(pl.file_url.slice(5));
          toast('Plan gelöscht');
          route();
        }
        if (act === 'archive') {
          await DB.update('plans', b.dataset.id, { active: false });
          toast('Plan liegt jetzt bei „Frühere Pläne“');
          route();
        }
        if (act === 'activate') {
          await DB.update('plans', b.dataset.id, { active: true });
          toast('Plan ist jetzt aktiv');
          route();
        }
      } catch (x) { toast(friendlyAuthError(x), 'err'); }
    };
  },

  editPlayer(p) {
    const s = openSheet(`<h2>${esc(p.name)} bearbeiten</h2>
      <form class="form" id="ep">
        <label>Name<input name="pname" value="${esc(p.name)}" required></label>
        <label>Sportart<input name="sport" value="${esc(p.sport || '')}"></label>
        <label>Notizen (sieht nur der Trainer)<textarea name="notes" rows="3">${esc(p.notes || '')}</textarea></label>
        <label class="check-line"><input type="checkbox" name="active" ${p.active ? 'checked' : ''}> Aktiv (sonst im Archiv)</label>
        <button class="btn primary block" type="submit">Speichern</button>
      </form>
      <button class="btn danger ghost block" id="del">${icon('trash')} Spieler endgültig löschen</button>`);
    s.querySelector('#ep').onsubmit = async e => {
      e.preventDefault();
      const f = e.target.elements;
      await DB.update('players', p.id, { name: f.pname.value.trim(), sport: f.sport.value.trim(), notes: f.notes.value.trim(), active: f.active.checked });
      closeSheet();
      route();
    };
    s.querySelector('#del').onclick = async () => {
      if (!(await confirmSheet(`${p.name} mit allen Plänen, Einträgen und Feedback löschen? Das lässt sich nicht rückgängig machen.`))) return;
      if (p.user_id) await DB.rpc('reset_access', { p_player: p.id });
      await DB.remove('players', { id: p.id });
      toast('Gelöscht');
      location.hash = '#/spieler';
    };
  },

  newPlan(p, plans) {
    const s = openSheet(`<h2>Neuer Plan für ${esc(p.name)}</h2>
      <form class="form" id="npf">
        <label>Name des Plans<input name="title" placeholder="z. B. Wintervorbereitung Block 2" required></label>
        <label class="btn block upload-btn">${icon('file')} <span class="fname">Plan als PDF hochladen</span><input type="file" name="pdf" accept="application/pdf,.pdf" hidden></label>
        <label class="check-line"><input type="checkbox" name="fill" checked> Spieler trägt etwas ein (Felder automatisch setzen)</label>
        ${plans.some(x => x.active) ? `<label class="check-line"><input type="checkbox" name="replace"> Bisherige Pläne ersetzen (wandern zu „Frühere Pläne“)</label>` : ''}
        <p class="muted small">Ohne Haken bei „ersetzen“ kommt der Plan zusätzlich dazu – der Spieler sieht dann alle aktiven Pläne.</p>
        <button class="btn primary block" type="submit">Plan anlegen</button>
      </form>`);
    const pdfInput = s.querySelector('input[name=pdf]');
    pdfInput.onchange = () => {
      const file = pdfInput.files[0];
      if (file && !checkPdf(file)) { pdfInput.value = ''; return; }
      s.querySelector('.fname').textContent = file ? file.name : 'Plan als PDF hochladen';
      const t = s.querySelector('input[name=title]');
      if (file && !t.value) t.value = file.name.replace(/\.pdf$/i, '');
    };
    s.querySelector('#npf').onsubmit = async e => {
      e.preventDefault();
      const f = e.target.elements;
      e.target.querySelector("[type=submit]").disabled = true;
      try {
        const over = { title: f.title.value.trim() };
        if (pdfInput.files[0]) {
          toast('PDF wird hochgeladen …');
          over.file_url = await DB.upload(`plaene/${uuid()}-${safeName(pdfInput.files[0].name)}`, pdfInput.files[0]);
        }
        if (f.replace && f.replace.checked) for (const x of plans.filter(x => x.active)) await DB.update('plans', x.id, { active: false });
        const plan = await DB.insert('plans', { player_id: p.id, active: true, notes: '', ...over });
        if (over.file_url && f.fill.checked) {
          toast('Felder werden erkannt …');
          const n = await this.autoFields(plan.id, over.file_url);
          toast(n ? `${plural(n, 'Feld', 'Felder')} automatisch gesetzt` : 'Plan angelegt – Felder bitte von Hand setzen');
        }
        closeSheet();
        location.hash = `#/plan/${plan.id}`;
      } catch (x) { toast(friendlyAuthError(x), 'err'); e.target.querySelector("[type=submit]").disabled = false; }
    };
  },

  // Ausfüllfelder auf einer frisch hochgeladenen PDF automatisch anlegen (nur wenn der Plan noch keine hat)
  async autoFields(planId, url) {
    try {
      if ((await DB.list('pdf_fields', { plan_id: planId }, { select: 'id' })).length) return 0;
      const found = await PdfView.detectUrl(url);
      if (found.length) await DB.insert('pdf_fields', found.map(f => ({ id: uuid(), plan_id: planId, ...f })));
      return found.length;
    } catch (x) {
      console.warn('Automatische Erkennung fehlgeschlagen', x);
      return 0;
    }
  },

  // Plan mit allen Tagen und Übungen kopieren (playerId null = als Vorlage)
  async copyPlan(srcId, playerId, over = {}) {
    const [src] = await DB.list('plans', { id: srcId });
    const days = await DB.list('plan_days', { plan_id: srcId }, { order: 'sort' });
    const exs = await DB.list('exercises', { day_id: days.map(d => d.id) }, { order: 'sort' });
    const plan = await DB.insert('plans', {
      id: uuid(), player_id: playerId, title: src.title, notes: src.notes || '', weeks: src.weeks, file_url: src.file_url || null,
      start_date: playerId ? src.start_date : null, active: true, ...over,
    });
    const map = {};
    const newDays = days.map(d => { map[d.id] = uuid(); return { id: map[d.id], plan_id: plan.id, weekday: d.weekday, title: d.title, notes: d.notes || '', sort: d.sort }; });
    if (newDays.length) await DB.insert('plan_days', newDays);
    const newExs = exs.map(e => ({ id: uuid(), day_id: map[e.day_id], sort: e.sort, name: e.name, sets: e.sets, reps: e.reps || '', load: e.load || '', rest: e.rest || '', notes: e.notes || '', video_url: e.video_url || '' }));
    if (newExs.length) await DB.insert('exercises', newExs);
    // Felder nur übernehmen, wenn die neue Kopie dieselbe PDF hat
    const fields = src.file_url && plan.file_url === src.file_url ? await DB.list('pdf_fields', { plan_id: srcId }) : [];
    if (fields.length) await DB.insert('pdf_fields', fields.map(f => ({ id: uuid(), plan_id: plan.id, page: f.page, kind: f.kind, x: f.x, y: f.y, w: f.w, h: f.h })));
    return plan;
  },

  /* ---------- Feedback ---------- */
  fbItem(f, name) {
    const hot = f.rpe >= 9 ? 'hot' : f.rpe >= 7 ? 'warm' : '';
    return `<li class="${f.coach_seen ? '' : 'new'}" data-fb="${f.id}">
      <div class="fb-meta">${name ? `<a href="#/spieler/${f.player_id}"><strong>${esc(name)}</strong></a> · ` : ''}<strong>${esc(f.day_title || 'Training')}</strong>
        <span class="muted small">${Dates.short(f.date)}</span>${f.rpe ? `<span class="pill ${hot}" title="${RPE[f.rpe]}">RPE ${f.rpe}</span>` : ''}${f.coach_seen ? '' : '<span class="pill accent">neu</span>'}</div>
      ${f.text ? `<p>${richText(f.text)}</p>` : ''}
      <div class="slot"></div>
      <form class="reply-form"><textarea rows="${f.reply ? 2 : 1}" placeholder="Antwort an ${esc((name || 'Spieler').split(' ')[0])} …">${esc(f.reply || '')}</textarea>
        <div class="row-btns"><button class="btn small primary" type="submit">${f.reply ? 'Antwort ändern' : 'Antworten'}</button>${f.coach_seen ? '' : '<button class="btn small" type="button" data-seen>Gelesen</button>'}</div></form>
    </li>`;
  },

  bindFeedback(root, after) {
    $$('[data-fb]', root).forEach(li => {
      const id = li.dataset.fb;
      const form = li.querySelector('.reply-form');
      const ta = form.querySelector('textarea');
      ta.addEventListener('focus', () => { ta.rows = 3; });
      form.onsubmit = async e => {
        e.preventDefault();
        if (!ta.value.trim()) return;
        try {
          await DB.update('feedback', id, { reply: ta.value.trim(), coach_seen: true });
          li.classList.remove('new');
          li.querySelector('.pill.accent')?.remove();
          li.querySelector('[data-seen]')?.remove();
          form.querySelector('[type=submit]').textContent = 'Antwort ändern';
          toast('Antwort gesendet');
          after && after();
        } catch (x) { toast(friendlyAuthError(x), 'err'); }
      };
      const seen = form.querySelector('[data-seen]');
      if (seen) seen.onclick = async () => {
        await DB.update('feedback', id, { coach_seen: true });
        li.classList.remove('new');
        li.querySelector('.pill.accent')?.remove();
        seen.remove();
        after && after();
      };
    });
  },

  async feedback(view, live) {
    const [list, players] = await Promise.all([
      DB.list('feedback', {}, { order: 'coach_seen,-updated_at', limit: 100 }),
      DB.list('players', {}, { select: 'id,name' }),
    ]);
    const logs = list.length ? await DB.list('logs', { player_id: [...new Set(list.map(f => f.player_id))], date: [...new Set(list.map(f => f.date))] }) : [];
    if (!live()) return;
    const name = id => (players.find(p => p.id === id) || {}).name || '?';
    const fresh = list.filter(f => !f.coach_seen);
    view.innerHTML = `<div class="page narrow">
      <header class="page-head"><div><h1>Feedback</h1><p class="muted">${fresh.length ? `${fresh.length} neu` : 'Alles gelesen'}</p></div></header>
      ${list.length ? `<ul class="fb-list cards">${list.map(f => this.fbItem(f, name(f.player_id))).join('')}</ul>` : '<section class="card empty"><p class="muted">Noch kein Feedback von Spielern.</p></section>'}
    </div>`;
    // Eingetragene Gewichte direkt beim Feedback anzeigen
    list.forEach(f => {
      const ls = logs.filter(l => l.player_id === f.player_id && l.date === f.date && l.day_id === f.day_id);
      const slot = $(`[data-fb="${f.id}"] .slot`, view);
      if (slot && ls.length) slot.innerHTML = `<details class="session"><summary class="small">Eingetragene Werte (${ls.filter(l => l.done).length}/${ls.length} erledigt)</summary>
        <table class="log-table">${ls.map(l => `<tr><td>${l.done ? icon('check', 'ok') : ''}</td><td>${esc(l.exercise_name)}</td><td class="num">${esc(setsText(l.sets)) || '–'}</td></tr>`).join('')}</table></details>`;
    });
    this.bindFeedback(view, () => this.refreshBadge());
  },

  /* ---------- Vorlagen ---------- */
  async templates(view, live) {
    const tpls = await DB.list('plans', { player_id: null }, { order: 'title' });
    const days = await DB.list('plan_days', { plan_id: tpls.map(t => t.id) }, { select: 'id,plan_id,title,weekday' });
    if (!live()) return;
    view.innerHTML = `<div class="page narrow">
      <header class="page-head"><div><h1>Vorlagen</h1><p class="muted">Pläne zum Wiederverwenden – beim Anlegen eines Spielers oder Plans auswählbar.</p></div>
        <button class="btn primary" id="nt">${icon('plus')} Vorlage</button></header>
      ${tpls.map(t => {
        const ds = days.filter(d => d.plan_id === t.id);
        return `<a class="card plan-box" href="#/plan/${t.id}"><div><strong>${esc(t.title)}</strong>
          <span class="muted small">${ds.map(d => `${d.weekday ? WD[d.weekday - 1] + ' ' : ''}${esc(d.title)}`).join(' · ') || 'leer'}</span></div>${icon('next')}</a>`;
      }).join('') || '<section class="card empty"><p class="muted">Noch keine Vorlagen. Tipp: Im Plan eines Spielers „Als Vorlage speichern“ wählen.</p></section>'}
    </div>`;
    $('#nt').onclick = async () => {
      const plan = await DB.insert('plans', { player_id: null, title: 'Neue Vorlage', notes: '', weeks: 6, active: true });
      location.hash = `#/plan/${plan.id}`;
    };
  },

  /* ---------- Wochenplan: welcher Teil des Plans an welchem Tag ---------- */
  async week(view, start, live) {
    const today = Dates.today();
    // Ab Samstag wird schon die kommende Woche geplant
    const ws = start && /^\d{4}-\d{2}-\d{2}$/.test(start) ? Dates.monday(start) : Dates.monday(Dates.weekday(today) >= 6 ? Dates.add(today, 7) : today);
    const days = Dates.week(ws);
    const [players, rows, fbs] = await Promise.all([
      DB.list('players', { active: true }, { order: 'name', select: 'id,name' }),
      DB.list('week_plans', { week_start: ws }),
      // Feedback der Spieler zu den Einheiten dieser Woche – erscheint direkt beim Tag
      DB.list('feedback', { date: { gte: days[0], lte: days[6] } }, { select: 'player_id,date,rpe,duration_min,text,coach_seen' }).catch(() => []),
    ]);
    if (!live()) return;
    const val = (pid, wd) => (rows.find(r => r.player_id === pid && r.weekday === wd) || {}).text || '';
    const fbOf = (pid, d) => fbs.filter(f => f.player_id === pid && f.date === d);
    const d0 = Dates.parse(days[0]), d6 = Dates.parse(days[6]);
    view.innerHTML = `<div class="page wide">
      <header class="page-head"><div><h1>Wochenplan</h1><p class="muted">Was jeder Spieler an welchem Tag macht – sehen die Spieler auf ihrer Startseite. Darunter erscheint ihr Feedback zur Einheit.</p></div></header>
      <div class="week-nav">
        <a class="icon-btn" href="#/woche/${Dates.add(ws, -7)}" aria-label="Vorige Woche">${icon('back')}</a>
        <strong>KW ${Dates.kw(ws)} · ${d0.getDate()}.${d0.getMonth() + 1}. – ${d6.getDate()}.${d6.getMonth() + 1}.${d6.getFullYear()}</strong>
        <a class="icon-btn" href="#/woche/${Dates.add(ws, 7)}" aria-label="Nächste Woche">${icon('next')}</a>
        <span class="save-state" id="save-state"></span>
      </div>
      ${players.length ? `<div class="wp-scroll"><table class="wp-table">
        <colgroup><col class="wp-name">${days.map(() => '<col>').join('')}</colgroup>
        <thead><tr><th>Spieler</th>${days.map(d => `<th class="${d === today ? 'today' : ''}">${WD[Dates.weekday(d) - 1]}<span>${Dates.parse(d).getDate()}.${Dates.parse(d).getMonth() + 1}.</span></th>`).join('')}</tr></thead>
        <tbody>${players.map(p => `<tr><th><a href="#/spieler/${p.id}">${esc(p.name)}</a></th>${days.map((d, i) => `<td>
          <div class="wp-cell" data-p="${p.id}" data-wd="${i + 1}"><textarea rows="1" class="wp-main" placeholder="–" aria-label="${esc(p.name)} ${WD_LONG[i]}">${esc(val(p.id, i + 1))}</textarea></div>
          ${fbOf(p.id, d).map(f => `<div class="wp-fb-wrap"><button type="button" class="wp-fb ${f.coach_seen ? '' : 'new'}" ${f.text ? '' : 'disabled'}>${icon('check')}<span>${f.duration_min ? `${f.duration_min} Min.` : 'Feedback'}${f.rpe != null ? ` · ${f.rpe}/10` : ''}</span>${f.text ? `<i class="wp-fb-c" title="Kommentar vom Spieler">${icon('msg')}</i>` : ''}</button>${f.text ? `<p class="wp-fb-text" hidden>${richText(f.text)}</p>` : ''}</div>`).join('')}
        </td>`).join('')}</tr>`).join('')}</tbody>
      </table></div>`
      : '<section class="card empty"><p class="muted">Noch keine aktiven Spieler.</p></section>'}
    </div>`;
    // Textfelder wachsen mit dem Text mit – alles bleibt lesbar
    const grow = t => { t.style.height = 'auto'; t.style.height = `${t.scrollHeight + 2}px`; };
    const st = $('#save-state', view);
    const save = async cell => {
      const row = { player_id: cell.dataset.p, week_start: ws, weekday: +cell.dataset.wd };
      const text = $('.wp-main', cell).value.trim();
      st.textContent = 'Speichert …'; st.className = 'save-state';
      try {
        if (text) await DB.upsert('week_plans', { ...row, text, updated_at: new Date().toISOString() }, 'player_id,week_start,weekday');
        else await DB.remove('week_plans', row);
        st.textContent = 'Gespeichert'; st.className = 'save-state ok';
      } catch (x) { st.textContent = 'Nicht gespeichert'; st.className = 'save-state bad'; toast(friendlyAuthError(x), 'err'); }
    };
    $$('.wp-cell', view).forEach(cell => {
      const t = $('.wp-main', cell);
      grow(t); t.oninput = () => grow(t); t.onchange = () => save(cell);
    });
    // Kommentar des Spielers zum Feedback aufklappen
    $$('.wp-fb:not([disabled])', view).forEach(b => b.onclick = () => { const p = b.parentElement.querySelector('.wp-fb-text'); p.hidden = !p.hidden; b.classList.toggle('open', !p.hidden); });
  },


  /* ---------- Ausgefüllte Plan-PDF eines Spielers ---------- */
  async pdfFilled(view, id, live) {
    await swr(`pdf:${id}`, async () => {
      if (DEMO) {
        const [plan] = await DB.list('plans', { id });
        if (!plan) return { plan: null };
        const [[player], fields] = await Promise.all([DB.list('players', { id: plan.player_id }), DB.list('pdf_fields', { plan_id: id })]);
        const vals = await DB.list('pdf_values', { player_id: plan.player_id, field_id: fields.map(f => f.id) }, { order: '-updated_at' });
        return { plan, player, fields, vals };
      }
      // Plan + Spieler + Felder + Einträge in einer Anfrage
      const [x] = await DB.list('plans', { id }, { select: '*,players(name),pdf_fields(id,page,kind,x,y,w,h,pdf_values(field_id,value,updated_at))' });
      if (!x) return { plan: null };
      const fields = x.pdf_fields || [];
      const vals = fields.flatMap(f => f.pdf_values || []).sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
      fields.forEach(f => delete f.pdf_values);
      const player = x.players;
      delete x.pdf_fields; delete x.players;
      return { plan: x, player, fields, vals };
    }, d => this.drawFilled(view, id, d), live);
  },

  drawFilled(view, id, { plan, player, fields, vals }) {
    if (!plan || !plan.file_url) { view.innerHTML = '<div class="page"><p class="err-box">Zu diesem Plan gibt es keine PDF.</p></div>'; return; }
    const filled = vals.filter(v => v.value).length;
    view.innerHTML = `<div class="page pdf-page-wrap">
      <header class="page-head sub-head">
        <a class="icon-btn" href="#/spieler/${plan.player_id}" aria-label="Zurück">${icon('back')}</a>
        <div><span class="eyebrow">${esc(player?.name || '')}</span><h1>${esc(plan.title)}</h1>
          <p class="muted small">${fields.length ? `${filled} von ${plural(fields.length, 'Feld', 'Feldern')} ausgefüllt${vals[0] ? ` · zuletzt ${Dates.relative(vals[0].updated_at.slice(0, 10))}` : ''}` : 'Noch keine Felder gesetzt.'}</p></div>
        <a class="btn small" href="#/plan/${id}">${icon('edit')} Felder</a>
      </header>
      <div id="pdf-box" class="pdf-box"></div>
    </div>`;
    PdfView.mount($('#pdf-box'), plan.file_url, { mode: 'view', fields, values: Object.fromEntries(vals.map(v => [v.field_id, v.value])) })
      .catch(x => { const box = $('#pdf-box', view); if (box) box.innerHTML = `<p class="err-box">${esc(friendlyAuthError(x))}</p>`; });
  },

  /* ---------- Plan-Editor ---------- */
  async editor(view, id, live) {
    let plan, player, fieldCount;
    if (DEMO) {
      [plan] = await DB.list('plans', { id });
      player = plan && plan.player_id ? (await DB.list('players', { id: plan.player_id }))[0] : null;
      fieldCount = plan ? (await DB.list('pdf_fields', { plan_id: id }, { select: 'id' })).length : 0;
    } else {
      // Plan + Spieler + Anzahl Felder in einer Anfrage
      [plan] = await DB.list('plans', { id }, { select: '*,players(id,name),pdf_fields(id)' });
      if (plan) { player = plan.players; fieldCount = (plan.pdf_fields || []).length; delete plan.players; delete plan.pdf_fields; }
    }
    if (!plan) { view.innerHTML = '<div class="page"><p class="err-box">Plan nicht gefunden.</p></div>'; return; }
    // Trainingstage/Übungen werden im Editor nicht mehr bearbeitet
    const days = [], exs = [], library = [];
    // Abgleich Übungen in der PDF ↔ Trainingsvideos (läuft im Hintergrund)
    let pvHtml = '<div class="spinner"></div>';
    const computeVideos = async () => {
      if (!S.plan.file_url) return;
      try {
        const [videos, exercises] = await Promise.all([DB.list('content', { section: 'videos' }), PlanVideos.exercises(S.plan.file_url)]);
        const list = PlanVideos.match(exercises, videos);
        const n = list.filter(m => m.video).length;
        pvHtml = list.length ? `<p class="muted small">${n} von ${plural(list.length, 'Übung', 'Übungen')} haben ein Video. Zugeordnet wird über den Videotitel – z. B. „Trap Bar Deadlift“ passt zu „TRAP BAR DL“.</p>
          <ul class="pv-list">${list.map(m => `<li class="${m.video ? 'ok' : ''}">${m.video ? icon('check') : '<span class="st open"></span>'}<span><strong>${esc(m.name)}</strong>${m.video ? `<small class="muted">${esc(m.video.title)}</small>` : '<small class="muted">noch kein Video</small>'}</span></li>`).join('')}</ul>`
          : '<p class="muted small">In der PDF wurden keine Übungsnamen gefunden.</p>';
      } catch (x) {
        console.warn(x);
        pvHtml = '<p class="muted small">Abgleich hat nicht geklappt.</p>';
      }
      const el = $('#pv-admin', view);
      if (el) el.innerHTML = pvHtml;
    };
    if (!live()) return;

    const S = {
      plan: { ...plan },
      days: days.map(d => ({ ...d, exs: exs.filter(e => e.day_id === d.id).map(e => ({ ...e })) })),
    };
    const orig = { days: days.map(d => d.id), exs: exs.map(e => e.id) };
    let dirty = false;
    const setDirty = v => { dirty = v; view.classList.toggle('dirty', v); $('#save', view) && ($('#save', view).disabled = !v); };
    window.onbeforeunload = () => (dirty ? true : undefined);
    const back = player ? `#/spieler/${player.id}` : '#/spieler';
    const blankEx = () => ({ id: uuid(), name: '', sets: 3, reps: '', load: '', rest: '', notes: '', video_url: '' });

    const exRow = (e, di, ei, n) => `<div class="ed-ex" data-d="${di}" data-e="${ei}">
      <div class="ed-ex-main">
        <span class="ex-num">${ei + 1}</span>
        <input class="ed-name" data-f="name" value="${esc(e.name)}" placeholder="Übung, z. B. Kniebeuge">
        <div class="ed-move">
          <button class="icon-btn sm" data-act="ex-up" ${ei ? '' : 'disabled'} aria-label="Nach oben">${icon('up')}</button>
          <button class="icon-btn sm" data-act="ex-down" ${ei < n - 1 ? '' : 'disabled'} aria-label="Nach unten">${icon('down')}</button>
          <button class="icon-btn sm" data-act="ex-del" aria-label="Übung löschen">${icon('trash')}</button>
        </div>
      </div>
      <div class="ed-grid">
        <label>Sätze<input data-f="sets" type="number" min="1" max="20" value="${esc(e.sets)}"></label>
        <label>Wdh<input data-f="reps" value="${esc(e.reps || '')}" placeholder="8"></label>
        <label>Gewicht / Intensität<input data-f="load" value="${esc(e.load || '')}" placeholder="60 kg"></label>
        <label>Pause<input data-f="rest" value="${esc(e.rest || '')}" placeholder="90 s"></label>
      </div>
      <input data-f="notes" value="${esc(e.notes || '')}" placeholder="Hinweis zur Ausführung (optional)">
      <div class="ed-video">
        ${icon('play')}<input data-f="video_url" value="${esc(e.video_url || '')}" placeholder="Video-Link (YouTube, Vimeo …)">
        <button class="btn small" data-act="ex-video">Mediathek</button>
      </div>
    </div>`;

    const render = () => {
      const scroll = window.scrollY;
      view.innerHTML = `<div class="page narrow editor">
        <header class="page-head sub-head">
          <a class="icon-btn" href="${back}" aria-label="Zurück">${icon('back')}</a>
          <div><span class="eyebrow">${player ? `Plan für ${esc(player.name)}` : 'Vorlage'}</span><h1>${esc(S.plan.title || 'Plan')}</h1></div>
          <button class="btn ghost" data-act="more" aria-label="Weitere Aktionen">⋯</button>
        </header>
        <section class="card form">
          <label>Name des Plans<input data-p="title" value="${esc(S.plan.title)}"></label>
          <label>Hinweise für den Spieler<textarea data-p="notes" rows="2" placeholder="z. B. Aufwärmen, worauf achten, Ziel des Blocks">${esc(S.plan.notes || '')}</textarea></label>
          ${player ? `<label class="check-line"><input type="checkbox" data-p="active" ${S.plan.active ? 'checked' : ''}> Aktiver Plan (sieht der Spieler)</label>` : ''}
        </section>
        <section class="card">
          <div class="card-head"><h2>Plan als PDF</h2></div>
          ${S.plan.file_url ? `<div class="pdf-row">${icon('file')}<span>${esc(fileLabel(S.plan.file_url))}</span>
              <button class="icon-btn sm" data-act="pdf-del" aria-label="PDF entfernen">${icon('trash')}</button></div>
            <button class="btn primary block" data-act="pdf-fields">${icon('edit')} Felder zum Ausfüllen setzen${fieldCount ? ` (${fieldCount})` : ''}</button>
            <p class="muted small">${fieldCount ? `${plural(fieldCount, 'Feld', 'Felder')} auf der PDF – der Spieler kann sie abhaken bzw. Gewichte eintragen.` : 'Setz Kreuz- und kg-Felder auf die PDF, damit der Spieler sie ausfüllen kann.'}</p>`
            : '<p class="muted small">Optional: Lade deinen fertigen Plan als PDF hoch. Danach setzt du Felder darauf, in die der Spieler Kreuze und Gewichte einträgt.</p>'}
          <label class="btn block upload-btn">${icon('upload')} ${S.plan.file_url ? 'Andere PDF hochladen (Felder werden neu erkannt)' : 'PDF hochladen'}<input type="file" id="pdf-up" accept="application/pdf,.pdf" hidden></label>
        </section>
        ${S.plan.file_url ? `<section class="card">
          <div class="card-head"><h2>Videos zum Plan</h2></div>
          <div id="pv-admin">${pvHtml}</div>
        </section>` : ''}
        <div class="save-bar"><span class="muted small" id="dirty-text">${dirty ? 'Ungespeicherte Änderungen' : 'Alles gespeichert'}</span>
          <button class="btn primary" id="save" ${dirty ? '' : 'disabled'}>Speichern</button></div>
      </div>`;
      window.scrollTo(0, scroll);
      $('#pdf-up', view).onchange = async e => {
        const file = e.target.files[0];
        if (!file || !checkPdf(file)) return;
        toast('PDF wird hochgeladen …');
        try {
          // Hieß der Plan wie die alte PDF, bekommt er den Namen der neuen
          const norm = s => String(s || '').replace(/\.pdf$/i, '').replace(/[\s_-]+/g, '').toLowerCase();
          if (!S.plan.title || norm(S.plan.title) === norm(fileLabel(S.plan.file_url))) S.plan.title = file.name.replace(/\.pdf$/i, '');
          S.plan.file_url = await DB.upload(`plaene/${uuid()}-${safeName(file.name)}`, file);
          // Neue PDF gilt sofort; Felder der alten PDF passen nicht mehr → neu erkennen
          await DB.update('plans', id, { file_url: S.plan.file_url, title: S.plan.title });
          plan.file_url = S.plan.file_url;
          if (fieldCount) await DB.remove('pdf_fields', { plan_id: id });
          fieldCount = await this.autoFields(id, S.plan.file_url);
          toast(`PDF hochgeladen${fieldCount ? `, ${plural(fieldCount, 'Feld', 'Felder')} automatisch gesetzt` : ''}`);
          render();
          computeVideos();
        } catch (x) { toast(friendlyAuthError(x), 'err'); }
      };
    };

    const touch = () => { setDirty(true); const t = $('#dirty-text', view); if (t) t.textContent = 'Ungespeicherte Änderungen'; };
    view.oninput = e => {
      const t = e.target;
      if (t.dataset.p) {
        S.plan[t.dataset.p] = t.type === 'checkbox' ? t.checked : t.type === 'number' ? (t.value ? +t.value : null) : t.value;
        if (t.dataset.p === 'title') $('h1', view).textContent = t.value || 'Plan';
      } else if (t.dataset.df) {
        const d = S.days[+t.closest('[data-d]').dataset.d];
        d[t.dataset.df] = t.dataset.df === 'weekday' ? (t.value ? +t.value : null) : t.value;
      } else if (t.dataset.f) {
        const row = t.closest('[data-e]');
        const e = S.days[+row.dataset.d].exs[+row.dataset.e];
        e[t.dataset.f] = t.dataset.f === 'sets' ? (+t.value || 1) : t.value;
      } else return;
      touch();
    };
    view.onchange = view.oninput;

    const move = (arr, i, dir) => { const j = i + dir; if (j < 0 || j >= arr.length) return; [arr[i], arr[j]] = [arr[j], arr[i]]; };
    view.onclick = async e => {
      const b = e.target.closest('[data-act], #save');
      if (!b) return;
      if (b.id === 'save') return save();
      const act = b.dataset.act;
      const di = +(b.closest('[data-d]')?.dataset.d ?? -1);
      const ei = +(b.closest('[data-e]')?.dataset.e ?? -1);
      const day = S.days[di];
      if (act === 'more') return more();
      if (act === 'pdf-fields') {
        const fields = await DB.list('pdf_fields', { plan_id: id });
        const s = openSheet(`<h2>Felder setzen</h2><div class="pdf-box" id="pdf-ed"></div>`, { wide: true, onClose: () => { fieldCount = fields.length; render(); } });
        s.classList.add('full');
        // Änderungen der Reihe nach speichern (Feld erst anlegen, dann verschieben)
        let queue = Promise.resolve();
        const run = fn => { queue = queue.then(fn).catch(x => toast(friendlyAuthError(x), 'err')); };
        try {
          await PdfView.mount($('#pdf-ed', s), S.plan.file_url, {
            mode: 'fields', fields,
            onAdd: f => run(() => DB.insert('pdf_fields', { id: f.id, plan_id: id, page: f.page, kind: f.kind, x: f.x, y: f.y, w: f.w, h: f.h })),
            onChange: f => run(() => DB.update('pdf_fields', f.id, { x: f.x, y: f.y, w: f.w, h: f.h })),
            onDelete: f => run(() => DB.remove('pdf_fields', { id: f.id })),
          });
        } catch (x) { $('#pdf-ed', s).innerHTML = `<p class="err-box">${esc(friendlyAuthError(x))}</p>`; }
        return;
      }
      if (act === 'pdf-del') {
        if (!(await confirmSheet('PDF vom Plan entfernen?', 'Entfernen'))) return;
        S.plan.file_url = null;
      }
      if (act === 'day-add') {
        const used = new Set(S.days.map(d => d.weekday));
        const wd = [1, 3, 5, 2, 4, 6, 7].find(w => !used.has(w)) || null;
        S.days.push({ id: uuid(), weekday: wd, title: '', notes: '', exs: [blankEx()] });
      }
      if (act === 'day-del') {
        if (day.exs.some(x => x.name) && !(await confirmSheet(`Trainingstag „${day.title || 'ohne Namen'}“ mit allen Übungen löschen?`))) return;
        S.days.splice(di, 1);
      }
      if (act === 'day-up') move(S.days, di, -1);
      if (act === 'day-down') move(S.days, di, 1);
      if (act === 'day-copy') S.days.splice(di + 1, 0, { ...day, id: uuid(), title: `${day.title} (Kopie)`, exs: day.exs.map(x => ({ ...x, id: uuid() })) });
      if (act === 'ex-add') { day.exs.push(blankEx()); render(); touch(); $$(`[data-d="${di}"] .ed-name`, view).pop()?.focus(); return; }
      if (act === 'ex-del') day.exs.splice(ei, 1);
      if (act === 'ex-up') move(day.exs, ei, -1);
      if (act === 'ex-down') move(day.exs, ei, 1);
      if (act === 'ex-video') return pickVideo(day.exs[ei], b.closest('[data-e]'));
      render();
      touch();
    };

    const pickVideo = (ex, row) => {
      const s = openSheet(`<h2>Video für „${esc(ex.name || 'Übung')}“</h2>
        ${library.length ? `<div class="pick-list">${library.map(c => `<button class="pick-row" data-url="${esc(c.url || '')}" ${c.url ? '' : 'disabled'}>${icon('play')}<span><strong>${esc(c.title)}</strong></span></button>`).join('')}</div>` : '<p class="muted">In der Mediathek (Inhalte → Videos) ist noch nichts.</p>'}
        <label class="btn block upload-btn">${icon('upload')} Eigenes Video hochladen (max. ${MAX_UPLOAD_MB} MB)<input type="file" accept="video/*" hidden></label>
        <p class="muted small">Tipp: Längere Videos am besten bei YouTube als „nicht gelistet“ hochladen und den Link einfügen.</p>`);
      const set = url => { ex.video_url = url; row.querySelector('[data-f="video_url"]').value = url; touch(); closeSheet(); };
      $$('[data-url]', s).forEach(b => b.onclick = () => set(b.dataset.url));
      s.querySelector('input[type=file]').onchange = async e => {
        const file = e.target.files[0];
        if (!file) return;
        if (file.size > MAX_UPLOAD_MB * 1048576) { toast(`Datei ist größer als ${MAX_UPLOAD_MB} MB – bitte über YouTube (nicht gelistet) teilen.`, 'err'); return; }
        toast('Lädt hoch …');
        try { set(await DB.upload(`uebungen/${uuid()}-${safeName(file.name)}`, file)); toast('Hochgeladen'); }
        catch (x) { toast(friendlyAuthError(x), 'err'); }
      };
    };

    const more = () => {
      const s = openSheet(`<h2>${esc(S.plan.title)}</h2><div class="action-list">
        <button class="pick-row" data-m="tpl">${icon('copy')}<span><strong>Als Vorlage speichern</strong><small class="muted">Zum Wiederverwenden für andere Spieler</small></span></button>
        <button class="pick-row" data-m="copy">${icon('users')}<span><strong>Für anderen Spieler kopieren</strong><small class="muted">Wird dort der aktive Plan</small></span></button>
        <button class="pick-row danger" data-m="del">${icon('trash')}<span><strong>Plan löschen</strong><small class="muted">Eingetragene Gewichte bleiben im Verlauf</small></span></button>
      </div>`);
      $$('[data-m]', s).forEach(b => b.onclick = async () => {
        if (dirty) { toast('Bitte zuerst speichern.'); return; }
        const m = b.dataset.m;
        if (m === 'tpl') {
          const t = await this.copyPlan(plan.id, null, { title: S.plan.title, start_date: null });
          closeSheet(); toast('Vorlage gespeichert'); location.hash = `#/plan/${t.id}`;
        }
        if (m === 'copy') {
          const players = (await DB.list('players', { active: true }, { order: 'name' })).filter(x => x.id !== plan.player_id);
          const s2 = openSheet(`<h2>Kopieren für …</h2><div class="pick-list">${players.map(x => `<button class="pick-row" data-p="${x.id}">${icon('user')}<span><strong>${esc(x.name)}</strong></span></button>`).join('') || '<p class="muted">Keine weiteren Spieler.</p>'}</div>`);
          $$('[data-p]', s2).forEach(pb => pb.onclick = async () => {
            const target = players.find(x => x.id === pb.dataset.p);
            for (const x of await DB.list('plans', { player_id: target.id, active: true })) await DB.update('plans', x.id, { active: false });
            const np = await this.copyPlan(plan.id, target.id, { title: S.plan.title, start_date: Dates.monday(Dates.add(Dates.today(), 7)), active: true });
            closeSheet(); toast(`Plan für ${target.name} angelegt`); location.hash = `#/plan/${np.id}`;
          });
        }
        if (m === 'del') {
          if (!(await confirmSheet(`Plan „${S.plan.title}“ löschen?`))) return;
          await DB.remove('plans', { id: plan.id });
          toast('Plan gelöscht');
          location.hash = back;
        }
      });
    };

    const save = async () => {
      const btn = $('#save', view);
      btn.disabled = true;
      btn.textContent = 'Speichert …';
      try {
        await DB.update('plans', plan.id, {
          title: S.plan.title.trim() || 'Plan', start_date: S.plan.start_date || null, weeks: S.plan.weeks || null,
          notes: S.plan.notes || '', file_url: S.plan.file_url || null, active: !!S.plan.active, updated_at: new Date().toISOString(),
        });
        setDirty(false);
        render();
        toast('Gespeichert – der Spieler sieht den Plan sofort.');
      } catch (x) {
        toast(friendlyAuthError(x), 'err');
        btn.disabled = false;
        btn.textContent = 'Speichern';
      }
    };

    // Beim Verlassen mit ungespeicherten Änderungen nachfragen (wird von route() geprüft)
    App.guard = { hash: `#/plan/${id}`, ok: () => !dirty || confirm('Änderungen am Plan sind noch nicht gespeichert. Trotzdem verlassen?') };

    render();
    computeVideos();
  },

  /* ---------- Trainingsvideos ---------- */
  async content(view, section, live) {
    await swr('videos', async () => {
      const [items, players] = await Promise.all([
        DB.list('content', { section }, { order: 'sort,-created_at' }),
        DB.list('players', { active: true }, { order: 'name', select: 'id,name' }),
      ]);
      return { items, players };
    }, d => this.drawContent(view, section, d), live);
  },

  drawContent(view, section, { items, players }) {
    const nameOf = id => (players.find(p => p.id === id) || {}).name || '?';
    const tools = c => `<div class="cc-tools">${c.audience && c.audience.length ? `<span class="pill" title="${esc(c.audience.map(nameOf).join(', '))}">${plural(c.audience.length, 'Spieler', 'Spieler')}</span>` : '<span class="pill">alle</span>'}
      <button class="icon-btn sm" data-edit="${c.id}" aria-label="Bearbeiten">${icon('edit')}</button><button class="icon-btn sm" data-del="${c.id}" aria-label="Löschen">${icon('trash')}</button></div>`;
    view.innerHTML = `<div class="page narrow">
      <header class="page-head"><div><h1>Trainingsvideos</h1></div>
        <button class="btn primary" id="add">${icon('plus')} Video</button></header>
      ${items.length ? videoGroups(items, c => contentCard(c, tools(c))) : '<section class="card empty"><p class="muted">Noch keine Videos hochgeladen.</p></section>'}
    </div>`;
    bindContent(view);
    $('#add').onclick = () => this.editContent({ section }, items, players);
    $$('[data-edit]', view).forEach(b => b.onclick = () => this.editContent(items.find(c => c.id === b.dataset.edit), items, players));
    $$('[data-del]', view).forEach(b => b.onclick = async () => {
      const c = items.find(x => x.id === b.dataset.del);
      if (!(await confirmSheet(`„${c.title}“ löschen?`))) return;
      await DB.remove('content', { id: c.id });
      if (c.url && c.url.startsWith('file:')) await DB.removeFile(c.url.slice(5));
      route();
    });
  },

  editContent(c, items, players) {
    const aud = c.audience || [];
    const s = openSheet(`<h2>${c.id ? 'Video bearbeiten' : 'Neues Video'}</h2>
      <form class="form" id="cf">
        <label>Rubrik<select name="category" required><option value="">– bitte wählen –</option>${VIDEO_CATS.map(x => `<option ${c.category === x ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select></label>
        <label>Titel<input name="title" value="${esc(c.title || '')}" required placeholder="Wie die Übung im Plan, z. B. Trap Bar Deadlift"></label>
        <label>Text (optional)<textarea name="body" rows="4">${esc(c.body || '')}</textarea></label>
        <label>Link (YouTube, Vimeo, Webseite …)<input name="url" value="${esc(c.url && !c.url.startsWith('file:') ? c.url : '')}" placeholder="https://"></label>
        <label class="btn block upload-btn">${icon('upload')} <span id="fname">${c.url && c.url.startsWith('file:') ? esc(c.url.split('/').pop().replace(/^[\w-]{36}-/, '')) : `Oder Video hochladen (max. ${MAX_UPLOAD_MB} MB)`}</span><input type="file" name="file" accept="video/*" hidden></label>
        <fieldset class="aud"><legend>Sichtbar für</legend>
          <label class="check-line"><input type="radio" name="aud" value="all" ${aud.length ? '' : 'checked'}> Alle Spieler</label>
          <label class="check-line"><input type="radio" name="aud" value="some" ${aud.length ? 'checked' : ''}> Nur bestimmte</label>
          <div class="aud-list" ${aud.length ? '' : 'hidden'}>${players.map(p => `<label class="check-line"><input type="checkbox" name="who" value="${p.id}" ${aud.includes(p.id) ? 'checked' : ''}> ${esc(p.name)}</label>`).join('')}</div>
        </fieldset>
        <button class="btn primary block" type="submit">Speichern</button>
      </form>`);
    const f = s.querySelector('#cf');
    const el = f.elements;
    let file = null;
    el.file.onchange = () => {
      file = el.file.files[0] || null;
      if (file && file.size > MAX_UPLOAD_MB * 1048576) { toast(`Datei ist größer als ${MAX_UPLOAD_MB} MB – Videos bitte über YouTube (nicht gelistet) teilen.`, 'err'); file = null; el.file.value = ''; return; }
      if (file) { $('#fname', s).textContent = file.name; el.url.value = ''; if (!el.title.value) el.title.value = file.name.replace(/\.[^.]+$/, ''); }
    };
    $$('input[name=aud]', f).forEach(r => r.onchange = () => { $('.aud-list', f).hidden = el.aud.value !== 'some'; });
    f.onsubmit = async e => {
      e.preventDefault();
      e.target.querySelector("[type=submit]").disabled = true;
      try {
        let url = el.url.value.trim() || (c.url && c.url.startsWith('file:') ? c.url : '');
        if (file) {
          toast('Lädt hoch …');
          url = await DB.upload(`videos/${uuid()}-${safeName(file.name)}`, file);
          if (c.url && c.url.startsWith('file:')) await DB.removeFile(c.url.slice(5));
        }
        const who = $$('input[name=who]:checked', f).map(x => x.value);
        const row = {
          section: 'videos', category: el.category.value, title: el.title.value.trim(),
          body: el.body.value.trim(), url: url || null, audience: el.aud.value === 'some' && who.length ? who : null,
        };
        if (c.id) await DB.update('content', c.id, row);
        else await DB.insert('content', row);
        closeSheet();
        toast('Gespeichert');
        route();
      } catch (x) { toast(friendlyAuthError(x), 'err'); e.target.querySelector("[type=submit]").disabled = false; }
    };
  },
};

function checkPdf(file) {
  if (!/pdf$/i.test(file.type) && !/\.pdf$/i.test(file.name)) { toast('Bitte eine PDF-Datei wählen.', 'err'); return false; }
  if (file.size > MAX_UPLOAD_MB * 1048576) { toast(`Die PDF ist größer als ${MAX_UPLOAD_MB} MB.`, 'err'); return false; }
  return true;
}

function safeName(name) {
  return String(name).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.-]+/g, '-').slice(-60);
}
