/**
 * İstanbul Sinema Haritası — Veri Paneli
 * Vanilla JS. Şema sunucudan gelir; sütun anlamları config.js'te (data.js ile aynı indeksler).
 * Yazmalar her zaman sütun indeksiyle (changes: { indeks: değer }) yapılır.
 */
(function () {
  'use strict';

  const CFG = window.PANEL_CONFIG;
  const P = CFG.PLACES;
  const { SheetsAdapter, DemoAdapter } = window.PanelData;
  const DEMO = new URLSearchParams(location.search).has('demo');

  // ------------------------------------------------------------ durum
  const S = {
    adapter: null,
    editor: '',
    tables: {},        // ad → tablo
    order: [],
    active: null,
    selectedKey: null, // seçili kaydın anahtarı (kimlik ya da "#satır")
    rowObj: null,      // tablodaki satır dizisinin kendisi
    mode: 'none',      // none | edit | create
    original: null,    // seçili satırın sunucudaki hali (kopya)
    draft: null,       // düzenlenen hali
    conflict: null,    // çakışmada sunucudaki güncel satır
    query: '',
    onlyIssues: false,
    limit: CFG.LIST_PAGE,
    saving: false,
    map: null,
    idxCache: new Map(),
  };

  // ------------------------------------------------------------ yardımcılar
  const $ = (sel, root = document) => root.querySelector(sel);

  /** Güvenli DOM üretici: metinler her zaman textNode olur (innerHTML yok). */
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k === 'value') el.value = v;
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
  const matchKey = (mode, s) => (mode === 'exact' ? collapse(s) : norm(s));
  const colLetter = i => { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = (i - m - 1) / 26; } return s; };
  const splitList = v => String(v || '').split(P.separator).map(collapse).filter(Boolean);
  const num = v => { const n = parseFloat(String(v).replace(',', '.')); return Number.isFinite(n) ? n : null; };
  const ID_RE = /^([A-Za-zÇĞİÖŞÜçğıöşü_-]*)(\d+)$/;

  /** Haritadaki driveToImgUrl ile aynı. */
  function driveToImgUrl(url) {
    url = String(url || '').trim();
    if (!url || url.includes('lh3.google')) return url;
    const m = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/) || url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    return m ? 'https://lh3.googleusercontent.com/d/' + m[1] : url;
  }

  const store = {
    get(k) { try { return sessionStorage.getItem(k) || localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v, persist) { try { (persist ? localStorage : sessionStorage).setItem(k, v); } catch (e) { /* yok say */ } },
    del(k) { try { sessionStorage.removeItem(k); localStorage.removeItem(k); } catch (e) { /* yok say */ } },
  };

  function toast(msg, kind) {
    const el = h('div', { class: 'toast ' + (kind || '') }, msg);
    $('#toasts').append(el);
    setTimeout(() => el.remove(), kind === 'err' ? 7000 : 3500);
  }

  /** Basit modal; seçilen eylemin değeriyle çözülür (Esc/dışarı tık → null). */
  function modal(title, body, actions) {
    return new Promise(resolve => {
      const root = $('#modal-root');
      const close = v => { root.replaceChildren(); document.removeEventListener('keydown', onKey); resolve(v); };
      const onKey = e => { if (e.key === 'Escape') close(null); };
      document.addEventListener('keydown', onKey);
      const box = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' },
        h('h3', null, title), body,
        h('div', { class: 'acts' }, actions.map(a => h('button', { class: 'btn ' + (a.kind || ''), onclick: () => close(a.value) }, a.label))));
      root.replaceChildren(h('div', { class: 'modal-bg', onclick: e => { if (e.target === e.currentTarget) close(null); } }, box));
      const btns = box.querySelectorAll('.acts .btn');
      (btns[btns.length - 1] || box).focus();
    });
  }

  // ------------------------------------------------------------ tablolar & şema
  const keyOf = (t, r) => (t.hasIds ? r[0] : '#' + r.__row);
  const keyLabel = (t, r) => (t.hasIds ? r[0] : 'satır ' + r.__row);

  function prepareTables(raw) {
    S.tables = {};
    S.order = raw.map(t => t.name);
    raw.forEach(src => {
      const rows = src.rows.map((r, i) => { const a = r.slice(); a.__row = src.rowNums ? src.rowNums[i] : i + 2; return a; });
      const t = {
        name: src.name,
        headers: src.headers.map(x => String(x || '').trim()),
        formulaCols: new Set(src.formulaCols || []),
        rows,
      };
      t.rows.forEach(r => { while (r.length < t.headers.length) r.push(''); });
      const ov = (CFG.FIELD_OVERRIDES || {})[t.name] || {};
      t.hasIds = ov[0] === 'id' || detectIdColumn(t);
      reindex(t);
      S.tables[t.name] = t;
    });
    Object.values(S.tables).forEach(t => { t.types = detectTypes(t); });
    Object.values(S.tables).forEach(t => {
      const lc = (CFG.LABEL_COL || {})[t.name];
      t.labelCol = lc != null ? lc : t.types.findIndex((ty, i) => i > 0 && ty === 'text');
      if (t.labelCol < 0) t.labelCol = Math.min(1, t.headers.length - 1);
      t.subCol = t.types.findIndex((ty, i) => i > t.labelCol && /^(text|enum|year|link:|ref:)/.test(ty));
      t.latCol = t.types.indexOf('lat');
      t.lonCol = t.types.indexOf('lon');
      t.coordCol = t.types.indexOf('coord');
      t.imageCol = t.types.indexOf('image');
      t.statusCol = t.types.indexOf('status');
      t.hasMap = (t.latCol > 0 && t.lonCol > 0) || t.coordCol > 0;
      refreshEnums(t);
    });
    S.idxCache.clear();
  }

  function detectIdColumn(t) {
    const vals = t.rows.map(r => String(r[0] || '').trim()).filter(Boolean);
    if (vals.length < Math.max(1, t.rows.length * 0.9)) return false;
    if (!vals.every(v => ID_RE.test(v))) return false;
    return new Set(vals).size === vals.length;
  }

  function reindex(t) {
    t.byKey = new Map();
    t.dupIds = new Set();
    t.rows.forEach(r => {
      const k = keyOf(t, r);
      if (t.byKey.has(k)) t.dupIds.add(k);
      t.byKey.set(k, r);
    });
  }

  function refreshEnums(t) {
    t.enumValues = t.types.map((ty, i) => (/^(enum|text|year)$/.test(ty) ? distinct(t, i, 60) : null));
  }

  function distinct(t, i, max) {
    const set = new Set();
    for (const r of t.rows) { const v = String(r[i] || '').trim(); if (v) set.add(v); if (set.size > max) return null; }
    return [...set].sort((a, b) => a.localeCompare(b, 'tr'));
  }

  function detectTypes(t) {
    const ov = (CFG.FIELD_OVERRIDES || {})[t.name] || {};
    return t.headers.map((head, i) => {
      if (ov[i]) return ov[i];
      if (i === 0 && t.hasIds) return 'id';
      if (t.formulaCols.has(i)) return 'readonly';
      const vals = t.rows.map(r => String(r[i] || '').trim()).filter(Boolean);
      for (const hint of CFG.HINTS) if (hint.re.test(head)) return hint.type;
      // başka bir sayfanın kimliklerini içeren sütun → ref
      if (vals.length) {
        const parts = vals.flatMap(v => v.split(',').map(x => x.trim())).slice(0, 300);
        if (parts.every(v => ID_RE.test(v))) {
          for (const o of Object.values(S.tables)) {
            if (o === t || !o.hasIds || !o.rows.length) continue;
            const hit = parts.filter(v => o.byKey.has(v)).length;
            if (hit / parts.length >= 0.8) return 'ref:' + o.name;
          }
        }
        const avg = vals.reduce((a, v) => a + v.length, 0) / vals.length;
        if (avg > 90) return 'longtext';
        const d = new Set(vals).size;
        if (vals.length >= 8 && d <= 15 && d / vals.length < 0.4) return 'enum';
      }
      return 'text';
    });
  }

  const nameCol = t => (t.name === P.target ? P.targetCol : t.labelCol);

  /** hedef sayfada ad → [anahtar] dizini (mode: exact | norm) */
  function nameIndex(targetName, mode) {
    const ck = targetName + '|' + mode;
    if (S.idxCache.has(ck)) return S.idxCache.get(ck);
    const t = S.tables[targetName];
    const m = new Map();
    if (t) {
      const c = nameCol(t);
      t.rows.forEach(r => {
        const k = matchKey(mode, r[c]);
        if (!k) return;
        if (!m.has(k)) m.set(k, []);
        m.get(k).push(keyOf(t, r));
      });
    }
    S.idxCache.set(ck, m);
    return m;
  }

  const linkMode = (t, i) => (CFG.LINK_MATCH || {})[`${t.name}:${i}`] || 'norm';
  const placesCol = t => t.types.indexOf('places');
  const placeHits = name => nameIndex(P.target, 'norm').get(norm(name));
  const placeIgnored = name => norm(name).length < (P.minLen || 0);

  // ------------------------------------------------------------ sorun denetimi
  function rowIssues(t, r) {
    const out = [];
    if (t.hasIds && t.dupIds.has(r[0])) out.push('Yinelenen kimlik');
    const req = (CFG.REQUIRED || {})[t.name] || [];
    const empty = req.filter(i => !String(r[i] || '').trim()).map(i => t.headers[i] || colLetter(i));
    if (empty.length) out.push('Boş zorunlu alan: ' + empty.join(', '));
    t.types.forEach((ty, i) => {
      const v = String(r[i] || '').trim();
      if (ty === 'places') {
        const parts = splitList(v).filter(x => !placeIgnored(x));
        const miss = parts.filter(x => !placeHits(x));
        if (!parts.length) out.push('Çekim yeri boş');
        else if (miss.length === parts.length) out.push('Hiçbir yer eşleşmiyor (haritada görünmez)');
        else if (miss.length) out.push(`${miss.length} yer ${P.target}'da yok`);
      } else if (ty.startsWith('link:') && v) {
        if (!nameIndex(ty.slice(5), linkMode(t, i)).get(matchKey(linkMode(t, i), v))) out.push(`${t.headers[i]}: ${ty.slice(5)} içinde eşleşmiyor`);
      } else if (ty.startsWith('ref:') && v) {
        const o = S.tables[ty.slice(4)];
        const miss = v.split(',').map(x => x.trim()).filter(x => x && !o.byKey.has(x));
        if (miss.length) out.push(`Bulunamayan bağlantı: ${miss.join(', ')}`);
      } else if (ty === 'year' && v && !/^\d{4}$/.test(v)) {
        out.push('Yıl 4 haneli değil');
      }
    });
    if (t.hasMap) {
      const c = coordsOf(t, r);
      if (!c) out.push('Koordinat yok (haritada görünmez)');
      else if (!inIstanbul(c)) out.push('Koordinat İstanbul dışında');
    }
    return out;
  }

  const inIstanbul = c => c[1] >= 40.7 && c[1] <= 41.65 && c[0] >= 27.9 && c[0] <= 29.95;

  /** [lon, lat] ya da null — coord sütunu haritadaki gibi "enlem, boylam" */
  function coordsOf(t, r) {
    if (t.latCol > 0 && t.lonCol > 0) {
      const lat = num(r[t.latCol]), lon = num(r[t.lonCol]);
      return lat != null && lon != null ? [lon, lat] : null;
    }
    if (t.coordCol > 0) {
      const p = String(r[t.coordCol] || '').replace(/"/g, '').split(',').map(s => parseFloat(s.trim()));
      return Number.isFinite(p[0]) && Number.isFinite(p[1]) && p[0] && p[1] ? [p[1], p[0]] : null;
    }
    return null;
  }

  // ------------------------------------------------------------ başlat
  async function boot() {
    S.adapter = DEMO ? new DemoAdapter()
      : CFG.ADAPTER === 'sheets' ? new SheetsAdapter(CFG.API_URL)
      : null;
    if (!S.adapter) { document.body.textContent = 'Tanımsız veri katmanı: ' + CFG.ADAPTER; return; }

    $('#login-form').addEventListener('submit', onLogin);
    const saved = DEMO ? 'demo' : store.get('panel.token');
    if (saved) {
      try { await login(saved); return; } catch (e) { if (e.code === 'auth') store.del('panel.token'); }
    }
    $('#login').hidden = false;
    if (!DEMO && /BURAYA/.test(CFG.API_URL)) {
      $('#login-error').textContent = 'Panel henüz API\'ye bağlanmadı (config.js → API_URL). Sahte veriyle denemek için adrese ?demo ekleyin.';
    }
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
    } catch (err) {
      $('#login-error').textContent = err.message;
    } finally { btn.disabled = false; }
  }

  async function login(token) {
    const r = await S.adapter.login(token);
    S.editor = r.editor;
    $('#login').hidden = true;
    $('#app').hidden = false;
    $('#editor-name').textContent = S.editor;
    $('#demo-badge').hidden = !DEMO;
    bindUi();
    await reload();
  }

  async function reload() {
    $('#editor').replaceChildren(h('div', { class: 'loading' }, 'Veri yükleniyor…'));
    try {
      const data = await S.adapter.load();
      prepareTables(data.tables);
    } catch (e) {
      $('#editor').replaceChildren(h('div', { class: 'loading' }, 'Yüklenemedi: ' + e.message));
      if (e.code === 'auth') logout();
      return;
    }
    const hash = decodeURIComponent(location.hash.slice(1));
    const cut = hash.indexOf('/');
    const hTable = cut < 0 ? hash : hash.slice(0, cut), hKey = cut < 0 ? '' : hash.slice(cut + 1);
    S.active = S.tables[hTable] ? hTable : (S.tables[S.active] ? S.active : S.order[0]);
    renderTabs();
    renderList();
    const t = S.tables[S.active];
    const keep = hKey && t.byKey.has(hKey) ? hKey : (S.selectedKey && t.byKey.has(S.selectedKey) ? S.selectedKey : null);
    if (keep) openRecord(keep); else clearEditor();
  }

  let uiBound = false;
  function bindUi() {
    if (uiBound) return;
    uiBound = true;
    $('#search').addEventListener('input', e => { S.query = e.target.value; S.limit = CFG.LIST_PAGE; renderList(); });
    $('#only-issues').addEventListener('change', e => { S.onlyIssues = e.target.checked; S.limit = CFG.LIST_PAGE; renderList(); });
    $('#btn-new').addEventListener('click', async () => { if (await guard()) startCreate(); });
    $('#btn-reload').addEventListener('click', async () => { if (await guard()) reload(); });
    $('#btn-logout').addEventListener('click', async () => { if (await guard()) logout(); });
    document.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
      else if (e.key === '/' && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) { e.preventDefault(); $('#search').focus(); }
    });
    window.addEventListener('beforeunload', e => { if (isDirty()) { e.preventDefault(); e.returnValue = ''; } });
  }

  function logout() {
    store.del('panel.token');
    history.replaceState(null, '', location.pathname + location.search);
    location.reload();
  }

  // ------------------------------------------------------------ sekmeler & liste
  function renderTabs() {
    $('#tabs').replaceChildren(...S.order.map(name => {
      const t = S.tables[name];
      const iss = t.rows.filter(r => rowIssues(t, r).length).length;
      return h('button', {
        class: 'tab', role: 'tab', 'aria-selected': String(name === S.active),
        onclick: async () => { if (name !== S.active && await guard()) switchTab(name); },
      }, name, h('span', { class: 'n' }, t.rows.length), iss ? h('span', { class: 'iss', title: 'Sorunlu kayıt sayısı' }, '⚠' + iss) : null);
    }));
  }

  function switchTab(name, thenKey) {
    S.active = name;
    S.query = ''; $('#search').value = '';
    S.limit = CFG.LIST_PAGE;
    renderTabs();
    renderList();
    if (thenKey) openRecord(thenKey); else clearEditor();
  }

  function filteredRows() {
    const t = S.tables[S.active];
    const q = fold(S.query).trim();
    let rows = t.rows;
    if (q) rows = rows.filter(r => fold(r.join(' ')).includes(q));
    if (S.onlyIssues) rows = rows.filter(r => rowIssues(t, r).length);
    return rows;
  }

  function renderList() {
    const t = S.tables[S.active];
    const rows = filteredRows();
    const shown = rows.slice(0, S.limit);
    const items = shown.map(r => {
      const iss = rowIssues(t, r);
      const k = keyOf(t, r);
      return h('li', {
        'aria-selected': String(k === S.selectedKey && S.mode === 'edit'),
        dataset: { key: k },
        onclick: async () => { if (k !== S.selectedKey && await guard()) openRecord(k); },
      },
      h('span', { class: 'rid' }, t.hasIds ? r[0] : '#' + r.__row),
      h('span', { class: 'ttl' }, r[t.labelCol] || '—', t.subCol > 0 ? h('span', { class: 'sub' }, subText(t, r)) : null),
      iss.length ? h('span', { class: 'dot', title: iss.join('\n') }) : h('span'));
    });
    if (rows.length > shown.length) {
      items.push(h('li', { class: 'more', onclick: () => { S.limit += CFG.LIST_PAGE; renderList(); } },
        `+ ${rows.length - shown.length} kayıt daha göster`));
    }
    $('#list').replaceChildren(...items);
    $('#list-count').textContent = rows.length === t.rows.length ? `${rows.length} kayıt` : `${rows.length} / ${t.rows.length}`;
  }

  function subText(t, r) {
    const v = r[t.subCol] || '';
    const ty = t.types[t.subCol];
    if (ty.startsWith('ref:')) {
      const o = S.tables[ty.slice(4)], x = o.byKey.get(v);
      return x ? `${v} · ${x[o.labelCol]}` : v;
    }
    return v;
  }

  function markSelectedInList() {
    document.querySelectorAll('#list li[data-key]').forEach(li => {
      li.setAttribute('aria-selected', String(li.dataset.key === S.selectedKey && S.mode === 'edit'));
    });
  }

  // ------------------------------------------------------------ kayıt açma
  function setHash() {
    const v = S.mode === 'edit' ? `${S.active}/${S.selectedKey}` : S.active;
    history.replaceState(null, '', '#' + encodeURIComponent(v).replace(/%2F/g, '/'));
  }

  function clearEditor() {
    destroyMap();
    S.mode = 'none'; S.selectedKey = null; S.rowObj = null; S.original = S.draft = S.conflict = null;
    $('#editor').replaceChildren(h('div', { class: 'empty' }, 'Soldan bir kayıt seçin ya da ', h('b', null, '+ Yeni'), ' ile ekleyin.'));
    markSelectedInList();
    setHash();
  }

  function openRecord(key) {
    const t = S.tables[S.active];
    const r = t.byKey.get(key);
    if (!r) { clearEditor(); return; }
    S.mode = 'edit'; S.selectedKey = key; S.rowObj = r; S.conflict = null;
    S.original = r.slice();
    S.draft = r.slice();
    renderEditor();
    markSelectedInList();
    setHash();
    const li = document.querySelector(`#list li[data-key="${CSS.escape(key)}"]`);
    if (li) li.scrollIntoView({ block: 'nearest' });
  }

  function startCreate(prefill) {
    const t = S.tables[S.active];
    S.mode = 'create'; S.selectedKey = null; S.rowObj = null; S.conflict = null;
    S.original = t.headers.map(() => '');
    S.draft = S.original.slice();
    Object.entries(prefill || {}).forEach(([i, v]) => { S.draft[i] = v; });
    renderEditor();
    markSelectedInList();
    setHash();
    const first = $('#editor .fields input:not([readonly]), #editor .fields textarea');
    if (first) first.focus();
  }

  function changedCols() {
    if (!S.draft) return [];
    const out = [];
    S.draft.forEach((v, i) => { if (String(v ?? '') !== String(S.original[i] ?? '')) out.push(i); });
    return out;
  }
  const isDirty = () => changedCols().length > 0;

  /** Kaydedilmemiş değişiklik varsa sorar. true → devam edilebilir. */
  async function guard() {
    if (!isDirty()) return true;
    const v = await modal('Kaydedilmemiş değişiklik',
      h('p', null, 'Bu kayıtta kaydedilmemiş değişiklikler var.'),
      [{ label: 'Vazgeç', value: false }, { label: 'Kaydetmeden çık', kind: 'danger', value: 'discard' }, { label: 'Kaydet', kind: 'primary', value: 'save' }]);
    if (v === 'discard') { S.draft = S.original.slice(); return true; }
    if (v === 'save') return await save();
    return false;
  }

  // ------------------------------------------------------------ editör
  function renderEditor() {
    destroyMap();
    const t = S.tables[S.active];
    const d = S.draft;
    const creating = S.mode === 'create';

    const head = h('div', { class: 'ed-head' },
      h('div', { class: 'ed-title' },
        h('div', { class: 'rid' }, creating ? `${t.name} / yeni kayıt` : `${t.name} / ${keyLabel(t, S.rowObj)}`),
        h('h2', { id: 'ed-h2' }, d[t.labelCol] || (creating ? 'Yeni kayıt' : '—'))),
      h('div', { class: 'ed-actions' },
        h('span', { class: 'dirty-note', id: 'dirty-note' }),
        !creating ? h('button', { class: 'btn danger', id: 'btn-delete', onclick: confirmDelete }, 'Sil') : null,
        h('button', { class: 'btn', id: 'btn-revert', onclick: revert }, creating ? 'İptal' : 'Geri al'),
        h('button', { class: 'btn primary', id: 'btn-save', onclick: save, title: 'Ctrl+S' }, creating ? 'Oluştur' : 'Kaydet')));

    const fields = h('div', { class: 'fields' });
    t.headers.forEach((_, i) => fields.append(renderField(t, i)));
    if (t.hasMap) fields.append(h('div', { class: 'field map-field' },
      h('label', null, 'Konum', h('span', { class: 'col' }, 'Haritaya tıklayın ya da iğneyi sürükleyin')),
      h('div', { class: 'map', id: 'map' })));

    $('#editor').replaceChildren(head, conflictBox(), fields, renderLinks(t));
    $('#editor').scrollTop = 0;
    if (t.hasMap) initMap(t);
    refreshDirty();
  }

  function fieldLabel(t, i, extra) {
    const req = ((CFG.REQUIRED || {})[t.name] || []).includes(i);
    return h('label', { for: 'f' + i }, (t.headers[i] || `Sütun ${colLetter(i)}`) + (req ? ' *' : ''),
      h('span', { class: 'col' }, [extra, colLetter(i)].filter(Boolean).join(' · ')));
  }

  function renderField(t, i) {
    const ty = t.types[i];
    const v = S.draft[i] ?? '';
    const wrap = h('div', { class: 'field', dataset: { col: i } });
    const add = (...kids) => wrap.append(...kids.filter(k => k != null && k !== false));
    const set = val => { S.draft[i] = val; onFieldChange(t, i); };
    const warnEl = h('div', { class: 'warn', id: 'w' + i });

    if (ty === 'id') {
      add(fieldLabel(t, i, 'otomatik'), h('input', { id: 'f' + i, value: S.mode === 'create' ? '(kayıtta verilir)' : v, readonly: true }));
    } else if (ty === 'readonly') {
      add(fieldLabel(t, i, 'formül'), h('input', { id: 'f' + i, value: v, readonly: true }));
    } else if (ty === 'longtext') {
      wrap.classList.add('wide');
      add(fieldLabel(t, i), h('textarea', { id: 'f' + i, value: v, oninput: e => set(e.target.value) }));
    } else if (ty === 'status') {
      const seg = h('div', { class: 'seg', role: 'group', id: 'f' + i });
      const paint = () => seg.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === String(S.draft[i] ?? ''))));
      CFG.STATUS_VALUES.forEach(s => seg.append(h('button', { type: 'button', dataset: { v: s.v }, onclick: () => { set(s.v); paint(); } },
        s.label + (s.v ? ` (${s.v})` : ''))));
      paint();
      add(fieldLabel(t, i), seg);
    } else if (ty === 'flag') {
      add(fieldLabel(t, i, '1 / boş'), h('label', { class: 'check flag' },
        h('input', { id: 'f' + i, type: 'checkbox', checked: String(v).trim() === '1', onchange: e => set(e.target.checked ? '1' : '') }),
        t.headers[i] || 'İşaretli'));
    } else if (ty === 'places') {
      wrap.classList.add('wide');
      add(fieldLabel(t, i, `${P.target} adlarıyla eşleşir`), placesEditor(t, i));
    } else if (ty.startsWith('link:') || ty.startsWith('ref:')) {
      const isLink = ty.startsWith('link:');
      const o = S.tables[ty.slice(isLink ? 5 : 4)];
      const listId = 'dl' + i;
      const opts = o ? o.rows.slice(0, 4000).map(r => isLink ? h('option', { value: r[nameCol(o)] }) : h('option', { value: r[0] }, r[o.labelCol])) : [];
      add(fieldLabel(t, i, '→ ' + (o ? o.name : '?')),
        h('input', { id: 'f' + i, value: v, list: listId, autocomplete: 'off', oninput: e => { set(e.target.value); paintRelation(t, i); } }),
        h('datalist', { id: listId }, opts),
        h('div', { class: 'ref-label', id: 'rl' + i }));
      setTimeout(() => paintRelation(t, i));
    } else if (ty === 'image') {
      const img = h('img', { class: 'img-prev', alt: '', hidden: true, onerror: e => { e.target.hidden = true; }, onload: e => { e.target.hidden = false; } });
      if (v) img.src = driveToImgUrl(v);
      wrap.classList.add('wide');
      add(fieldLabel(t, i, 'Drive bağlantısı ya da görsel adresi'), h('input', { id: 'f' + i, value: v, type: 'url', oninput: e => {
        set(e.target.value.trim());
        if (S.draft[i]) img.src = driveToImgUrl(S.draft[i]); else img.hidden = true;
      } }), img);
    } else {
      const listId = t.enumValues[i] ? 'dl' + i : null;
      const extra = { lat: 'enlem', lon: 'boylam', coord: 'enlem, boylam' }[ty];
      add(fieldLabel(t, i, extra),
        h('input', { id: 'f' + i, value: v, list: listId, autocomplete: 'off', inputmode: /^(year|lat|lon)$/.test(ty) ? 'decimal' : null,
          oninput: e => { set(e.target.value); if (t.hasMap && /^(lat|lon|coord)$/.test(ty)) syncMarker(t); } }),
        listId ? h('datalist', { id: listId }, t.enumValues[i].map(x => h('option', { value: x }))) : null);
    }
    add(warnEl);
    setTimeout(() => paintWarn(t, i));
    return wrap;
  }

  /** link/ref alanının altındaki "→ hedef kayıt" satırı */
  function paintRelation(t, i) {
    const el = $('#rl' + i); if (!el) return;
    const ty = t.types[i];
    const v = String(S.draft[i] || '').trim();
    if (!v) { el.replaceChildren(); return; }
    let o, keys;
    if (ty.startsWith('link:')) {
      o = S.tables[ty.slice(5)];
      keys = o ? nameIndex(o.name, linkMode(t, i)).get(matchKey(linkMode(t, i), v)) : null;
    } else {
      o = S.tables[ty.slice(4)];
      keys = o && o.byKey.has(v) ? [v] : null;
    }
    if (!o) { el.replaceChildren(); return; }
    if (!keys) {
      el.replaceChildren(h('span', { class: 'warn' }, `${o.name} içinde ${linkMode(t, i) === 'exact' ? 'birebir aynı adla ' : ''}kayıt yok`));
      return;
    }
    const links = [];
    keys.forEach((k, n) => {
      const r = o.byKey.get(k);
      if (n) links.push('  ');
      links.push(h('a', { href: '#', onclick: async e => { e.preventDefault(); if (await guard()) switchTab(o.name, k); } },
        `${keyLabel(o, r)} · ${r[o.labelCol]} →`));
    });
    el.replaceChildren(...links);
  }

  function paintWarn(t, i) {
    const el = $('#w' + i); if (!el) return;
    const ty = t.types[i], v = String(S.draft[i] || '').trim();
    let msg = '';
    if (ty === 'year' && v && !/^\d{4}$/.test(v)) msg = 'Yıl 4 haneli olmalı.';
    if (ty === 'lat' && v && (num(v) == null || num(v) < 40.7 || num(v) > 41.65)) msg = 'Enlem İstanbul aralığında değil (40.7–41.65).';
    if (ty === 'lon' && v && (num(v) == null || num(v) < 27.9 || num(v) > 29.95)) msg = 'Boylam İstanbul aralığında değil (27.9–29.95).';
    if (ty === 'coord' && v) {
      const c = coordsOf(t, S.draft);
      if (!c) msg = 'Biçim "enlem, boylam" olmalı (ör. 41.0201, 28.9733).';
      else if (!inIstanbul(c)) msg = 'Koordinat İstanbul dışında görünüyor (enlem ile boylam yer değiştirmiş olabilir).';
    }
    if (((CFG.REQUIRED || {})[t.name] || []).includes(i) && !v) msg = 'Boş bırakılırsa kayıt haritada görünmez.';
    if (i === t.labelCol && v) {
      const k = norm(v);
      const same = t.rows.filter(r => r !== S.rowObj && norm(r[t.labelCol]) === k);
      if (same.length && t.name !== 'Görseller') msg = `Aynı adda kayıt var: ${same.map(r => keyLabel(t, r)).join(', ')}`;
    }
    el.textContent = msg;
  }

  function onFieldChange(t, i) {
    paintWarn(t, i);
    if (i === t.labelCol) $('#ed-h2').textContent = S.draft[i] || '—';
    refreshDirty();
  }

  function refreshDirty() {
    const ch = changedCols();
    document.querySelectorAll('#editor .field[data-col]').forEach(f => f.classList.toggle('changed', ch.includes(+f.dataset.col)));
    const note = $('#dirty-note');
    if (note) note.textContent = ch.length ? `${ch.length} alan değişti` : '';
    const sv = $('#btn-save');
    if (sv) sv.disabled = S.saving || (S.mode === 'edit' && !ch.length);
    const rv = $('#btn-revert');
    if (rv && S.mode === 'edit') rv.disabled = !ch.length;
  }

  // ------------------------------------------------------------ çekim yerleri (çip düzenleyici)
  function placesEditor(t, i) {
    const tgt = S.tables[P.target];
    const box = h('div', { class: 'chips' });
    const listId = 'dl-places';
    const input = h('input', { id: 'f' + i, list: listId, placeholder: 'Mekan adı yazın, Enter…', autocomplete: 'off' });
    const datalist = h('datalist', { id: listId }, tgt ? tgt.rows.map(r => h('option', { value: r[P.targetCol] })) : []);

    const items = () => splitList(S.draft[i]);
    const write = arr => { S.draft[i] = arr.join(P.joiner); onFieldChange(t, i); paint(); };

    function paint() {
      const chips = items().map((name, k) => {
        const keys = placeHits(name);
        const ignored = !keys && placeIgnored(name);
        const tgtRow = keys && tgt.byKey.get(keys[0]);
        const exactSpelling = tgtRow && collapse(tgtRow[P.targetCol]) === collapse(name);
        return h('span', {
          class: 'chip' + (keys ? '' : ' miss'),
          title: keys ? `${keys.join(', ')}${exactSpelling ? '' : ` — ${P.target}'daki yazım: "${tgtRow[P.targetCol]}"`}`
            : ignored ? 'Çok kısa; harita bu parçayı yok sayar' : `${P.target} sayfasında eşleşen ad yok`,
        },
        keys ? h('a', { href: '#', onclick: async e => { e.preventDefault(); if (await guard()) switchTab(P.target, keys[0]); } }, name) : name,
        keys && !exactSpelling ? h('span', { class: 'alt', title: 'Yazımı farklı ama eşleşiyor' }, '≈') : null,
        !keys && !ignored ? h('button', { type: 'button', class: 'add', title: `${P.target} sayfasında oluştur`, onclick: () => createPlace(name) }, '+ mekan') : null,
        h('button', { type: 'button', title: 'Çıkar', onclick: () => { const a = items(); a.splice(k, 1); write(a); } }, '×'));
      });
      box.replaceChildren(...chips, input);
    }
    function commit() {
      const parts = splitList(input.value);
      if (!parts.length) return;
      input.value = '';
      const a = items();
      parts.forEach(p => { if (!a.some(x => norm(x) === norm(p))) a.push(p); });
      write(a);
      input.focus();
    }
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); commit(); }
      else if (e.key === 'Backspace' && !input.value) { const a = items(); a.pop(); write(a); input.focus(); }
    });
    // datalist'ten seçim (Chrome: inputType = insertReplacementText ya da tanımsız)
    input.addEventListener('input', e => {
      if ((!e.inputType || e.inputType === 'insertReplacementText') && placeHits(input.value)) commit();
    });
    input.addEventListener('blur', commit);
    paint();
    return h('div', null, box, datalist);
  }

  async function createPlace(name) {
    if (!(await guard())) return;
    switchTab(P.target);
    startCreate({ [P.targetCol]: name });
    toast(`"${name}" için yeni mekan kaydı açıldı; konumu işaretleyip kaydedin.`);
  }

  // ------------------------------------------------------------ harita
  function destroyMap() { if (S.map) { try { S.map.remove(); } catch (e) { /* */ } S.map = null; } }

  function initMap(t) {
    const el = $('#map');
    if (!window.maplibregl) { el.replaceChildren(h('div', { class: 'map-msg' }, 'Harita kütüphanesi yüklenemedi; koordinatları alana elle girin.')); return; }
    const c = coordsOf(t, S.draft);
    let map;
    try {
      map = new maplibregl.Map({ container: el, style: CFG.BASEMAP_STYLE, center: c || CFG.MAP_CENTER, zoom: c ? 15 : CFG.MAP_ZOOM, attributionControl: { compact: true } });
    } catch (e) {
      el.replaceChildren(h('div', { class: 'map-msg' }, 'Harita açılamadı (WebGL?). Koordinatları elle girin.'));
      return;
    }
    S.map = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    const marker = new maplibregl.Marker({ element: h('div', { class: 'pin' }), draggable: true });
    map._pin = marker;
    if (c) marker.setLngLat(c).addTo(map);
    marker.on('dragend', () => writeCoords(t, marker.getLngLat()));
    map.on('click', e => { marker.setLngLat(e.lngLat).addTo(map); writeCoords(t, e.lngLat); });

    map.on('load', () => {
      const feats = t.rows.filter(r => r !== S.rowObj).map(r => {
        const p = coordsOf(t, r);
        return p ? { type: 'Feature', geometry: { type: 'Point', coordinates: p }, properties: { name: r[t.labelCol] } } : null;
      }).filter(Boolean);
      map.addSource('others', { type: 'geojson', data: { type: 'FeatureCollection', features: feats } });
      map.addLayer({ id: 'others', type: 'circle', source: 'others',
        paint: { 'circle-radius': 4, 'circle-color': '#111', 'circle-opacity': 0.35, 'circle-stroke-width': 1, 'circle-stroke-color': '#fff' } });
      if (map.getStyle().glyphs) map.addLayer({ id: 'others-label', type: 'symbol', source: 'others', minzoom: 14,
        layout: { 'text-field': ['get', 'name'], 'text-size': 11, 'text-offset': [0, 1], 'text-anchor': 'top' },
        paint: { 'text-color': '#555', 'text-halo-color': '#fff', 'text-halo-width': 1 } });
    });
  }

  function writeCoords(t, ll) {
    const lat = ll.lat.toFixed(6), lon = ll.lng.toFixed(6);
    if (t.latCol > 0 && t.lonCol > 0) {
      S.draft[t.latCol] = lat; S.draft[t.lonCol] = lon;
      $('#f' + t.latCol).value = lat; $('#f' + t.lonCol).value = lon;
      onFieldChange(t, t.latCol); onFieldChange(t, t.lonCol);
    } else {
      S.draft[t.coordCol] = `${lat}, ${lon}`;
      $('#f' + t.coordCol).value = S.draft[t.coordCol];
      onFieldChange(t, t.coordCol);
    }
  }

  function syncMarker(t) {
    if (!S.map) return;
    const c = coordsOf(t, S.draft);
    if (c) { S.map._pin.setLngLat(c).addTo(S.map); S.map.easeTo({ center: c }); }
    else S.map._pin.remove();
  }

  // ------------------------------------------------------------ bağlantılar (ters ilişkiler)
  /** row: hedef kaydın (sunucudaki) hali. byNameOnly: yalnız ad üzerinden kurulan bağlar. */
  function backlinks(t, row, byNameOnly) {
    const groups = [];
    if (t.name === P.target) {
      const k = norm(row[P.targetCol]);
      const src = S.tables[P.sheet], pc = src ? placesCol(src) : -1;
      if (k && pc > 0) {
        groups.push({ table: src, byName: true, title: 'Bu mekanda çekilen filmler',
          rows: src.rows.filter(r => splitList(r[pc]).some(x => norm(x) === k)) });
      }
    }
    Object.values(S.tables).forEach(o => {
      o.types.forEach((ty, i) => {
        if (ty === 'link:' + t.name) {
          const mode = linkMode(o, i), k = matchKey(mode, row[nameCol(t)]);
          if (!k) return;
          groups.push({ table: o, byName: true, title: `${o.name} (${o.headers[i] || colLetter(i)})`,
            rows: o.rows.filter(r => matchKey(mode, r[i]) === k) });
        } else if (!byNameOnly && ty === 'ref:' + t.name && t.hasIds && !o.types.includes('link:' + t.name)) {
          // aynı sayfa hem ad hem kimlikle bağlıysa yalnız ad bağı gösterilir (harita adı kullanır)
          groups.push({ table: o, byName: false, title: `${o.name} (${o.headers[i] || colLetter(i)})`,
            rows: o.rows.filter(r => String(r[i] || '').split(',').map(x => x.trim()).includes(row[0])) });
        }
      });
    });
    return byNameOnly ? groups.filter(g => g.byName) : groups;
  }

  function renderLinks(t) {
    if (S.mode !== 'edit') return h('div');
    const groups = backlinks(t, S.original);
    if (!groups.length) return h('div');
    const go = (o, k) => async e => { e.preventDefault(); if (await guard()) switchTab(o.name, k); };
    return h('div', { class: 'links' }, groups.map(g => {
      const o = g.table;
      const body = o.imageCol > 0
        ? h('div', { class: 'thumbs' }, g.rows.map(r => {
            const st = o.statusCol > 0 ? String(r[o.statusCol] || '') : '';
            // küçük resim altı: film sayfasında mekan adı, mekan sayfasında film adı
            const other = o.types.findIndex(ty => /^link:/.test(ty) && ty !== 'link:' + t.name);
            return h('div', { class: 'thumb' + (st === 'x' ? ' x' : ''), onclick: go(o, keyOf(o, r)) },
              h('img', { src: driveToImgUrl(r[o.imageCol]), alt: '', loading: 'lazy', onerror: e => { e.target.style.visibility = 'hidden'; } }),
              h('div', { class: 'st' }, h('span', null, other >= 0 && r[other] ? r[other] : keyLabel(o, r)),
                st ? h('b', null, (CFG.STATUS_VALUES.find(s => s.v === st) || {}).label || st) : null));
          }))
        : h('ul', { class: 'link-list' }, g.rows.map(r => h('li', null,
            h('span', { class: 'rid' }, keyLabel(o, r)), h('a', { href: '#', onclick: go(o, keyOf(o, r)) }, r[o.labelCol] || '—'))));
      return [h('h3', null, g.title, ' ', h('span', { class: 'n' }, g.rows.length)), g.rows.length ? body : h('p', { class: 'muted' }, 'Bağlı kayıt yok.')];
    }));
  }

  // ------------------------------------------------------------ çakışma
  function conflictBox() {
    if (!S.conflict) return h('div', { id: 'conflict' });
    const t = S.tables[S.active];
    const cur = S.conflict;
    const diffs = t.headers.map((_, i) => i).filter(i => String(cur[i] ?? '') !== String(S.original[i] ?? ''));
    return h('div', { class: 'conflict', id: 'conflict', role: 'alert' },
      h('b', null, t.hasIds
        ? 'Çakışma: bu kayıt siz düzenlerken başka biri tarafından değiştirildi.'
        : 'Çakışma: bu satır siz düzenlerken değişti ya da satırlar kaydı (başka biri satır eklemiş/silmiş olabilir). Yenile ile güncel hâli alın.'),
      h('ul', null, diffs.map(i => h('li', null, `${t.headers[i] || colLetter(i)}: "${S.original[i]}" → "${cur[i]}"`))),
      h('div', { class: 'acts' },
        h('button', { class: 'btn', onclick: () => { S.draft = S.original.slice(); reload(); } }, 'Yenile'),
        t.hasIds ? h('button', { class: 'btn', onclick: () => {
          S.original = cur.slice(); S.draft = cur.slice(); S.conflict = null; renderEditor();
        } }, 'Sunucudakini yükle (değişikliklerim gider)') : null,
        t.hasIds ? h('button', { class: 'btn danger', onclick: () => {
          // değiştirdiğim alanlar kalır, diğerleri sunucudakiyle güncellenir
          const mine = changedCols();
          const next = cur.slice();
          mine.forEach(i => { next[i] = S.draft[i]; });
          S.original = cur.slice(); S.draft = next; S.conflict = null; renderEditor();
        } }, 'Sunucudakinin üzerine benimkileri uygula') : null));
  }

  // ------------------------------------------------------------ kaydet / sil / geri al
  const nonFormulaRow = (t, row) => Object.fromEntries(row.map((v, i) => [i, v]).filter(([i]) => !t.formulaCols.has(i) && i < t.headers.length));
  const refFor = t => (t.hasIds ? { id: S.original[0] } : { row: S.rowObj.__row });

  async function save() {
    if (S.saving || S.mode === 'none') return false;
    const t = S.tables[S.active];
    const cols = changedCols();
    if (S.mode === 'edit' && !cols.length) return true;
    if (S.mode === 'create' && !String(S.draft[t.labelCol] || '').trim()) {
      toast(`"${t.headers[t.labelCol]}" alanı boş olamaz.`, 'err');
      return false;
    }
    // ad değişiyorsa, ad üzerinden bağlı kayıtlar kopacak → uyar
    if (S.mode === 'edit' && cols.includes(nameCol(t))) {
      const groups = backlinks(t, S.original, true).filter(g => g.rows.length);
      if (groups.length) {
        const ok = await modal('Ad değişiyor', h('div', null,
          h('p', null, `"${S.original[nameCol(t)]}" adı şu kayıtlarda geçiyor; ad değişince bu bağlar kopar ve elle düzeltilmeleri gerekir:`),
          h('ul', null, groups.map(g => h('li', null, `${g.title}: ${g.rows.length}`)))),
          [{ label: 'Vazgeç', value: false }, { label: 'Yine de kaydet', kind: 'danger', value: true }]);
        if (!ok) return false;
      }
    }
    S.saving = true; refreshDirty();
    try {
      if (S.mode === 'create') {
        const values = {};
        t.types.forEach((ty, i) => { if (ty !== 'id' && ty !== 'readonly' && String(S.draft[i] ?? '').trim() !== '') values[i] = S.draft[i]; });
        const res = await S.adapter.create(t.name, values, { autoId: t.hasIds });
        const row = res.row.slice(); row.__row = res.rowNum;
        while (row.length < t.headers.length) row.push('');
        t.rows.push(row);
        afterWrite(t);
        S.draft = null;
        openRecord(keyOf(t, row));
        toast(`${keyLabel(t, row)} oluşturuldu.`, 'ok');
      } else {
        const changes = {};
        cols.forEach(i => { changes[i] = S.draft[i]; });
        // kimlikli sayfada yalnız değişen alanlar karşılaştırılır; kimliksizde satır kaymasını yakalamak için tüm satır
        const expected = t.hasIds ? Object.fromEntries(cols.map(i => [i, S.original[i]])) : nonFormulaRow(t, S.original);
        const res = await S.adapter.update(t.name, refFor(t), changes, expected);
        const fresh = res.row.slice(); fresh.__row = res.rowNum;
        while (fresh.length < t.headers.length) fresh.push('');
        const idx = t.rows.indexOf(S.rowObj);
        if (idx >= 0) t.rows[idx] = fresh;
        S.rowObj = fresh;
        afterWrite(t);
        const external = fresh.some((v, i) => String(v) !== String(S.draft[i] ?? ''));
        S.original = fresh.slice();
        S.draft = fresh.slice();
        S.conflict = null;
        if (external) renderEditor();
        else { const c = $('#conflict'); if (c) c.replaceWith(conflictBox()); refreshDirty(); }
        toast(`${keyLabel(t, fresh)} kaydedildi.`, 'ok');
      }
      return true;
    } catch (e) {
      if (e.code === 'conflict' && e.current) {
        S.conflict = e.current;
        $('#conflict').replaceWith(conflictBox());
        $('#editor').scrollTop = 0;
      } else if (e.code === 'not_found') {
        toast('Kayıt sunucuda bulunamadı (silinmiş ya da satırlar kaymış olabilir). Yenile ile güncel veriyi alın.', 'err');
      } else if (e.code === 'auth') {
        toast('Oturum geçersiz, yeniden giriş yapın.', 'err'); logout();
      } else {
        toast('Kaydedilemedi: ' + e.message, 'err');
      }
      return false;
    } finally {
      S.saving = false; refreshDirty();
    }
  }

  function afterWrite(t) {
    reindex(t);
    S.idxCache.clear();
    refreshEnums(t);
    renderTabs();
    renderList();
  }

  function revert() {
    if (S.mode === 'create') { clearEditor(); return; }
    S.draft = S.original.slice();
    renderEditor();
  }

  async function confirmDelete() {
    const t = S.tables[S.active];
    const label = keyLabel(t, S.rowObj);
    const links = backlinks(t, S.original).filter(g => g.rows.length);
    const body = h('div', null,
      h('p', null, `${label} — ${S.original[t.labelCol] || ''} kalıcı olarak silinecek. İşlem _Panel_Log sayfasına kaydedilir.`),
      links.length ? [h('p', { class: 'warn' }, 'Bu kayda bağlı kayıtlar var; silinince bağlar kopar:'),
        h('ul', null, links.flatMap(g => g.rows.slice(0, 20).map(r => h('li', null, `${g.table.name} ${keyLabel(g.table, r)} — ${r[g.table.labelCol] || ''}`))))] : null);
    const ok = await modal('Kaydı sil', body, [{ label: 'Vazgeç', value: false }, { label: 'Sil', kind: 'danger', value: true }]);
    if (!ok) return;
    try {
      // formüllü sütunlar başka sayfalardaki değişiklikle kendiliğinden değişebilir → karşılaştırma dışı
      const res = await S.adapter.remove(t.name, refFor(t), nonFormulaRow(t, S.original));
      const gone = S.rowObj;
      t.rows = t.rows.filter(r => r !== gone);
      t.rows.forEach(r => { if (r.__row > res.rowNum) r.__row--; });
      S.draft = S.original.slice();
      afterWrite(t);
      clearEditor();
      toast(`${label} silindi.`, 'ok');
    } catch (e) {
      if (e.code === 'conflict') toast('Kayıt bu arada değişmiş; Yenile ile güncel hâlini alın.', 'err');
      else toast('Silinemedi: ' + e.message, 'err');
    }
  }

  // konsol/test erişimi
  window.panel = { state: S, reload };

  boot();
})();
