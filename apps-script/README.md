# Veri Paneli — kurulum

Panel: `https://sinemadaistanbul.tr/panel/` (`panel/` klasörü, deploy dalıyla yayına çıkar).
Veriyi bu klasördeki `panel-api.gs` üzerinden Google Sheets'e yazar.

## 1. API'yi dağıt (bir kez)

1. script.google.com → **Yeni proje** → `panel-api.gs` içeriğini yapıştır.
   Katkı formu projesinden **ayrı** bir proje olmalı (ikisinin de `doPost`'u var).
2. Proje Ayarları → **Script Properties**:
   - `SPREADSHEET_ID` = `1CxJQRPP88RwhzOJFKR7ylv6wzJz_56p-WeX23TE7jbA`
   - `PANEL_TOKENS` = `{"mihrac":"<anahtar>","selda":"<anahtar>"}`
     Anahtar üretmek için editörde `yeniAnahtar` fonksiyonunu çalıştır, Günlük'ten kopyala.
     Adlar `_Panel_Log` sayfasında "Düzenleyen" olarak görünür.
3. **Dağıt → Yeni dağıtım → Web uygulaması** → Yürüt: **Ben**, Erişim: **Herkes**.
   Projeyi çalıştıran hesabın tabloda düzenleme yetkisi olmalı.
4. Çıkan `/exec` adresini `panel/config.js` → `API_URL` alanına yaz, main'e gönder.

Kod güncellenince: Dağıt → Dağıtımları yönet → mevcut dağıtımı düzenle → **Yeni sürüm**
(adres değişmez). Bir kişinin erişimini kesmek için `PANEL_TOKENS`'tan anahtarını sil.

Sunucusuz deneme: `https://sinemadaistanbul.tr/panel/?demo` (sahte veri, hiçbir şey yazılmaz).

## Nasıl çalışır

- **Sütunlar `data.js` ile aynı indekslerdedir** (`panel/config.js` → `FIELD_OVERRIDES`).
  Filmler: 0 no, 1 ad, 2 yerli/yabancı, 3 yönetmen, 4 tür, 5 yıl, 6 çekildiği yer, 7 açıklama, 8 orijinal isim.
  Mekanlar: 0 no, 1 ad, 2 kategori, 3 koordinat ("enlem, boylam"), 4 ilçe, 5 kayıp eser (1).
  Görseller: 1 film adı, 2 mekan, 3 görsel URL, 4 durum (1 / boş / x).
  Tabloya sütun eklenirse panel onu da gösterir; tipini başlıktan tahmin eder.
- **Yazma sütun indeksiyle**, yalnız değişen hücrelere yapılır. Formüllü sütunlar salt okunur;
  yeni satırda formül üst satırdan kopyalanır. `=` ile başlayan metin formül olarak çalışmaz.
- **Kimlik:** Filmler/Mekanlar A sütunundaki F…/M… ile bulunur; yeni kayda sıradaki numara verilir.
  A sütununda benzersiz kimlik olmayan sayfalar (Görseller) **satır numarasıyla** adreslenir;
  sunucu yazmadan önce satırın tamamını karşılaştırır, satırlar kaymışsa yazmaz.
- **Eşleşme haritayla aynı:** Çekildiği Yer ↔ Mekanlar adı `normStr` eşitliğiyle
  (`config.js` → `normalizeName`, `data.js`'teki `normStr`'ın kopyası; biri değişirse diğeri de).
  Görseller film adına birebir (boşluk sadeleştirilmiş) bağlanır, `gorselMap` gibi.
- **Çakışma:** İki kişi aynı alanı aynı anda değiştirirse ikinci kayıt reddedilir ve fark gösterilir;
  farklı alanlardaki değişiklikler birleşir.
- **Kayıt defteri:** Her ekleme/değişiklik/silme `_Panel_Log` sayfasına önce/sonra hâliyle yazılır.
- **Sorunlu kayıtlar:** Haritanın eleyeceği kayıtlar (tür boş, hiçbir yeri eşleşmeyen film,
  kategorisi/koordinatı olmayan mekan), eşleşmeyen yer ve görsel bağları listede işaretlenir.
- **Ad değişikliği:** Film ya da mekan adı değişirken, o ada bağlı film/görsel varsa uyarır
  (bağlar ad üzerinden olduğu için kopar).

Harita yayımlanmış CSV'yi okuduğundan değişiklikler haritaya birkaç dakikalık gecikmeyle yansır.

## Veritabanına geçiş

`panel/adapters.js` içine aynı beş metodu (`login, load, update, create, remove`) uygulayan bir
`RestAdapter` yazılır ve `config.js` → `ADAPTER: 'rest'` yapılır. REST API aynı biçimi döndürdüğü
sürece (`tables[].headers / rows / rowNums / formulaCols`, çakışmada `current`) panelin geri kalanı değişmez.
