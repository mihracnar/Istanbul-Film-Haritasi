# İstanbul Film Mekanları Haritası

İBB Sinema Ofisi için geliştirilmiş interaktif bir web haritası. İstanbul'da çekilen filmlerin mekanlarını, dönemlerini ve türlerini keşfetmeyi sağlar.

---

## Proje Yapısı

```
├── index.html
├── assets/
│   ├── css/
│   │   └── style.css
│   └── js/
│       ├── config.js
│       ├── data.js
│       ├── tmdb.js
│       ├── map.js
│       ├── ui.js
│       ├── app.js
│       └── init.js
└── data/
    └── tmdb-cache.json
```

---

## Dosya Sorumlulukları

| Dosya | Sorumluluk |
|---|---|
| `config.js` | Google Sheets URL'leri, GID sabitleri, `FILMS`/`LOCS` dizileri, `FILM_MAP`/`LOC_MAP` lookup dictionary'leri, `buildLookupMaps()` |
| `data.js` | Google Sheets CSV parser, `loadSheetsData()`, mekan-film eşleştirme (`matchLocs`), Türkçe karakter normalizasyonu |
| `tmdb.js` | TMDB API entegrasyonu, `fetchTMDB()`, prebuilt cache yükleme (`tmdb-cache.json`), sessionStorage cache |
| `map.js` | Leaflet harita, pin HTML üretimi, bağlantı çizgileri, media panel, galeri, lightbox, zoom/wheel yönetimi, mobil tab sistemi |
| `ui.js` | Mekan listesi render, film accordion render, filtre uygulama, pin highlight/reset, `eSelectLoc()` |
| `app.js` | Chip üretimi (mekan kategorisi, decade, tür), filtre setter fonksiyonları, arama (search) mantığı, tema toggle |
| `init.js` | `initApp()`, `attachMapRedraw()`, scroll event listener'ları |

---

## Veri Akışı

```
Google Sheets CSV
    └── loadSheetsData()         ← data.js
        ├── LOCS[]               ← koordinat, kategori, ilçe
        ├── FILMS[]              ← yıl, tür, yönetmen, mekan ID'leri
        └── buildLookupMaps()    ← FILM_MAP{}, LOC_MAP{}  (O(1) erişim)

TMDB API
    └── fetchTMDB(film)          ← poster, backdrop, stills, açıklama
        └── tmdb-cache.json      ← prebuilt cache (sayfa yükünde yüklenir)
```

---

## Filtre Sistemi

Tüm filtreler global state değişkenleriyle yönetilir (`map.js`):

```js
let eActiveGenre  = '';   // film türü
let eActiveDir    = '';   // yönetmen
let eActiveLocCat = '';   // mekan kategorisi
let eActiveDecade = 0;    // dönem (0 = tümü)
```

Her filtre değişikliğinde iki fonksiyon çağrılır:
- `eApplyFilters()` → film listesini ve mekan sidebar opacity'sini günceller
- `eFilterMapMarkers()` → haritadaki pin görünürlüğünü günceller, desktop'ta filtrelenmiş alana fly eder

### Filtre Bileşenleri

**Sol panel (Mekanlar)**
- Mekan kategorisi chip'leri: Plato, Stüdyo, Sokak, Simge Yapı, Otel, Okul, Diğer + TÜMÜ
- Datadan dinamik üretilir; o kategoride hiç mekan yoksa `empty` class'ı alır

**Sağ panel (Filmler)**
- Film türü chip'leri: datadan dinamik üretilir
- Decade segmentleri: datadan dinamik üretilir, accordion listesinin hemen üstünde, tab/underline görsel dil

**Arama (Search)**
- Film adı, mekan adı ve yönetmen adında aynı anda arama
- Sonuçlar 3 grup halinde (FİLM / MEKAN / YÖNETMEN)
- Yönetmen seçilince ilgili filmlerin bulunduğu decade accordion'ları açılır ve filmler flash animasyonu ile vurgulanır

---

## Pin Sistemi

Her mekan için `pinHTML_E()` fonksiyonu inline HTML pin üretir. Pin yapısı:

```
div#pin-E-{id}
  ├── div.pin-label   ← mekan adı + film sayısı, max-width:90px, 2 satır wrap
  └── div.pin-stem    ← dikey ince çizgi
```

**Pin renk durumları:**
- Normal: `rgba(0,0,0,0.85)` — siyah
- Seçili / vurgulanmış: `rgba(240,48,16,0.85)` — kırmızı
- Çakışma sonucu gizli: `opacity:0` (label), stem küçük noktaya dönüşür

**Label collision detection** (`eUpdateLabelVisibility`):
- Zoom bitiminde (zoomend + 80ms) çalışır, pan sırasında çalışmaz
- Film sayısına göre öncelik: fazla film → her zaman görünür
- Seçili pin her zaman görünür
- Çakışan label `opacity:0` ile fade-out yapılır (anlık `display:none` değil)

**Drag guard:** Pin tıklamaları, harita sürükleme sırasında iptal edilir. `mousedown` → `mousemove` > 6px olursa `_dragGuard.dragging = true`, `onclick` bunu kontrol eder.

---

## Bağlantı Çizgileri (Connection Lines)

Mekan veya film seçilince SVG layer üzerinde eğrisel bağlantı çizgileri çizilir.

- Mekan seçimi → mekan pin'i kaynak, film listesi satırları hedef
- Film seçimi → film satırı kaynak, haritadaki mekan pin'leri hedef
- `liveUpdateConn()` scroll/pan sırasında çizgileri canlı yeniden konumlandırır (RAF korumalı)
- Mobilde tamamen devre dışı (`#conn-svg { display:none }`)

