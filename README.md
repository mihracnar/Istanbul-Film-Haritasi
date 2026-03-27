# İstanbul Film Mekanları Haritası

## Proje Yapısı

```
├── index.html              # Ana HTML
├── assets/
│   ├── css/
│   │   └── style.css       # Tüm stiller (light/dark tema dahil)
│   ├── js/
│   │   ├── config.js       # API URL'leri ve sabitler
│   │   ├── data.js         # Google Sheets CSV parser & loader
│   │   ├── tmdb.js         # TMDB API entegrasyonu
│   │   ├── map.js          # Leaflet harita, pin'ler, bağlantı çizgileri
│   │   ├── ui.js           # Filtreler, arama, sidebar render
│   │   ├── app.js          # Ana uygulama mantığı (E konsept)
│   │   └── init.js         # Uygulama başlatma
│   └── images/             # Statik görseller (logo vb.)
└── data/                   # Yedek/statik JSON verisi (opsiyonel)
```

## Veri Kaynakları

- **Mekanlar & Filmler:** Google Sheets CSV (config.js'de URL)
- **Film görselleri & açıklamalar:** TMDB API (config.js'de key)

## Geliştirme Notları

- Leaflet 1.9.4
- Google Fonts: DM Mono, Teko
- Tema: LIGHT / DARK toggle (☀ / ☾)