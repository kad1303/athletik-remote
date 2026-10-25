'use strict';

/* ============================================================
   Kleine Helfer: HTML, Datum, Dialoge, Videos.
   ============================================================ */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uuid = () => crypto.randomUUID();
// Text mit Zeilenumbrüchen und anklickbaren Links
const richText = s => esc(s).replace(/https?:\/\/[^\s<]+/g, u => `<a href="${u}" target="_blank" rel="noopener">${u}</a>`).replace(/\n/g, '<br>');

const WD = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const WD_LONG = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];

const Dates = {
  iso(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; },
  parse(s) { const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); },
  today() { return this.iso(new Date()); },
  add(s, n) { const d = this.parse(s); d.setDate(d.getDate() + n); return this.iso(d); },
  weekday(s) { return ((this.parse(s).getDay() + 6) % 7) + 1; },   // 1 = Montag
  monday(s) { return this.add(s, 1 - this.weekday(s)); },
  week(s) { const m = this.monday(s); return Array.from({ length: 7 }, (_, i) => this.add(m, i)); },
  diffDays(a, b) { return Math.round((this.parse(b) - this.parse(a)) / 864e5); },
  short(s) { const d = this.parse(s); return `${WD[this.weekday(s) - 1]}, ${d.getDate()}.${d.getMonth() + 1}.`; },
  long(s) { const d = this.parse(s); return `${WD_LONG[this.weekday(s) - 1]}, ${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}`; },
  relative(s) {
    const n = this.diffDays(s, this.today());
    if (n === 0) return 'heute';
    if (n === 1) return 'gestern';
    if (n > 1 && n < 7) return `vor ${n} Tagen`;
    return this.short(s);
  },
  stamp(ts) { const d = new Date(ts); return `${d.getDate()}.${d.getMonth() + 1}. ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; },
};

/* ---------- Toast ---------- */
let toastTimer;
function toast(msg, kind = '') {
  const el = $('#toast');
  el.textContent = msg;
  el.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, kind === 'err' ? 5000 : 2600);
}

/* ---------- Dialog (unten ausfahrend auf dem Handy) ---------- */
function openSheet(html, { wide = false, onClose } = {}) {
  closeSheet();
  const bg = document.createElement('div');
  bg.className = 'sheet-bg';
  bg.innerHTML = `<div class="sheet ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">
    <button class="icon-btn sheet-x" data-close aria-label="Schließen">${icon('x')}</button>${html}</div>`;
  document.body.appendChild(bg);
  document.body.classList.add('no-scroll');
  bg._onClose = onClose;
  bg.addEventListener('click', e => { if (e.target === bg || e.target.closest('[data-close]')) closeSheet(); });
  requestAnimationFrame(() => bg.classList.add('open'));
  const first = bg.querySelector('input:not([type=hidden]), textarea, select');
  if (first && matchMedia('(pointer: fine)').matches) first.focus();
  return bg.querySelector('.sheet');
}
function closeSheet() {
  const bg = $('.sheet-bg');
  if (!bg) return;
  bg.querySelectorAll('iframe, video').forEach(v => v.remove());
  bg.remove();
  document.body.classList.remove('no-scroll');
  if (bg._onClose) bg._onClose();
}
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); });

function confirmSheet(text, okLabel = 'Löschen') {
  return new Promise(resolve => {
    let ok = false;
    const s = openSheet(`<h2>${esc(text)}</h2><div class="row-btns"><button class="btn" data-close>Abbrechen</button><button class="btn danger" id="cf-ok">${esc(okLabel)}</button></div>`,
      { onClose: () => resolve(ok) });
    s.querySelector('#cf-ok').addEventListener('click', () => { ok = true; closeSheet(); });
  });
}

/* ---------- Videos & Dateien ---------- */
const Media = {
  kind(url) {
    if (!url) return null;
    if (this.youtube(url) || /vimeo\.com\/\d+/.test(url)) return 'video';
    const name = url.toLowerCase().split('?')[0];
    if (/\.(mp4|mov|m4v|webm)$/.test(name)) return 'video';
    if (/\.(png|jpe?g|gif|webp|heic)$/.test(name)) return 'image';
    if (/\.pdf$/.test(name)) return 'pdf';
    return url.startsWith('file:') ? 'file' : 'link';
  },
  youtube(url) {
    const m = String(url).match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/))([\w-]{11})/);
    return m ? m[1] : null;
  },
  async href(url) { return url.startsWith('file:') ? DB.fileUrl(url.slice(5)) : url; },
  label(url) {
    return { video: 'Video ansehen', image: 'Bild ansehen', pdf: 'PDF öffnen', file: 'Datei öffnen', link: 'Link öffnen' }[this.kind(url)] || 'Öffnen';
  },
  // Öffnet Video/Bild im Dialog, alles andere in neuem Tab
  async open(url, title = '') {
    const kind = this.kind(url);
    if (kind === 'pdf' || kind === 'file' || kind === 'link') {
      const w = window.open('', '_blank');
      try { const h = await this.href(url); if (w) w.location = h; else location.href = h; } catch (e) { if (w) w.close(); toast(e.message, 'err'); }
      return;
    }
    const s = openSheet(`<h2>${esc(title)}</h2><div class="media-box"><div class="spinner"></div></div>`, { wide: true });
    const box = s.querySelector('.media-box');
    try {
      const yt = this.youtube(url);
      const vm = String(url).match(/vimeo\.com\/(\d+)/);
      if (yt) box.innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${yt}?rel=0&playsinline=1" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen title="${esc(title)}"></iframe>`;
      else if (vm) box.innerHTML = `<iframe src="https://player.vimeo.com/video/${vm[1]}" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen title="${esc(title)}"></iframe>`;
      else if (kind === 'image') box.innerHTML = `<img src="${esc(await this.href(url))}" alt="${esc(title)}">`;
      else box.innerHTML = `<video src="${esc(await this.href(url))}" controls playsinline preload="metadata"></video>`;
      box.classList.toggle('free', kind === 'image');
    } catch (e) {
      box.innerHTML = `<p class="muted">${esc(e.message)}</p>`;
    }
  },
};

