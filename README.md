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
| `map.js` | MapLibre harita, GeoJSON kaynak/layer yönetimi, bağlantı çizgileri, pin highlight sistemi, media panel, galeri, lightbox, mobil tab sistemi, filtre state |
| `ui.js` | Mekan listesi render, film accordion render, filtre uygulama, `eSelectLoc()` |
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
- `eFilterMapMarkers()` → haritadaki layer filter'ını günceller, desktop'ta filtrelenmiş alana fly eder; sonunda `_syncSelSource()` çağırarak seçili pin durumunu korur

### Filtre Bileşenleri

**Sol panel (Mekanlar)**
- Mekan kategorisi chip'leri: Plato, Stüdyo, Sokak, Simge Yapı, Otel, Okul, Diğer + TÜMÜ
- Datadan dinamik üretilir; o kategoride hiç mekan yoksa `empty` class'ı alır

**Sağ panel (Filmler)**
- Film türü chip'leri: datadan dinamik üretilir
- Decade segmentleri: datadan dinamik üretilir, accordion listesinin hemen üstünde

**Arama (Search)**
- Film adı, mekan adı ve yönetmen adında aynı anda arama
- Sonuçlar 3 grup halinde (FİLM / MEKAN / YÖNETMEN)
- Yönetmen seçilince ilgili filmlerin bulunduğu decade accordion'ları açılır ve filmler flash animasyonu ile vurgulanır

---

## Harita Motoru

**MapLibre GL JS 4.7.1** kullanılır. Tile kaynağı: CARTO Positron GL Style (`basemaps.cartocdn.com`).

### Harita Hazırlık Kontrolü

`_isMapReady(m)` fonksiyonu ile haritanın kullanıma hazır olup olmadığı kontrol edilir:

```js
function _isMapReady(m){ return m && inited.E && !!m.getSource('locs'); }
```

`m.loaded()` **kullanılmaz** — MapLibre tile yüklenirken bu metod `false` döndürdüğünden `flyTo` animasyonu sırasında tüm pin/label işlemleri bloke olur. Bunun yerine `m.on('load')` callback'inde `inited.E = true` yapılır ve bu flag kalıcı olarak `true` kalır.

---

## Pin ve Label Sistemi

Pinler ve label'lar Leaflet HTML marker yerine **MapLibre GL JS symbol layer'ları** kullanır. Collision detection native MapLibre tarafından yönetilir.

### Layer Yapısı (oluşturma sırası)

| Layer ID | Tür | Kaynak | Açıklama |
|---|---|---|---|
| `conn-lines-layer` | `line` | `conn-lines` | Bağlantı çizgileri (kırmızı, kesikli) |
| `conn-dots-layer` | `circle` | `conn-dots` | Bağlantı bitiş noktaları (kırmızı) |
| `locs-dots` | `circle` | `locs` | Pin noktaları — her zaman siyah |
| `locs-labels` | `symbol` | `locs` | Siyah label box — seçili pinler gizlenir |
| `locs-labels-sel` | `symbol` | `locs-sel` | Kırmızı label box — yalnızca seçili pinler |

### Label İçeriği (`text-field` format)

```
• (kırmızı)  MekanAdı (beyaz)  ×FilmSayısı (yarı saydam)
```

`•` karakteri format expression içinde `text-color: '#f03010'` ile ayrı renklendirme alır.

### Seçili Pin Mekanizması

Seçim durumu `_selPinIds` (Set) ile takip edilir. `_syncSelSource()` her değişimde:

1. `_selPinIds`'deki mekanları `locs-sel` GeoJSON source'a yazar
2. `locs-labels` layer'ına `!match` filter uygular (seçili ID'leri gizler)
3. `locs-labels-sel` layer'ı bu ID'leri kırmızı background ile gösterir
4. `feature-state.selected` ile `locs-dots` renk durumunu günceller

`ePinHighlight(locId, on)` → `_selPinIds`'e ekler/çıkarır → `_syncSelSource()` çağırır.
`ePinsResetAll()` → seti temizler → `_syncSelSource()` çağırır.

**Film seçilince** `highlightFilmOnMap()` tüm mekan pinlerini vurgular ve haritayı o filmin mekanlarının sınırlarına `fitBounds` ile oturtur (`maxZoom: 13`, mekan sayısına göre dinamik `padding`).

---

## Bağlantı Çizgileri (Connection Lines)

Mekan seçilince harita canvas'ı üzerinde GeoJSON LineLayer kullanılarak eğrisel kesikli çizgiler çizilir.

- Kaynak: mekan pin'inin harita üzerindeki ekran koordinatı (`m.project([lng, lat])`)
- Hedef: film listesi satırlarının ekran koordinatı (`getBoundingClientRect()`)
- Koordinatlar `m.unproject()` ile geo'ya dönüştürülür, harita hareket ettikçe `liveUpdateConn()` ile yenilenir
- Bezier eğrisi cubic control point'lerle hesaplanır; yüksek dikey sapma (`0.35`) belirgin yay oluşturur
- `conn-lines-layer`: `line-color: '#f03010'`, `line-dasharray: [5,4]`
- RAF guard (`_connRaf`) aynı frame'de birden fazla çizim engelini sağlar

### Timer Yönetimi

`eSelectLoc()` iki aşamalı çizim başlatır:

1. **300ms sonra** (accordion animasyonu ~250ms biter): `buildConnLine()` ilk çizim
2. **moveend + 80ms**: flyTo bitince pin konumu yeniden hesaplanır

`closeMedia()` ve `openMedia()`, `_connTimer` ve `_connMoveEnd` handler'larını iptal ederek stale çizim oluşmasını engeller.

