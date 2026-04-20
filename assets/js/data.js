/* ════════════════════════════════════════════════════════════
   data.js — MapLibre Edition
   Tek değişiklik: koordinatlar hâlâ {lat, lng} obje alanları
   olarak saklanır (LOC_MAP/LOCS.lat, LOCS.lng), ama MapLibre'ye
   her yerde [lng, lat] olarak geçilir. Bu dosya değişmez.
   ════════════════════════════════════════════════════════════ */

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

function matchLocs(cekildigiYer, locsArr) {
  if (!cekildigiYer) return [];
  const parts = cekildigiYer.split(',').map(s => normStr(s)).filter(Boolean);
  const matched = [];
  for (const part of parts) {
    if (part.length < 3) continue;
    for (const loc of locsArr) {
      const locNorm = normStr(loc.name);
      if (locNorm.includes(part) || part.includes(locNorm)) {
        if (!matched.includes(loc.id)) matched.push(loc.id);
      }
    }
  }
  return matched;
}

async function loadSheetsData() {
  try {
    const [filmRes, mekanRes] = await Promise.all([
      fetch(`${SHEETS_BASE}&gid=${GID_FILMLER}`),
      fetch(`${SHEETS_BASE}&gid=${GID_MEKANLAR}`)
    ]);
    const [filmText, mekanText] = await Promise.all([filmRes.text(), mekanRes.text()]);

    // Parse mekanlar
    const mekanRows = parseCSV(mekanText).slice(1);
    LOCS = mekanRows
      .filter(r => r[0] && r[0].startsWith('M'))
      .map(r => {
        const idNum = parseInt(r[0].replace('M',''), 10);
        // Sheets'te koordinatlar "lat,lng" sırası
        const coords = (r[3] || '').replace(/"/g,'').split(',').map(s => parseFloat(s.trim()));
        return {
          id:   idNum,
          name: r[1] || '',
          cat:  r[2] || 'Diğer',
          lat:  coords[0] || 0,  // coğrafi enlem — loc.lat olarak sakla
          lng:  coords[1] || 0,  // coğrafi boylam — loc.lng olarak sakla
          ilce: r[4] || '',
          type: 'nokta',
          films: []
        };
      })
      .filter(l => l.lat && l.lng);

    // Parse filmler
    const filmRows = parseCSV(filmText).slice(1);
    FILMS = filmRows
      .filter(r => r[0] && r[0].startsWith('F'))
      .map(r => {
        const idNum = parseInt(r[0].replace('F',''), 10);
        const yerler = r[6] || '';
        const locIds = matchLocs(yerler, LOCS);
        const genre = (r[4] || '').split(',')[0].trim();
        return {
          id:    idNum,
          title: (r[1] || '').trim(),
          yabanci: r[2] === 'Yabancı',
          dir:   (r[3] || '').trim(),
          genre: genre,
          year:  parseInt(r[5], 10) || 0,
          locs:  locIds,
          desc:  (r[7] || '').trim(),
          stills: []
        };
      })
      .filter(f => f.genre && f.genre.trim() !== '' && f.locs.length > 0);

    // LOCS.films
    LOCS.forEach(loc => {
      loc.films = FILMS.filter(f => f.locs.includes(loc.id)).map(f => f.id);
    });

    LOCS = LOCS.filter(l => l.films.length > 0 && l.cat && l.cat.trim() !== '');

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
   gorselMap: filmTitle → [{url, mekan}]
   Seçim Durumu: '1' = önce, '' / '0' = normal, 'x' = gösterme
   ════════════════════════════════════════════════════════════ */
let gorselMap = {};

async function loadGorseller() {
  try {
    const res  = await fetch(`${SHEETS_BASE}&gid=${GID_GORSELLER}`);
    const text = await res.text();
    const rows = parseCSV(text).slice(1); // A=ID B=FilmAdı C=Mekan D=URL E=Durum

    const raw = {};
    rows.forEach(r => {
      const url   = (r[3] || '').trim();
      const durum = (r[4] || '').trim();
      const title = (r[1] || '').trim().replace(/\s+/g, ' ');
      const mekan = (r[2] || '').trim();
      if (!url || !title || durum === 'x') return;
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

    console.log('gorselMap: ' + Object.keys(gorselMap).length + ' film yüklendi');
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