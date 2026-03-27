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
  catch(e) {} // storage dolu olabilir, sessizce geç
}

async function fetchTMDB(film) {
  if (tmdbCache[film.id]) return tmdbCache[film.id];
  try {
    const q = encodeURIComponent(film.title);
    const yr = film.year || '';

    // Arama: ad + yıl
    const res = await fetch(`${TMDB_BASE}/search/movie?api_key=${TMDB_KEY}&query=${q}&year=${yr}&language=tr-TR`);
    const data = await res.json();
    let results = data.results || [];

    // Bulamazsa yılsız
    if (!results.length) {
      const res2 = await fetch(`${TMDB_BASE}/search/movie?api_key=${TMDB_KEY}&query=${q}&language=tr-TR`);
      const data2 = await res2.json();
      results = data2.results || [];
    }

    if (!results.length) return null;

    // İlk 5 sonuç içinde yıla en yakın olanı seç
    const best = results.slice(0, 5).reduce((best, m) => {
      if (!film.year) return best || m;
      const mYear = parseInt((m.release_date || '').slice(0, 4), 10);
      const bestYear = parseInt((best?.release_date || '').slice(0, 4), 10);
      const mDiff = Math.abs(mYear - film.year);
      const bestDiff = Math.abs(bestYear - film.year);
      return mDiff <= bestDiff ? m : best;
    }, null) || results[0];

    // Detay + görseller
    const detRes = await fetch(`${TMDB_BASE}/movie/${best.id}?api_key=${TMDB_KEY}&append_to_response=images&language=tr-TR&include_image_language=tr,en,null`);
    const detail = await detRes.json();

    const backdrops = (detail.images?.backdrops || []).slice(0, 8);
    const result = {
      poster:   best.poster_path   ? TMDB_IMG + best.poster_path : null,
      backdrop: best.backdrop_path ? TMDB_IMG_ORIG + best.backdrop_path : null,
      desc:     detail.overview || best.overview || '',
      stills:   backdrops.map(b => TMDB_IMG + b.file_path),
      tmdbId:   best.id,
    };
    tmdbCache[film.id] = result;
    tmdbCacheSave();
    return result;
  } catch(e) {
    return null;
  }
}

const DESCS = {
  A:"Koyu zemin, altın vurgu, film şeridi detayı — sinema arşivi prestiji.",
  B:"Beyaz zemin, kırmızı-siyah aksan, gazete mantığı — kurumsal ama dinamik.",
  D:"Krem zemin, altın bordür, Osmanlı geometrik desen — İstanbul kimliğine özgün yaklaşım.",
  E:"Saf beyaz, siyah-kırmızı, Teko tipoğrafyası — İsviçre okul minimalizmi.",
};