/* ---------- Icons (Linien, 24er Raster) ---------- */
const ICONS = {
  home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
  play: '<circle cx="12" cy="12" r="9"/><path d="m10 8.5 5.5 3.5-5.5 3.5z"/>',
  star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-5.8 6.5-5.8s6.5 2.2 6.5 5.8"/><path d="M16 4.8a3.5 3.5 0 0 1 0 6.4M18 14.6c2.2.7 3.5 2.6 3.5 5.4"/>',
  msg: '<path d="M4 5h16v11H9l-5 4z"/>',
  list: '<path d="M9 6h12M9 12h12M9 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
  folder: '<path d="M3 6a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  next: '<path d="m9 5 7 7-7 7"/>',
  up: '<path d="m6 15 6-6 6 6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5M4 20h16"/>',
  file: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/>',
  wa: '<path d="M4 20l1.3-4A8 8 0 1 1 8 18.8z"/>',
  flame: '<path d="M12 3c1 4 5 5.5 5 10a5 5 0 0 1-10 0c0-2.5 1.5-3.5 2-5 1 1.5 2 2 2 2s-.5-4 1-7z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  logout: '<path d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 17l5-5-5-5M15 12H3"/>',
};
function icon(name, cls = '') {
  return `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ''}</svg>`;
}

/* ---------- Kleinkram ---------- */
function initials(name) { return String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join(''); }
function plural(n, one, many) { return `${n} ${n === 1 ? one : many}`; }
function target(e) {
  const parts = [];
  if (e.sets || e.reps) parts.push(`${e.sets || '?'} × ${e.reps || '?'}`);
  if (e.load) parts.push(e.load);
  return parts.join(' · ');
}
function setsText(sets) {
  return (sets || []).filter(s => s.kg || s.reps).map(s => s.kg ? `${String(s.kg).replace('.', ',')} kg × ${s.reps || '–'}` : `${s.reps} Wdh`).join(' · ');
}
function waLink(text) { return `https://wa.me/?text=${encodeURIComponent(text)}`; }
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast('Kopiert'); }
  catch { prompt('Zum Kopieren:', text); }
}
function debounce(fn, ms) {
  let t;
  const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  d.flush = (...a) => { clearTimeout(t); return fn(...a); };
  return d;
}
const RPE = ['', 'sehr leicht', 'leicht', 'leicht', 'mittel', 'mittel', 'fordernd', 'hart', 'sehr hart', 'extrem hart', 'Maximum'];
