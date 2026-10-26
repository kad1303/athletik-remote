'use strict';

/* ============================================================
   PDF mit Feldern: Alex setzt Kreuz-/kg-/Text-Felder per Tippen auf die PDF,
   Spieler tippen die Felder an und tragen ein. Positionen relativ zur Seite (0 … 1).
   Anzeige über pdf.js (wird erst bei Bedarf geladen).
   ============================================================ */

const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
const FIELD_SIZE = { check: [0.032, null], kg: [0.075, 0.024], text: [0.16, 0.024] };   // Breite, Höhe (null = quadratisch)
const FIELD_LABEL = { check: 'Kreuz', kg: 'kg', text: 'Text' };

const PdfView = {
  async lib() {
    if (!window.pdfjsLib) {
      await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = PDFJS + 'pdf.min.js';
        s.onload = resolve;
        s.onerror = () => reject(new Error('Die PDF-Anzeige konnte nicht geladen werden. Bist du online?'));
        document.head.appendChild(s);
      });
      pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.js';
    }
    return pdfjsLib;
  },

  async load(url) {
    const lib = await this.lib();
    const res = await fetch(await Media.href(url));
    if (!res.ok) throw new Error('PDF nicht gefunden.');
    return lib.getDocument({ data: await res.arrayBuffer() }).promise;
  },

  /* Erkennt Ausfüllstellen in Tabellen-Plänen (z. B. Excel-Export):
     Zelle rechts neben einer Wiederholungsangabe („10ea“, „5“) → kg-Feld, bei „Explosiv“ ein Kreuz in der Wdh-Zelle;
     Zelle unter einer Circuit-Angabe („3x12x10''“) → Kreuz. Zellränder kommen aus den Linien der PDF. */
  async detect(page, n) {
    const O = pdfjsLib.OPS;
    const vp = page.getViewport({ scale: 1 });
    const W = vp.width, H = vp.height;
    const ol = await page.getOperatorList();
    const mul = (a, b) => [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
    let ctm = [1, 0, 0, 1, 0, 0];
    const stack = [];
    const pt = (x, y) => vp.convertToViewportPoint(ctm[0] * x + ctm[2] * y + ctm[4], ctm[1] * x + ctm[3] * y + ctm[5]);
    const V = [], Hz = [];   // senkrechte {x, y1, y2} und waagerechte {y, x1, x2} Linien
    const Fills = [];        // farbige Flächen – dort wird nichts eingetragen (Überschriften, Ampeln …)
    const seg = (a, b) => {
      if (Math.abs(a[0] - b[0]) < 1.8) V.push({ x: (a[0] + b[0]) / 2, y1: Math.min(a[1], b[1]), y2: Math.max(a[1], b[1]) });
      else if (Math.abs(a[1] - b[1]) < 1.8) Hz.push({ y: (a[1] + b[1]) / 2, x1: Math.min(a[0], b[0]), x2: Math.max(a[0], b[0]) });
    };
    let path = null, fillWhite = false, strokeWhite = false;
    const white = c => c && c[0] > 240 && c[1] > 240 && c[2] > 240;
    for (let i = 0; i < ol.fnArray.length; i++) {
      const f = ol.fnArray[i], a = ol.argsArray[i];
      if (f === O.save) stack.push(ctm);
      else if (f === O.restore) ctm = stack.pop() || ctm;
      else if (f === O.transform) ctm = mul(ctm, a);
      else if (f === O.setFillRGBColor) fillWhite = white(a);
      else if (f === O.setStrokeRGBColor) strokeWhite = white(a);
      else if (f === O.constructPath) {
        path = { rects: [], lines: [] };
        let k = 0, last = null;
        for (const op of a[0]) {
          if (op === O.rectangle) {
            const [x, y, w, h] = a[1].slice(k, k + 4); k += 4;
            path.rects.push([pt(x, y), pt(x + w, y + h)]);
          } else if (op === O.moveTo) { last = pt(a[1][k], a[1][k + 1]); k += 2; }
          else if (op === O.lineTo) { const p = pt(a[1][k], a[1][k + 1]); k += 2; if (last) path.lines.push([last, p]); last = p; }
          else if (op === O.curveTo) k += 6;
          else if (op === O.curveTo2 || op === O.curveTo3) k += 4;
        }
      } else if (path && [O.fill, O.eoFill, O.stroke, O.closeStroke, O.fillStroke, O.eoFillStroke, O.closeFillStroke, O.closeEOFillStroke].includes(f)) {
        const stroke = f !== O.fill && f !== O.eoFill;
        if (!(stroke ? strokeWhite : fillWhite)) {
          for (const [p, q] of path.rects) {
            const x1 = Math.min(p[0], q[0]), x2 = Math.max(p[0], q[0]), y1 = Math.min(p[1], q[1]), y2 = Math.max(p[1], q[1]);
            if (x2 - x1 < 1.8 || y2 - y1 < 1.8) seg([x1, y1], [x2, y2]);   // dünnes Rechteck = Linie
            else if (!stroke) Fills.push({ x1, x2, y1, y2 });              // farbig hinterlegte Zelle
            else if (stroke) { seg([x1, y1], [x2, y1]); seg([x1, y2], [x2, y2]); seg([x1, y1], [x1, y2]); seg([x2, y1], [x2, y2]); }
          }
          if (stroke) path.lines.forEach(([p, q]) => seg(p, q));
        }
        path = null;
      } else if (f === O.endPath) path = null;
    }

    const cellAt = (px, py) => {
      const t = 0.6;
      const vs = V.filter(v => v.y1 - t <= py && v.y2 + t >= py);
      const hs = Hz.filter(h => h.x1 - t <= px && h.x2 + t >= px);
      const l = Math.max(...vs.filter(v => v.x < px).map(v => v.x));
      const r = Math.min(...vs.filter(v => v.x > px).map(v => v.x));
      const top = Math.max(...hs.filter(h => h.y < py).map(h => h.y));
      const b = Math.min(...hs.filter(h => h.y > py).map(h => h.y));
      return [l, r, top, b].every(Number.isFinite) ? { l, r, t: top, b } : null;
    };

    const tc = await page.getTextContent();
    const items = tc.items.filter(it => it.str.trim()).map(it => {
      const [x, y] = vp.convertToViewportPoint(it.transform[4], it.transform[5]);
      const h = it.height || Math.hypot(it.transform[2], it.transform[3]);
      return { s: it.str.trim(), cx: x + Math.min(it.width, 30) / 2, cy: y - h * 0.35 };
    });
    // Kleine Flächen (z. B. Haken-Grafik) zählen nicht, nur solche, die die Zelle weitgehend füllen
    const colored = c => Fills.some(f => f.x1 <= c.l + 2 && f.x2 >= c.r - 2 && f.y1 <= c.t + 2 && f.y2 >= c.b - 2 && (f.x2 - f.x1) < 400);
    const textIn = c => items.filter(i => i.cx > c.l && i.cx < c.r && i.cy > c.t && i.cy < c.b).map(i => i.s).join(' ').trim();
    const rel = (c, kind) => ({ page: n, kind, x: c.l / W, y: c.t / H, w: (c.r - c.l) / W, h: (c.b - c.t) / H });
    const inset = (c, d) => ({ l: c.l + d, r: c.r - d, t: c.t + d, b: c.b - d });
    const square = (c, right) => {
      const s = Math.max(4, Math.min(c.b - c.t, c.r - c.l) - 2.6);
      const x = right ? c.r - s - 1.3 : c.l + 1.3;
      return { l: x, r: x + s, t: c.t + (c.b - c.t - s) / 2, b: c.t + (c.b - c.t + s) / 2 };
    };

    const out = [];
    for (const it of items) {
      if (/^\d{1,2}\s*(ea|x)?$/i.test(it.s)) {
        const c = cellAt(it.cx, it.cy);
        if (!c || c.r - c.l > 60) continue;
        const v = cellAt(c.r + 0.9, it.cy);
        if (!v || v.r - v.l > 60 || Math.abs(v.t - c.t) > 1.5 || colored(c) || colored(v)) continue;
        const txt = textIn(v);
        const row = { key: `${n}|${Math.round(c.t)}`, at: c.l, pitch: (v.r - c.l) * 1.25 };
        if (/explosiv|✓|done/i.test(txt)) out.push({ ...rel(square(c, true), 'check'), ...row });
        else if (!txt || /kg\b/i.test(txt) || /^[-–]+$/.test(txt) || /^\d+([.,]\d+)?$/.test(txt)) out.push({ ...rel(inset(v, 1), 'kg'), ...row });
      } else if (/^\d+\s*x\s*\d+/i.test(it.s)) {
        const c = cellAt(it.cx, it.cy);
        if (!c) continue;
        const d = cellAt(it.cx, c.b + 0.9);
        if (!d || Math.abs(d.t - c.b) > 1.5 || Math.abs(d.l - c.l) > 1.5) continue;
        const txt = textIn(d);
        if (!txt || /done|✓|erledigt/i.test(txt)) out.push({ ...rel(square(d, false), 'check'), circuit: true });
      }
    }
    // Wochen-Spalten erkennen: in einer Zeile mindestens 3 Treffer direkt nebeneinander
    // (so fallen einzelne Zahlen in anderen Tabellen derselben Zeile raus)
    const keep = new Set(out.filter(f => f.circuit));
    const rows = {};
    out.filter(f => f.key).forEach(f => (rows[f.key] = rows[f.key] || []).push(f));
    for (const list of Object.values(rows)) {
      list.sort((a, b) => a.at - b.at);
      let run = [list[0]];
      const flush = () => { if (run.length >= 3) run.forEach(f => keep.add(f)); };
      for (const f of list.slice(1)) {
        if (f.at - run[run.length - 1].at <= f.pitch) run.push(f);
        else { flush(); run = [f]; }
      }
      flush();
    }
    const seen = new Set();
    return out.filter(f => keep.has(f)).filter(f => {
      const k = `${f.page}|${f.x.toFixed(3)}|${f.y.toFixed(3)}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    }).map(({ page, kind, x, y, w, h }) => ({ page, kind, x, y, w, h }));
  },

  /* Zeigt die PDF in box an.
     opts: { mode: 'fields' | 'fill' | 'view', fields, values: { fieldId: wert },
             onAdd(f), onChange(f), onDelete(f), onValue(f, wert) } */
  async mount(box, url, opts) {
    box.innerHTML = '<div class="spinner"></div>';
    const doc = await this.load(url);
    const st = { zoom: 1, tool: 'check', selected: null, pages: [], lastSize: {} };
    const fields = opts.fields;
    const values = opts.values || {};
    const editing = opts.mode === 'fields';

    box.innerHTML = `<div class="pdf-tools">
        ${editing ? `<div class="seg small pdf-toolset">${Object.entries(FIELD_LABEL).map(([k, l]) => `<button data-tool="${k}" class="${k === st.tool ? 'on' : ''}">${k === 'check' ? '☒ ' : ''}${l}</button>`).join('')}</div>
          <span class="pdf-sel" hidden><button class="icon-btn sm" data-sel="smaller" aria-label="Kleiner">−</button><button class="icon-btn sm" data-sel="bigger" aria-label="Größer">+</button><button class="icon-btn sm" data-sel="del" aria-label="Feld löschen">${icon('trash')}</button></span>
          <button class="btn small" data-import hidden></button>` : ''}
        <span class="pdf-zoom"><button class="icon-btn sm" data-zoom="-1" aria-label="Verkleinern">−</button><span class="num" id="zoom-val">100 %</span><button class="icon-btn sm" data-zoom="1" aria-label="Vergrößern">+</button></span>
      </div>
      ${editing ? '<p class="muted small pdf-hint">Feldart wählen und auf die Stelle in der PDF tippen. Feld ziehen = verschieben, roten Punkt unten rechts ziehen = Breite und Höhe ändern. Neue Felder übernehmen die zuletzt eingestellte Größe.</p>' : ''}
      <div class="pdf-scroll"><div class="pdf-pages"></div></div>`;
    const scroll = $('.pdf-scroll', box);
    const pagesEl = $('.pdf-pages', box);

    const fieldHtml = f => {
      const v = values[f.id] || '';
      const text = f.kind === 'check' ? (v ? '✕' : '') : esc(v);
      return `<div class="pdf-field ${f.kind} ${v ? 'filled' : ''} ${st.selected === f.id ? 'sel' : ''}" data-fid="${f.id}"
        style="left:${f.x * 100}%;top:${f.y * 100}%;width:${f.w * 100}%;height:${f.h * 100}%">${text || (editing ? `<i>${f.kind === 'check' ? '' : FIELD_LABEL[f.kind]}</i>` : '')}${editing && st.selected === f.id ? '<span class="pdf-handle" title="Ziehen = Größe ändern"></span>' : ''}</div>`;
    };
    const fitFont = el => { el.style.fontSize = `${Math.max(9, el.offsetHeight * 0.72)}px`; };
    const drawFields = () => {
      st.pages.forEach(p => {
        p.layer.innerHTML = fields.filter(f => f.page === p.n).map(fieldHtml).join('');
        // Schriftgröße passend zur Feldhöhe
        p.layer.querySelectorAll('.pdf-field').forEach(fitFont);
      });
      const sel = $('.pdf-sel', box);
      if (sel) sel.hidden = !st.selected;
    };

    const render = async () => {
      const width = Math.max(280, (scroll.clientWidth - 2) * st.zoom);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      pagesEl.innerHTML = '';
      st.pages = [];
      for (let n = 1; n <= doc.numPages; n++) {
        const page = await doc.getPage(n);
        const base = page.getViewport({ scale: 1 });
        const vp = page.getViewport({ scale: (width / base.width) * dpr });
        const wrap = document.createElement('div');
        wrap.className = 'pdf-page';
        wrap.style.width = `${width}px`;
        wrap.style.aspectRatio = `${base.width} / ${base.height}`;
        const canvas = document.createElement('canvas');
        canvas.width = vp.width;
        canvas.height = vp.height;
        const layer = document.createElement('div');
        layer.className = 'pdf-layer';
        layer.dataset.page = n;
        wrap.append(canvas, layer);
        pagesEl.appendChild(wrap);
        st.pages.push({ n, page, base, layer, ratio: base.width / base.height });
        await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
      }
      $('#zoom-val', box).textContent = `${Math.round(st.zoom * 100)} %`;
      drawFields();
    };
    // Auf dem Handy etwas größer starten, damit die Felder gut zu treffen sind
    if (scroll.clientWidth < 500) st.zoom = 1.5;
    await render();

    // Ausfüllbare PDF? Dann Formularfelder anbieten
    if (editing) {
      const found = [];
      for (const p of st.pages) {
        for (const a of await p.page.getAnnotations()) {
          if (a.subtype !== 'Widget' || !['Btn', 'Tx'].includes(a.fieldType) || a.pushButton) continue;
          const [x1, y1, x2, y2] = p.base.convertToViewportRectangle(a.rect);
          const kind = a.fieldType === 'Btn' ? 'check' : /kg|gew|last|weight/i.test(a.fieldName || '') ? 'kg' : 'text';
          found.push({ page: p.n, kind, x: Math.min(x1, x2) / p.base.width, y: Math.min(y1, y2) / p.base.height, w: Math.abs(x2 - x1) / p.base.width, h: Math.abs(y2 - y1) / p.base.height });
        }
      }
      // Ohne Formularfelder: Ausfüllstellen aus der Tabelle erkennen (Zellränder + Text)
      const imp = $('[data-import]', box);
      imp.hidden = false;
      imp.textContent = found.length ? `${found.length} Formularfelder übernehmen` : 'Felder automatisch erkennen';
      imp.onclick = async () => {
        imp.disabled = true;
        imp.textContent = 'Erkenne …';
        try {
          let list = found;
          if (!list.length) for (const p of st.pages) list = list.concat(await this.detect(p.page, p.n));
          // Stellen, an denen schon ein Feld ist, auslassen
          const taken = f => fields.some(g => g.page === f.page && f.x + f.w / 2 > g.x && f.x + f.w / 2 < g.x + g.w && f.y + f.h / 2 > g.y && f.y + f.h / 2 < g.y + g.h);
          const add = list.filter(f => !taken(f));
          for (const f of add) { const nf = { id: uuid(), ...f }; fields.push(nf); opts.onAdd(nf); }
          drawFields();
          toast(add.length ? `${plural(add.length, 'Feld', 'Felder')} angelegt – bitte kurz prüfen` : 'Keine weiteren Ausfüllstellen gefunden');
        } catch (x) { console.error(x); toast('Automatische Erkennung hat nicht geklappt.', 'err'); }
        imp.disabled = false;
        imp.textContent = 'Felder automatisch erkennen';
      };
    }

    /* ---------- Bedienung ---------- */
    box.addEventListener('click', e => {
      const z = e.target.closest('[data-zoom]');
      if (z) {
        const steps = [0.75, 1, 1.5, 2, 3];
        const i = Math.max(0, Math.min(steps.length - 1, steps.indexOf(st.zoom) + +z.dataset.zoom));
        if (steps[i] !== st.zoom) { st.zoom = steps[i]; render(); }
        return;
      }
      const t = e.target.closest('[data-tool]');
      if (t) { st.tool = t.dataset.tool; $$('[data-tool]', box).forEach(b => b.classList.toggle('on', b === t)); return; }
      const s = e.target.closest('[data-sel]');
      if (s && st.selected) {
        const f = fields.find(x => x.id === st.selected);
        if (s.dataset.sel === 'del') {
          fields.splice(fields.indexOf(f), 1);
          st.selected = null;
          opts.onDelete(f);
        } else {
          const k = s.dataset.sel === 'bigger' ? 1.2 : 1 / 1.2;
          f.w = Math.min(0.9, f.w * k); f.h = Math.min(0.5, f.h * k);
          st.lastSize[f.kind] = [f.w, f.h];
          opts.onChange(f);
        }
        drawFields();
      }
    });

    if (editing) {
      // Am Computer: Pfeiltasten verschieben das ausgewählte Feld fein, mit Umschalt ändern sie die Größe
      const onKey = e => {
        if (!box.isConnected) { document.removeEventListener('keydown', onKey); return; }
        const f = st.selected && fields.find(x => x.id === st.selected);
        const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
        if (!f || !dir || /input|textarea|select/i.test(e.target.tagName)) return;
        e.preventDefault();
        const step = 0.002;
        if (e.shiftKey) {
          f.w = Math.max(0.008, Math.min(1 - f.x, f.w + dir[0] * step));
          f.h = Math.max(0.006, Math.min(1 - f.y, f.h + dir[1] * step));
          st.lastSize[f.kind] = [f.w, f.h];
        } else {
          f.x = Math.max(0, Math.min(1 - f.w, f.x + dir[0] * step));
          f.y = Math.max(0, Math.min(1 - f.h, f.y + dir[1] * step));
        }
        drawFields();
        clearTimeout(st.keyTimer);
        st.keyTimer = setTimeout(() => opts.onChange(f), 400);
      };
      document.addEventListener('keydown', onKey);

      // Tippen auf leere Stelle = neues Feld, Feld ziehen = verschieben, Feld antippen = auswählen
      let drag = null;
      pagesEl.addEventListener('pointerdown', e => {
        const layer = e.target.closest('.pdf-layer');
        if (!layer) return;
        const el = e.target.closest('.pdf-field');
        const rect = layer.getBoundingClientRect();
        if (el) {
          const f = fields.find(x => x.id === el.dataset.fid);
          drag = { f, el, rect, sx: e.clientX, sy: e.clientY, ox: f.x, oy: f.y, ow: f.w, oh: f.h, moved: false, resize: !!e.target.closest('.pdf-handle') };
          el.setPointerCapture(e.pointerId);
          e.preventDefault();
        } else {
          drag = { add: true, layer, rect, sx: e.clientX, sy: e.clientY };
        }
      });
      pagesEl.addEventListener('pointermove', e => {
        if (!drag || drag.add) return;
        const dx = (e.clientX - drag.sx) / drag.rect.width, dy = (e.clientY - drag.sy) / drag.rect.height;
        if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 4) return;
        drag.moved = true;
        if (drag.resize) {
          drag.f.w = Math.max(0.008, Math.min(1 - drag.f.x, drag.ow + dx));
          drag.f.h = Math.max(0.006, Math.min(1 - drag.f.y, drag.oh + dy));
          drag.el.style.width = `${drag.f.w * 100}%`;
          drag.el.style.height = `${drag.f.h * 100}%`;
          fitFont(drag.el);
          return;
        }
        drag.f.x = Math.max(0, Math.min(1 - drag.f.w, drag.ox + dx));
        drag.f.y = Math.max(0, Math.min(1 - drag.f.h, drag.oy + dy));
        drag.el.style.left = `${drag.f.x * 100}%`;
        drag.el.style.top = `${drag.f.y * 100}%`;
      });
      pagesEl.addEventListener('pointercancel', () => { drag = null; });
      pagesEl.addEventListener('pointerup', async e => {
        if (!drag) return;
        const d = drag;
        drag = null;
        if (d.add) {
          if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 8) return;   // war Scrollen
          if (st.selected) { st.selected = null; drawFields(); return; }
          const p = st.pages.find(x => x.n === +d.layer.dataset.page);
          const [w0, h0] = FIELD_SIZE[st.tool];
          const [w, h] = st.lastSize[st.tool] || [w0, h0 ?? w0 * p.ratio];
          const f = {
            id: uuid(), page: p.n, kind: st.tool, w, h,
            x: Math.max(0, Math.min(1 - w, (e.clientX - d.rect.left) / d.rect.width - w / 2)),
            y: Math.max(0, Math.min(1 - h, (e.clientY - d.rect.top) / d.rect.height - h / 2)),
          };
          fields.push(f);
          drawFields();
          opts.onAdd(f);
        } else if (d.moved) {
          if (d.resize) st.lastSize[d.f.kind] = [d.f.w, d.f.h];
          st.selected = d.f.id;
          drawFields();
          opts.onChange(d.f);
        } else {
          st.selected = st.selected === d.f.id ? null : d.f.id;
          drawFields();
        }
      });
    } else if (opts.mode === 'fill') {
      pagesEl.addEventListener('click', e => {
        const el = e.target.closest('.pdf-field');
        if (!el) return;
        const f = fields.find(x => x.id === el.dataset.fid);
        if (f.kind === 'check') {
          values[f.id] = values[f.id] ? '' : 'x';
          drawFields();
          opts.onValue(f, values[f.id]);
          return;
        }
        const s = openSheet(`<h2>${f.kind === 'kg' ? 'Gewicht eintragen' : 'Eintragen'}</h2>
          <form class="form" id="pv"><div class="pv-row"><input name="v" ${f.kind === 'kg' ? 'inputmode="decimal"' : ''} value="${esc(values[f.id] || '')}" autocomplete="off">${f.kind === 'kg' ? '<span>kg</span>' : ''}</div>
          <div class="row-btns"><button class="btn" type="button" data-clear>Leeren</button><button class="btn primary" type="submit">Übernehmen</button></div></form>`);
        const inp = s.querySelector('input');
        setTimeout(() => { inp.focus(); inp.select(); }, 50);
        const set = v => { values[f.id] = v; closeSheet(); drawFields(); opts.onValue(f, v); };
        s.querySelector('#pv').onsubmit = ev => { ev.preventDefault(); set(f.kind === 'kg' ? inp.value.trim().replace('.', ',') : inp.value.trim()); };
        s.querySelector('[data-clear]').onclick = () => set('');
      });
    }

    let rt;
    const onResize = () => { clearTimeout(rt); rt = setTimeout(() => { if (box.isConnected) render(); else window.removeEventListener('resize', onResize); }, 250); };
    window.addEventListener('resize', onResize);
    return { redraw: drawFields };
  },
};
