/* ════════════════════════════════════════════════════════════
   data.js — MapLibre Edition (debug instrumented)

   - matchLocs: TAM (normalize-eşitlik) eşleşme.
   - Yükleme tanıları: yinelenenler, koordinat çakışmaları,
     eşleşmeyen yerler-parçaları, yetim filmler/mekanlar.
   - window.debug.* — interaktif tanı namespace'i.
   - Bayraklar: window.DEBUG_MATCH, window.DEBUG_FILTER,
                window.DEBUG_CLICK, window.DEBUG_FLY (hepsi default false).
   ════════════════════════════════════════════════════════════ */

window.DEBUG_MATCH  = false;  // matchLocs satır satır
window.DEBUG_FILTER = false;  // filtre uygulamaları
window.DEBUG_CLICK  = false;  // harita / chip tıklamaları
window.DEBUG_FLY    = false;  // flyTo / fitBounds çağrıları

function parseCSV(text) {
  const rows = [];
  const lines = text.split('\n');
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li].trim();
    if (!line) continue;
    const cols = [];
    let cur = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') { inQ = !inQ; }
      else if (c === ',' && !inQ) { cols.push(cur.trim()); cur = ''; }
      else cur += c;
    }
    cols.push(cur.trim());
    rows.push(cols);
  }
  return rows;
}

function normStr(s) {
  return (s || '').toLowerCase()
    .replace(/İ/g,'i').replace(/ı/g,'i').replace(/Ğ/g,'g').replace(/ğ/g,'g')
    .replace(/Ü/g,'u').replace(/ü/g,'u').replace(/Ş/g,'s').replace(/ş/g,'s')
    .replace(/Ö/g,'o').replace(/ö/g,'o').replace(/Ç/g,'c').replace(/ç/g,'c')
    .replace(/â/g,'a').replace(/î/g,'i').replace(/û/g,'u')
    .replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim();
}

/* ════════════════════════════════════════════════════════════
   matchLocs — TAM eşleşme. DEBUG_MATCH açıkken her parça loglar.
   ════════════════════════════════════════════════════════════ */
function matchLocs(cekildigiYer, locsArr, filmCtx) {
  if (!cekildigiYer) return [];
  const parts = cekildigiYer.split(',').map(s => normStr(s)).filter(Boolean);
  const matched = [];
  const dbg = window.DEBUG_MATCH;
  const ctx = (dbg && filmCtx) ? `[F${filmCtx.id} "${filmCtx.title}"] ` : '';

  for (const part of parts) {
    if (part.length < 3) {
      if (dbg) console.log(`${ctx}parça "${part}" çok kısa, atlandı`);
      continue;
    }
    let hit = null;
    for (const loc of locsArr) {
      const ln = loc._n || normStr(loc.name);
      if (ln === part) {
        hit = loc;
        if (!matched.includes(loc.id)) matched.push(loc.id);
      }
    }
    if (dbg) {
      if (hit) console.log(`${ctx}parça "${part}" → M${hit.id} "${hit.name}"`);
      else     console.warn(`${ctx}parça "${part}" → eşleşme YOK`);
    }
  }
  return matched;
}

/* ════════════════════════════════════════════════════════════
   loadSheetsData
   ════════════════════════════════════════════════════════════ */