---

## Media Panel

Film seçilince sağdan kayan panel:

1. Başlık, meta bilgi
2. Hero görsel (TMDB backdrop → poster → placeholder)
3. Thumbnail strip (TMDB stills)
4. Açıklama
5. Çekim Mekanları chip'leri (`mp-loc-chip`)

Media panel açılınca sağ film panel `visibility:hidden` yapılır. Kapanınca restore edilir ve tüm highlight/conn state temizlenir.

---

## Galeri Bar

Mekan seçilince haritanın altından çıkan görsel şerit:

- `buildLocGallerySkeleton()` → anında shimmer placeholder gösterir
- `fillLocGallery()` → async TMDB verisi gelince gerçek görsellerle doldurur
- Görsele tıklanınca lightbox açılır

---

## Tema Sistemi

İki tema: **Sade** (light) ve **Renkli** (dark).

- Toggle: `eSetTheme('sade' | 'renkli')`
- `#cE.renkli` class'ı CSS cascade üzerinden tüm renkleri değiştirir
- Logo: `logo.png` (sade) ↔ `logo_dark.png` (renkli)
- Media panel: `#mp.renkli` class'ı ayrıca eklenir

Sade modda harita canvas'ına `filter:grayscale` **uygulanmaz**; interaktif kırmızı elementler (pin label box, bağlantı çizgileri, nokta) her iki temada da renkli görünür. Harita görsel dili zaten düşük doygunluklu CARTO Positron tile'ına dayanır.

---

## Performans Optimizasyonları

| Optimizasyon | Etki |
|---|---|
| `FILM_MAP` / `LOC_MAP` (O(1) lookup) | Dizilerde tekrarlı `find()` çağrısı kaldırıldı |
| `inited.E` flag | `m.loaded()` tile-yükleme false pozitiflerini engeller |
| RAF guard — `liveUpdateConn` | Aynı frame'de birden fazla GeoJSON güncelleme engellendi |
| MapLibre native collision | JS label collision detection kaldırıldı |
| `buildLocGallerySkeleton` | Mekan galerisinin anında açılması |
| GeoJSON source separation | `locs-sel` ayrı source — seçili pin render'ı normal flow'u bozmaz |

---

## Zoom Davranışı

```js
new maplibregl.Map({
  center: [28.9784, 41.0082],  // İstanbul
  zoom:   12,
  minZoom: 10,
  maxZoom: 19,
})
```

**Film seçimi zoom:**
- Tek mekan → `flyTo({ zoom: 14 })`
- Çoklu mekan → `fitBounds(bounds, { maxZoom: 13, padding: dinamik })`
  - ≤3 mekan: `padding: 120`
  - ≤8 mekan: `padding: 100`
  - >8 mekan: `padding: 80`

**Mekan seçimi zoom:** `flyTo({ zoom: 15, duration: 500 })`

---

## Chip Tasarım Sistemi

**Mekan kategorisi + Film türü chip'leri:**
```css
border: 1px solid #ddd;
padding: 4px 9px;
font-size: 9px;
/* active: */ background:#000; color:#fff;
```

**Decade segmentleri:** tab/underline dili
```css
border: none;
border-bottom: 2px solid transparent;
/* active: */ background:#efefef; font-weight:700;
```

Sol panel chip yüksekliği, sağ panel genre chip yüksekliğiyle `eSyncFilterHeights()` ile hizalanır (`min-height` kullanılır, wrap'e izin vermek için).

---

## Mobil Düzen (≤ 640px)

### Layout
- Harita tam ekran (top bar + bottom nav yüksekliği çıkarılarak)
- Sol ve sağ paneller haritanın üzerine **bottom sheet** olarak açılır

### Bottom Navigation
```
[ ⊞ Harita ]  [ ◎ Mekanlar ]  [ ▶ Filmler ]
```

### Navigasyon Sürekliliği
- Film detayı açılmadan önce hangi sheet'in açık olduğu `_mPrevSheet` ile kaydedilir
- Seçili mekan `_mPrevLoc` ile kaydedilir
- Film detayı kapatılınca her ikisi restore edilir

### Devre Dışı Bırakılan Özellikler (Mobil)
- Bağlantı çizgileri (mobilde `liveUpdateConn` çağrılmaz)
- `eFilterMapMarkers` flyTo
- `highlightFilmOnMap` flyTo
- `eSyncFilterHeights` JS sync

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
| MapLibre GL JS | 4.7.1 | Harita motoru, tile render, symbol layer |
| CARTO Positron GL | — | Tile layer (light, düşük doygunluk) |
| TMDB API | v3 | Film görselleri ve açıklamaları |
| Google Fonts | — | Cormorant Garamond, DM Mono, Teko, EB Garamond, Libre Baskerville |

---

## Geliştirme Notları

- Tüm JS ES6+, modül sistemi yok. Script tag sırası kritik: `config → data → tmdb → map → ui → app → init`
- Koordinatlar veri yapısında `{lat, lng}` olarak saklanır; MapLibre'ye her yerde `[lng, lat]` sırasıyla geçilir
- `eSelectLoc()` sync fonksiyon — galeri skeleton pattern ile async bekleme kaldırıldı
- `locs-labels-sel` click event'i `_setupEMapEvents()` içinde diğer layer'larla birlikte dinlenir
- Google Sheets CSV'den gelen Türkçe karakterler `normStr()` ile normalize edilerek mekan eşleştirmesi yapılır
- TMDB cache iki katmanlı: `data/tmdb-cache.json` (prebuilt, sayfa yükünde) + `sessionStorage` (runtime)