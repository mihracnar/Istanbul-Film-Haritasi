/**
 * İçerik Paneli — yapılandırma
 * Sütun indeksleri haritanın assets/js/data.js'indeki okuma sırasıyla birebir aynıdır.
 * Buradaki tanımda olmayan sütunlar film/mekan sayfasında "Diğer alanlar" altında gösterilir.
 */
window.PANEL_CONFIG = {
  ADAPTER: 'sheets',
  API_URL: 'https://script.google.com/macros/s/AKfycbzdulhSv1aqxo9hQUDqbcDYj2xH4yKkBUZH482bRcmDA6ykp36lisMONGpixt2T5Vaa/exec',

  BASEMAP_STYLE: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
  MAP_CENTER: [28.975, 41.015],
  MAP_ZOOM: 11,
  // Konum araması (OpenStreetMap Nominatim) — İstanbul kutusuyla sınırlı
  GEOCODER: 'https://nominatim.openstreetmap.org/search',
  ISTANBUL_BBOX: [27.9, 40.75, 29.95, 41.65],

  // --- Filmler (data.js: r[0]…r[8])
  FILM: {
    sheet: 'Filmler',
    id: 0, title: 1, origin: 2, director: 3, genre: 4, year: 5, places: 6, desc: 7, origTitle: 8,
    origins: ['Yerli', 'Yabancı'],
  },

  // --- Mekanlar (data.js: r[0]…r[5]); koordinat tek hücrede "enlem, boylam"
  MEKAN: {
    sheet: 'Mekanlar',
    id: 0, name: 1, category: 2, coord: 3, district: 4, lost: 5,
  },

  // --- Görseller (data.js loadGorseller: r[1] film adı, r[2] mekan, r[3] URL, r[4] durum)
  GORSEL: {
    sheet: 'Görseller',
    film: 1, place: 2, url: 3, status: 4,
  },

  STATUS: [
    { v: '1', label: 'Öncelikli', short: '★' },
    { v: '', label: 'Normal', short: '' },
    { v: 'x', label: 'Gizli', short: 'gizli' },
  ],

  // Çekim yeri listesi: virgülle ayrılır; harita 3 karakterden kısa parçaları yok sayar
  LIST_SEPARATOR: ',',
  LIST_JOINER: ', ',
  PLACE_MIN_LEN: 3,

  // Yüklenen görseller: uzun kenar en fazla bu kadar piksele küçültülür, JPEG kalitesi
  UPLOAD_MAX_PX: 2400,
  UPLOAD_QUALITY: 0.88,
  UPLOAD_MAX_MB: 25,

  ILCELER: ['Adalar', 'Arnavutköy', 'Ataşehir', 'Avcılar', 'Bağcılar', 'Bahçelievler', 'Bakırköy', 'Başakşehir',
    'Bayrampaşa', 'Beşiktaş', 'Beykoz', 'Beylikdüzü', 'Beyoğlu', 'Büyükçekmece', 'Çatalca', 'Çekmeköy',
    'Esenler', 'Esenyurt', 'Eyüpsultan', 'Fatih', 'Gaziosmanpaşa', 'Güngören', 'Kadıköy', 'Kağıthane',
    'Kartal', 'Küçükçekmece', 'Maltepe', 'Pendik', 'Sancaktepe', 'Sarıyer', 'Silivri', 'Sultanbeyli',
    'Sultangazi', 'Şile', 'Şişli', 'Tuzla', 'Ümraniye', 'Üsküdar', 'Zeytinburnu'],

  /** Haritadaki normStr (assets/js/data.js) ile BİREBİR aynı olmalı. */
  normalizeName(s) {
    return (s || '').toLowerCase()
      .replace(/İ/g, 'i').replace(/ı/g, 'i').replace(/Ğ/g, 'g').replace(/ğ/g, 'g')
      .replace(/Ü/g, 'u').replace(/ü/g, 'u').replace(/Ş/g, 's').replace(/ş/g, 's')
      .replace(/Ö/g, 'o').replace(/ö/g, 'o').replace(/Ç/g, 'c').replace(/ç/g, 'c')
      .replace(/â/g, 'a').replace(/î/g, 'i').replace(/û/g, 'u')
      .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  },

  PAGE_SIZE: 120,
};
