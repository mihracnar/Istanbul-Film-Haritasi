const TILE = {
  A: { url:'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',          attr:'&copy; OpenStreetMap &copy; CARTO' },
  B: { url:'https://{s}.basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}{r}.png', attr:'&copy; OpenStreetMap &copy; CARTO' },
  D: { url:'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',         attr:'&copy; OpenStreetMap &copy; CARTO' },
  E: { url:'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',         attr:'&copy; OpenStreetMap &copy; CARTO' },
};

const TYPE_COLORS = {
  A: { nokta:'#c8a252', rota:'#6e9bc8', bölge:'#7ac87a' },
  B: { nokta:'#d42b1e', rota:'#2266cc', bölge:'#22aa55' },
  D: { nokta:'#c47c1e', rota:'#4a6b8a', bölge:'#5c8a4a' },
  E: { nokta:'#f03010', rota:'#0055cc', bölge:'#008844' },
};

const TMDB_KEY  = '5d246fcc9b5f1d3b857545f5244dd780';
const TMDB_BASE = 'https://api.themoviedb.org/3';
const TMDB_IMG  = 'https://image.tmdb.org/t/p/w500';
const TMDB_IMG_ORIG = 'https://image.tmdb.org/t/p/original';

// Cache: filmId → {poster, backdrop, desc, stills}
// sessionStorage'a bağlı — sekme kapanınca temizlenir
const TMDB_CACHE_KEY = 'tmdb_cache_v1';
const tmdbCache = (() => {
  try { return JSON.parse(sessionStorage.getItem(TMDB_CACHE_KEY) || '{}'); }
  catch(e) { return {}; }
})();

function tmdbCacheSave() {
  try { sessionStorage.setItem(TMDB_CACHE_KEY, JSON.stringify(tmdbCache)); }
  catch(e) {}
}

// Sayfa yüklenince data/tmdb-cache.json'dan önceden üretilmiş cache'i yükle
async function loadPrebuiltCache() {
  try {
    const res = await fetch('data/tmdb-cache.json');
    if(!res.ok) return;
    const prebuilt = await res.json();
    let added = 0;
    Object.entries(prebuilt).forEach(([id, val]) => {
      if(!tmdbCache[id]) { tmdbCache[id] = val; added++; }
    });
    if(added > 0) {
      tmdbCacheSave();
      console.log('TMDB prebuilt cache: ' + added + ' film yüklendi');
    }
  } catch(e) {}
}
loadPrebuiltCache();

async function fetchTMDB(film) {
  if (tmdbCache[film.id]) return tmdbCache[film.id];
  try {
    // 1. ADIM: Doğrudan Arama
    const q = encodeURIComponent(film.title);
    const res = await fetch(`${TMDB_BASE}/search/movie?api_key=${TMDB_KEY}&query=${q}&year=${film.year}&language=tr-TR`);
    const data = await res.json();
    let target = data.results?.[0];

    // 2. ADIM: Sonuç yoksa veya isim çok kısaysa yönetmen üzerinden ara
    if (!target || film.title.length <= 3) {
      const pRes = await fetch(`${TMDB_BASE}/search/person?api_key=${TMDB_KEY}&query=${encodeURIComponent(film.dir)}`);
      const pData = await pRes.json();
      if (pData.results?.length > 0) {
        const dirId = pData.results[0].id;
        const dRes = await fetch(`${TMDB_BASE}/discover/movie?api_key=${TMDB_KEY}&with_crew=${dirId}`);
        const dData = await dRes.json();
        target = dData.results.find(m =>
          m.title.toLowerCase() === film.title.toLowerCase() ||
          m.original_title.toLowerCase() === film.title.toLowerCase()
        );
      }
    }
    if (!target) return null;

    // 3. ADIM: Detayları Çek
    const detRes = await fetch(`${TMDB_BASE}/movie/${target.id}?api_key=${TMDB_KEY}&append_to_response=images,credits&language=tr-TR&include_image_language=tr,en,null`);
    const detail = await detRes.json();
    const backdrops = (detail.images?.backdrops || []).slice(0, 8);
    const result = {
      poster:   detail.poster_path   ? TMDB_IMG + detail.poster_path : null,
      backdrop: detail.backdrop_path ? TMDB_IMG_ORIG + detail.backdrop_path : null,
      desc:     detail.overview || '',
      stills:   backdrops.map(b => TMDB_IMG + b.file_path),
      tmdbId:   detail.id,
    };
    tmdbCache[film.id] = result;
    tmdbCacheSave();
    return result;
  } catch (e) {
    console.error('TMDB Fetch Hatası:', e);
    return null;
  }
}

const DESCS = {
  A:"Koyu zemin, altın vurgu, film şeridi detayı — sinema arşivi prestiji.",
  B:"Beyaz zemin, kırmızı-siyah aksan, gazete mantığı — kurumsal ama dinamik.",
  D:"Krem zemin, altın bordür, Osmanlı geometrik desen — İstanbul kimliğine özgün yaklaşım.",
  E:"Saf beyaz, siyah-kırmızı, Teko tipoğrafyası — İsviçre okul minimalizmi.",
};