---

## Media Panel

Film seçilince sağdan kayan panel:

1. Başlık, meta bilgi
2. Hero görsel (TMDB backdrop → poster → placeholder)
3. Thumbnail strip (TMDB stills)
4. Açıklama
5. Çekim Mekanları chip'leri (`mp-loc-chip`)

**Mobilde:** tam genişlik, alttan yukarı slide, z-index backdrop'un üstünde (1250).

---

## Galeri Bar

Mekan seçilince haritanın altından çıkan görsel şerit:

- `buildLocGallerySkeleton()` → anında shimmer placeholder gösterir
- `fillLocGallery()` → async TMDB verisi gelince gerçek görsellerle doldurur
- Görsele tıklanınca lightbox açılır

---

## Performans Optimizasyonları

| Optimizasyon | Etki |
|---|---|
| `FILM_MAP` / `LOC_MAP` (O(1) lookup) | 14 adet `Array.find()` yerini aldı |
| RAF guard — `liveUpdateConn` | Aynı frame'de birden fazla çağrı engellendi |
| RAF guard — `eUpdateLabelVisibility` | Her frame'de collision detection önlendi |
| `buildLocGallerySkeleton` | Mekan galerisinin anında açılması |
| `updateWhenZooming: false` | Zoom sırasında yeni tile isteği atılmıyor |
| `keepBuffer: 4` | Pan sırasında beyaz boşluk önlendi |
| `will-change: transform` + `translateZ(0)` | Tile pane ve zoom katmanları GPU'ya alındı |

---

## Zoom Davranışı

```js
L.map(id, {
  zoomSnap:   0,    // snap yok, scroll ile 1:1
  zoomDelta:  1,
  wheelPxPerZoomLevel: 40,
  minZoom:    10,
})
```

Leaflet'in zoom animasyonu CSS override ile 0.1s'ye kısaltılmıştır:
```css
.leaflet-zoom-anim .leaflet-zoom-animated {
  transition: transform 0.1s cubic-bezier(0,0,0.25,1) !important;
}
```

---

## Tema Sistemi

İki tema: **Sade** (light) ve **Renkli** (dark).

- Toggle: `eSetTheme('sade' | 'renkli')`
- `#cE.renkli` class'ı CSS cascade üzerinden tüm renkleri değiştirir
- Logo: `logo.png` (sade) ↔ `logo-dark.png` (renkli)
- Media panel: `#mp.renkli` class'ı ayrıca eklenir

---

## Chip Tasarım Sistemi

3 filtre bileşeni için birleşik CSS token:

**Mekan kategorisi + Film türü chip'leri:** aynı görsel dil
```css
border: 1px solid #ddd;
padding: 4px 9px;
font-size: 9px;
/* active: */ background:#000; color:#fff;
```

**Decade segmentleri:** farklı dil — tab/underline
```css
border: none;
border-bottom: 2px solid transparent;
/* active: */ background:#efefef; font-weight:700;
```

Sol panel chip yüksekliği, sağ panel genre chip yüksekliğiyle `eSyncFilterHeights()` ile hizalanır (`min-height` kullanılır, `height` değil — wrap'e izin vermek için).

---

## Mobil Düzen (≤ 640px)

### Layout
- Harita tam ekran (top bar + bottom nav yüksekliği çıkarılarak)
- Sol ve sağ paneller haritanın üzerine **bottom sheet** olarak açılır
- `transform: translateY(100%)` → `translateY(0)` animasyonu

### Bottom Navigation
```
[ ⊞ Harita ]  [ ◎ Mekanlar ]  [ ▶ Filmler ]
```

### Navigasyon Sürekliliği
- Film detayı açılmadan önce hangi sheet'in açık olduğu `_mPrevSheet` ile kaydedilir
- Seçili mekan `_mPrevLoc` ile kaydedilir (`clearHighlights()` bunu sildiği için)
- Film detayı kapatılınca `_mPrevSheet` ve `_mPrevLoc` restore edilir
- `mp-loc-chip`'e tıklanınca o mekan seçilir ve harita tab'ına geçilir
- Filtre değiştiğinde ve film seçildiğinde harita fly/zoom yapmaz

### Devre Dışı Bırakılan Özellikler (Mobil)
- Bağlantı çizgileri (`#conn-svg`)
- `eFilterMapMarkers` flyTo
- `highlightFilmOnMap` flyTo
- `eSyncFilterHeights` JS sync
- infobar

---

## Klavye Kısayolları

| Kısayol | Eylem |
|---|---|
| `Escape` | Media panel / lightbox kapat |
| `←` `→` | Lightbox'ta görsel gezinme |

---

## Bağımlılıklar

| Kütüphane | Versiyon | Kullanım |
|---|---|---|
| Leaflet | 1.9.4 | Harita |
| CARTO | — | Tile layer (light) |
| TMDB API | v3 | Film görselleri ve açıklamaları |
| Google Fonts | — | DM Mono, Teko |

---

## Geliştirme Notları

- Tüm JS ES6+, modül sistemi yok, script tag sırası önemli: `config → data → tmdb → map → ui → app → init`
- `eSelectLoc()` sync fonksiyon — galeri skeleton pattern ile async bekleme kaldırıldı
- Pin onclick'leri Leaflet marker üzerinde değil, inline HTML string içinde tanımlı (Leaflet `iconSize:[1,1]` nedeniyle)
- Google Sheets CSV'den gelen Türkçe karakterler `normStr()` ile normalize edilerek mekan eşleştirmesi yapılır
- TMDB cache iki katmanlı: `data/tmdb-cache.json` (prebuilt, sayfa yükünde) + `sessionStorage` (runtime)