// ============================================================
// katki-modal.js  v3
// İstanbul Film Mekanları Haritası — Katkı Formu
// 3 adım: Tür → Form → İletişim
// config.js: SHEETS_BASE, GID_FILMLER/MEKANLAR/GORSELLER, KATKI_API_URL
// ============================================================

const KatkiModal = (() => {

  // ── Sabitler ──────────────────────────────────────────────
  const TUR_TANIMI = [
    { id: 'gorsel', baslik: 'Görsel Önerisi',  aciklama: 'Film çekimleriyle ilgili fotoğraf öner',      labelGonder: 'Görsel Gönder' },
    { id: 'mekan',  baslik: 'Mekan Önerisi',   aciklama: 'Haritada eksik bir çekim mekanı ekle',         labelGonder: 'Mekan Gönder'  },
    { id: 'film',   baslik: 'Film Önerisi',    aciklama: 'Haritada yer almayan bir film veya dizi öner', labelGonder: 'Film Gönder'   },
    { id: 'hata',   baslik: 'Hata Bildirimi',  aciklama: 'Yanlış bilgi veya bozuk içerik bildir',        labelGonder: 'Hata Bildir'   },
    { id: 'genel',  baslik: 'Genel Öneri',     aciklama: 'Harita veya proje hakkında öneri/yorum',       labelGonder: 'Öneri Gönder'  },
  ];

  const FILM_TURLERI = [
    'Dram','Komedi','Gerilim','Aksiyon','Belgesel',
    'Animasyon','Korku','Romantik','Tarihi','Suç',
    'Bilim Kurgu','Fantastik','Biyografi','Müzikal','Diğer',
  ];

  const MEKAN_KATEGORILERI = [
    'Simge Yapı','Sokak','Semt','Plato','Okul',
    'Köprü','Boğaz','Park','Sahil','Konut','Diğer',
  ];

  // ── Durum ─────────────────────────────────────────────────
  let state = {
    adim: 1,
    seciliTur: null,
    filmler:   [],
    mekanlar:  [],
    gorseller: [],
    form2Veri: null,       // adım 2 verisi adım 3'e geçmeden önce saklanır
    miniMap: null,
    secilenKoord: null,
    secilenGorselUrl: null,
  };

  // ── CSV parse ─────────────────────────────────────────────
  function parseCSV(metin) {
    const satirlar = metin.trim().split('\n');
    if (satirlar.length < 2) return [];
    const basliklar = satirlar[0].split(',').map(s => s.trim().replace(/^"|"$/g, ''));
    return satirlar.slice(1).map(satir => {
      const alanlar = []; let alan = '', ic = false;
      for (const k of satir) {
        if (k === '"') { ic = !ic; }
        else if (k === ',' && !ic) { alanlar.push(alan.trim()); alan = ''; }
        else alan += k;
      }
      alanlar.push(alan.trim());
      const obj = {};
      basliklar.forEach((b, i) => { obj[b] = (alanlar[i] || '').replace(/^"|"$/g, ''); });
      return obj;
    });
  }

  // ── Veri yükleme ──────────────────────────────────────────
  async function filmleriYukle() {
    if (state.filmler.length > 0) return;
    try {
      const r = await fetch(`${SHEETS_BASE}&gid=${GID_FILMLER}`);
      const satirlar = parseCSV(await r.text());
      state.filmler = satirlar
        .map(s => ({ ad: s['Film Adı'] || s['ad'] || s['title'] || '', yil: s['Yapım Yılı'] || s['yil'] || '' }))
        .filter(f => f.ad)
        .sort((a, b) => a.ad.localeCompare(b.ad, 'tr'));
    } catch(e) { console.error('KatkiModal: filmler yüklenemedi', e); }
  }

  async function mekanlariYukle() {
    if (state.mekanlar.length > 0) return;
    try {
      const r = await fetch(`${SHEETS_BASE}&gid=${GID_MEKANLAR}`);
      const satirlar = parseCSV(await r.text());
      state.mekanlar = satirlar
        .map(s => ({ ad: s['Mekan Adı'] || s['ad'] || s['name'] || '', kategori: s['Kategori'] || '' }))
        .filter(m => m.ad)
        .sort((a, b) => a.ad.localeCompare(b.ad, 'tr'));
    } catch(e) { console.error('KatkiModal: mekanlar yüklenemedi', e); }
  }

  async function gorsellerYukle() {
    if (state.gorseller.length > 0) return;
    try {
      const r = await fetch(`${SHEETS_BASE}&gid=${GID_GORSELLER}`);
      const satirlar = parseCSV(await r.text());
      state.gorseller = satirlar
        .map(s => ({
          film:  s['Film Adı'] || s['Film'] || s['film'] || '',
          mekan: s['Mekan Adı'] || s['Mekan'] || s['mekan'] || '',
          url:   driveToImg(s['URL'] || s['Görsel URL'] || s['url'] || s['gorsel_url'] || ''),
        }))
        .filter(g => g.film && g.url);
    } catch(e) { console.error('KatkiModal: görseller yüklenemedi', e); }
  }

  function driveToImg(url) {
    if (!url) return '';
    if (url.includes('lh3.googleusercontent')) return url;
    const m = url.match(/(?:id=|\/d\/)([a-zA-Z0-9_-]{25,})/);
    return m ? `https://lh3.googleusercontent.com/d/${m[1]}` : url;
  }

  // ── Overlay HTML (bir kez oluşturulur) ────────────────────
  function overlayHTML() {
    return `
<div id="katki-overlay" role="dialog" aria-modal="true" aria-label="Katkı Formu">
  <div id="katki-modal">
    <div class="km-baslik">
      <h2>Katkı Yap</h2>
      <button class="km-kapat" id="katki-kapat-btn" aria-label="Kapat">×</button>
    </div>
    <div class="km-icerik" id="katki-icerik"></div>
  </div>
</div>`;
  }

  // ── ADIM 1: Tür seçimi ────────────────────────────────────
  function adim1HTML() {
    return `
<p class="km-aciklama">Haritaya nasıl katkıda bulunmak istersiniz?</p>
<div class="km-tur-liste">
  ${TUR_TANIMI.map((t, i) => `
    <button class="km-tur-sat ${state.seciliTur === t.id ? 'secili' : ''}" data-tur="${t.id}" type="button">
      <span class="kts-no">${i + 1}</span>
      <span>
        <span class="kts-baslik">${t.baslik}</span>
        <span class="kts-aciklama">${t.aciklama}</span>
      </span>
    </button>`).join('')}
</div>
<div class="km-buton-grup">
  <button class="km-btn km-btn-ileri" id="km-ileri-btn" ${!state.seciliTur ? 'disabled' : ''}>Devam Et</button>
</div>`;
  }

  // ── ADIM 2: İçerik formu ──────────────────────────────────
  function adim2HTML() {
    const tur    = state.seciliTur;
    const turObj = TUR_TANIMI.find(t => t.id === tur);
    let alanlar  = '';

    if (tur === 'gorsel') {
      alanlar = `
        ${filmSelectHTML('gorsel-film', 'Film *', true)}
        ${mekanSelectHTML('gorsel-mekan', 'Mekan', false, true)}
        <div class="km-alan">
          <label for="gorsel-url">Görsel URL *</label>
          <input type="url" id="gorsel-url" placeholder="https://drive.google.com/…" />
          <p class="km-yardim">Google Drive veya erişilebilir bir kaynak linki</p>
        </div>
        <div class="km-alan">
          <label for="gorsel-not">Not</label>
          <textarea id="gorsel-not" placeholder="Görselin kaynağı, tarihi veya ek bilgi…"></textarea>
        </div>`;

    } else if (tur === 'mekan') {
      alanlar = `
        ${filmSelectHTML('mekan-film', 'Film *', true)}
        <div class="km-alan">
          <label for="mekan-ad">Mekan Adı *</label>
          <input type="text" id="mekan-ad" placeholder="ör. Galata Kulesi" />
        </div>
        <div class="km-alan">
          <label for="mekan-kategori">Kategori</label>
          <select id="mekan-kategori">
            <option value="">— Kategori seçin —</option>
            ${MEKAN_KATEGORILERI.map(k => `<option value="${escHtml(k)}">${escHtml(k)}</option>`).join('')}
          </select>
        </div>
        <div class="km-alan">
          <label>Konum <span class="km-yardim-inline">— haritaya tıklayarak pin bırakın</span></label>
          <div id="katki-mini-harita"></div>
          <div class="km-koord-display" id="katki-koord-display">Henüz konum seçilmedi</div>
        </div>
        <div class="km-alan">
          <label for="mekan-not">Açıklama</label>
          <textarea id="mekan-not" placeholder="Filmde hangi sahnede geçiyor…"></textarea>
        </div>`;

    } else if (tur === 'film') {
      alanlar = `
        ${mekanSelectHTML('film-mekan', 'Çekim Mekanı', false, true)}
        <div class="km-alan">
          <label for="film-ad">Film / Dizi Adı *</label>
          <input type="text" id="film-ad" placeholder="ör. Karanlık Gece" />
        </div>
        <div class="km-alan">
          <label for="film-tur">Film Türü</label>
          <select id="film-tur">
            <option value="">— Tür seçin —</option>
            ${FILM_TURLERI.map(t => `<option value="${escHtml(t)}">${escHtml(t)}</option>`).join('')}
          </select>
        </div>
        <div class="km-alan">
          <label for="film-yonetmen">Yönetmen</label>
          <input type="text" id="film-yonetmen" placeholder="ör. Nuri Bilge Ceylan" />
        </div>
        <div class="km-alan">
          <label for="film-yil">Yapım Yılı</label>
          <input type="number" id="film-yil" placeholder="ör. 2023" min="1900" max="2099" />
        </div>
        <div class="km-alan">
          <label for="film-not">Açıklama</label>
          <textarea id="film-not" placeholder="Tür, kısa bilgi…"></textarea>
        </div>`;

    } else if (tur === 'hata') {
      alanlar = `
        ${filmSelectHTML('hata-film', 'İlgili Film', false)}
        ${mekanSelectHTML('hata-mekan', 'İlgili Mekan', false, false)}
        <div class="km-alan" id="hata-gorsel-alan" style="display:none">
          <label>Hatalı Görsel <span class="km-yardim-inline">— seçin</span></label>
          <div class="km-gorsel-grid" id="hata-gorsel-grid"></div>
        </div>
        <div class="km-alan">
          <label for="hata-aciklama">Hata Açıklaması *</label>
          <textarea id="hata-aciklama" placeholder="Neyin yanlış olduğunu açıklayın…"></textarea>
        </div>`;

    } else if (tur === 'genel') {
      alanlar = `
        <div class="km-alan">
          <label for="genel-metin">Öneriniz / Yorumunuz *</label>
          <textarea id="genel-metin" style="min-height:120px" placeholder="Harita veya proje hakkında öneri, düzeltme veya yorum…"></textarea>
        </div>`;
    }

    return `
<div class="km-adim-etiket">${turObj.baslik}</div>
<div class="km-hata-mesaj" id="km-hata-mesaj"></div>
${alanlar}
<div class="km-buton-grup">
  <button class="km-btn km-btn-geri" id="km-geri-btn">Geri</button>
  <button class="km-btn km-btn-ileri" id="km-ileri-btn">Devam Et</button>
</div>`;
  }

  // ── ADIM 3: İletişim bilgileri ────────────────────────────
  function adim3HTML() {
    return `
<div class="km-adim-etiket">İletişim Bilgileri</div>
<p class="km-aciklama">İsteğe bağlı — yanıt verebilmemiz veya sizi bilgilendirmemiz için.</p>
<div class="km-alan">
  <label for="iletisim-ad">Ad Soyad</label>
  <input type="text" id="iletisim-ad" autocomplete="name" placeholder="ör. Ahmet Yılmaz" />
</div>
<div class="km-alan">
  <label for="iletisim-mail">E-posta</label>
  <input type="email" id="iletisim-mail" autocomplete="email" placeholder="ör. ahmet@email.com" />
</div>
<div class="km-hata-mesaj" id="km-hata-mesaj"></div>
<div class="km-buton-grup">
  <button class="km-btn km-btn-geri" id="km-geri-btn">Geri</button>
  <button class="km-btn km-btn-gonder" id="km-gonder-btn">Gönder</button>
</div>`;
  }

  // ── Select yardımcıları ───────────────────────────────────
  function filmSelectHTML(id, label, zorunlu) {
    const loading = state.filmler.length === 0;
    return `<div class="km-alan">
  <label for="${id}">${label}</label>
  <select id="${id}" ${zorunlu ? 'required' : ''} ${loading ? 'disabled' : ''}>
    <option value="">${loading ? 'Yükleniyor…' : '— Film seçin —'}</option>
    ${state.filmler.map(f => `<option value="${escHtml(f.ad)}">${escHtml(f.ad)}${f.yil ? ` (${f.yil})` : ''}</option>`).join('')}
  </select>
</div>`;
  }

  function mekanSelectHTML(id, label, zorunlu, digerVar) {
    const loading  = state.mekanlar.length === 0;
    const digerId  = id + '-diger';
    const placeholder = zorunlu ? '— Mekan seçin —' : '— Mekan seçin (opsiyonel) —';
    return `<div class="km-alan">
  <label for="${id}">${label}</label>
  <select id="${id}" ${zorunlu ? 'required' : ''} ${loading ? 'disabled' : ''} data-diger="${digerVar ? digerId : ''}">
    <option value="">${loading ? 'Yükleniyor…' : placeholder}</option>
    ${state.mekanlar.map(m => `<option value="${escHtml(m.ad)}">${escHtml(m.ad)}${m.kategori ? ` · ${m.kategori}` : ''}</option>`).join('')}
    ${digerVar ? '<option value="diger">Diğer (belirtin)</option>' : ''}
  </select>
</div>
${digerVar ? `<div class="km-alan km-diger-alan" id="${digerId}-wrap" style="display:none">
  <label for="${digerId}">Mekan Adı</label>
  <input type="text" id="${digerId}" placeholder="Mekan adını yazın…" />
</div>` : ''}`;
  }

  function basariHTML() {
    return `
<div class="km-basari">
  <h3>Teşekkürler</h3>
  <p>Katkınız alındı ve ekibimiz tarafından incelenecek.<br>
     İstanbul'un sinema belleğine destek olduğunuz için teşekkür ederiz.</p>
</div>
<div class="km-buton-grup" style="margin-top:20px">
  <button class="km-btn km-btn-ileri" id="km-yeni-katki-btn">Yeni Katkı</button>
</div>`;
  }

  // ── Render & Adım geçişleri ───────────────────────────────
  function render(html) {
    document.getElementById('katki-icerik').innerHTML = html;
    eventleriEkle();
  }

  function adim1Goster() {
    miniMapTemizle();
    state.adim = 1;
    state.form2Veri = null;
    render(adim1HTML());
  }

  async function adim2Goster() {
    state.adim = 2;
    await Promise.all([filmleriYukle(), mekanlariYukle()]);
    if (state.seciliTur === 'hata') await gorsellerYukle();
    render(adim2HTML());
    if (state.seciliTur === 'mekan') setTimeout(miniMapBaslat, 80);
  }

  function adim3Goster() {
    // Adım 2 verilerini doğrula ve sakla
    const veri = formVerisiTopla();
    if (!veri) return;             // validasyon başarısız, adım 2'de kal
    state.form2Veri = veri;
    miniMapTemizle();
    state.adim = 3;
    render(adim3HTML());
  }

  // ── Mini harita ───────────────────────────────────────────
  function miniMapBaslat() {
    const el = document.getElementById('katki-mini-harita');
    if (!el || !window.maplibregl) return;
    miniMapTemizle();
    state.secilenKoord = null;

    state.miniMap = new maplibregl.Map({
      container: 'katki-mini-harita',
      style: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
      center: [28.978, 41.013],
      zoom: 11,
      attributionControl: false,
    });

    let marker = null;
    state.miniMap.on('click', e => {
      const { lng, lat } = e.lngLat;
      state.secilenKoord = { lat: +lat.toFixed(6), lng: +lng.toFixed(6) };
      if (marker) marker.remove();
      marker = new maplibregl.Marker({ color: '#f03010' }).setLngLat([lng, lat]).addTo(state.miniMap);
      const koordEl = document.getElementById('katki-koord-display');
      if (koordEl) koordEl.textContent = `${state.secilenKoord.lat}, ${state.secilenKoord.lng}`;
    });
  }

  function miniMapTemizle() {
    if (state.miniMap) { state.miniMap.remove(); state.miniMap = null; }
  }

  // ── Görsel grid (hata bildirimi) ──────────────────────────
  function gorselGridGuncelle(filmAdi) {
    const alan = document.getElementById('hata-gorsel-alan');
    const grid = document.getElementById('hata-gorsel-grid');
    if (!alan || !grid) return;

    const eslesen = state.gorseller
      .filter(g => !filmAdi || g.film.toLowerCase() === filmAdi.toLowerCase())
      .slice(0, 24);

    if (eslesen.length === 0) { alan.style.display = 'none'; state.secilenGorselUrl = null; return; }

    alan.style.display = 'block';
    state.secilenGorselUrl = null;

    grid.innerHTML = eslesen.map((g, i) => `
      <button class="km-gorsel-thumb" data-url="${escHtml(g.url)}" data-i="${i}" type="button"
              title="${escHtml(g.mekan || g.film)}">
        <img src="${escHtml(g.url)}" alt="" loading="lazy"
             onerror="this.parentElement.style.display='none'">
      </button>`).join('');

    grid.querySelectorAll('.km-gorsel-thumb').forEach(btn => {
      btn.addEventListener('click', () => {
        grid.querySelectorAll('.km-gorsel-thumb').forEach(b => b.classList.remove('secili'));
        btn.classList.add('secili');
        state.secilenGorselUrl = btn.dataset.url;
      });
    });
  }

  // ── Event listener'lar ────────────────────────────────────
  function eventleriEkle() {
    const ic = document.getElementById('katki-icerik');

    // Adım 1: tür seçimi
    ic.querySelectorAll('.km-tur-sat').forEach(btn => {
      btn.addEventListener('click', () => { state.seciliTur = btn.dataset.tur; adim1Goster(); });
    });

    // Adım 1: devam
    const ileri = document.getElementById('km-ileri-btn');
    if (ileri && state.adim === 1) {
      ileri.addEventListener('click', () => { if (state.seciliTur) adim2Goster(); });
    }

    // Adım 2: devam (→ adım 3)
    if (ileri && state.adim === 2) {
      ileri.addEventListener('click', adim3Goster);
    }

    // Geri
    const geri = document.getElementById('km-geri-btn');
    if (geri) {
      geri.addEventListener('click', () => {
        if (state.adim === 2) adim1Goster();
        else if (state.adim === 3) adim2Goster();
      });
    }

    // Gönder (sadece adım 3'te)
    const gonder = document.getElementById('km-gonder-btn');
    if (gonder) gonder.addEventListener('click', formuGonder);

    // Yeni katkı
    const yeni = document.getElementById('km-yeni-katki-btn');
    if (yeni) yeni.addEventListener('click', () => { state.seciliTur = null; adim1Goster(); });

    // "Diğer" mekan select'leri
    ic.querySelectorAll('select[data-diger]').forEach(sel => {
      if (!sel.dataset.diger) return;
      const wr = document.getElementById(sel.dataset.diger + '-wrap');
      sel.addEventListener('change', () => {
        if (wr) wr.style.display = sel.value === 'diger' ? 'block' : 'none';
      });
    });

    // Hata: film değişince görsel grid güncelle
    const hataFilm = document.getElementById('hata-film');
    if (hataFilm) hataFilm.addEventListener('change', () => gorselGridGuncelle(hataFilm.value));
  }

  // ── Form verisi (adım 2 alanları) ────────────────────────
  function formVerisiTopla() {
    const tur  = state.seciliTur;
    const veri = { katki_turu: TUR_TANIMI.find(t => t.id === tur)?.baslik || tur };

    const mekanDeger = (selectId, digerId) => {
      const v = g(selectId);
      return v === 'diger' ? `Diğer: ${g(digerId)}` : v;
    };

    if (tur === 'gorsel') {
      const film = g('gorsel-film'), url = g('gorsel-url');
      if (!film) { hataGoster('Lütfen bir film seçin.'); return null; }
      if (!url)  { hataGoster('Lütfen görsel URL\'si girin.'); return null; }
      veri.film   = film;
      veri.mekan  = mekanDeger('gorsel-mekan', 'gorsel-mekan-diger');
      veri.icerik = url;
      veri.notlar = g('gorsel-not');

    } else if (tur === 'mekan') {
      const film = g('mekan-film'), ad = g('mekan-ad');
      if (!film) { hataGoster('Lütfen bir film seçin.'); return null; }
      if (!ad)   { hataGoster('Lütfen mekan adı girin.'); return null; }
      veri.film     = film;
      veri.mekan    = ad;
      veri.kategori = g('mekan-kategori');
      veri.icerik   = state.secilenKoord ? `${state.secilenKoord.lat}, ${state.secilenKoord.lng}` : '';
      veri.notlar   = g('mekan-not');

    } else if (tur === 'film') {
      const ad = g('film-ad');
      if (!ad) { hataGoster('Lütfen film adı girin.'); return null; }
      veri.mekan    = mekanDeger('film-mekan', 'film-mekan-diger');
      veri.film     = ad;
      veri.kategori = g('film-tur');
      veri.icerik   = [g('film-yonetmen'), g('film-yil')].filter(Boolean).join(' · ');
      veri.notlar   = g('film-not');

    } else if (tur === 'hata') {
      const aciklama = g('hata-aciklama');
      if (!aciklama) { hataGoster('Lütfen hata açıklaması girin.'); return null; }
      veri.film   = g('hata-film');
      veri.mekan  = g('hata-mekan');
      veri.icerik = aciklama;
      veri.notlar = state.secilenGorselUrl ? `Hatalı görsel: ${state.secilenGorselUrl}` : '';

    } else if (tur === 'genel') {
      const metin = g('genel-metin');
      if (!metin) { hataGoster('Lütfen önerinizi yazın.'); return null; }
      veri.icerik = metin;
    }

    return veri;
  }

  // ── Gönderme (adım 3'ten tetiklenir) ─────────────────────
  async function formuGonder() {
    const gonderBtn = document.getElementById('km-gonder-btn');

    const apiUrl = typeof KATKI_API_URL !== 'undefined' ? KATKI_API_URL : null;
    if (!apiUrl || apiUrl.includes('BURAYA')) { hataGoster('KATKI_API_URL henüz ayarlanmadı.'); return; }

    // state.form2Veri adım 3'e geçişte zaten doğrulandı
    const veri = { ...state.form2Veri };

    // İletişim bilgilerini ekle
    const ad   = g('iletisim-ad');
    const mail = g('iletisim-mail');
    if (ad || mail) veri.gonderen = [ad, mail].filter(Boolean).join(' | ');

    gonderBtn.disabled = true;
    gonderBtn.textContent = 'Gönderiliyor…';

    try {
      const r = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify(veri),
      });
      const cevap = await r.json();
      if (cevap.basari) {
        render(basariHTML());
        eventleriEkle();
      } else {
        hataGoster(cevap.mesaj || 'Bir hata oluştu.');
        gonderBtn.disabled = false;
        gonderBtn.textContent = 'Gönder';
      }
    } catch(e) {
      hataGoster('Bağlantı hatası. Lütfen tekrar deneyin.');
      gonderBtn.disabled = false;
      gonderBtn.textContent = 'Gönder';
    }
  }

  // ── Yardımcılar ───────────────────────────────────────────
  function g(id) { const el = document.getElementById(id); return el ? el.value.trim() : ''; }
  function hataGoster(m) { const el = document.getElementById('km-hata-mesaj'); if (!el) return; el.textContent = m; el.classList.add('goster'); }
  function escHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  // ── Aç / Kapat ────────────────────────────────────────────
  function ac() {
    document.getElementById('katki-overlay').classList.add('aktif');
    document.body.style.overflow = 'hidden';
  }

  function kapat() {
    miniMapTemizle();
    state.secilenKoord    = null;
    state.secilenGorselUrl = null;
    state.form2Veri       = null;
    document.getElementById('katki-overlay').classList.remove('aktif');
    document.body.style.overflow = '';
  }

  // ── Init ──────────────────────────────────────────────────
  function init() {
    const d = document.createElement('div');
    d.innerHTML = overlayHTML();
    document.body.appendChild(d);

    document.getElementById('katki-kapat-btn').addEventListener('click', kapat);
    document.getElementById('katki-overlay').addEventListener('click', e => {
      if (e.target.id === 'katki-overlay') kapat();
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') kapat(); });

    window.katkiModalAc = () => { ac(); adim1Goster(); };
  }

  return { init, ac, kapat };

})();

// Adım 2'den adım 3'e geçince adım 2 DOM'u yok olur; geri dönünce adım 2 yeniden render edilir.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => KatkiModal.init());
} else {
  KatkiModal.init();
}