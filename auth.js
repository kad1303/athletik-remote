'use strict';

/* ============================================================
   Anmeldung und Datenzugriff (Supabase).
   Spieler registrieren sich nur über einen Einladungslink von Alex.
   DB = gemeinsame Schnittstelle für Supabase und den Demo-Modus (demo.js):
     DB.list(table, where, { order, limit, select })   where: { spalte: wert | [werte] | null | { gte, lte, lt, gt } }
     DB.insert(table, row|rows) · DB.upsert(table, row|rows, 'a,b') · DB.update(table, id, patch) · DB.remove(table, where)
   ============================================================ */

const CFG = window.AR_CONFIG || { url: '', key: '' };
const AUTH_KEY = 'athletik:auth';

class AuthError extends Error {
  constructor(message, status, code) { super(message); this.status = status; this.code = code; }
}

const Auth = {
  session: null,
  onExpired: null,

  configured() { return !!(CFG.url && CFG.key); },

  load() {
    try { this.session = JSON.parse(localStorage.getItem(AUTH_KEY)) || null; } catch { this.session = null; }
    return this.session;
  },

  save(s) {
    this.session = s;
    try {
      if (s) localStorage.setItem(AUTH_KEY, JSON.stringify(s));
      else localStorage.removeItem(AUTH_KEY);
    } catch (e) {
      console.warn('Sitzung nicht gespeichert', e);
    }
  },

  from(data) {
    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Date.now() + (data.expires_in || 3600) * 1000,
      user: { id: data.user.id, email: data.user.email },
    };
  },

  async request(path, body, method = 'POST', token) {
    const res = await fetch(`${CFG.url}/auth/v1/${path}`, {
      method,
      headers: {
        apikey: CFG.key,
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new AuthError(data.msg || data.error_description || data.message || `Fehler ${res.status}`, res.status, data.error_code || data.code);
    return data;
  },

  async signIn(email, password) {
    this.save(this.from(await this.request('token?grant_type=password', { email: email.trim(), password })));
  },

  // Neuer Zugang über Einladungslink. Liefert false, wenn Supabase erst eine Bestätigungs-Mail verlangt.
  async signUp(email, password) {
    const data = await this.request('signup', { email: email.trim(), password });
    if (!data.access_token) return false;
    this.save(this.from(data));
    return true;
  },

  async signOut() {
    const token = this.session && this.session.access_token;
    this.save(null);
    if (token) fetch(`${CFG.url}/auth/v1/logout`, { method: 'POST', headers: { apikey: CFG.key, Authorization: `Bearer ${token}` } }).catch(() => {});
  },

  async setPassword(password) {
    await this.request('user', { password }, 'PUT', await this.token());
  },

  async token() {
    const s = this.session;
    if (!s) throw new AuthError('Nicht angemeldet', 401);
    if (Date.now() < s.expires_at - 60000) return s.access_token;
    try {
      this.save(this.from(await this.request('token?grant_type=refresh_token', { refresh_token: s.refresh_token })));
      return this.session.access_token;
    } catch (e) {
      if (e instanceof AuthError && e.status >= 400 && e.status < 500) {
        this.save(null);
        if (this.onExpired) this.onExpired();
      }
      throw e;
    }
  },

  // Anfrage an Datenbank oder Ablage, mit einem Wiederholungsversuch nach Token-Erneuerung
  async fetch(path, opts = {}, anon = false) {
    const go = async () => fetch(`${CFG.url}${path}`, {
      ...opts,
      headers: { apikey: CFG.key, Authorization: `Bearer ${anon ? CFG.key : await this.token()}`, ...(opts.headers || {}) },
    });
    let res = await go();
    if (res.status === 401 && this.session && !anon) {
      this.session.expires_at = 0;
      res = await go();
    }
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      throw new AuthError(d.message || d.msg || d.error || `Fehler ${res.status}`, res.status, d.code);
    }
    return res;
  },
};

/* ---------- Supabase-Datenzugriff ---------- */
const Remote = {
  query(where = {}, opts = {}) {
    const p = [];
    const lit = v => encodeURIComponent(String(v));
    for (const [k, v] of Object.entries(where)) {
      if (v === undefined) continue;
      if (v === null) p.push(`${k}=is.null`);
      else if (Array.isArray(v)) p.push(`${k}=in.(${v.map(x => `"${String(x).replace(/"/g, '\\"')}"`).map(encodeURIComponent).join(',')})`);
      else if (typeof v === 'object') for (const [op, x] of Object.entries(v)) p.push(`${k}=${op}.${lit(x)}`);
      else p.push(`${k}=eq.${lit(v)}`);
    }
    p.push(`select=${opts.select || '*'}`);
    if (opts.order) p.push('order=' + opts.order.split(',').map(o => o.startsWith('-') ? `${o.slice(1)}.desc` : `${o}.asc`).join(','));
    if (opts.limit) p.push(`limit=${opts.limit}`);
    return p.join('&');
  },

  async list(table, where, opts) {
    if (where) for (const v of Object.values(where)) if (Array.isArray(v) && !v.length) return [];
    return (await Auth.fetch(`/rest/v1/${table}?${this.query(where, opts)}`)).json();
  },

  async write(method, table, query, body, prefer) {
    const res = await Auth.fetch(`/rest/v1/${table}${query ? '?' + query : ''}`, {
      method,
      headers: { 'Content-Type': 'application/json', Prefer: prefer },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const t = await res.text();
    return t ? JSON.parse(t) : [];
  },

  async insert(table, rows) {
    const out = await this.write('POST', table, '', rows, 'return=representation');
    return Array.isArray(rows) ? out : out[0];
  },

  async upsert(table, rows, onConflict) {
    if (Array.isArray(rows) && !rows.length) return [];
    const q = onConflict ? `on_conflict=${onConflict}` : '';
    const out = await this.write('POST', table, q, rows, 'resolution=merge-duplicates,return=representation');
    return Array.isArray(rows) ? out : out[0];
  },

  async update(table, id, patch) {
    return (await this.write('PATCH', table, `id=eq.${encodeURIComponent(id)}`, patch, 'return=representation'))[0];
  },

  async remove(table, where) {
    const q = this.query(where).replace(/&?select=\*/, '');
    if (!q) throw new Error('remove ohne Bedingung');
    await this.write('DELETE', table, q, undefined, 'return=minimal');
  },

  async rpc(fn, args, anon = false) {
    const res = await Auth.fetch(`/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(args || {}),
    }, anon);
    const t = await res.text();
    return t ? JSON.parse(t) : null;
  },

  async upload(path, file) {
    await Auth.fetch(`/storage/v1/object/media/${path.split('/').map(encodeURIComponent).join('/')}`, {
      method: 'POST',
      headers: { 'Content-Type': file.type || 'application/octet-stream', 'x-upsert': 'false' },
      body: file,
    });
    return 'file:' + path;
  },

  async removeFile(path) {
    await Auth.fetch('/storage/v1/object/media', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefixes: [path] }),
    }).catch(e => console.warn('Datei nicht gelöscht', e));
  },

  // Zeitlich begrenzter Link auf eine Datei in der Ablage
  async fileUrl(path) {
    const res = await Auth.fetch(`/storage/v1/object/sign/media/${path.split('/').map(encodeURIComponent).join('/')}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expiresIn: 3 * 3600 }),
    });
    const d = await res.json();
    return CFG.url + '/storage/v1' + d.signedURL;
  },
};

