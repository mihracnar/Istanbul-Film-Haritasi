/**
 * TMDB Cache Builder
 * Kullanım: node scripts/build-tmdb-cache.js
 * Çıktı: data/tmdb-cache.json
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const TMDB_KEY     = '5d246fcc9b5f1d3b857545f5244dd780';
const TMDB_BASE    = 'https://api.themoviedb.org/3';
const TMDB_IMG     = 'https://image.tmdb.org/t/p/w500';
const TMDB_IMG_ORIG= 'https://image.tmdb.org/t/p/original';

const SHEETS_URL   = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vTXt4zT3CyoU90VGbFB8zUjGaqErL2l-CVSXoHE0JExFEDtCMoeEkZOsoR1ir3vLONtrspJAwG1kZSA/pub?output=csv&gid=0';

const OUT_FILE = path.join(__dirname, '../data/tmdb-cache.json');
const DELAY_MS = 300; // Rate limit: ~3 istek/saniye

function get(url, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      // Redirect takip et
      if ((res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307)
          && res.headers.location && maxRedirects > 0) {
        return get(res.headers.location, maxRedirects - 1).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { resolve(data); }
      });
    }).on('error', reject);
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function parseCSV(text) {
  const rows = [];
  const lines = text.split('\n');
  for (const line of lines) {
    if(!line.trim()) continue;
    const cols = [];
    let cur = '', inQ = false;
    for (const c of line) {
      if (c === '"') { inQ = !inQ; }
      else if (c === ',' && !inQ) { cols.push(cur.trim()); cur = ''; }
      else cur += c;
    }
    cols.push(cur.trim());
    rows.push(cols);
  }
  return rows;
}

async function fetchTMDB(film) {
  try {
    // 1. Doğrudan ara
    const q = encodeURIComponent(film.title);
    const data = await get(`${TMDB_BASE}/search/movie?api_key=${TMDB_KEY}&query=${q}&year=${film.year}&language=tr-TR`);
    let target = data.results?.[0];

    // 2. Bulamazsa yönetmen üzerinden
    if (!target || film.title.length <= 3) {
      await sleep(DELAY_MS);
      const pData = await get(`${TMDB_BASE}/search/person?api_key=${TMDB_KEY}&query=${encodeURIComponent(film.dir)}`);
      if (pData.results?.length > 0) {
        await sleep(DELAY_MS);
        const dirId = pData.results[0].id;
        const dData = await get(`${TMDB_BASE}/discover/movie?api_key=${TMDB_KEY}&with_crew=${dirId}`);
        target = dData.results?.find(m =>
          m.title.toLowerCase() === film.title.toLowerCase() ||
          m.original_title?.toLowerCase() === film.title.toLowerCase()
        );
      }
    }
    if (!target) return null;

    // 3. Detay + görseller
    await sleep(DELAY_MS);
    const detail = await get(`${TMDB_BASE}/movie/${target.id}?api_key=${TMDB_KEY}&append_to_response=images&language=tr-TR&include_image_language=tr,en,null`);
    const backdrops = (detail.images?.backdrops || []).slice(0, 8);

    return {
      poster:   detail.poster_path   ? TMDB_IMG + detail.poster_path : null,
      backdrop: detail.backdrop_path ? TMDB_IMG_ORIG + detail.backdrop_path : null,
      desc:     detail.overview || '',
      stills:   backdrops.map(b => TMDB_IMG + b.file_path),
      tmdbId:   detail.id,
    };
  } catch(e) {
    console.error(`  HATA [${film.title}]:`, e.message);
    return null;
  }
}

async function main() {
  console.log('📥 Filmler Sheets\'ten çekiliyor...');
  const csvText = await get(SHEETS_URL);
  const rows = parseCSV(csvText).slice(1);
  const films = rows
    .filter(r => r[0]?.startsWith('F'))
    .map(r => ({
      id:    parseInt(r[0].replace('F', ''), 10),
      title: (r[1] || '').trim(),
      dir:   (r[3] || '').trim(),
      year:  parseInt(r[5], 10) || 0,
      genre: (r[4] || '').split(',')[0].trim(),
    }))
    .filter(f => f.title && f.genre);

  console.log(`✅ ${films.length} film bulundu\n`);

  // Mevcut cache varsa yükle (devam edebilmek için)
  let cache = {};
  if (fs.existsSync(OUT_FILE)) {
    cache = JSON.parse(fs.readFileSync(OUT_FILE, 'utf8'));
    console.log(`♻️  Mevcut cache: ${Object.keys(cache).length} film\n`);
  }

  let done = 0, skipped = 0, failed = 0;

  for (const film of films) {
    const key = String(film.id);
    if (cache[key]) {
      skipped++;
      continue;
    }
    process.stdout.write(`[${done + skipped + 1}/${films.length}] ${film.title} (${film.year})... `);
    const result = await fetchTMDB(film);
    if (result) {
      cache[key] = result;
      done++;
      console.log(`✅ ${result.tmdbId}`);
    } else {
      failed++;
      console.log('❌ bulunamadı');
    }
    // Her 10 filmde bir kaydet
    if ((done + failed) % 10 === 0) {
      fs.writeFileSync(OUT_FILE, JSON.stringify(cache, null, 2));
    }
    await sleep(DELAY_MS);
  }

  fs.writeFileSync(OUT_FILE, JSON.stringify(cache, null, 2));
  console.log(`\n✅ Tamamlandı: ${done} yeni, ${skipped} atlandı, ${failed} başarısız`);
  console.log(`📁 ${OUT_FILE}`);
}

main().catch(console.error);