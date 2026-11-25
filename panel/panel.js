/**
 * Sinemada İstanbul — İçerik Paneli
 * Vanilla JS. Film merkezli içerik yönetimi: filmler, mekanlar, görseller.
 * Veri katmanı adapters.js'tedir; yazmalar her zaman sütun indeksiyle yapılır.
 */
(function () {
  'use strict';

  const CFG = window.PANEL_CONFIG;
  const F = CFG.FILM, M = CFG.MEKAN, G = CFG.GORSEL;
  const { SheetsAdapter, DemoAdapter } = window.PanelData;
  const DEMO = new URLSearchParams(location.search).has('demo');

  // ================================================================ durum
  const S = {
    adapter: null,
    editor: '',
    tables: {},
    view: 'ozet',                 // ozet | film | mekan | gorsel
    list: {
      film: { q: '', filter: 'all', sort: 'name', limit: CFG.PAGE_SIZE },
      mekan: { q: '', filter: 'all', sort: 'name', limit: CFG.PAGE_SIZE },
      gorsel: { q: '', filter: 'all', limit: CFG.PAGE_SIZE },
    },
    sel: null,                    // { ent, mode: 'edit'|'create', rowObj, original, draft }
    conflict: null,
    saving: false,
    maps: [],
    cache: null,
    gorselCol0: 'none',
    skipped: {},                  // sayfa → yok sayılan boş satır sayısı           // Görseller A sütunu: auto (kimlik) | filmId | none
  };

  // ================================================================ yardımcılar
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  /** Güvenli DOM üretici (innerHTML kullanılmaz). */
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k === 'value') el.value = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k in el && typeof v !== 'string') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid == null || kid === false) continue;
      el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }

  const fold = s => String(s || '').toLocaleLowerCase('tr').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ı/g, 'i');
  const norm = s => CFG.normalizeName(String(s || ''));
  const collapse = s => String(s || '').replace(/\s+/g, ' ').trim();
  const splitList = v => String(v || '').split(CFG.LIST_SEPARATOR).map(collapse).filter(Boolean);
  const joinList = a => a.join(CFG.LIST_JOINER);
  const trSort = (a, b) => String(a).localeCompare(String(b), 'tr');
  const ID_RE = /^([A-Za-zÇĞİÖŞÜçğıöşü_-]*)(\d+)$/;
  const plural = (n, w) => `${n} ${w}`;

  function driveId(url) {
    const u = String(url || '');
    const m = u.match(/\/file\/d\/([a-zA-Z0-9_-]+)/) || u.match(/[?&]id=([a-zA-Z0-9_-]+)/) || u.match(/lh3\.googleusercontent\.com\/d\/([a-zA-Z0-9_-]+)/);
    return m ? m[1] : null;
  }
  /** Küçük resim adresi (Drive → lh3, boyutlu) */
  function thumbUrl(url, w) {
    const u = String(url || '').trim();
    if (!u || u.startsWith('data:')) return u;
    const id = driveId(u);
    return id ? `https://lh3.googleusercontent.com/d/${id}=w${w}` : u;
  }

  const store = {
    get(k) { try { return sessionStorage.getItem(k) || localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v, persist) { try { (persist ? localStorage : sessionStorage).setItem(k, v); } catch (e) { /* */ } },
    del(k) { try { sessionStorage.removeItem(k); localStorage.removeItem(k); } catch (e) { /* */ } },
  };

  function toast(msg, kind) {
    const el = h('div', { class: 'toast ' + (kind || '') }, msg);
    $('#toasts').append(el);
    setTimeout(() => el.remove(), kind === 'err' ? 8000 : 3500);
  }

  /** Modal: actions [{label, value, kind}] → seçilen value (Esc/dışarı → null). */
  function modal(title, body, actions, opts) {
    return new Promise(resolve => {
      const root = $('#modal-root');
      const close = v => { root.replaceChildren(); document.removeEventListener('keydown', onKey); resolve(v); };
      const onKey = e => { if (e.key === 'Escape') close(null); };
      document.addEventListener('keydown', onKey);
      const box = h('div', { class: 'modal' + (opts && opts.wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true' },
        h('h3', null, title), body,
        actions.length ? h('div', { class: 'acts' }, actions.map(a => h('button', {
          class: 'btn ' + (a.kind || ''), type: 'button',
          onclick: () => close(typeof a.value === 'function' ? a.value() : a.value),
        }, a.label))) : null);
      if (opts && opts.closeRef) opts.closeRef.close = close;
      root.replaceChildren(h('div', { class: 'modal-bg', onclick: e => { if (e.target === e.currentTarget) close(null); } }, box));
      const first = box.querySelector('input, textarea, select');
      (first || box.querySelector('.acts .btn:last-child') || box).focus();
    });
  }

  async function confirmBox(title, text, okLabel, danger) {
    return !!(await modal(title, h('div', null, [].concat(text).map(t => (t instanceof Node ? t : h('p', null, t)))),
      [{ label: 'Vazgeç', value: false }, { label: okLabel || 'Tamam', kind: danger ? 'danger' : 'primary', value: true }]));
  }

  function promptBox(title, label, initial) {
    const inp = h('input', { type: 'text', value: initial || '' });
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('.modal .acts .btn.primary').click(); } });
    return modal(title, h('label', { class: 'field' }, h('span', { class: 'lbl' }, label), inp),
      [{ label: 'Vazgeç', value: null }, { label: 'Ekle', kind: 'primary', value: () => collapse(inp.value) || null }]);
  }

  // ================================================================ tablolar
  const T = name => S.tables[name];
  // Kimlikli sayfada A sütunu boşsa kayıt satır numarasıyla tanınır (aynı anahtarı paylaşmasın)
  const keyOf = (t, r) => (t.hasIds && collapse(r[0]) ? r[0] : '#' + r.__row);
  const refOf = (t, r) => (t.hasIds && collapse(r[0]) ? { id: r[0] } : { row: r.__row });
  const keyLabel = (t, r) => (collapse(r[0]) || 'numarasız');
  /** Sıradaki kimlik (F1148, M951 …): mevcut en büyük numara + 1, aynı hane sayısıyla */
  function nextId(t) {
    let prefix = t.name === F.sheet ? 'F' : t.name === M.sheet ? 'M' : '', width = 3, max = 0;
    t.rows.forEach(r => { const m = ID_RE.exec(collapse(r[0])); if (m) { prefix = m[1]; width = Math.max(width, m[2].length); max = Math.max(max, +m[2]); } });
    return prefix + String(max + 1).padStart(width, '0');
  }
  // İçerik sütunları: bunların hepsi boşsa satır "boş satır" sayılır (formülü aşağı uzatılmış satırlar)
  const CONTENT_COLS = {
    [F.sheet]: [F.id, F.title, F.origin, F.director, F.genre, F.year, F.places, F.desc, F.origTitle],
    [M.sheet]: [M.id, M.name, M.category, M.coord, M.district],
    [G.sheet]: [G.film, G.place, G.url],
  };
  const fullExpected = (t, r) => Object.fromEntries(r.map((v, i) => [i, v]).filter(([i]) => !t.formulaCols.has(i) && i < t.headers.length));

  function prepareTables(raw) {
    S.tables = {};
    raw.forEach(src => {
      const t = {
        name: src.name,
        headers: src.headers.map(x => collapse(x)),
        formulaCols: new Set(src.formulaCols || []),
        rows: src.rows.map((r, i) => { const a = r.slice(); a.__row = src.rowNums ? src.rowNums[i] : i + 2; return a; }),
      };
      t.rows.forEach(r => { while (r.length < t.headers.length) r.push(''); });
      const cc = (CONTENT_COLS[t.name] || []).filter(i => !t.formulaCols.has(i));
      if (cc.length) {
        const before = t.rows.length;
        t.rows = t.rows.filter(r => cc.some(i => collapse(r[i])));
        S.skipped[t.name] = before - t.rows.length;
        if (S.skipped[t.name]) console.info(`[panel] ${t.name}: içeriği boş ${S.skipped[t.name]} satır yok sayıldı`);
      }
      t.hasIds = t.name === F.sheet || t.name === M.sheet || detectIds(t);
      reindex(t);
      S.tables[t.name] = t;
    });
    const gt = T(G.sheet), ft = T(F.sheet);
    if (gt.hasIds) S.gorselCol0 = 'auto';
    else {
      const vals = gt.rows.map(r => collapse(r[0])).filter(Boolean);
      S.gorselCol0 = vals.length && vals.filter(v => ft.byKey.has(v)).length / vals.length >= 0.8 ? 'filmId' : 'none';
    }
    invalidate();
  }

  function detectIds(t) {
    const vals = t.rows.map(r => collapse(r[0])).filter(Boolean);
    return vals.length >= t.rows.length * 0.9 && vals.length > 0 && vals.every(v => ID_RE.test(v)) && new Set(vals).size === vals.length;
  }

  function reindex(t) {
    t.byKey = new Map();
    t.rows.forEach(r => t.byKey.set(keyOf(t, r), r));
  }

  // ================================================================ türetilmiş dizinler
  function invalidate() { S.cache = null; }

  function X() {
    if (S.cache) return S.cache;
    const ft = T(F.sheet), mt = T(M.sheet), gt = T(G.sheet);
    const c = {
      mekanByNorm: new Map(), filmByTitle: new Map(), imagesByFilm: new Map(), imagesByPlace: new Map(),
      filmsByPlace: new Map(), directors: new Set(), genres: new Set(), categories: new Set(), districts: new Set(CFG.ILCELER),
      unmatched: new Map(),
    };
    const push = (map, k, v) => { if (!k) return; if (!map.has(k)) map.set(k, []); map.get(k).push(v); };
    mt.rows.forEach(r => {
      push(c.mekanByNorm, norm(r[M.name]), r);
      if (collapse(r[M.category])) c.categories.add(collapse(r[M.category]));
      if (collapse(r[M.district])) c.districts.add(collapse(r[M.district]));
    });
    ft.rows.forEach(r => {
      push(c.filmByTitle, collapse(r[F.title]), r);
      splitList(r[F.director]).forEach(d => c.directors.add(d));
      splitList(r[F.genre]).forEach(g => c.genres.add(g));
      splitList(r[F.places]).forEach(p => {
        const k = norm(p);
        if (k.length < CFG.PLACE_MIN_LEN) return;
        push(c.filmsByPlace, k, r);
        if (!c.mekanByNorm.has(k)) {
          if (!c.unmatched.has(k)) c.unmatched.set(k, { name: p, films: [] });
          c.unmatched.get(k).films.push(r);
        }
      });
    });
    gt.rows.forEach(r => {
      push(c.imagesByFilm, collapse(r[G.film]), r);
      push(c.imagesByPlace, norm(r[G.place]), r);
    });
    c.directors = [...c.directors].sort(trSort);
    c.genres = [...c.genres].sort(trSort);
    c.categories = [...c.categories].sort(trSort);
    c.districts = [...c.districts].sort(trSort);
    S.cache = c;
    return c;
  }

  const imagesOfFilm = r => (X().imagesByFilm.get(collapse(r[F.title])) || []);
  const filmsOfPlace = r => (X().filmsByPlace.get(norm(r[M.name])) || []);
  const imagesOfPlace = r => (X().imagesByPlace.get(norm(r[M.name])) || []);
  const placeMatch = name => X().mekanByNorm.get(norm(name));
  const sortImages = rows => rows.slice().sort((a, b) => statusRank(a[G.status]) - statusRank(b[G.status]));
  const statusRank = v => ({ '1': 0, '': 1, 'x': 2 }[collapse(v)] ?? 1);
  const coverOf = r => sortImages(imagesOfFilm(r)).find(g => collapse(g[G.status]) !== 'x');

  function coordsOf(str) {
    const p = String(str || '').replace(/"/g, '').split(',').map(s => parseFloat(s.trim()));
    return Number.isFinite(p[0]) && Number.isFinite(p[1]) && p[0] && p[1] ? [p[1], p[0]] : null; // [lon, lat]
  }
  const inIstanbul = c => c && c[0] >= CFG.ISTANBUL_BBOX[0] && c[0] <= CFG.ISTANBUL_BBOX[2] && c[1] >= CFG.ISTANBUL_BBOX[1] && c[1] <= CFG.ISTANBUL_BBOX[3];

  // ================================================================ denetimler
  /** [{ text, hide }] — hide: harita bu kaydı göstermez */
  function filmIssues(r) {
    const out = [];
    const title = collapse(r[F.title]);
    if (!/^F\d/.test(collapse(r[F.id]))) out.push({ text: 'Film numarası yok (kaydedince verilir)', hide: true });
    if (!title) out.push({ text: 'Film adı boş', hide: true });
    if (!collapse(r[F.genre])) out.push({ text: 'Tür boş', hide: true });
    const parts = splitList(r[F.places]).filter(p => norm(p).length >= CFG.PLACE_MIN_LEN);
    const miss = parts.filter(p => !placeMatch(p));
    if (!parts.length) out.push({ text: 'Çekim yeri yok', hide: true });
    else if (miss.length === parts.length) out.push({ text: 'Çekim yerlerinin hiçbiri Mekanlar\'da yok', hide: true });
    else if (miss.length) out.push({ text: `${miss.length} çekim yeri Mekanlar'da yok: ${miss.join(', ')}` });
    if (title && (X().filmByTitle.get(title) || []).length > 1) out.push({ text: 'Aynı adlı başka film var (görseller karışır)' });
    const y = collapse(r[F.year]);
    if (y && !/^\d{4}$/.test(y)) out.push({ text: 'Yıl 4 haneli değil' });
    return out;
  }
  function mekanIssues(r) {
    const out = [];
    if (!/^M\d/.test(collapse(r[M.id]))) out.push({ text: 'Mekan numarası yok (kaydedince verilir)', hide: true });
    if (!collapse(r[M.name])) out.push({ text: 'Mekan adı boş', hide: true });
    if (!collapse(r[M.category])) out.push({ text: 'Kategori boş', hide: true });
    const c = coordsOf(r[M.coord]);
    if (!c) out.push({ text: 'Konum yok', hide: true });
    else if (!inIstanbul(c)) out.push({ text: 'Konum İstanbul dışında (enlem/boylam yer değiştirmiş olabilir)' });
    if (collapse(r[M.name]) && (X().mekanByNorm.get(norm(r[M.name])) || []).length > 1) out.push({ text: 'Aynı adlı başka mekan var' });
    return out;
  }
  function gorselIssues(r) {
    const out = [];
    if (!collapse(r[G.url])) out.push({ text: 'Görsel adresi yok', hide: true });
    if (!X().filmByTitle.get(collapse(r[G.film]))) out.push({ text: 'Film bulunamadı', hide: true });
    if (collapse(r[G.place]) && !placeMatch(r[G.place])) out.push({ text: 'Mekan bulunamadı' });
    return out;
  }
  const issuesOf = (ent, r) => (ent === 'film' ? filmIssues(r) : ent === 'mekan' ? mekanIssues(r) : gorselIssues(r));
  const isHidden = (ent, r) => issuesOf(ent, r).some(i => i.hide);

  // ================================================================ başlat
  async function boot() {
    S.adapter = DEMO ? new DemoAdapter() : CFG.ADAPTER === 'sheets' ? new SheetsAdapter(CFG.API_URL) : null;
    if (!S.adapter) { document.body.textContent = 'Tanımsız veri katmanı: ' + CFG.ADAPTER; return; }
    $('#login-form').addEventListener('submit', onLogin);
    const saved = DEMO ? 'demo' : store.get('panel.token');
    if (saved) {
      try { await login(saved); return; } catch (e) { if (e.code === 'auth') store.del('panel.token'); }
    }
    $('#login').hidden = false;
    if (!DEMO && /BURAYA/.test(CFG.API_URL)) $('#login-error').textContent = 'Panel henüz API\'ye bağlanmadı (config.js → API_URL).';
  }

  async function onLogin(e) {
    e.preventDefault();
    const btn = $('#login-form button');
    btn.disabled = true;
    $('#login-error').textContent = '';
    const token = $('#login-token').value.trim();
    try {
      await login(token);
      store.set('panel.token', token, $('#login-remember').checked);
    } catch (err) { $('#login-error').textContent = err.message; } finally { btn.disabled = false; }
  }

  async function login(token) {
    const r = await S.adapter.login(token);
    S.editor = r.editor;
    $('#login').hidden = true;
    $('#app').hidden = false;
    $('#editor-name').textContent = S.editor;
    $('#demo-badge').hidden = !DEMO;
    bindUi();
    await reload(true);
  }

  async function reload(fromHash) {
    destroyMaps();
    $('#main').replaceChildren(h('div', { class: 'loading' }, 'Veri yükleniyor…'));
    try {
      const data = await S.adapter.load();
      prepareTables(data.tables);
    } catch (e) {
      $('#main').replaceChildren(h('div', { class: 'loading' }, 'Yüklenemedi: ' + e.message));
      if (e.code === 'auth') logout();
      return;
    }
    let view = S.view, key = S.sel && S.sel.mode === 'edit' ? keyOf(T(entTable(S.sel.ent)), S.sel.rowObj) : null;
    if (fromHash) {
      const [v, k] = decodeURIComponent(location.hash.slice(1)).split('/');
      if (['ozet', 'film', 'mekan', 'gorsel'].includes(v)) { view = v; key = k || null; }
    }
    S.sel = null; S.conflict = null;
    go(view, key);
  }

  let uiBound = false;
  function bindUi() {
    if (uiBound) return;
    uiBound = true;
    $('#btn-reload').addEventListener('click', async () => { if (await guard()) reload(); });
    $('#btn-logout').addEventListener('click', async () => { if (await guard()) logout(); });
    document.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); if (S.sel) saveEntity(); }
      else if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) {
        const s = $('#list-search'); if (s) { e.preventDefault(); s.focus(); }
      }
    });
    window.addEventListener('beforeunload', e => { if (isDirty()) { e.preventDefault(); e.returnValue = ''; } });
  }

  function logout() {
    store.del('panel.token');
    history.replaceState(null, '', location.pathname + location.search);
    location.reload();
  }

  const entTable = ent => (ent === 'film' ? F.sheet : ent === 'mekan' ? M.sheet : G.sheet);

  // ================================================================ gezinme
  function renderNav() {
    const ft = T(F.sheet), mt = T(M.sheet), gt = T(G.sheet);
    const item = (v, label, n, warn) => h('button', {
      class: 'nav-item', 'aria-current': S.view === v ? 'page' : null,
      onclick: async () => { if (S.view !== v && await guard()) go(v); },
    }, label, n != null ? h('span', { class: 'n' }, n) : null, warn ? h('span', { class: 'warn-n', title: 'Haritada görünmeyen' }, warn) : null);
    $('#nav').replaceChildren(
      item('ozet', 'Özet'),
      item('film', 'Filmler', ft.rows.length, ft.rows.filter(r => isHidden('film', r)).length || null),
      item('mekan', 'Mekanlar', mt.rows.length, mt.rows.filter(r => isHidden('mekan', r)).length || null),
      item('gorsel', 'Görseller', gt.rows.length),
    );
  }

  function setHash() {
    let v = S.view;
    if (S.sel && S.sel.mode === 'edit') v += '/' + keyOf(T(entTable(S.sel.ent)), S.sel.rowObj);
    history.replaceState(null, '', '#' + encodeURIComponent(v).replace(/%2F/g, '/'));
  }

  /** Bölüme git; key verilirse kaydı aç. */
  function go(view, key, opts) {
    destroyMaps();
    S.view = view;
    S.sel = null; S.conflict = null;
    if (opts && opts.filter && S.list[view]) { S.list[view].filter = opts.filter; S.list[view].q = ''; S.list[view].limit = CFG.PAGE_SIZE; }
    renderNav();
    if (view === 'ozet') renderOzet();
    else if (view === 'gorsel') renderGorseller();
    else {
      renderTwoPane(view);
      const t = T(entTable(view));
      if (key && t.byKey.has(key)) openEntity(view, t.byKey.get(key));
      else if (opts && opts.create) startCreate(view, opts.prefill);
      else renderEmptyDetail(view);
    }
    setHash();
  }

  // ================================================================ ÖZET
  function renderOzet() {
    const ft = T(F.sheet), mt = T(M.sheet), gt = T(G.sheet);
    const filmsHidden = ft.rows.filter(r => isHidden('film', r));
    const mekanHidden = mt.rows.filter(r => isHidden('mekan', r));
    const visImgs = gt.rows.filter(r => collapse(r[G.status]) !== 'x' && !isHidden('gorsel', r));
    const noImg = ft.rows.filter(r => !imagesOfFilm(r).some(g => collapse(g[G.status]) !== 'x'));
    const orphans = gt.rows.filter(r => !X().filmByTitle.get(collapse(r[G.film])));
    const dupFilms = ft.rows.filter(r => (X().filmByTitle.get(collapse(r[F.title])) || []).length > 1);
    const unmatched = [...X().unmatched.values()].sort((a, b) => b.films.length - a.films.length);

    const kpi = (n, of, label, sub) => h('div', { class: 'kpi' }, h('div', { class: 'kpi-n' }, n, of != null ? h('span', null, ' / ' + of) : null), h('div', { class: 'kpi-l' }, label), sub ? h('div', { class: 'kpi-s' }, sub) : null);
    const todo = (n, text, action) => h('li', { class: n ? '' : 'done' },
      h('span', { class: 'todo-n' }, n), h('span', { class: 'todo-t' }, text), n ? h('button', { class: 'btn', onclick: action }, 'Listele') : h('span', { class: 'muted' }, 'tamam'));

    const um = h('div', { class: 'card' },
      h('h3', null, 'Mekanlar\'da karşılığı olmayan çekim yerleri ', h('span', { class: 'n' }, unmatched.length)),
      h('p', { class: 'muted' }, 'Filmlerde yazılı ama Mekanlar\'da birebir eşleşen adı olmayan yerler. Haritada bu yerler görünmez. Mekan olarak ekleyin ya da filmdeki yazımı düzeltin.'),
      unmatched.length ? h('table', { class: 'tbl' },
        h('thead', null, h('tr', null, h('th', null, 'Yer adı'), h('th', null, 'Film'), h('th'))),
        h('tbody', null, unmatched.slice(0, 60).map(u => h('tr', null,
          h('td', null, u.name),
          h('td', null, u.films.slice(0, 4).map((f, i) => [i ? ', ' : '', h('a', { href: '#', onclick: e => { e.preventDefault(); go('film', f[F.id]); } }, f[F.title])]),
            u.films.length > 4 ? ` +${u.films.length - 4}` : ''),
          h('td', { class: 'r' }, h('button', { class: 'btn', onclick: () => go('mekan', null, { create: true, prefill: { [M.name]: u.name } }) }, '+ Mekan olarak ekle'))))))
        : h('p', null, 'Hepsi eşleşiyor.'),
      unmatched.length > 60 ? h('p', { class: 'muted' }, `… ve ${unmatched.length - 60} yer daha`) : null);

    $('#main').replaceChildren(h('div', { class: 'ozet' },
      h('div', { class: 'ozet-head' },
        h('h1', null, 'Özet'),
        h('div', { class: 'acts' },
          h('button', { class: 'btn primary', onclick: () => go('film', null, { create: true }) }, '+ Yeni film'),
          h('button', { class: 'btn primary', onclick: () => go('mekan', null, { create: true }) }, '+ Yeni mekan'))),
      h('div', { class: 'kpis' },
        kpi(ft.rows.length - filmsHidden.length, ft.rows.length, 'film haritada', filmsHidden.length ? `${filmsHidden.length} film eksik bilgi yüzünden görünmüyor` : 'hepsi görünüyor'),
        kpi(mt.rows.length - mekanHidden.length, mt.rows.length, 'mekan haritada', mekanHidden.length ? `${mekanHidden.length} mekanın konumu ya da kategorisi eksik` : 'hepsi görünüyor'),
        kpi(visImgs.length, gt.rows.length, 'görsel yayında', `${ft.rows.length - noImg.length} filmin görseli var`),
        kpi(unmatched.length, null, 'eşleşmeyen yer adı')),
      skippedNote(),
      h('div', { class: 'card' }, h('h3', null, 'Yapılacaklar'),
        h('ul', { class: 'todo' },
          todo(filmsHidden.length, 'film haritada görünmüyor (tür ya da çekim yeri eksik)', () => go('film', null, { filter: 'hidden' })),
          todo(mekanHidden.length, 'mekan haritada görünmüyor (konum ya da kategori eksik)', () => go('mekan', null, { filter: 'hidden' })),
          todo(noImg.length, 'filmin hiç görseli yok', () => go('film', null, { filter: 'noimg' })),
          todo(orphans.length, 'görselin filmi bulunamıyor (film adı eşleşmiyor)', () => go('gorsel', null, { filter: 'orphan' })),
          todo(dupFilms.length, 'film aynı adı taşıyor (görselleri karışır)', () => go('film', null, { filter: 'dup' })))),
      um));
  }

  function skippedNote() {
    const parts = Object.entries(S.skipped).filter(([, n]) => n).map(([k, n]) => `${k}: ${n}`);
    return parts.length ? h('p', { class: 'muted skipped' }, `Tabloda içeriği tamamen boş satırlar yok sayıldı (${parts.join(', ')}). Bunlar genelde formülü aşağıya kadar uzatılmış satırlardır; tablodan silinebilirler.`) : null;
  }

  // ================================================================ LİSTE + DETAY
  const ENT_LABEL = {
    film: { one: 'film', One: 'Film', newLabel: '+ Yeni film', save: 'Filmi kaydet', del: 'Filmi sil', empty: 'Soldan bir film seçin ya da yeni film ekleyin.' },
    mekan: { one: 'mekan', One: 'Mekan', newLabel: '+ Yeni mekan', save: 'Mekanı kaydet', del: 'Mekanı sil', empty: 'Soldan bir mekan seçin ya da yeni mekan ekleyin.' },
  };
  const FILTERS = {
    film: [['all', 'Tümü'], ['hidden', 'Haritada yok'], ['issues', 'Sorunlu'], ['noimg', 'Görselsiz'], ['dup', 'Aynı adlı'], ['Yerli', 'Yerli'], ['Yabancı', 'Yabancı']],
    mekan: [['all', 'Tümü'], ['hidden', 'Haritada yok'], ['issues', 'Sorunlu'], ['nofilm', 'Filmsiz'], ['lost', 'Kayıp eser']],
  };
  const SORTS = {
    film: [['name', 'Ada göre'], ['year', 'Yıla göre'], ['new', 'Son eklenen']],
    mekan: [['name', 'Ada göre'], ['district', 'İlçeye göre'], ['new', 'Son eklenen']],
  };

  function renderTwoPane(ent) {
    const L = S.list[ent];
    const search = h('input', { id: 'list-search', type: 'search', placeholder: ent === 'film' ? 'Film, yönetmen, yer ara…' : 'Mekan, ilçe, kategori ara…', value: L.q,
      oninput: e => { L.q = e.target.value; L.limit = CFG.PAGE_SIZE; renderList(ent); } });
    const sort = h('select', { 'aria-label': 'Sıralama', onchange: e => { L.sort = e.target.value; renderList(ent); } },
      SORTS[ent].map(([v, l]) => h('option', { value: v, selected: L.sort === v }, l)));
    const chips = h('div', { class: 'filters', role: 'group', 'aria-label': 'Süzgeç' }, FILTERS[ent].map(([v, l]) =>
      h('button', { class: 'fchip', 'aria-pressed': String(L.filter === v), onclick: () => { L.filter = v; L.limit = CFG.PAGE_SIZE; renderTwoPaneFilters(ent); renderList(ent); }, dataset: { v } }, l)));
    $('#main').replaceChildren(h('div', { class: 'two' },
      h('aside', { class: 'list-pane' },
        h('div', { class: 'list-head' },
          h('h2', null, ent === 'film' ? 'Filmler' : 'Mekanlar'),
          h('button', { class: 'btn primary', id: 'btn-new', onclick: async () => { if (await guard()) startCreate(ent); } }, ENT_LABEL[ent].newLabel)),
        h('div', { class: 'list-tools' }, search, sort),
        chips,
        h('div', { class: 'list-count muted', id: 'list-count' }),
        h('ol', { class: 'list', id: 'list' })),
      h('section', { class: 'detail', id: 'detail' })));
    renderList(ent);
  }

  function renderTwoPaneFilters(ent) {
    $$('.filters .fchip').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === S.list[ent].filter)));
  }

  function listRows(ent) {
    const L = S.list[ent];
    const t = T(entTable(ent));
    let rows = t.rows;
    const q = fold(L.q).trim();
    if (q) rows = rows.filter(r => fold(r.join(' ')).includes(q));
    const f = L.filter;
    if (f === 'hidden') rows = rows.filter(r => isHidden(ent, r));
    else if (f === 'issues') rows = rows.filter(r => issuesOf(ent, r).length);
    else if (f === 'noimg') rows = rows.filter(r => !imagesOfFilm(r).some(g => collapse(g[G.status]) !== 'x'));
    else if (f === 'dup') rows = rows.filter(r => (X().filmByTitle.get(collapse(r[F.title])) || []).length > 1);
    else if (f === 'Yerli' || f === 'Yabancı') rows = rows.filter(r => collapse(r[F.origin]) === f);
    else if (f === 'nofilm') rows = rows.filter(r => !filmsOfPlace(r).length);
    else if (f === 'lost') rows = rows.filter(r => collapse(r[M.lost]) === '1');
    const nameCol = ent === 'film' ? F.title : M.name;
    const idNum = r => { const m = ID_RE.exec(collapse(r[0])); return m ? +m[2] : r.__row; };
    const by = {
      name: (a, b) => trSort(a[nameCol], b[nameCol]),
      year: (a, b) => (parseInt(a[F.year], 10) || 9999) - (parseInt(b[F.year], 10) || 9999) || trSort(a[nameCol], b[nameCol]),
      district: (a, b) => trSort(a[M.district] || 'zzz', b[M.district] || 'zzz') || trSort(a[nameCol], b[nameCol]),
      new: (a, b) => idNum(b) - idNum(a),
    }[L.sort] || ((a, b) => trSort(a[nameCol], b[nameCol]));
    return rows.slice().sort(by);
  }

  function renderList(ent) {
    const L = S.list[ent];
    const list = $('#list'); if (!list) return;
    const t = T(entTable(ent));
    const rows = listRows(ent);
    const shown = rows.slice(0, L.limit);
    const selKey = S.sel && S.sel.mode === 'edit' ? keyOf(t, S.sel.rowObj) : null;
    list.replaceChildren(...shown.map(r => {
      const k = keyOf(t, r);
      const iss = issuesOf(ent, r);
      const hidden = iss.some(i => i.hide);
      let thumb, title, sub;
      if (ent === 'film') {
        const cov = coverOf(r);
        thumb = cov ? h('img', { src: thumbUrl(cov[G.url], 120), alt: '', loading: 'lazy', onerror: e => { e.target.replaceWith(h('span', { class: 'ph' }, '?')); } })
          : h('span', { class: 'ph' }, (collapse(r[F.title])[0] || '—').toLocaleUpperCase('tr'));
        title = r[F.title] || '(adsız film)';
        sub = [r[F.year], splitList(r[F.director]).join(', ')].filter(Boolean).join(' · ');
      } else {
        thumb = h('span', { class: 'ph pin-ph' + (coordsOf(r[M.coord]) ? '' : ' off') }, '●');
        title = r[M.name] || '(adsız mekan)';
        sub = [r[M.category], r[M.district], `${filmsOfPlace(r).length} film`].filter(Boolean).join(' · ');
      }
      return h('li', {
        dataset: { key: k }, 'aria-selected': String(k === selKey),
        onclick: async () => { if (k !== selKey && await guard()) openEntity(ent, r); },
      }, h('span', { class: 'thumb' }, thumb),
      h('span', { class: 'li-main' }, h('span', { class: 'li-title' }, title), h('span', { class: 'li-sub' }, sub)),
      iss.length ? h('span', { class: 'dot' + (hidden ? ' hide' : ''), title: iss.map(i => i.text).join('\n') }) : h('span'));
    }), ...(rows.length > shown.length ? [h('li', { class: 'more', onclick: () => { L.limit += CFG.PAGE_SIZE; renderList(ent); } }, `+ ${rows.length - shown.length} kayıt daha`)] : []));
    $('#list-count').textContent = rows.length === t.rows.length ? plural(rows.length, ENT_LABEL[ent].one) : `${rows.length} / ${t.rows.length} ${ENT_LABEL[ent].one}`;
  }

  function markListSelection() {
    const ent = S.view;
    if (!S.list[ent] || !$('#list')) return;
    const t = T(entTable(ent));
    const selKey = S.sel && S.sel.mode === 'edit' ? keyOf(t, S.sel.rowObj) : null;
    $$('#list li[data-key]').forEach(li => li.setAttribute('aria-selected', String(li.dataset.key === selKey)));
  }

  function renderEmptyDetail(ent) {
    $('#detail').replaceChildren(h('div', { class: 'empty' }, ENT_LABEL[ent].empty));
  }

  // ================================================================ kayıt açma / oluşturma
  function openEntity(ent, r) {
    destroyMaps();
    S.sel = { ent, mode: 'edit', rowObj: r, original: r.slice(), draft: r.slice() };
    S.conflict = null;
    renderDetail();
    markListSelection();
    setHash();
    const li = $(`#list li[data-key="${CSS.escape(keyOf(T(entTable(ent)), r))}"]`);
    if (li) li.scrollIntoView({ block: 'nearest' });
  }

  function startCreate(ent, prefill) {
    destroyMaps();
    const t = T(entTable(ent));
    const blank = t.headers.map(() => '');
    S.sel = { ent, mode: 'create', rowObj: null, original: blank.slice(), draft: blank.slice() };
    if (ent === 'film') S.sel.draft[F.origin] = 'Yerli';
    Object.entries(prefill || {}).forEach(([i, v]) => { S.sel.draft[i] = v; });
    S.sel.original = S.sel.draft.slice(); // varsayılanlar "değişiklik" sayılmaz
    S.conflict = null;
    renderDetail();
    markListSelection();
    setHash();
    const first = $('#detail input[type=text]');
    if (first) first.focus();
  }

  function changedCols() {
    if (!S.sel) return [];
    const out = [];
    S.sel.draft.forEach((v, i) => { if (String(v ?? '') !== String(S.sel.original[i] ?? '')) out.push(i); });
    return out;
  }
  const isDirty = () => !!S.sel && changedCols().length > 0;

  async function guard() {
    if (!isDirty()) return true;
    const v = await modal('Kaydedilmemiş değişiklik', h('p', null, 'Bu kayıtta kaydedilmemiş değişiklikler var.'),
      [{ label: 'Vazgeç', value: false }, { label: 'Kaydetmeden çık', kind: 'danger', value: 'discard' }, { label: 'Kaydet', kind: 'primary', value: 'save' }]);
    if (v === 'discard') { S.sel.draft = S.sel.original.slice(); return true; }
    if (v === 'save') return await saveEntity();
    return false;
  }

  // ================================================================ DETAY
  function renderDetail() {
    destroyMaps();
    const { ent, mode, draft } = S.sel;
    const creating = mode === 'create';
    const t = T(entTable(ent));
    const titleCol = ent === 'film' ? F.title : M.name;

    const head = h('div', { class: 'd-head' },
      h('div', { class: 'd-title' },
        h('div', { class: 'kicker' }, creating ? `Yeni ${ENT_LABEL[ent].one}` : `${ENT_LABEL[ent].One} · ${keyLabel(t, S.sel.rowObj)}`),
        h('h2', { id: 'd-h2' }, collapse(draft[titleCol]) || (creating ? `Yeni ${ENT_LABEL[ent].one}` : '—')),
        h('div', { id: 'd-status' })),
      h('div', { class: 'd-actions' },
        h('span', { class: 'dirty-note', id: 'dirty-note' }),
        !creating ? h('button', { class: 'btn danger', id: 'btn-delete', onclick: deleteEntity }, 'Sil') : null,
        h('button', { class: 'btn', id: 'btn-revert', onclick: revert }, creating ? 'İptal' : 'Değişiklikleri geri al'),
        h('button', { class: 'btn primary', id: 'btn-save', onclick: saveEntity, title: 'Ctrl+S' }, creating ? ENT_LABEL[ent].save : 'Kaydet')));

    const body = ent === 'film' ? filmForm() : mekanForm();
    body.append(otherFields(t));
    $('#detail').replaceChildren(head, conflictBox(), body);
    $('#detail').scrollTop = 0;
    refreshState();
  }

  /** Başlık altındaki "haritada görünür/görünmez" durumu + kaydet düğmesi */
  function refreshState() {
    if (!S.sel) return;
    const { ent, draft } = S.sel;
    const iss = issuesOf(ent, draft);
    const hide = iss.filter(i => i.hide);
    const st = $('#d-status');
    if (st) st.replaceChildren(hide.length
      ? h('span', { class: 'pill bad' }, 'Haritada görünmeyecek: ' + hide.map(i => i.text.toLocaleLowerCase('tr')).join(', '))
      : h('span', { class: 'pill ok' }, 'Haritada görünür'),
      ...iss.filter(i => !i.hide).map(i => h('span', { class: 'pill warn' }, i.text)));
    const ch = changedCols();
    $$('#detail [data-col]').forEach(f => f.classList.toggle('changed', ch.includes(+f.dataset.col)));
    const note = $('#dirty-note'); if (note) note.textContent = ch.length ? 'Kaydedilmemiş değişiklik var' : '';
    const sv = $('#btn-save'); if (sv) sv.disabled = S.saving || (S.sel.mode === 'edit' && !ch.length && !!collapse(S.sel.original[0]));
    const rv = $('#btn-revert'); if (rv && S.sel.mode === 'edit') rv.disabled = !ch.length;
    const h2 = $('#d-h2'); const tc = ent === 'film' ? F.title : M.name;
    if (h2) h2.textContent = collapse(draft[tc]) || (S.sel.mode === 'create' ? `Yeni ${ENT_LABEL[ent].one}` : '—');
  }

  function setVal(col, v) { S.sel.draft[col] = v; refreshState(); }

  // ---------------------------------------------------------------- form parçaları
  function field(col, label, control, opts) {
    opts = opts || {};
    return h('div', { class: 'field' + (opts.wide ? ' wide' : ''), dataset: { col } },
      h('label', { class: 'lbl', for: opts.forId || null }, label, opts.required ? h('span', { class: 'req', title: 'Gerekli' }, ' *') : null),
      control,
      opts.hint ? h('div', { class: 'hint' }, opts.hint) : null,
      h('div', { class: 'warn', id: 'w' + col }));
  }

  function textInput(col, opts) {
    opts = opts || {};
    return h('input', { type: 'text', id: 'f' + col, value: S.sel.draft[col] || '', placeholder: opts.placeholder || null,
      inputmode: opts.numeric ? 'numeric' : null, maxlength: opts.max || null, list: opts.list || null, autocomplete: 'off',
      oninput: e => { setVal(col, e.target.value); if (opts.after) opts.after(e.target.value); } });
  }

  function segmented(col, options) {
    const wrap = h('div', { class: 'seg', role: 'radiogroup', id: 'f' + col });
    const paint = () => $$('button', wrap).forEach(b => b.setAttribute('aria-checked', String(b.dataset.v === collapse(S.sel.draft[col]))));
    options.forEach(o => wrap.append(h('button', { type: 'button', role: 'radio', dataset: { v: o }, onclick: () => { setVal(col, o); paint(); } }, o)));
    paint();
    return wrap;
  }

  /** Etiket alanı: virgülle ayrılmış değerler (yönetmen, tür). primary → ilk etiket "ana" */
  function tagInput(col, suggestions, opts) {
    opts = opts || {};
    const listId = 'dl-' + col;
    const box = h('div', { class: 'chips', id: 'chips-' + col });
    const input = h('input', { type: 'text', id: 'f' + col, list: listId, autocomplete: 'off', placeholder: opts.placeholder || 'Yazın, Enter…' });
    const items = () => splitList(S.sel.draft[col]);
    const write = a => { setVal(col, joinList(a)); paint(); };
    function paint() {
      const a = items();
      box.replaceChildren(...a.map((v, i) => h('span', { class: 'chip' + (opts.primary && i === 0 ? ' primary' : '') },
        opts.primary && i === 0 ? h('span', { class: 'chip-badge', title: 'Haritada ana tür olarak kullanılır' }, 'ana') : null,
        opts.primary && i > 0 ? h('button', { type: 'button', class: 'chip-up', title: 'Ana tür yap', onclick: () => { const b = items(); b.unshift(b.splice(i, 1)[0]); write(b); } }, '↑') : null,
        v,
        h('button', { type: 'button', class: 'chip-x', title: 'Çıkar', onclick: () => { const b = items(); b.splice(i, 1); write(b); } }, '×'))), input);
    }
    function commit() {
      const parts = splitList(input.value);
      if (!parts.length) return;
      input.value = '';
      const a = items();
      parts.forEach(p => { if (!a.some(x => fold(x) === fold(p))) a.push(p); });
      write(a); input.focus();
    }
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); commit(); }
      else if (e.key === 'Backspace' && !input.value) { const a = items(); a.pop(); write(a); input.focus(); }
    });
    input.addEventListener('input', e => { if ((!e.inputType || e.inputType === 'insertReplacementText') && suggestions.includes(input.value)) commit(); });
    input.addEventListener('blur', commit);
    paint();
    return h('div', null, box, h('datalist', { id: listId }, suggestions.map(s => h('option', { value: s }))));
  }

  function selectWithNew(col, options, newLabel) {
    const sel = h('select', { id: 'f' + col });
    const fill = () => {
      const cur = collapse(S.sel.draft[col]);
      const opts = options.slice();
      if (cur && !opts.includes(cur)) opts.unshift(cur);
      sel.replaceChildren(h('option', { value: '' }, '— seçin —'), ...opts.map(o => h('option', { value: o, selected: o === cur }, o)),
        newLabel ? h('option', { value: '__new__' }, newLabel) : null);
      sel.value = cur;
    };
    sel.addEventListener('change', async () => {
      if (sel.value === '__new__') {
        const v = await promptBox(newLabel.replace(/^＋\s*/, ''), 'Ad');
        if (v) { if (!options.includes(v)) options.push(v); options.sort(trSort); setVal(col, v); }
        fill();
      } else setVal(col, sel.value);
    });
    fill();
    return sel;
  }

  function toggle(col, label) {
    return h('label', { class: 'switch' },
      h('input', { type: 'checkbox', id: 'f' + col, checked: collapse(S.sel.draft[col]) === '1', onchange: e => setVal(col, e.target.checked ? '1' : '') }),
      h('span', { class: 'switch-ui' }), label);
  }

  function section(title, ...kids) {
    return h('section', { class: 'sec' }, h('h3', { class: 'sec-h' }, title), ...kids);
  }

  /** Şemada tanımlı olmayan sütunlar — hiçbir veri gizli kalmasın */
  function otherFields(t) {
    const known = new Set(Object.values(t.name === F.sheet ? F : M).filter(v => typeof v === 'number'));
    const cols = t.headers.map((_, i) => i).filter(i => i > 0 && !known.has(i));
    if (!cols.length) return h('div');
    return section('Diğer alanlar', h('div', { class: 'grid' }, cols.map(i => field(i, t.headers[i] || `Sütun ${i + 1}`,
      t.formulaCols.has(i) ? h('input', { type: 'text', value: S.sel.draft[i] || '', readonly: true, title: 'Formülle hesaplanır' }) : textInput(i),
      { hint: t.formulaCols.has(i) ? 'Tabloda formülle hesaplanır' : null }))));
  }

  // ---------------------------------------------------------------- FİLM formu
  function filmForm() {
    const d = S.sel.draft;
    const x = X();
    const künye = section('Künye', h('div', { class: 'grid' },
      field(F.title, 'Film adı', textInput(F.title, { after: () => paintDupTitle() }), { required: true, wide: true, forId: 'f' + F.title,
        hint: 'Görseller filme bu adla bağlanır; ad değişirse görsellerdeki ad da güncellenir.' }),
      field(F.origin, 'Yapım', segmented(F.origin, F.origins), { required: true }),
      field(F.year, 'Çekim yılı', textInput(F.year, { numeric: true, max: 4, placeholder: 'ör. 1963', after: () => paintYear() }), { forId: 'f' + F.year }),
      field(F.origTitle, 'Orijinal adı', textInput(F.origTitle), { forId: 'f' + F.origTitle, hint: 'Yabancı filmlerde haritada film adının yanında parantez içinde gösterilir.' }),
      field(F.director, 'Yönetmen', tagInput(F.director, x.directors, { placeholder: 'Yönetmen adı yazın ya da listeden seçin, Enter…' }),
        { hint: 'Birden fazla yönetmen eklenebilir. Listede yoksa yazıp Enter\'a basın.' }),
      field(F.genre, 'Tür', tagInput(F.genre, x.genres, { primary: true, placeholder: 'Tür yazın ya da seçin, Enter…' }),
        { required: true, hint: 'İlk tür haritada ana tür (filtre) olarak kullanılır; ↑ ile değiştirin.' })));
    const desc = h('textarea', { id: 'f' + F.desc, value: d[F.desc] || '', rows: 6, oninput: e => { setVal(F.desc, e.target.value); cnt.textContent = e.target.value.length + ' karakter'; } });
    const cnt = h('span', { class: 'muted' }, (d[F.desc] || '').length + ' karakter');
    const aciklama = section('Açıklama', field(F.desc, 'Film açıklaması', desc, { wide: true }), cnt);

    const yerler = section('Çekim yerleri', field(F.places, 'Çekildiği yerler', placesEditor(), { required: true, wide: true,
      hint: 'Mekanlar\'daki adla eşleşen yerler haritada gösterilir. Eşleşmeyen yer turuncu görünür; mekan olarak ekleyebilirsiniz.' }),
    h('div', { class: 'map small', id: 'places-map' }));

    const gal = S.sel.mode === 'create'
      ? section('Görseller', h('p', { class: 'muted' }, 'Görsel eklemek için önce filmi kaydedin.'))
      : section('Görseller', filmGallery());

    setTimeout(() => { paintDupTitle(); paintYear(); initPlacesMap(); });
    return h('div', { class: 'form' }, künye, aciklama, yerler, gal);
  }

  function paintDupTitle() {
    const w = $('#w' + F.title); if (!w) return;
    const v = collapse(S.sel.draft[F.title]);
    const same = (X().filmByTitle.get(v) || []).filter(r => r !== S.sel.rowObj);
    w.textContent = !v ? 'Film adı gerekli.' : same.length ? `Aynı adla kayıtlı film var: ${same.map(r => `${r[F.id]} (${r[F.year] || 'yıl yok'})`).join(', ')} — görseller ikisine birden bağlanır.` : '';
  }
  function paintYear() {
    const w = $('#w' + F.year); if (!w) return;
    const v = collapse(S.sel.draft[F.year]);
    w.textContent = v && !/^\d{4}$/.test(v) ? 'Yıl 4 haneli olmalı.' : '';
  }

  // çekim yerleri çipleri
  function placesEditor() {
    const col = F.places;
    const mt = T(M.sheet);
    const box = h('div', { class: 'chips' });
    const input = h('input', { type: 'text', id: 'f' + col, list: 'dl-places', placeholder: 'Mekan adı yazın, Enter…', autocomplete: 'off' });
    const items = () => splitList(S.sel.draft[col]);
    const write = a => { setVal(col, joinList(a)); paint(); refreshPlacesMap(); };
    function paint() {
      box.replaceChildren(...items().map((name, i) => {
        const hits = placeMatch(name);
        const short = norm(name).length < CFG.PLACE_MIN_LEN;
        const exact = hits && collapse(hits[0][M.name]) === collapse(name);
        return h('span', { class: 'chip' + (hits ? '' : ' miss'), title: hits ? (exact ? hits[0][M.id] : `Mekanlar'daki yazım: "${hits[0][M.name]}"`) : short ? 'Çok kısa; harita yok sayar' : 'Mekanlar\'da yok' },
          hits ? h('a', { href: '#', onclick: async e => { e.preventDefault(); if (await guard()) go('mekan', hits[0][M.id]); } }, name) : name,
          hits && !exact ? h('span', { class: 'alt', title: 'Yazımı farklı ama eşleşiyor' }, '≈') : null,
          !hits && !short ? h('button', { type: 'button', class: 'chip-add', onclick: () => createPlaceFrom(name) }, '+ mekan') : null,
          h('button', { type: 'button', class: 'chip-x', title: 'Çıkar', onclick: () => { const a = items(); a.splice(i, 1); write(a); } }, '×'));
      }), input);
    }
    function commit() {
      const parts = splitList(input.value);
      if (!parts.length) return;
      input.value = '';
      const a = items();
      parts.forEach(p => { if (!a.some(x => norm(x) === norm(p))) a.push(p); });
      write(a); input.focus();
    }
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); commit(); }
      else if (e.key === 'Backspace' && !input.value) { const a = items(); a.pop(); write(a); input.focus(); }
    });
    input.addEventListener('input', e => { if ((!e.inputType || e.inputType === 'insertReplacementText') && placeMatch(input.value)) commit(); });
    input.addEventListener('blur', commit);
    paint();
    return h('div', null, box, h('datalist', { id: 'dl-places' }, mt.rows.map(r => h('option', { value: r[M.name] }))));
  }

  async function createPlaceFrom(name) {
    if (!(await guard())) return;
    go('mekan', null, { create: true, prefill: { [M.name]: name } });
    toast(`"${name}" için yeni mekan açıldı. Konumu ve kategoriyi girip kaydedin.`);
  }

  // ---------------------------------------------------------------- MEKAN formu
  function mekanForm() {
    const x = X();
    const bilgi = section('Bilgiler', h('div', { class: 'grid' },
      field(M.name, 'Mekan adı', textInput(M.name, { after: () => paintDupPlace() }), { required: true, wide: true, forId: 'f' + M.name,
        hint: 'Filmlerdeki çekim yeri adlarıyla eşleşir; ad değişirse filmlerdeki ve görsellerdeki ad da güncellenir.' }),
      field(M.category, 'Kategori', selectWithNew(M.category, x.categories.slice(), '＋ Yeni kategori…'), { required: true, forId: 'f' + M.category }),
      field(M.district, 'İlçe', selectWithNew(M.district, x.districts.slice(), null), { forId: 'f' + M.district }),
      field(M.lost, 'Durum', toggle(M.lost, 'Kayıp eser (artık mevcut değil)'), { hint: 'Haritada "Kayıp Eser" rozetiyle gösterilir.' })));
    const konum = section('Konum', field(M.coord, 'Koordinat', h('div', { class: 'coord-row' },
      textInput(M.coord, { placeholder: 'enlem, boylam — ör. 41.0201, 28.9733', after: () => { paintCoord(); syncPicker(); } }),
      h('span', { class: 'muted' }, 'Google Haritalar\'dan kopyalanan koordinat yapıştırılabilir.')), { required: true, wide: true, forId: 'f' + M.coord }),
    h('div', { class: 'geo' },
      h('input', { type: 'search', id: 'geo-q', placeholder: 'Adres ya da yer ara (ör. Kız Kulesi, Üsküdar)…', onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); geocode(); } } }),
      h('button', { class: 'btn', type: 'button', onclick: geocode }, 'Ara'),
      h('ul', { class: 'geo-res', id: 'geo-res' })),
    h('div', { class: 'map', id: 'coord-map' }),
    h('p', { class: 'muted' }, 'Haritaya tıklayın ya da iğneyi sürükleyin.'));
    const parts = [bilgi, konum];
    if (S.sel.mode === 'edit') {
      const films = filmsOfPlace(S.sel.original).slice().sort((a, b) => (parseInt(a[F.year], 10) || 0) - (parseInt(b[F.year], 10) || 0));
      parts.push(section('Bu mekanda çekilen filmler',
        films.length ? h('ul', { class: 'film-links' }, films.map(f => h('li', null,
          h('a', { href: '#', onclick: async e => { e.preventDefault(); if (await guard()) go('film', f[F.id]); } }, f[F.title]),
          h('span', { class: 'muted' }, ' ' + [f[F.year], splitList(f[F.director]).join(', ')].filter(Boolean).join(' · ')))))
          : h('p', { class: 'muted' }, 'Bu adla eşleşen film yok. Mekan filmsiz olduğu için haritada gösterilmez.')));
      const imgs = sortImages(imagesOfPlace(S.sel.original));
      parts.push(section('Bu mekandaki görseller', imgs.length ? h('div', { class: 'gallery' }, imgs.map(g => imageCard(g, { showFilm: true })))
        : h('p', { class: 'muted' }, 'Bu mekana işaretlenmiş görsel yok. Görseller film sayfasından eklenir.')));
    }
    setTimeout(() => { paintDupPlace(); paintCoord(); initPicker(); });
    return h('div', { class: 'form' }, ...parts);
  }

  function paintDupPlace() {
    const w = $('#w' + M.name); if (!w) return;
    const v = collapse(S.sel.draft[M.name]);
    const same = (X().mekanByNorm.get(norm(v)) || []).filter(r => r !== S.sel.rowObj);
    w.textContent = !v ? 'Mekan adı gerekli.' : same.length ? `Aynı adla mekan var: ${same.map(r => `${r[M.id]} ${r[M.name]}`).join(', ')}` : '';
  }
  function paintCoord() {
    const w = $('#w' + M.coord); if (!w) return;
    const v = collapse(S.sel.draft[M.coord]);
    const c = coordsOf(v);
    w.textContent = !v ? 'Konum girilmezse mekan haritada görünmez.' : !c ? 'Biçim "enlem, boylam" olmalı.' : !inIstanbul(c) ? 'Konum İstanbul dışında görünüyor (enlem ile boylam yer değiştirmiş olabilir).' : '';
  }

  async function geocode() {
    const q = collapse($('#geo-q').value);
    const res = $('#geo-res');
    if (!q) return;
    res.replaceChildren(h('li', { class: 'muted' }, 'Aranıyor…'));
    const b = CFG.ISTANBUL_BBOX;
    try {
      const url = `${CFG.GEOCODER}?format=jsonv2&limit=6&accept-language=tr&countrycodes=tr&bounded=1&viewbox=${b[0]},${b[3]},${b[2]},${b[1]}&q=${encodeURIComponent(q)}`;
      const data = await (await fetch(url, { headers: { Accept: 'application/json' } })).json();
      res.replaceChildren(...(data.length ? data.map(d => h('li', null, h('button', { type: 'button', onclick: () => {
        const lat = (+d.lat).toFixed(6), lon = (+d.lon).toFixed(6);
        setCoord(lat, lon, true); res.replaceChildren();
      } }, d.display_name))) : [h('li', { class: 'muted' }, 'Sonuç yok.')]));
    } catch (e) {
      res.replaceChildren(h('li', { class: 'muted' }, 'Arama yapılamadı.'));
    }
  }

  function setCoord(lat, lon, fly) {
    const v = `${lat}, ${lon}`;
    setVal(M.coord, v);
    const inp = $('#f' + M.coord); if (inp) inp.value = v;
    paintCoord();
    syncPicker(fly);
  }

  // ---------------------------------------------------------------- haritalar
  function destroyMaps() { S.maps.forEach(m => { try { m.remove(); } catch (e) { /* */ } }); S.maps = []; }

  function newMap(el, center, zoom) {
    if (!el) return null;
    if (!window.maplibregl) { el.replaceChildren(h('div', { class: 'map-msg' }, 'Harita yüklenemedi.')); return null; }
    try {
      const m = new maplibregl.Map({ container: el, style: CFG.BASEMAP_STYLE, center, zoom, attributionControl: { compact: true } });
      m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
      S.maps.push(m);
      return m;
    } catch (e) { el.replaceChildren(h('div', { class: 'map-msg' }, 'Harita açılamadı (WebGL).')); return null; }
  }

  let picker = null;
  function initPicker() {
    const c = coordsOf(S.sel.draft[M.coord]);
    const m = newMap($('#coord-map'), c || CFG.MAP_CENTER, c ? 15 : CFG.MAP_ZOOM);
    if (!m) return;
    const marker = new maplibregl.Marker({ element: h('div', { class: 'pin' }), draggable: true });
    if (c) marker.setLngLat(c).addTo(m);
    marker.on('dragend', () => { const ll = marker.getLngLat(); setCoord(ll.lat.toFixed(6), ll.lng.toFixed(6)); });
    m.on('click', e => { marker.setLngLat(e.lngLat).addTo(m); setCoord(e.lngLat.lat.toFixed(6), e.lngLat.lng.toFixed(6)); });
    m.on('load', () => {
      const feats = T(M.sheet).rows.filter(r => r !== S.sel.rowObj).map(r => {
        const p = coordsOf(r[M.coord]);
        return p ? { type: 'Feature', geometry: { type: 'Point', coordinates: p }, properties: { name: r[M.name] } } : null;
      }).filter(Boolean);
      m.addSource('others', { type: 'geojson', data: { type: 'FeatureCollection', features: feats } });
      m.addLayer({ id: 'others', type: 'circle', source: 'others', paint: { 'circle-radius': 4, 'circle-color': '#111', 'circle-opacity': 0.3, 'circle-stroke-width': 1, 'circle-stroke-color': '#fff' } });
      if (m.getStyle().glyphs) m.addLayer({ id: 'others-l', type: 'symbol', source: 'others', minzoom: 14, layout: { 'text-field': ['get', 'name'], 'text-size': 11, 'text-offset': [0, 1], 'text-anchor': 'top' }, paint: { 'text-color': '#555', 'text-halo-color': '#fff', 'text-halo-width': 1 } });
    });
    picker = { m, marker };
  }
  function syncPicker(fly) {
    if (!picker || !S.maps.includes(picker.m)) return;
    const c = coordsOf(S.sel.draft[M.coord]);
    if (c) { picker.marker.setLngLat(c).addTo(picker.m); fly ? picker.m.flyTo({ center: c, zoom: 16 }) : picker.m.easeTo({ center: c }); }
    else picker.marker.remove();
  }

  let placesMap = null;
  function placesFeatures() {
    return splitList(S.sel.draft[F.places]).map(p => {
      const hit = placeMatch(p); const c = hit && coordsOf(hit[0][M.coord]);
      return c ? { type: 'Feature', geometry: { type: 'Point', coordinates: c }, properties: { name: hit[0][M.name] } } : null;
    }).filter(Boolean);
  }
  function initPlacesMap() {
    const el = $('#places-map'); if (!el) return;
    const m = newMap(el, CFG.MAP_CENTER, 10);
    if (!m) return;
    placesMap = m;
    m.on('load', () => {
      m.addSource('pl', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      m.addLayer({ id: 'pl', type: 'circle', source: 'pl', paint: { 'circle-radius': 6, 'circle-color': '#d7261e', 'circle-stroke-width': 2, 'circle-stroke-color': '#fff' } });
      if (m.getStyle().glyphs) m.addLayer({ id: 'pl-l', type: 'symbol', source: 'pl', layout: { 'text-field': ['get', 'name'], 'text-size': 11, 'text-offset': [0, 1.1], 'text-anchor': 'top' }, paint: { 'text-color': '#333', 'text-halo-color': '#fff', 'text-halo-width': 1 } });
      refreshPlacesMap();
    });
  }
  function refreshPlacesMap() {
    if (!placesMap || !S.maps.includes(placesMap) || !placesMap.getSource('pl')) return;
    const feats = placesFeatures();
    placesMap.getSource('pl').setData({ type: 'FeatureCollection', features: feats });
    if (feats.length === 1) placesMap.jumpTo({ center: feats[0].geometry.coordinates, zoom: 14 });
    else if (feats.length > 1) {
      const b = new maplibregl.LngLatBounds();
      feats.forEach(f => b.extend(f.geometry.coordinates));
      placesMap.fitBounds(b, { padding: 40, maxZoom: 14, duration: 0 });
    }
  }

  // ================================================================ GÖRSELLER
  /** Film sayfasındaki galeri + yükleme alanı */
  function filmGallery() {
    const film = S.sel.rowObj;
    const wrap = h('div', { class: 'film-gallery' });
    const placeOpts = () => splitList(film[F.places]).filter(p => placeMatch(p));
    const placeSel = h('select', { id: 'up-place', 'aria-label': 'Yeni görsellerin mekanı' },
      h('option', { value: '' }, '— mekan belirtilmedi —'), placeOpts().map(p => h('option', { value: p }, p)));
    const uploader = uploaderBox(film, () => placeSel.value, () => paintGrid());
    const grid = h('div', { class: 'gallery', id: 'film-grid' });
    function paintGrid() {
      const imgs = sortImages(imagesOfFilm(film));
      grid.replaceChildren(...(imgs.length ? imgs.map(g => imageCard(g, { film, onChange: paintGrid })) : [h('p', { class: 'muted' }, 'Henüz görsel yok.')]));
    }
    paintGrid();
    wrap.append(
      h('div', { class: 'up-head' }, h('label', { class: 'lbl', for: 'up-place' }, 'Eklenecek görsellerin mekanı'), placeSel),
      uploader,
      h('p', { class: 'hint' }, '★ Öncelikli görseller haritada önce gösterilir. Gizli görseller haritada gösterilmez ama kayıtta kalır.'),
      grid);
    return wrap;
  }

  /** Sürükle-bırak / dosya seç / bağlantı ile ekleme kutusu */
  function uploaderBox(film, getPlace, onDone) {
    const fileInput = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true, onchange: e => { handleFiles(e.target.files); e.target.value = ''; } });
    const status = h('div', { class: 'up-status', id: 'up-status' });
    const drop = h('div', { class: 'drop', tabindex: '0',
      ondragover: e => { e.preventDefault(); drop.classList.add('over'); },
      ondragleave: () => drop.classList.remove('over'),
      ondrop: e => { e.preventDefault(); drop.classList.remove('over'); handleFiles(e.dataTransfer.files); },
      onkeydown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } } },
    h('div', { class: 'drop-t' }, 'Görselleri buraya sürükleyip bırakın'),
    h('div', null, 'ya da ', h('button', { type: 'button', class: 'btn', onclick: () => fileInput.click() }, 'Bilgisayardan seçin')),
    h('div', { class: 'muted' }, 'Drive\'daki "Film Görselleri" klasörüne yüklenir. Büyük görseller otomatik küçültülür.'), fileInput);
    const linkIn = h('input', { type: 'url', placeholder: 'ya da görsel bağlantısı yapıştırın (Drive paylaşım linki ya da https://…)', onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); addLink(); } } });
    const link = h('div', { class: 'link-add' }, linkIn, h('button', { type: 'button', class: 'btn', onclick: addLink }, 'Bağlantıyı ekle'));

    async function handleFiles(list) {
      const files = Array.from(list || []).filter(f => /^image\//.test(f.type));
      if (!files.length) { toast('Yalnızca görsel dosyaları yüklenebilir.', 'err'); return; }
      let ok = 0, notShared = 0;
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        status.textContent = `Yükleniyor ${i + 1} / ${files.length}: ${f.name}`;
        if (f.size > CFG.UPLOAD_MAX_MB * 1048576) { toast(`${f.name}: ${CFG.UPLOAD_MAX_MB} MB'tan büyük.`, 'err'); continue; }
        try {
          const prep = await prepareImage(f, film);
          const res = await S.adapter.upload(G.sheet, prep, gorselValues(film, getPlace()), { urlCol: G.url, autoId: S.gorselCol0 === 'auto' });
          addRow(T(G.sheet), res.row, res.rowNum);
          if (!res.shared) notShared++;
          ok++;
          onDone();
        } catch (e) {
          toast(`${f.name} yüklenemedi: ${e.message}`, 'err');
        }
      }
      status.textContent = '';
      if (ok) toast(`${ok} görsel eklendi.`, 'ok');
      if (notShared) toast(`${notShared} görsel "bağlantıya sahip herkes" olarak paylaşılamadı; haritada görünmeyebilir. Drive'da paylaşım ayarını kontrol edin.`, 'err');
      afterImagesChanged();
    }
    async function addLink() {
      const url = collapse(linkIn.value);
      if (!/^https?:\/\/\S+$/.test(url)) { toast('Geçerli bir bağlantı girin (https://…).', 'err'); return; }
      try {
        const values = gorselValues(film, getPlace()); values[G.url] = url;
        const res = await S.adapter.create(G.sheet, values, { autoId: S.gorselCol0 === 'auto' });
        addRow(T(G.sheet), res.row, res.rowNum);
        linkIn.value = '';
        toast('Görsel bağlantısı eklendi.', 'ok');
        onDone(); afterImagesChanged();
      } catch (e) { toast('Eklenemedi: ' + e.message, 'err'); }
    }
    return h('div', { class: 'uploader' }, drop, link, status);
  }

  function gorselValues(film, place) {
    const v = { [G.film]: collapse(film[F.title]), [G.status]: '' };
    if (place) v[G.place] = place;
    if (S.gorselCol0 === 'filmId') v[0] = film[F.id];
    return v;
  }

  /** Görseli küçültüp JPEG'e çevirir; base64 döner */
  async function prepareImage(file, film) {
    const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '');
    const base = `${collapse(film[F.title]) || 'film'} (${film[F.id]}) ${stamp}`.replace(/[\\/:*?"<>|]+/g, ' ');
    let blob = file, ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
    if (!/gif|svg/.test(file.type) && window.createImageBitmap) {
      try {
        const bmp = await createImageBitmap(file);
        const k = Math.min(1, CFG.UPLOAD_MAX_PX / Math.max(bmp.width, bmp.height));
        const cv = document.createElement('canvas');
        cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
        const ctx = cv.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
        ctx.drawImage(bmp, 0, 0, cv.width, cv.height);
        const out = await new Promise(r => cv.toBlob(r, 'image/jpeg', CFG.UPLOAD_QUALITY));
        if (out && (out.size < file.size || k < 1 || file.type !== 'image/jpeg')) { blob = out; ext = 'jpg'; }
      } catch (e) { /* dönüştürülemezse özgün dosya */ }
    }
    const data = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1]); fr.onerror = rej; fr.readAsDataURL(blob); });
    return { name: `${base}.${ext}`, mimeType: blob.type || file.type || 'image/jpeg', data };
  }

  function addRow(t, row, rowNum) {
    const r = row.slice(); r.__row = rowNum;
    while (r.length < t.headers.length) r.push('');
    t.rows.push(r); reindex(t); invalidate();
    return r;
  }
  function replaceRow(t, oldRow, row, rowNum) {
    const r = row.slice(); r.__row = rowNum;
    while (r.length < t.headers.length) r.push('');
    const i = t.rows.indexOf(oldRow);
    if (i >= 0) t.rows[i] = r; else t.rows.push(r);
    reindex(t); invalidate();
    return r;
  }
  function dropRow(t, oldRow, rowNum) {
    t.rows = t.rows.filter(r => r !== oldRow);
    if (!t.hasIds) t.rows.forEach(r => { if (r.__row > rowNum) r.__row--; });
    reindex(t); invalidate();
  }
  function afterImagesChanged() { renderNav(); if (S.view === 'film' || S.view === 'mekan') renderList(S.view); }

  /** Görsel kartı: önizleme, durum, mekan, düzenle, sil — değişiklikler anında kaydedilir */
  function imageCard(g, ctx) {
    ctx = ctx || {};
    const st = collapse(g[G.status]);
    const issues = gorselIssues(g);
    const card = h('figure', { class: 'gcard' + (st === 'x' ? ' hidden-img' : '') + (st === '1' ? ' prio' : ''), dataset: { key: keyOf(T(G.sheet), g) } });
    const img = h('img', { src: thumbUrl(g[G.url], 480), alt: '', loading: 'lazy', onerror: () => { img.replaceWith(h('div', { class: 'noimg' }, 'Önizleme yok')); } });
    const seg = h('div', { class: 'seg small', role: 'radiogroup', 'aria-label': 'Durum' }, CFG.STATUS.map(s => h('button', {
      type: 'button', role: 'radio', 'aria-checked': String(st === s.v), title: s.label,
      onclick: () => { if (st !== s.v) updateImage(g, { [G.status]: s.v }, ctx); },
    }, s.v === '1' ? '★ Öncelikli' : s.label)));
    const filmLink = ctx.showFilm ? h('a', { href: '#', class: 'g-film', onclick: async e => {
      e.preventDefault();
      const f = (X().filmByTitle.get(collapse(g[G.film])) || [])[0];
      if (f && await guard()) go('film', f[F.id]);
    } }, g[G.film] || '(film yok)') : null;
    const placeLine = h('span', { class: 'g-place' }, collapse(g[G.place]) ? g[G.place] : 'mekan belirtilmedi');
    card.append(
      h('div', { class: 'g-img' }, img, st === '1' ? h('span', { class: 'g-badge' }, '★') : null, st === 'x' ? h('span', { class: 'g-badge dim' }, 'gizli') : null),
      h('figcaption', null,
        filmLink, placeLine,
        issues.length ? h('span', { class: 'g-warn' }, issues.map(i => i.text).join(' · ')) : null,
        seg,
        h('div', { class: 'g-acts' },
          h('button', { type: 'button', class: 'linkbtn', onclick: () => editImage(g, ctx) }, 'Düzenle'),
          collapse(g[G.url]) && !String(g[G.url]).startsWith('data:') ? h('a', { class: 'linkbtn', href: g[G.url], target: '_blank', rel: 'noopener' }, 'Aç ↗') : null,
          h('button', { type: 'button', class: 'linkbtn danger', onclick: () => deleteImage(g, ctx) }, 'Sil'))));
    return card;
  }

  async function updateImage(g, changes, ctx) {
    const t = T(G.sheet);
    try {
      const res = await S.adapter.update(G.sheet, refOf(t, g), changes, fullExpected(t, g));
      replaceRow(t, g, res.row, res.rowNum);
      afterImagesChanged();
      repaintImages(ctx);
    } catch (e) { imageError(e); }
  }

  function imageError(e) {
    if (e.code === 'conflict' || e.code === 'not_found') {
      toast('Görseller bu arada değişmiş; veri yeniden yükleniyor.', 'err');
      reload();
    } else toast('Kaydedilemedi: ' + e.message, 'err');
  }

  function repaintImages(ctx) {
    if (ctx && ctx.onChange) ctx.onChange();
    else if (S.view === 'gorsel') renderGrid();
    else if (S.view === 'mekan' && S.sel) { const keep = S.sel; renderDetail(); S.sel = keep; }
  }

  async function editImage(g, ctx) {
    const ft = T(F.sheet), mt = T(M.sheet);
    const filmIn = h('input', { type: 'text', value: g[G.film] || '', list: 'dl-ed-films', autocomplete: 'off' });
    const placeIn = h('input', { type: 'text', value: g[G.place] || '', list: 'dl-ed-places', autocomplete: 'off' });
    const urlIn = h('input', { type: 'url', value: g[G.url] || '' });
    const msg = h('div', { class: 'warn' });
    const check = () => {
      const fm = X().filmByTitle.get(collapse(filmIn.value));
      const pm = !collapse(placeIn.value) || placeMatch(placeIn.value);
      msg.textContent = !fm ? 'Bu adla film yok — görsel hiçbir filmde görünmez.' : !pm ? 'Bu adla mekan yok.' : '';
    };
    filmIn.addEventListener('input', check); placeIn.addEventListener('input', check); check();
    const body = h('div', { class: 'stack' },
      h('img', { class: 'ed-prev', src: thumbUrl(g[G.url], 640), alt: '' }),
      h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Film'), filmIn),
      h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Mekan'), placeIn),
      h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Görsel adresi'), urlIn),
      msg,
      h('datalist', { id: 'dl-ed-films' }, ft.rows.map(r => h('option', { value: r[F.title] }, r[F.year]))),
      h('datalist', { id: 'dl-ed-places' }, mt.rows.map(r => h('option', { value: r[M.name] }))));
    const ok = await modal('Görseli düzenle', body, [{ label: 'Vazgeç', value: false }, { label: 'Kaydet', kind: 'primary', value: true }], { wide: true });
    if (!ok) return;
    const changes = {};
    if (collapse(filmIn.value) !== collapse(g[G.film])) changes[G.film] = collapse(filmIn.value);
    if (collapse(placeIn.value) !== collapse(g[G.place])) changes[G.place] = collapse(placeIn.value);
    if (collapse(urlIn.value) !== collapse(g[G.url])) changes[G.url] = collapse(urlIn.value);
    if (Object.keys(changes).length) await updateImage(g, changes, ctx);
  }

  async function deleteImage(g, ctx) {
    const isDrive = !!driveId(g[G.url]) && !/lh3/.test(g[G.url]);
    const trash = h('input', { type: 'checkbox', checked: true });
    const body = h('div', null,
      h('img', { class: 'ed-prev', src: thumbUrl(g[G.url], 480), alt: '' }),
      h('p', null, `"${g[G.film] || ''}" filminin bu görseli silinecek. Haritadan kaldırmak için silmek yerine "Gizli" de yapabilirsiniz.`),
      isDrive ? h('label', { class: 'check' }, trash, ' Panelden yüklenmişse Drive\'daki dosyayı da çöpe at') : null);
    const ok = await modal('Görseli sil', body, [{ label: 'Vazgeç', value: false }, { label: 'Sil', kind: 'danger', value: true }]);
    if (!ok) return;
    const t = T(G.sheet);
    try {
      const res = await S.adapter.remove(G.sheet, refOf(t, g), fullExpected(t, g), isDrive && trash.checked ? { trashFile: true, urlCol: G.url } : null);
      dropRow(t, g, res.rowNum);
      toast('Görsel silindi.', 'ok');
      afterImagesChanged();
      repaintImages(ctx);
    } catch (e) { imageError(e); }
  }

  // ---------------------------------------------------------------- Görseller bölümü
  const GFILTERS = [['all', 'Tümü'], ['prio', '★ Öncelikli'], ['normal', 'Normal'], ['hidden', 'Gizli'], ['orphan', 'Filmi bulunamayan'], ['noplace', 'Mekansız']];

  function renderGorseller() {
    const L = S.list.gorsel;
    $('#main').replaceChildren(h('div', { class: 'gview' },
      h('div', { class: 'gview-head' },
        h('h2', null, 'Görseller'),
        h('input', { id: 'list-search', type: 'search', placeholder: 'Film ya da mekan ara…', value: L.q, oninput: e => { L.q = e.target.value; L.limit = CFG.PAGE_SIZE; renderGrid(); } }),
        h('button', { class: 'btn primary', id: 'btn-new', onclick: addImagesForFilm }, '+ Görsel ekle')),
      h('div', { class: 'filters' }, GFILTERS.map(([v, l]) => h('button', { class: 'fchip', dataset: { v }, 'aria-pressed': String(L.filter === v),
        onclick: () => { L.filter = v; L.limit = CFG.PAGE_SIZE; $$('.gview .fchip').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === v))); renderGrid(); } }, l))),
      h('div', { class: 'list-count muted', id: 'list-count' }),
      h('div', { class: 'gallery big', id: 'g-grid' })));
    renderGrid();
  }

  function renderGrid() {
    const grid = $('#g-grid'); if (!grid) return;
    const L = S.list.gorsel;
    const t = T(G.sheet);
    let rows = t.rows;
    const q = fold(L.q).trim();
    if (q) rows = rows.filter(r => fold(r[G.film] + ' ' + r[G.place]).includes(q));
    const st = r => collapse(r[G.status]);
    rows = rows.filter(r => ({
      all: true, prio: st(r) === '1', normal: st(r) === '', hidden: st(r) === 'x',
      orphan: !X().filmByTitle.get(collapse(r[G.film])), noplace: !collapse(r[G.place]),
    }[L.filter]));
    rows = rows.slice().sort((a, b) => trSort(a[G.film], b[G.film]) || statusRank(a[G.status]) - statusRank(b[G.status]));
    const shown = rows.slice(0, L.limit);
    grid.replaceChildren(...shown.map(g => imageCard(g, { showFilm: true })),
      ...(rows.length > shown.length ? [h('button', { class: 'btn more-btn', onclick: () => { L.limit += CFG.PAGE_SIZE; renderGrid(); } }, `+ ${rows.length - shown.length} görsel daha`)] : []));
    $('#list-count').textContent = rows.length === t.rows.length ? `${rows.length} görsel` : `${rows.length} / ${t.rows.length} görsel`;
  }

  /** Görseller bölümünden ekleme: önce film seç, sonra yükle */
  async function addImagesForFilm() {
    const ft = T(F.sheet);
    const inp = h('input', { type: 'text', list: 'dl-pick-film', autocomplete: 'off', placeholder: 'Film adı yazın…' });
    const holder = h('div');
    const ref = {};
    const pick = () => {
      const f = (X().filmByTitle.get(collapse(inp.value)) || [])[0];
      if (!f) { holder.replaceChildren(h('p', { class: 'muted' }, 'Listeden bir film seçin.')); return; }
      const placeSel = h('select', null, h('option', { value: '' }, '— mekan belirtilmedi —'),
        splitList(f[F.places]).filter(p => placeMatch(p)).map(p => h('option', { value: p }, p)));
      holder.replaceChildren(h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Mekan'), placeSel),
        uploaderBox(f, () => placeSel.value, () => { if (S.view === 'gorsel') renderGrid(); }));
    };
    inp.addEventListener('input', pick);
    pick();
    await modal('Görsel ekle', h('div', { class: 'stack' },
      h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Film'), inp,
        h('datalist', { id: 'dl-pick-film' }, ft.rows.map(r => h('option', { value: r[F.title] }, r[F.year])))),
      holder), [{ label: 'Kapat', kind: 'primary', value: true }], { wide: true, closeRef: ref });
    if (S.view === 'gorsel') renderGrid();
  }

  // ================================================================ çakışma
  function conflictBox() {
    if (!S.conflict) return h('div', { id: 'conflict' });
    const t = T(entTable(S.sel.ent));
    const cur = S.conflict;
    const diffs = t.headers.map((_, i) => i).filter(i => String(cur[i] ?? '') !== String(S.sel.original[i] ?? ''));
    return h('div', { class: 'conflict', id: 'conflict', role: 'alert' },
      h('b', null, 'Bu kayıt siz düzenlerken başka biri tarafından değiştirildi.'),
      h('ul', null, diffs.map(i => h('li', null, `${t.headers[i] || 'Sütun ' + (i + 1)}: "${S.sel.original[i]}" → "${cur[i]}"`))),
      h('div', { class: 'acts' },
        h('button', { class: 'btn', onclick: () => { S.sel.original = cur.slice(); S.sel.draft = cur.slice(); S.conflict = null; renderDetail(); } }, 'Güncel hâli yükle (değişikliklerim gider)'),
        h('button', { class: 'btn danger', onclick: () => {
          const mine = changedCols(); const next = cur.slice(); mine.forEach(i => { next[i] = S.sel.draft[i]; });
          S.sel.original = cur.slice(); S.sel.draft = next; S.conflict = null; renderDetail();
        } }, 'Güncel hâlin üzerine benimkileri uygula')));
  }

  // ================================================================ kaydet / sil
  /** Ad değişikliğinin diğer kayıtlara yansıması (görseller, film çekim yerleri) */
  function cascadeOps(ent, oldName, newName) {
    const ops = [], summary = [];
    const gt = T(G.sheet), ft = T(F.sheet);
    if (!collapse(oldName) || collapse(oldName) === collapse(newName)) return { ops, summary };
    if (ent === 'film') {
      const others = (X().filmByTitle.get(collapse(oldName)) || []).filter(r => r !== S.sel.rowObj);
      if (others.length) return { ops, summary }; // aynı adlı başka film varsa görselleri taşıma
      const imgs = X().imagesByFilm.get(collapse(oldName)) || [];
      imgs.forEach(g => ops.push({ sheet: G.sheet, ...refOf(gt, g), changes: { [G.film]: collapse(newName) }, expected: fullExpected(gt, g), _row: g }));
      if (imgs.length) summary.push(`${imgs.length} görselin film adı`);
    } else {
      const k = norm(oldName);
      const others = (X().mekanByNorm.get(k) || []).filter(r => r !== S.sel.rowObj);
      if (others.length || norm(newName) === k) return { ops, summary };
      const films = X().filmsByPlace.get(k) || [];
      films.forEach(f => {
        const parts = splitList(f[F.places]).map(p => (norm(p) === k ? collapse(newName) : p));
        const fr = refOf(ft, f);
        ops.push(Object.assign({ sheet: F.sheet, changes: { [F.places]: joinList(parts) }, expected: fr.id != null ? { [F.places]: f[F.places] } : fullExpected(ft, f), _row: f }, fr));
      });
      const imgs = X().imagesByPlace.get(k) || [];
      imgs.forEach(g => ops.push({ sheet: G.sheet, ...refOf(gt, g), changes: { [G.place]: collapse(newName) }, expected: fullExpected(gt, g), _row: g }));
      if (films.length) summary.push(`${films.length} filmin çekim yeri listesi`);
      if (imgs.length) summary.push(`${imgs.length} görselin mekanı`);
    }
    return { ops, summary };
  }

  async function saveEntity() {
    if (!S.sel || S.saving) return false;
    const { ent, mode, draft, original } = S.sel;
    const t = T(entTable(ent));
    const nameCol = ent === 'film' ? F.title : M.name;
    const cols = changedCols();
    if (mode === 'edit' && !cols.length && collapse(original[0])) return true;
    if (!collapse(draft[nameCol])) { toast(ent === 'film' ? 'Film adı gerekli.' : 'Mekan adı gerekli.', 'err'); $('#f' + nameCol).focus(); return false; }
    // aynı ad uyarısı
    const dupList = ent === 'film' ? (X().filmByTitle.get(collapse(draft[nameCol])) || []) : (X().mekanByNorm.get(norm(draft[nameCol])) || []);
    const dups = dupList.filter(r => r !== S.sel.rowObj);
    if (dups.length && (mode === 'create' || cols.includes(nameCol))) {
      const ok = await confirmBox('Aynı adlı kayıt var', ent === 'film'
        ? `"${collapse(draft[nameCol])}" adıyla ${dups.map(r => r[F.id]).join(', ')} zaten kayıtlı. Görseller film adına bağlandığı için iki film aynı görselleri paylaşır. Ayırt etmek için adı değiştirebilirsiniz.`
        : `"${collapse(draft[nameCol])}" adıyla ${dups.map(r => r[M.id]).join(', ')} zaten kayıtlı. Filmler mekanlara adla bağlandığı için ikisi birlikte eşleşir.`, 'Yine de kaydet');
      if (!ok) return false;
    }
    // ad değişikliği zinciri
    let cascade = { ops: [], summary: [] };
    if (mode === 'edit' && cols.includes(nameCol)) {
      cascade = cascadeOps(ent, original[nameCol], draft[nameCol]);
      if (cascade.ops.length) {
        const ok = await confirmBox('Ad değişiyor', [`"${collapse(original[nameCol])}" → "${collapse(draft[nameCol])}"`,
          `Bağlantılar kopmasın diye şunlar da güncellenecek: ${cascade.summary.join(', ')}.`], 'Kaydet ve güncelle');
        if (!ok) return false;
      }
    }
    S.saving = true; refreshState();
    try {
      if (mode === 'create') {
        const values = {};
        draft.forEach((v, i) => { if (i > 0 && !t.formulaCols.has(i) && collapse(v) !== '') values[i] = v; });
        const res = await S.adapter.create(t.name, values, { autoId: true });
        const r = addRow(t, res.row, res.rowNum);
        S.sel.draft = r.slice(); S.sel.original = r.slice();
        toast(`${r[0]} · ${collapse(r[nameCol])} kaydedildi.`, 'ok');
        renderNav(); renderList(ent); openEntity(ent, r);
      } else {
        const changes = {}, expected = {};
        cols.forEach(i => { changes[i] = draft[i]; expected[i] = original[i]; });
        const ref = refOf(t, S.sel.rowObj);
        let main;
        if (ref.id != null) main = Object.assign({ sheet: t.name, changes, expected }, ref);
        else {
          // numarasız kayıt: satır numarasıyla yaz, tüm satırı karşılaştır, sıradaki numarayı ver
          if (!t.formulaCols.has(0)) changes[0] = nextId(t);
          main = Object.assign({ sheet: t.name, changes, expected: fullExpected(t, original) }, ref);
        }
        let fresh;
        if (cascade.ops.length) {
          const res = await S.adapter.batch([main, ...cascade.ops.map(o => { const c = Object.assign({}, o); delete c._row; return c; })]);
          fresh = replaceRow(t, S.sel.rowObj, res.results[0].row, res.results[0].rowNum);
          cascade.ops.forEach((o, i) => { const r2 = res.results[i + 1]; replaceRow(T(o.sheet), o._row, r2.row, r2.rowNum); });
        } else {
          const res = await S.adapter.update(t.name, ref, main.changes, main.expected);
          fresh = replaceRow(t, S.sel.rowObj, res.row, res.rowNum);
        }
        S.saving = false;
        toast(`${collapse(fresh[nameCol])} kaydedildi.` + (cascade.ops.length ? ` (${cascade.summary.join(', ')} güncellendi)` : ''), 'ok');
        renderNav(); renderList(ent); openEntity(ent, fresh);
      }
      return true;
    } catch (e) {
      if (e.code === 'conflict' && e.current) {
        S.conflict = e.current;
        $('#conflict').replaceWith(conflictBox());
        $('#detail').scrollTop = 0;
      } else if (e.code === 'conflict') {
        toast('Bağlı kayıtlardan biri bu arada değişmiş; hiçbir şey yazılmadı. Yenile ile güncel veriyi alıp tekrar deneyin.', 'err');
      } else if (e.code === 'auth') { toast('Oturum geçersiz, yeniden giriş yapın.', 'err'); logout(); }
      else toast('Kaydedilemedi: ' + e.message, 'err');
      return false;
    } finally {
      S.saving = false; refreshState();
    }
  }

  function revert() {
    if (!S.sel) return;
    if (S.sel.mode === 'create') { S.sel = null; destroyMaps(); renderEmptyDetail(S.view); setHash(); return; }
    S.sel.draft = S.sel.original.slice(); S.conflict = null;
    renderDetail();
  }

  async function deleteEntity() {
    const { ent, original, rowObj } = S.sel;
    const t = T(entTable(ent));
    const nameCol = ent === 'film' ? F.title : M.name;
    const notes = [];
    if (ent === 'film') {
      const n = imagesOfFilm(original).length;
      if (n) notes.push(`Bu filme bağlı ${n} görsel kaydı silinmez; "Filmi bulunamayan" görseller arasında kalır.`);
    } else {
      const n = filmsOfPlace(original).length;
      if (n) notes.push(`${n} filmin çekim yeri listesinde bu ad geçiyor; bu filmlerde yer eşleşmesiz kalır.`);
    }
    const ok = await confirmBox(ENT_LABEL[ent].del, [`${keyLabel(t, rowObj)} · ${collapse(original[nameCol]) || '(adsız)'} kalıcı olarak silinecek. İşlem kayıt defterine (_Panel_Log) yazılır.`, ...notes], 'Sil', true);
    if (!ok) return;
    try {
      const res = await S.adapter.remove(t.name, refOf(t, rowObj), fullExpected(t, original));
      dropRow(t, rowObj, res.rowNum);
      S.sel = null;
      toast(`${keyLabel(t, rowObj)} silindi.`, 'ok');
      renderNav(); renderList(ent); renderEmptyDetail(ent); setHash();
    } catch (e) {
      if (e.code === 'conflict') toast('Kayıt bu arada değişmiş; Yenile ile güncel hâlini alın.', 'err');
      else toast('Silinemedi: ' + e.message, 'err');
    }
  }

  // konsol/test erişimi
  window.panel = { state: S, reload, go };

  boot();
})();
