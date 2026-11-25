/**
 * Veri Paneli — yapılandırma
 * Şema sunucudan okunur; sütun anlamları haritanın data.js'indeki indekslerle aynıdır.
 */
window.PANEL_CONFIG = {
  // Veri katmanı: 'sheets' (Apps Script) | ileride 'rest' (PostGIS API)
  ADAPTER: 'sheets',

  // panel-api.gs dağıtımının /exec adresi (apps-script/panel-api.gs → Dağıt → Web uygulaması)
  API_URL: 'https://script.google.com/macros/s/BURAYA_DAGITIM_KIMLIGI/exec',

  BASEMAP_STYLE: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
  MAP_CENTER: [28.975, 41.015],
  MAP_ZOOM: 11,

  /**
   * Sütun tipleri — data.js ile aynı indeksler. Burada olmayan sütunlar otomatik tanınır.
   * Tipler: id, text, longtext, enum, year, coord ("enlem, boylam"), lat, lon,
   *         image, status (1 / boş / x), flag (1 / boş), places, link:<Sayfa>, readonly
   */
  FIELD_OVERRIDES: {
    Filmler: {
      0: 'id', 1: 'text', 2: 'enum', 3: 'text', 4: 'text',
      5: 'year', 6: 'places', 7: 'longtext', 8: 'text',
    },
    Mekanlar: {
      0: 'id', 1: 'text', 2: 'enum', 3: 'coord', 4: 'enum', 5: 'flag',
    },
    Görseller: {
      1: 'link:Filmler', 2: 'link:Mekanlar', 3: 'image', 4: 'status',
    },
  },

  /**
   * Boşsa harita kaydı eler (data.js): film → Türü boş ya da hiç yer eşleşmiyor;
   * mekan → kategori boş ya da koordinat yok. Panel bunları "sorunlu" işaretler.
   */
  REQUIRED: { Filmler: [1, 4, 6], Mekanlar: [1, 2, 3], Görseller: [1, 3] },

  // Her sayfanın "ad" sütunu (liste başlığı, bağlantı hedefi)
  LABEL_COL: { Filmler: 1, Mekanlar: 1, Görseller: 1 },

  /**
   * Filmler.Çekildiği Yer (r[6]) ↔ Mekanlar adı (r[1]) — virgülle ayrılmış liste.
   * Harita: matchLocs() → normStr eşitliği, 3 karakterden kısa parçalar yok sayılır.
   */
  PLACES: {
    sheet: 'Filmler',
    target: 'Mekanlar',
    targetCol: 1,
    separator: ',',
    joiner: ', ',
    minLen: 3,
  },

  /**
   * Ad üzerinden bağlar (link:<Sayfa>) nasıl eşleşir:
   *  exact → boşluklar sadeleştirilmiş birebir eşitlik (harita: gorselMap[film adı])
   *  norm  → normalizeName eşitliği
   */
  LINK_MATCH: {
    'Görseller:1': 'exact',
    'Görseller:2': 'norm',
  },

  /** Haritadaki normStr (assets/js/data.js) ile BİREBİR aynı olmalı. */
  normalizeName(s) {
    return (s || '').toLowerCase()
      .replace(/İ/g, 'i').replace(/ı/g, 'i').replace(/Ğ/g, 'g').replace(/ğ/g, 'g')
      .replace(/Ü/g, 'u').replace(/ü/g, 'u').replace(/Ş/g, 's').replace(/ş/g, 's')
      .replace(/Ö/g, 'o').replace(/ö/g, 'o').replace(/Ç/g, 'c').replace(/ç/g, 'c')
      .replace(/â/g, 'a').replace(/î/g, 'i').replace(/û/g, 'u')
      .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  },

  // Yalnızca override'ı olmayan sütunlar için başlık ipuçları
  HINTS: [
    { re: /^(enlem|lat|latitude)$/i, type: 'lat' },
    { re: /^(boylam|lon|lng|longitude)$/i, type: 'lon' },
    { re: /koordinat|konum/i, type: 'coord' },
    { re: /(url|link|bağlantı|baglanti|drive)/i, type: 'image' },
    { re: /(açıklama|aciklama|özet|ozet|not(lar)?$)/i, type: 'longtext' },
    { re: /(yıl|yil)/i, type: 'year' },
  ],

  STATUS_VALUES: [
    { v: '1', label: 'Öncelikli' },
    { v: '', label: 'Normal' },
    { v: 'x', label: 'Hariç' },
  ],

  LIST_PAGE: 200,
};