async function loadSheetsData() {
  try {
    const t0 = performance.now();
    const [filmRes, mekanRes] = await Promise.all([
      fetch(`${SHEETS_BASE}&gid=${GID_FILMLER}`),
      fetch(`${SHEETS_BASE}&gid=${GID_MEKANLAR}`)
    ]);
    const [filmText, mekanText] = await Promise.all([filmRes.text(), mekanRes.text()]);
    const tFetch = performance.now();

    // ── Mekanlar ─────────────────────────────────────────────
    const mekanRows = parseCSV(mekanText).slice(1);

    const mekanColCounts = {};
    mekanRows.forEach(r => { mekanColCounts[r.length] = (mekanColCounts[r.length] || 0) + 1; });
    if (Object.keys(mekanColCounts).length > 1) {
      console.warn('[veri] mekanlar CSV: tutarsız sütun sayıları', mekanColCounts);
    }

    LOCS = mekanRows
      .filter(r => r[0] && r[0].startsWith('M'))
      .map(r => {
        const idNum = parseInt(r[0].replace('M',''), 10);
        const coords = (r[3] || '').replace(/"/g,'').split(',').map(s => parseFloat(s.trim()));
        const name = r[1] || '';
        return {
          id:   idNum,
          name: name,
          _n:   normStr(name),
          cat:  r[2] || 'Diğer',
          lat:  coords[0] || 0,
          lng:  coords[1] || 0,
          ilce: r[4] || '',
          type: 'nokta',
          films: []
        };
      })
      .filter(l => l.lat && l.lng);

    // Tanı: yinelenen normalize edilmiş adlar
    const dupNorm = {};
    LOCS.forEach(l => { if (l._n) (dupNorm[l._n] = dupNorm[l._n] || []).push(l); });
    const dupNames = Object.entries(dupNorm).filter(([k, arr]) => arr.length > 1);
    if (dupNames.length) {
      console.warn(`[veri] ${dupNames.length} grupta yinelenen mekan adı (normalize sonrası):`,
        dupNames.map(([k, arr]) => ({ ad: k, kayıtlar: arr.map(l => `M${l.id} "${l.name}"`) })));
    }

    // Tanı: koordinat çakışmaları
    const dupCoord = {};
    LOCS.forEach(l => {
      const k = `${l.lat.toFixed(6)},${l.lng.toFixed(6)}`;
      (dupCoord[k] = dupCoord[k] || []).push(l);
    });
    const dupCoords = Object.entries(dupCoord).filter(([k, arr]) => arr.length > 1);
    if (dupCoords.length) {
      console.warn(`[veri] ${dupCoords.length} koordinatta birden fazla mekan (üst üste pin):`,
        dupCoords.map(([k, arr]) => ({ koord: k, ids: arr.map(l => `M${l.id} "${l.name}"`) })));
    }

    // Tanı: ID boşlukları
    const locIdsSorted = LOCS.map(l => l.id).sort((a,b) => a-b);
    const locGaps = [];
    for (let i = 1; i < locIdsSorted.length; i++) {
      if (locIdsSorted[i] - locIdsSorted[i-1] > 1) locGaps.push(`${locIdsSorted[i-1]}→${locIdsSorted[i]}`);
    }
    if (locGaps.length) {
      console.log(`[veri] LOCS id boşlukları (silinmiş satır): ${locGaps.length}`,
        locGaps.length > 10 ? locGaps.slice(0,10).concat('...') : locGaps);
    }

    // ── Filmler ──────────────────────────────────────────────
    const filmRows = parseCSV(filmText).slice(1);
    const filmColCounts = {};
    filmRows.forEach(r => { filmColCounts[r.length] = (filmColCounts[r.length] || 0) + 1; });
    if (Object.keys(filmColCounts).length > 1) {
      console.warn('[veri] filmler CSV: tutarsız sütun sayıları', filmColCounts);
    }

    // Parçalı eşleşme istatistiği — global (dropped+kept hepsi)
    let totalParts = 0, unmatchedParts = 0;
    const unmatchedSamples = {};

    const _allFilmRows = filmRows
      .filter(r => r[0] && r[0].startsWith('F'))
      .map(r => {
        const idNum = parseInt(r[0].replace('F',''), 10);
        const yerler = r[6] || '';
        const f = {
          id:    idNum,
          title: (r[1] || '').trim(),
          yabanci: r[2] === 'Yabancı',
          dir:   (r[3] || '').trim(),
          genre: (r[4] || '').split(',')[0].trim(),
          year:  parseInt(r[5], 10) || 0,
          locs:  [],
          desc:  (r[7] || '').trim(),
          stills: [],
          yerlerRaw: yerler
        };
        f.locs = matchLocs(yerler, LOCS, f);

        yerler.split(',').map(s => s.trim()).filter(Boolean).forEach(p => {
          totalParts++;
          const np = normStr(p);
          if (np.length < 3) return;
          if (!LOCS.some(l => l._n === np)) {
            unmatchedParts++;
            (unmatchedSamples[np] = unmatchedSamples[np] || { ham: p, films: [] }).films.push(f.id);
          }
        });
        return f;
      });

    if (unmatchedParts) {
      const top = Object.entries(unmatchedSamples)
        .sort(([,a],[,b]) => b.films.length - a.films.length)
        .slice(0, 20)
        .map(([norm, info]) => `"${info.ham}" (${info.films.length}x)`);
      console.warn(`[veri] ${unmatchedParts}/${totalParts} yerler-parçası LOCS'ta karşılık bulamadı. En sık 20:`, top);
      console.warn('[veri] Tamamı: debug.unmatchedYerler()');
    }

    // Tanı: yinelenen film başlıkları
    const titleCount = {};
    _allFilmRows.forEach(f => (titleCount[f.title] = titleCount[f.title] || []).push(f.id));
    const dupTitles = Object.entries(titleCount).filter(([t, ids]) => ids.length > 1);
    if (dupTitles.length) {
      console.warn(`[veri] ${dupTitles.length} yinelenen film başlığı (gorselMap'i bozar):`,
        dupTitles.map(([t, ids]) => `"${t}" → F${ids.join(', F')}`));
    }

    const _droppedNoGenre = _allFilmRows.filter(f => !f.genre || f.genre.trim() === '');
    const _droppedNoLocs  = _allFilmRows.filter(f => f.genre && f.genre.trim() && f.locs.length === 0);
    if (_droppedNoGenre.length) {
      console.warn(`[veri] ${_droppedNoGenre.length} film tür alanı boş olduğu için elendi:`,
        _droppedNoGenre.map(f => `F${f.id} "${f.title}"`));
    }
    if (_droppedNoLocs.length) {
      console.warn(`[veri] ${_droppedNoLocs.length} film hiçbir mekanla eşleşmediği için elendi:`,
        _droppedNoLocs.map(f => `F${f.id} "${f.title}" — yerler: "${f.yerlerRaw}"`));
    }

    FILMS = _allFilmRows.filter(f => f.genre && f.genre.trim() !== '' && f.locs.length > 0);

    LOCS.forEach(loc => {
      loc.films = FILMS.filter(f => f.locs.includes(loc.id)).map(f => f.id);
    });

    const _locsBefore = LOCS.length;
    const _locsDropped = LOCS.filter(l => !(l.films.length > 0 && l.cat && l.cat.trim() !== ''));
    LOCS = LOCS.filter(l => l.films.length > 0 && l.cat && l.cat.trim() !== '');
    if (_locsDropped.length) {
      const noFilm  = _locsDropped.filter(l => l.films.length === 0);
      const noCat   = _locsDropped.filter(l => l.films.length > 0 && (!l.cat || l.cat.trim() === ''));
      console.log(`[veri] ${_locsDropped.length} mekan elendi (film yok veya geçersiz kategori)`);
      if (noFilm.length) {
        console.log(`  ↳ ${noFilm.length} film yok:`,
          noFilm.map(l => `M${l.id} "${l.name}" [${l.cat || '(boş)'}]`));
      }
      if (noCat.length) {
        console.log(`  ↳ ${noCat.length} kategori boş:`,
          noCat.map(l => `M${l.id} "${l.name}" (${l.films.length} film)`));
      }
    }

    const _validLocIds = new Set(LOCS.map(l => l.id));
    let _staleRefs = 0;
    FILMS.forEach(f => {
      const before = f.locs.length;
      f.locs = f.locs.filter(id => _validLocIds.has(id));
      _staleRefs += (before - f.locs.length);
    });
    const _orphans = FILMS.filter(f => f.locs.length === 0);
    if (_orphans.length) {
      console.warn(`[veri] LOCS filtresinden sonra ${_orphans.length} film tüm mekanlarını kaybettiği için atılıyor:`,
        _orphans.map(f => `F${f.id} "${f.title}"`));
    }
    if (_staleRefs) {
      console.warn(`[veri] FILMS içinden ${_staleRefs} adet eski loc referansı temizlendi`);
    }
    FILMS = FILMS.filter(f => f.locs.length > 0);

    LOCS.forEach(loc => {
      loc.films = FILMS.filter(f => f.locs.includes(loc.id)).map(f => f.id);
    });

    const tParse = performance.now();
    console.log(`[veri] Yükleme tamam: ${FILMS.length} film, ${LOCS.length} mekan ` +
                `(fetch ${(tFetch-t0).toFixed(0)}ms, parse ${(tParse-tFetch).toFixed(0)}ms)`);
    console.log('[veri] Tanı: debug.help()');

    window.LOCS = LOCS;
    window.FILMS = FILMS;

    buildLookupMaps();
    return true;
  } catch(e) {
    console.error('Sheets yükleneme hatası:', e);
    eShowLoading('HATA: ' + e.message);
    setTimeout(eHideLoading, 3000);
    return false;
  }
}

/* ════════════════════════════════════════════════════════════
   window.debug — tanı namespace'i (data.js bölümü)
   map.js ve ui.js bu namespace'i `Object.assign(window.debug, {...})`
   ile genişletir.
   ════════════════════════════════════════════════════════════ */
window.debug = window.debug || {};

(function() {
  function _ready() {
    if (typeof FILMS === 'undefined' || !FILMS || !LOCS) {
      console.warn('Veri henüz yüklenmedi'); return false;
    }
    return true;
  }

  Object.assign(window.debug, {

    help() {
      console.log(`window.debug.* — kullanılabilir fonksiyonlar:

VERİ
  film(query)            — film detayı (yerler ham + parçalar + eşleşmeler)
  loc(idOrName)          — mekan detayı + bağlı filmler
  locsByName(query)      — substring araması (sadece tanı, eşleşmede DEĞİL)
  unmatchedYerler()      — LOCS'ta karşılığı olmayan yerler-parçaları (table)
  duplicateLocs()        — yinelenen normStr veya koordinat
  duplicateTitles()      — yinelenen film başlığı
  unusedLocs()           — hiçbir filmde geçmeyen mekanlar
  orphanGorseller()      — gorselMap'te olup FILMS'te olmayan başlıklar
  filmsWithoutGorsel()   — FILMS'te olup gorselMap'te olmayan filmler
  stats()                — özet sayılar + dağılımlar

HARİTA
  map.state()            — mevcut filtreler, eActiveLoc, görünür pin
  map.filters()          — eActiveGenre/Dir/LocCat/Decade durumu
  map.visiblePins()      — şu an haritada görünen mekanlar
  map.filteredFilms()    — şu anki filtrelere uyan filmler

İZ SÜRME (default kapalı)
  trace.match(true)      — matchLocs satır satır
  trace.click(true)      — pin/film/chip tıklamaları
  trace.filter(true)     — filtre uygulamaları + sonuç sayısı
  trace.fly(true)        — flyTo / fitBounds çağrıları
  trace.all(true|false)  — hepsini topluca aç/kapat
`);
    },

    film(query) {
      if (!_ready()) return;
      const q = (query || '').toLowerCase();
      const matches = FILMS.filter(f => f.title.toLowerCase().includes(q));
      if (!matches.length) { console.log('Film bulunamadı:', query); return; }
      matches.forEach(f => {
        console.group(`F${f.id} — "${f.title}"`);
        console.log('yerler (ham):', JSON.stringify(f.yerlerRaw));
        const parts = (f.yerlerRaw || '').split(',').map(s => s.trim()).filter(Boolean);
        console.log(`${parts.length} parça:`);
        parts.forEach((p, i) => {
          const np = normStr(p);
          const hit = LOCS.find(l => l._n === np);
          console.log(`  [${i+1}] "${p}" → "${np}" → ${hit ? `M${hit.id} "${hit.name}"` : 'EŞLEŞME YOK'}`);
        });
        console.log(`f.locs (${f.locs.length}):`, f.locs.map(id => {
          const loc = LOCS.find(l => l.id === id);
          return loc ? `M${id} "${loc.name}"` : `M${id} (LOCS\'ta yok!)`;
        }));
        console.groupEnd();
      });
      return matches;
    },

    loc(idOrName) {
      if (!_ready()) return;
      let loc;
      if (typeof idOrName === 'number') {
        loc = LOCS.find(l => l.id === idOrName);
      } else {
        const q = (idOrName || '').toLowerCase();
        loc = LOCS.find(l => l.name.toLowerCase() === q) ||
              LOCS.find(l => l.name.toLowerCase().includes(q));
      }
      if (!loc) { console.log('Mekan bulunamadı:', idOrName); return; }
      console.group(`M${loc.id} — "${loc.name}"`);
      console.log('kategori:', loc.cat, '| ilçe:', loc.ilce);
      console.log('koordinat:', `[${loc.lat}, ${loc.lng}]`);
      console.log('normStr:', loc._n);
      console.log(`bağlı ${loc.films.length} film:`, loc.films.map(id => {
        const f = FILMS.find(x => x.id === id);
        return f ? `F${id} "${f.title}"` : `F${id}`;
      }));
      console.groupEnd();
      return loc;
    },

    locsByName(query) {
      if (!_ready()) return;
      const q = normStr(query);
      const hits = LOCS.filter(l => l._n.includes(q));
      console.log(`"${query}" için ${hits.length} mekan:`, hits.map(l => `M${l.id} "${l.name}"`));
      return hits;
    },

    unmatchedYerler() {
      if (!_ready()) return;
      const validNorms = new Set(LOCS.map(l => l._n));
      const map = {};
      FILMS.forEach(f => {
        (f.yerlerRaw || '').split(',').map(s => s.trim()).filter(Boolean).forEach(p => {
          const np = normStr(p);
          if (np.length < 3) return;
          if (!validNorms.has(np)) {
            (map[np] = map[np] || { ham: p, filmler: [] }).filmler.push(`F${f.id}`);
          }
        });
      });
      const arr = Object.entries(map)
        .map(([norm, info]) => ({ norm, ham: info.ham, sayı: info.filmler.length, ilkFilmler: info.filmler.slice(0, 3).join(', ') }))
        .sort((a, b) => b.sayı - a.sayı);
      console.log(`${arr.length} farklı eşleşmeyen yerler-parçası:`);
      console.table(arr);
      return arr;
    },

    duplicateLocs() {
      if (!_ready()) return;
      const byNorm = {}, byCoord = {};
      LOCS.forEach(l => {
        (byNorm[l._n] = byNorm[l._n] || []).push(l);
        const k = `${l.lat.toFixed(6)},${l.lng.toFixed(6)}`;
        (byCoord[k] = byCoord[k] || []).push(l);
      });
      const nameDups = Object.entries(byNorm).filter(([k, arr]) => arr.length > 1);
      const coordDups = Object.entries(byCoord).filter(([k, arr]) => arr.length > 1);
      console.group('Yinelenen normalize adlar');
      nameDups.forEach(([k, arr]) => console.log(`"${k}":`, arr.map(l => `M${l.id} "${l.name}"`)));
      console.groupEnd();
      console.group('Yinelenen koordinatlar');
      coordDups.forEach(([k, arr]) => console.log(k, ':', arr.map(l => `M${l.id} "${l.name}"`)));
      console.groupEnd();
      return { nameDups, coordDups };
    },

    duplicateTitles() {
      if (!_ready()) return;
      const map = {};
      FILMS.forEach(f => (map[f.title] = map[f.title] || []).push(f));
      const dups = Object.entries(map).filter(([t, arr]) => arr.length > 1);
      console.log(`${dups.length} yinelenen başlık:`,
        dups.map(([t, arr]) => `"${t}" → F${arr.map(f => f.id).join(', F')}`));
      return dups;
    },

    unusedLocs() {
      if (!_ready()) return;
      const used = new Set();
      FILMS.forEach(f => f.locs.forEach(id => used.add(id)));
      const unused = LOCS.filter(l => !used.has(l.id));
      console.log(`${unused.length} hiç kullanılmayan mekan (mevcut LOCS içinde):`,
        unused.map(l => `M${l.id} "${l.name}"`));
      return unused;
    },

    orphanGorseller() {
      if (!_ready()) return;
      if (!window.gorselMap) { console.log('gorselMap yok'); return; }
      const titles = new Set(FILMS.map(f => f.title.replace(/\s+/g, ' ').trim()));
      const orphan = Object.keys(gorselMap).filter(t => !titles.has(t));
      console.log(`${orphan.length} görsel başlığı FILMS'te yok:`, orphan);
      return orphan;
    },

    filmsWithoutGorsel() {
      if (!_ready()) return;
      if (!window.gorselMap) { console.log('gorselMap yok'); return; }
      const missing = FILMS.filter(f => !gorselMap[f.title] && !gorselMap[f.title.replace(/\s+/g, ' ').trim()]);
      console.log(`${missing.length} film görselsiz:`, missing.map(f => `F${f.id} "${f.title}"`));
      return missing;
    },

    stats() {
      if (!_ready()) return;
      const catCount = {};
      LOCS.forEach(l => catCount[l.cat] = (catCount[l.cat] || 0) + 1);
      const ilceCount = {};
      LOCS.forEach(l => ilceCount[l.ilce || '(boş)'] = (ilceCount[l.ilce || '(boş)'] || 0) + 1);
      const genreCount = {};
      FILMS.forEach(f => genreCount[f.genre] = (genreCount[f.genre] || 0) + 1);
      const yearCount = { '<1980': 0, '1980-2000': 0, '2000-2020': 0, '2020+': 0, 'belirsiz': 0 };
      FILMS.forEach(f => {
        if (!f.year) yearCount.belirsiz++;
        else if (f.year < 1980) yearCount['<1980']++;
        else if (f.year < 2000) yearCount['1980-2000']++;
        else if (f.year < 2020) yearCount['2000-2020']++;
        else yearCount['2020+']++;
      });
      const locsPerFilm = FILMS.map(f => f.locs.length);
      const filmsPerLoc = LOCS.map(l => l.films.length);
      const sum = a => a.reduce((s, x) => s + x, 0);
      const max = a => a.length ? Math.max(...a) : 0;
      const topLocs = [...LOCS].sort((a, b) => b.films.length - a.films.length).slice(0, 10);
      const topDirs = {};
      FILMS.forEach(f => topDirs[f.dir] = (topDirs[f.dir] || 0) + 1);
      const topDirsArr = Object.entries(topDirs).sort(([,a],[,b]) => b-a).slice(0, 10);

      console.group('STATS');
      console.log(`Film: ${FILMS.length} | Mekan: ${LOCS.length}`);
      console.log(`Mekan/film: ort ${(sum(locsPerFilm)/FILMS.length).toFixed(1)}, max ${max(locsPerFilm)}`);
      console.log(`Film/mekan: ort ${(sum(filmsPerLoc)/LOCS.length).toFixed(1)}, max ${max(filmsPerLoc)}`);
      console.log('Kategori dağılımı:', catCount);
      console.log('İlçe dağılımı:', ilceCount);
      console.log('Tür dağılımı:', genreCount);
      console.log('Yıl dağılımı:', yearCount);
      console.log('En çok geçen 10 mekan:', topLocs.map(l => `M${l.id} "${l.name}" (${l.films.length})`));
      console.log('En verimli 10 yönetmen:', topDirsArr.map(([d,c]) => `${d} (${c})`));
      console.groupEnd();
    },

    trace: {
      match(on)  { window.DEBUG_MATCH = !!on; console.log(`DEBUG_MATCH = ${!!on} (yeniden yükleme: location.reload())`); },
      click(on)  { window.DEBUG_CLICK = !!on; console.log(`DEBUG_CLICK = ${!!on}`); },
      filter(on) { window.DEBUG_FILTER = !!on; console.log(`DEBUG_FILTER = ${!!on}`); },
      fly(on)    { window.DEBUG_FLY = !!on; console.log(`DEBUG_FLY = ${!!on}`); },
      all(on)    {
        window.DEBUG_MATCH = !!on; window.DEBUG_CLICK = !!on;
        window.DEBUG_FILTER = !!on; window.DEBUG_FLY = !!on;
        console.log(`Tüm trace bayrakları: ${!!on}`);
      }
    }
  });
})();

// Geriye uyumluluk
window.debugFilm = (q) => window.debug.film(q);

/* ════════════════════════════════════════════════════════════
   gorselMap
   ════════════════════════════════════════════════════════════ */

function driveToImgUrl(url) {
  if (!url) return url;
  if (url.includes('lh3.google')) return url;
  var m = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (m) return 'https://lh3.googleusercontent.com/d/' + m[1];
  return url;
}

let gorselMap = {};
window.gorselMap = gorselMap;

async function loadGorseller() {
  try {
    const res  = await fetch(`${SHEETS_BASE}&gid=${GID_GORSELLER}`);
    const text = await res.text();
    const rows = parseCSV(text).slice(1);

    const raw = {};
    let skippedX = 0, skippedNoUrl = 0, skippedNoTitle = 0;
    rows.forEach(r => {
      const url   = driveToImgUrl((r[3] || '').trim());
      const durum = (r[4] || '').trim();
      const title = (r[1] || '').trim().replace(/\s+/g, ' ');
      const mekan = (r[2] || '').trim();
      if (durum === 'x') { skippedX++; return; }
      if (!url) { skippedNoUrl++; return; }
      if (!title) { skippedNoTitle++; return; }
      if (!raw[title]) raw[title] = { prio: [], normal: [] };
      const item = { url, mekan };
      if (durum === '1') raw[title].prio.push(item);
      else               raw[title].normal.push(item);
    });

    gorselMap = {};
    Object.entries(raw).forEach(([title, { prio, normal }]) => {
      if (prio.length || normal.length)
        gorselMap[title] = [...prio, ...normal];
    });
    window.gorselMap = gorselMap;

    console.log(`gorselMap: ${Object.keys(gorselMap).length} film yüklendi ` +
                `(atlanan: x=${skippedX}, url-yok=${skippedNoUrl}, başlık-yok=${skippedNoTitle})`);
  } catch(e) {
    console.warn('Görseller yüklenemedi:', e.message);
  }
}

function getGorsellerForFilm(filmTitle) {
  const items = gorselMap[filmTitle] || gorselMap[(filmTitle||'').replace(/\s+/g,' ').trim()];
  if (!items || !items.length) return null;
  return {
    stills:   items.map(i => i.url),
    poster:   null,
    backdrop: items[0].url,
    desc:     '',
    mekanlar: items.map(i => i.mekan).filter(Boolean),
    fromGorselSheet: true
  };
}