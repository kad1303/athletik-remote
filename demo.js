'use strict';

/* ============================================================
   Demo-Modus: gleiche Schnittstelle wie Remote (auth.js), Daten nur im Browser.
   Läuft automatisch, solange config.js leer ist – zum Ausprobieren ohne Supabase.
   ============================================================ */

const DEMO_KEY = 'athletik:demo';

const Demo = {
  db: null,
  role: 'admin',
  files: {},

  uid() { return crypto.randomUUID(); },

  load() {
    try { this.db = JSON.parse(localStorage.getItem(DEMO_KEY)); } catch { this.db = null; }
    if (!this.db || this.db.v !== 6) this.db = this.seed();
    return this;
  },

  persist() {
    try { localStorage.setItem(DEMO_KEY, JSON.stringify(this.db)); } catch (e) { console.warn(e); }
  },

  reset() { this.db = this.seed(); this.persist(); },

  match(row, where = {}) {
    return Object.entries(where).every(([k, v]) => {
      if (v === undefined) return true;
      const x = row[k] ?? null;
      if (v === null) return x === null;
      if (Array.isArray(v)) return v.map(String).includes(String(x));
      if (typeof v === 'object') return Object.entries(v).every(([op, y]) =>
        x !== null && (op === 'gte' ? x >= y : op === 'lte' ? x <= y : op === 'gt' ? x > y : op === 'lt' ? x < y : op === 'neq' ? x != y : true));
      return String(x) === String(v);
    });
  },

  async list(table, where, opts = {}) {
    let rows = (this.db[table] || []).filter(r => this.match(r, where)).map(r => ({ ...r }));
    if (opts.order) {
      const keys = opts.order.split(',').map(o => o.startsWith('-') ? [o.slice(1), -1] : [o, 1]);
      rows.sort((a, b) => {
        for (const [k, d] of keys) {
          const x = a[k] ?? '', y = b[k] ?? '';
          if (x < y) return -d;
          if (x > y) return d;
        }
        return 0;
      });
    }
    if (opts.limit) rows = rows.slice(0, opts.limit);
    return rows;
  },

  fill(table, row) {
    const now = new Date().toISOString();
    const base = { id: this.uid(), created_at: now };
    if (table === 'logs' || table === 'feedback' || table === 'plans') base.updated_at = now;
    if (table === 'feedback') Object.assign(base, { coach_seen: false, player_seen: true });
    return { ...base, ...row };
  },

  guardFeedback(row, old) {
    if (this.role === 'admin') {
      if ((row.reply || null) !== (old ? old.reply || null : null)) {
        row.replied_at = new Date().toISOString(); row.player_seen = false; row.coach_seen = true;
      }
    } else {
      row.reply = old ? old.reply : null;
      row.replied_at = old ? old.replied_at : null;
      row.coach_seen = old && row.text === old.text && row.rpe === old.rpe ? old.coach_seen : false;
    }
    row.updated_at = new Date().toISOString();
    return row;
  },

  async insert(table, rows) {
    const list = (Array.isArray(rows) ? rows : [rows]).map(r => {
      const row = this.fill(table, r);
      return table === 'feedback' ? this.guardFeedback(row, null) : row;
    });
    (this.db[table] = this.db[table] || []).push(...list);
    this.persist();
    return Array.isArray(rows) ? list.map(r => ({ ...r })) : { ...list[0] };
  },

  async upsert(table, rows, onConflict = 'id') {
    const keys = onConflict.split(',');
    const t = this.db[table] = this.db[table] || [];
    const out = (Array.isArray(rows) ? rows : [rows]).map(r => {
      const i = t.findIndex(x => keys.every(k => String(x[k] ?? '') === String(r[k] ?? '')) && keys.some(k => r[k] != null));
      let row;
      if (i >= 0) {
        row = { ...t[i], ...r, id: t[i].id };
        if (table === 'feedback') this.guardFeedback(row, t[i]);
        if (table === 'logs' || table === 'plans') row.updated_at = new Date().toISOString();
        t[i] = row;
      } else {
        row = this.fill(table, r);
        if (table === 'feedback') this.guardFeedback(row, null);
        t.push(row);
      }
      return { ...row };
    });
    this.persist();
    return Array.isArray(rows) ? out : out[0];
  },

  async update(table, id, patch) {
    const t = this.db[table] || [];
    const i = t.findIndex(r => r.id === id);
    if (i < 0) return null;
    const row = { ...t[i], ...patch };
    if (table === 'feedback') this.guardFeedback(row, t[i]);
    t[i] = row;
    this.persist();
    return { ...row };
  },

  async remove(table, where) {
    const t = this.db[table] || [];
    const gone = t.filter(r => this.match(r, where));
    this.db[table] = t.filter(r => !this.match(r, where));
    // Kaskaden wie in der Datenbank
    const ids = gone.map(r => r.id);
    if (ids.length) {
      if (table === 'players') for (const x of ['plans', 'logs', 'feedback', 'invites']) await this.remove(x, { player_id: ids });
      if (table === 'plans') { await this.remove('plan_days', { plan_id: ids }); await this.remove('pdf_fields', { plan_id: ids }); }
      if (table === 'pdf_fields') await this.remove('pdf_values', { field_id: ids });
      if (table === 'plan_days') await this.remove('exercises', { day_id: ids });
    }
    this.persist();
  },

  async rpc(fn, args) {
    if (fn === 'reset_access') {
      await this.remove('invites', { player_id: args.p_player, used_at: null });
      await this.update('players', args.p_player, { user_id: null });
      return null;
    }
    if (fn === 'invite_info') {
      const inv = (this.db.invites || []).find(i => i.code === args.p_code && !i.used_at);
      return inv ? { name: inv.name, role: inv.role } : null;
    }
    throw new Error(`Im Demo-Modus nicht verfügbar: ${fn}`);
  },

  async upload(path, file) {
    this.files[path] = URL.createObjectURL(file);
    return 'file:' + path;
  },

  async removeFile(path) { delete this.files[path]; },

  async fileUrl(path) {
    if (this.files[path]) return this.files[path];
    throw new Error('Demo-Dateien gibt es nur bis zum Neuladen der Seite.');
  },

  /* ---------- Beispieldaten ---------- */
  seed() {
    const id = () => this.uid();
    const today = new Date();
    const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const ago = n => { const d = new Date(today); d.setDate(d.getDate() - n); return iso(d); };
    const mon = new Date(today); mon.setDate(mon.getDate() - ((mon.getDay() + 6) % 7));
    const weekDate = wd => { const d = new Date(mon); d.setDate(d.getDate() + wd - 1); return iso(d); };

    const P = { lena: id(), jonas: id(), mia: id() };
    const players = [
      { id: P.lena, name: 'Lena Hoffmann', sport: 'Tennis', notes: 'Spielt Regionalliga, Fokus Beinkraft + Schulterstabilität.', active: true, user_id: 'demo-player', created_at: ago(40) },
      { id: P.jonas, name: 'Jonas Weber', sport: 'Tennis', notes: 'Wohnt in Köln, Turnierphase ab Januar.', active: true, user_id: 'demo-jonas', created_at: ago(30) },
      { id: P.mia, name: 'Mia Schulz', sport: 'Tennis', notes: '', active: true, user_id: null, created_at: ago(2) },
    ];
    const invites = [{ code: 'demo1234', role: 'player', name: 'Mia Schulz', player_id: P.mia, created_at: ago(2), used_at: null }];

    const plans = [], days = [], exercises = [];
    const addPlan = (player, title, startAgo, weeks, def) => {
      const plan = { id: id(), player_id: player, title, start_date: player ? ago(startAgo) : null, weeks, notes: def.notes || '', active: true, created_at: ago(startAgo), updated_at: ago(startAgo) };
      plans.push(plan);
      def.days.forEach((d, di) => {
        const day = { id: id(), plan_id: plan.id, weekday: d.wd, title: d.title, notes: d.notes || '', sort: di };
        days.push(day);
        d.ex.forEach((e, ei) => exercises.push({ id: id(), day_id: day.id, sort: ei, name: e[0], sets: e[1], reps: e[2], load: e[3] || '', rest: e[4] || '', notes: e[5] || '', video_url: '' }));
      });
      return plan;
    };
    const kraft = {
      days: [
        { wd: 1, title: 'Kraft Unterkörper', ex: [['Kniebeuge', 4, '6', '60 kg', '2 min', 'Tiefe bis Parallele, Knie stabil'], ['Rumänisches Kreuzheben', 3, '8', '50 kg', '90 s'], ['Bulgarian Split Squat', 3, '8 je Seite', '2× 12 kg', '90 s'], ['Wadenheben einbeinig', 3, '12', 'Körpergewicht', '60 s']] },
        { wd: 3, title: 'Schnelligkeit & Sprungkraft', notes: 'Volle Pause zwischen den Sätzen – Qualität vor Menge.', ex: [['Box Jumps', 4, '5', '', '90 s'], ['Seitliche Sprünge (Skater)', 3, '6 je Seite'], ['Sprints 10 m', 6, '1', '', '60 s'], ['Medizinball Rotationswurf', 3, '6 je Seite', '3 kg']] },
        { wd: 5, title: 'Kraft Oberkörper & Rumpf', ex: [['Klimmzüge', 4, '6', 'ggf. Band', '2 min'], ['Kurzhantel Bankdrücken', 3, '8', '2× 16 kg', '90 s'], ['Außenrotation am Kabel', 3, '12', '5 kg', '60 s', 'Ellbogen am Körper'], ['Pallof Press', 3, '10 je Seite'], ['Seitstütz', 3, '30 s je Seite']] },
        { wd: null, title: 'Mobility (flexibel)', notes: 'Wann es passt, z. B. nach dem Tennis.', ex: [['90/90 Hüftmobilisation', 2, '8 je Seite'], ['Thoracic Rotation', 2, '10 je Seite'], ['Dehnung Hüftbeuger', 2, '45 s je Seite']] },
      ],
    };
    const lenaPlan = addPlan(P.lena, 'Wintervorbereitung Block 1', 17, 6, kraft);
    addPlan(P.jonas, 'Turniervorbereitung', 10, 4, kraft);

    // Plan als PDF (Muster) mit automatisch erkannten Feldern; Woche 1 schon ausgefüllt
    lenaPlan.file_url = 'demo/musterplan.pdf';
    lenaPlan.title = 'Musterplan Block 1';
    const pdf_fields = [["c",0.3109,0.1602,0.0159,0.0225],["c",0.4926,0.1602,0.0159,0.0225],["c",0.6743,0.1602,0.0159,0.0225],["c",0.8561,0.1602,0.0159,0.0225],["c",0.3109,0.1871,0.0159,0.0225],["c",0.4926,0.1871,0.0159,0.0225],["c",0.6743,0.1871,0.0159,0.0225],["c",0.8561,0.1871,0.0159,0.0225],["c",0.3109,0.2139,0.0159,0.0225],["c",0.4926,0.2139,0.0159,0.0225],["c",0.6743,0.2139,0.0159,0.0225],["c",0.8561,0.2139,0.0159,0.0225],["k",0.3296,0.284,0.0885,0.0235],["k",0.5113,0.284,0.0885,0.0235],["k",0.693,0.284,0.0885,0.0235],["k",0.8747,0.284,0.0885,0.0235],["k",0.3296,0.3109,0.0885,0.0235],["k",0.5113,0.3109,0.0885,0.0235],["k",0.693,0.3109,0.0885,0.0235],["k",0.8747,0.3109,0.0885,0.0235],["k",0.3296,0.3378,0.0885,0.0235],["k",0.5113,0.3378,0.0885,0.0235],["k",0.693,0.3378,0.0885,0.0235],["k",0.8747,0.3378,0.0885,0.0235],["k",0.3296,0.4084,0.0885,0.0235],["k",0.5113,0.4084,0.0885,0.0235],["k",0.693,0.4084,0.0885,0.0235],["k",0.8747,0.4084,0.0885,0.0235],["k",0.3296,0.4353,0.0885,0.0235],["k",0.5113,0.4353,0.0885,0.0235],["k",0.693,0.4353,0.0885,0.0235],["k",0.8747,0.4353,0.0885,0.0235],["k",0.3296,0.4622,0.0885,0.0235],["k",0.5113,0.4622,0.0885,0.0235],["k",0.693,0.4622,0.0885,0.0235],["k",0.8747,0.4622,0.0885,0.0235],["k",0.3296,0.5328,0.0885,0.0235],["k",0.5113,0.5328,0.0885,0.0235],["k",0.693,0.5328,0.0885,0.0235],["k",0.8747,0.5328,0.0885,0.0235],["k",0.3296,0.5597,0.0885,0.0235],["k",0.5113,0.5597,0.0885,0.0235],["k",0.693,0.5597,0.0885,0.0235],["k",0.8747,0.5597,0.0885,0.0235],["k",0.3296,0.5866,0.0885,0.0235],["k",0.5113,0.5866,0.0885,0.0235],["k",0.693,0.5866,0.0885,0.0235],["k",0.8747,0.5866,0.0885,0.0235],["c",0.2391,0.6845,0.0159,0.0225],["c",0.4208,0.6845,0.0159,0.0225],["c",0.6025,0.6845,0.0159,0.0225],["c",0.7842,0.6845,0.0159,0.0225],["c",0.2391,0.7383,0.0159,0.0225],["c",0.4208,0.7383,0.0159,0.0225],["c",0.6025,0.7383,0.0159,0.0225],["c",0.7842,0.7383,0.0159,0.0225]].map(([k, x, y, w, h]) => ({ id: id(), plan_id: lenaPlan.id, page: 1, kind: k === 'c' ? 'check' : 'kg', x, y, w, h }));
    const kgWeek1 = ['60', '62,5', '62,5', '50', '50', '52,5', '16', '16', '16'];
    const pdf_values = pdf_fields.filter(f => f.x < 0.42).map(f => ({ field_id: f.id, player_id: P.lena, value: f.kind === 'check' ? 'x' : kgWeek1.shift(), updated_at: ago(3) }));
    addPlan(null, 'Grundlagen Kraft (3×/Woche)', 60, 6, kraft);

    // Einträge von Lena: letzte Woche komplett, diese Woche bis gestern
    const logs = [], feedback = [];
    const lenaDays = days.filter(d => d.plan_id === lenaPlan.id && d.weekday);
    const todayWd = ((today.getDay() + 6) % 7) + 1;
    const sessions = [];
    for (const d of lenaDays) {
      sessions.push([d, iso(new Date(new Date(weekDate(d.weekday)).getTime() - 7 * 864e5)), 0]);
      if (d.weekday < todayWd) sessions.push([d, weekDate(d.weekday), 1]);
    }
    sessions.forEach(([d, date, wk]) => {
      exercises.filter(e => e.day_id === d.id).forEach(e => {
        const kg = parseFloat(e.load) || '';
        logs.push({ id: id(), player_id: P.lena, exercise_id: e.id, exercise_name: e.name, day_id: d.id, date, done: true, updated_at: date,
          sets: Array.from({ length: e.sets }, () => ({ kg: kg ? String(kg - 2.5 + wk * 2.5) : '', reps: String(parseInt(e.reps) || '') })) });
      });
    });
    sessions.forEach(([d, date, wk], i) => {
      const fb = { id: id(), player_id: P.lena, day_id: d.id, day_title: d.title, date, rpe: [6, 7, 8, 7, 6, 8][i % 6],
        text: ['Lief gut, Kniebeuge fühlt sich stabil an.', 'Sprünge waren hart, rechte Wade etwas zu.', 'Klimmzüge nur 5 Wdh im letzten Satz geschafft.'][i % 3],
        reply: null, replied_at: null, coach_seen: true, player_seen: true, created_at: date + 'T18:00:00Z', updated_at: date + 'T18:00:00Z' };
      if (wk === 0 && i === 2) Object.assign(fb, { player_seen: false, reply: 'Völlig okay! Im letzten Satz darfst du das Band nehmen – saubere Ausführung ist wichtiger als die Zahl.', replied_at: date + 'T20:00:00Z' });
      if (wk === 1) fb.coach_seen = false;
      feedback.push(fb);
    });

    const content = [
    ];

    return {
      v: 6,
      players, invites, plans, plan_days: days, exercises, logs, feedback, content, pdf_fields, pdf_values,
      members: [
        { user_id: 'demo-admin', name: 'Alex', role: 'admin', player_id: null },
        { user_id: 'demo-player', name: 'Lena Hoffmann', role: 'player', player_id: P.lena },
      ],
    };
  },
};
