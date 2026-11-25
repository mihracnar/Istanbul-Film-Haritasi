# İçerik Paneli — kurulum

Panel: `https://sinemadaistanbul.tr/panel/` ve `https://mihracnar.github.io/Istanbul-Film-Haritasi/panel/`.
Veriyi bu klasördeki `panel-api.gs` üzerinden Google Sheets'e yazar, görselleri Drive'a yükler.

## 1. API'yi dağıt ya da güncelle

1. script.google.com → panel projesi (katkı formundan **ayrı** proje) → `panel-api.gs` içeriğini yapıştır.
2. Proje Ayarları → **Script Properties**:
   - `SPREADSHEET_ID` = `1CxJQRPP88RwhzOJFKR7ylv6wzJz_56p-WeX23TE7jbA`
   - `PANEL_TOKENS` = `{"mihrac":"<anahtar>"}` (aşağıdaki `anahtarEkle` ile doldurulabilir)
   - `GORSEL_KLASOR_ID` (isteğe bağlı): yüklenen görsellerin klasörü.
     Boşsa **Turizm - Dizi:Sinema / Film Görselleri** (`1-GgYq5rmYyzMOcTRRAPdH9g8hY5yRmff`).
3. **Drive yetkisi:** Editörde fonksiyon listesinden `yeniAnahtar`'ı bir kez **Çalıştır**. Google,
   Drive erişimi için izin ister; onayla. (Görsel yükleme bu izin olmadan çalışmaz.)
4. **Dağıt → Dağıtımları yönet → kalem → Sürüm: Yeni sürüm → Dağıt.** Adres değişmez.
   İlk kurulumda: Dağıt → Yeni dağıtım → Web uygulaması → Yürüt: **Ben**, Erişim: **Herkes**,
   çıkan `/exec` adresini `panel/config.js` → `API_URL` alanına yaz.

Projeyi çalıştıran hesabın tabloda düzenleme, görsel klasörüne ekleme yetkisi olmalı.

### Kişi ekleme / çıkarma

`anahtarEkle` fonksiyonunda `AD`'ı kişinin adıyla değiştir → **Çalıştır** → anahtar Yürütme günlüğünde.
Anahtarı kişiye ilet. Ad `_Panel_Log`'da "Düzenleyen" olarak görünür. Çıkarmak için `anahtarSil`.

Sunucusuz deneme: `/panel/?demo` (sahte veri, hiçbir şey yazılmaz).

## Panelde neler var

- **Özet:** Haritada görünen/görünmeyen film ve mekan sayıları, yapılacaklar
  (türü ya da çekim yeri eksik filmler, konumsuz mekanlar, görselsiz filmler, filmi bulunamayan görseller)
  ve **Mekanlar'da karşılığı olmayan çekim yerleri** — tek tıkla mekan olarak eklenir.
- **Film sayfası:** Künye (ad, yapım, yıl, orijinal ad, yönetmen ve tür etiketleri; ilk tür haritadaki ana tür),
  açıklama, çekim yerleri (Mekanlar'la eşleşme durumu + küçük harita), görseller.
- **Görseller:** Film sayfasından sürükle-bırak / dosya seç / bağlantı ile eklenir. Yüklenen dosya küçültülüp
  (uzun kenar 2400 px, JPEG) Drive klasörüne kaydedilir, "bağlantıya sahip herkes görüntüleyebilir" yapılır
  ve Görseller'e satır eklenir. Durum (★ öncelikli / normal / gizli) ve mekan karttan değiştirilir.
  Silerken, panelden yüklenmiş dosya isteğe bağlı olarak Drive'da çöpe atılır (başka klasördekilere dokunulmaz).
- **Mekan sayfası:** Ad, kategori, ilçe, kayıp eser; konum (adres arama, haritaya tıklama, koordinat yapıştırma);
  o mekanda çekilen filmler ve görseller.
- **Ad değişikliği:** Film adı değişince görsellerdeki film adı; mekan adı değişince filmlerin çekim yeri
  listeleri ve görsellerin mekanı **tek işlemde** güncellenir (biri bu arada değiştiyse hiçbiri yazılmaz).

## Teknik notlar

- Sütun indeksleri `assets/js/data.js` ile aynıdır (`panel/config.js` → `FILM`, `MEKAN`, `GORSEL`).
  Tabloda tanımsız sütunlar film/mekan sayfasında "Diğer alanlar" altında gösterilir.
- Eşleşme haritayla aynıdır: çekim yeri ↔ mekan `normStr` eşitliği (`config.js` → `normalizeName`),
  görsel ↔ film birebir ad (boşluk sadeleştirilmiş). Biri değişirse diğeri de değişmeli.
- Yazmalar sütun indeksiyle, yalnız değişen hücrelere yapılır; formüllü sütunlar salt okunur.
  Filmler/Mekanlar A sütunundaki kimlikle, Görseller satır numarası + tüm satır karşılaştırmasıyla bulunur.
- Her yazma `_Panel_Log` sayfasına önce/sonra hâliyle kaydedilir.
- Harita yayımlanmış CSV'yi okuduğundan değişiklikler haritaya birkaç dakika gecikmeyle yansır.

## Veritabanına geçiş

`panel/adapters.js` içine aynı metotları (`login, load, update, create, remove, batch, upload`) uygulayan bir
`RestAdapter` yazılır, `config.js` → `ADAPTER: 'rest'` yapılır. Panelin geri kalanı değişmez.