function friendlyAuthError(e) {
  const msg = String(e.message || '').toLowerCase();
  if (e.code === 'invalid_credentials' || msg.includes('invalid login')) return 'E-Mail oder Passwort stimmt nicht.';
  if (e.code === 'weak_password' || msg.includes('password should')) return 'Das Passwort ist zu kurz (mindestens 8 Zeichen).';
  if (e.code === 'same_password') return 'Das ist schon dein aktuelles Passwort.';
  if (e.code === 'user_already_exists' || msg.includes('already registered')) return 'Mit dieser E-Mail gibt es schon einen Zugang. Bitte anmelden – oder Alex um einen neuen Link bitten.';
  if (e.code === 'email_address_invalid' || msg.includes('invalid format') || msg.includes('is invalid')) return 'Bitte eine gültige E-Mail-Adresse eingeben.';
  if (e.code === 'signup_disabled' || msg.includes('signups not allowed')) return 'Registrierung ist in Supabase noch ausgeschaltet.';
  if (msg.includes('invalid_invite')) return 'Dieser Einladungslink ist nicht mehr gültig. Bitte Alex um einen neuen.';
  if (e.code === 'over_request_rate_limit' || msg.includes('rate limit')) return 'Zu viele Versuche. Bitte in ein paar Minuten erneut probieren.';
  if (e instanceof TypeError && /fetch|load failed|network/i.test(e.message)) return 'Keine Verbindung. Bist du online?';
  return e.message || 'Unbekannter Fehler';
}
