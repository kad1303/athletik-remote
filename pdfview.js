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

  /* Zeigt die PDF in box an.
     opts: { mode: 'fields' | 'fill' | 'view', fields, values: { fieldId: wert },
             onAdd(f), onChange(f), onDelete(f), onValue(f, wert) } */
  async mount(box, url, opts) {
    box.innerHTML = '<div class="spinner"></div>';
    const doc = await this.load(url);
    const st = { zoom: 1, tool: 'check', selected: null, pages: [] };
    const fields = opts.fields;
    const values = opts.values || {};
    const editing = opts.mode === 'fields';

    box.innerHTML = `<div class="pdf-tools">
        ${editing ? `<div class="seg small pdf-toolset">${Object.entries(FIELD_LABEL).map(([k, l]) => `<button data-tool="${k}" class="${k === st.tool ? 'on' : ''}">${k === 'check' ? '☒ ' : ''}${l}</button>`).join('')}</div>
          <span class="pdf-sel" hidden><button class="icon-btn sm" data-sel="smaller" aria-label="Kleiner">−</button><button class="icon-btn sm" data-sel="bigger" aria-label="Größer">+</button><button class="icon-btn sm" data-sel="del" aria-label="Feld löschen">${icon('trash')}</button></span>
          <button class="btn small" data-import hidden></button>` : ''}
        <span class="pdf-zoom"><button class="icon-btn sm" data-zoom="-1" aria-label="Verkleinern">−</button><span class="num" id="zoom-val">100 %</span><button class="icon-btn sm" data-zoom="1" aria-label="Vergrößern">+</button></span>
      </div>
      ${editing ? '<p class="muted small pdf-hint">Feldart wählen und auf die Stelle in der PDF tippen. Felder lassen sich verschieben; antippen zum Auswählen.</p>' : ''}
      <div class="pdf-scroll"><div class="pdf-pages"></div></div>`;
    const scroll = $('.pdf-scroll', box);
    const pagesEl = $('.pdf-pages', box);

    const fieldHtml = f => {
      const v = values[f.id] || '';
      const text = f.kind === 'check' ? (v ? '✕' : '') : esc(v);
      return `<div class="pdf-field ${f.kind} ${v ? 'filled' : ''} ${st.selected === f.id ? 'sel' : ''}" data-fid="${f.id}"
        style="left:${f.x * 100}%;top:${f.y * 100}%;width:${f.w * 100}%;height:${f.h * 100}%">${text || (editing ? `<i>${f.kind === 'check' ? '' : FIELD_LABEL[f.kind]}</i>` : '')}</div>`;
    };
    const drawFields = () => {
      st.pages.forEach(p => {
        p.layer.innerHTML = fields.filter(f => f.page === p.n).map(fieldHtml).join('');
        // Schriftgröße passend zur Feldhöhe
        p.layer.querySelectorAll('.pdf-field').forEach(el => { el.style.fontSize = `${Math.max(9, el.offsetHeight * 0.72)}px`; });
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
      const imp = $('[data-import]', box);
      if (found.length && !fields.length) {
        imp.hidden = false;
        imp.textContent = `${found.length} Formularfelder aus der PDF übernehmen`;
        imp.onclick = async () => {
          imp.disabled = true;
          for (const f of found) { const nf = { id: uuid(), ...f }; fields.push(nf); await opts.onAdd(nf); }
          imp.hidden = true;
          drawFields();
          toast(`${found.length} Felder übernommen`);
        };
      }
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
          opts.onChange(f);
        }
        drawFields();
      }
    });

    if (editing) {
      // Tippen auf leere Stelle = neues Feld, Feld ziehen = verschieben, Feld antippen = auswählen
      let drag = null;
      pagesEl.addEventListener('pointerdown', e => {
        const layer = e.target.closest('.pdf-layer');
        if (!layer) return;
        const el = e.target.closest('.pdf-field');
        const rect = layer.getBoundingClientRect();
        if (el) {
          const f = fields.find(x => x.id === el.dataset.fid);
          drag = { f, el, rect, sx: e.clientX, sy: e.clientY, ox: f.x, oy: f.y, moved: false };
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
          const w = w0, h = h0 ?? w0 * p.ratio;
          const f = {
            id: uuid(), page: p.n, kind: st.tool, w, h,
            x: Math.max(0, Math.min(1 - w, (e.clientX - d.rect.left) / d.rect.width - w / 2)),
            y: Math.max(0, Math.min(1 - h, (e.clientY - d.rect.top) / d.rect.height - h / 2)),
          };
          fields.push(f);
          drawFields();
          opts.onAdd(f);
        } else if (d.moved) {
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
