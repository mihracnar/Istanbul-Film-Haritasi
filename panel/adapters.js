/**
 * Veri katmanı — panel yalnızca bu arayüzü bilir:
 *
 *   login(token)                          → { editor }
 *   load()                                → { editor, tables: [{ name, headers, formulaCols, rows, rowNums }] }
 *   update(table, ref, changes, expected) → { row, rowNum }
 *   create(table, values, opts)           → { row, rowNum }     opts.autoId → sunucu kimlik üretir
 *   remove(table, ref, expected, opts)    → { rowNum }      opts.trashFile + opts.urlCol → Drive dosyası da çöpe
 *   batch(ops)                            → { results: [{ sheet, row, rowNum }] }   ops: [{ sheet, id|row, changes, expected }]
 *   upload(table, file, values, opts)     → { row, rowNum, url, shared }  file: { name, mimeType, data(base64) }
 *
 *   ref      : { id }  kimlik sütunu olan sayfalarda  |  { row } satır numarasıyla
 *   changes  : { sütunİndeksi: yeniDeğer }
 *   expected : { sütunİndeksi: beklenenEskiDeğer }  — sunucudaki değer farklıysa yazılmaz
 *
 * Hata: Error; e.code ∈ auth | conflict | not_found | duplicate | busy | network | server | config
 *       conflict'te e.current = sunucudaki güncel satır.
 *
 * Veritabanına geçişte aynı imzalarla bir RestAdapter yazılır; panel.js değişmez.
 */
(function () {
  class PanelError extends Error {
    constructor(code, message, extra) {
      super(message);
      this.code = code;
      Object.assign(this, extra || {});
    }
  }

  // ------------------------------------------------------------ Google Sheets (Apps Script)
  class SheetsAdapter {
    constructor(url) {
      this.url = url;
      this.token = null;
    }
    async call(action, payload) {
      if (!this.url || /BURAYA/.test(this.url)) {
        throw new PanelError('config', 'Panel henüz API\'ye bağlanmadı: panel/config.js → API_URL alanını doldurun.');
      }
      let res;
      try {
        // text/plain → CORS ön-isteği tetiklenmez; Apps Script ile çalışan yol budur.
        res = await fetch(this.url, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify(Object.assign({ action, token: this.token }, payload)),
        });
      } catch (e) {
        throw new PanelError('network', 'Sunucuya ulaşılamadı.');
      }
      let data;
      try { data = await res.json(); } catch (e) {
        throw new PanelError('server', 'Sunucu yanıtı okunamadı (dağıtım erişimi "Herkes" mi?).');
      }
      if (!data.ok) throw new PanelError(data.error || 'server', data.message || 'Bilinmeyen hata', { current: data.current });
      return data;
    }
    async login(token) { this.token = token; return this.call('login', {}); }
    load() { return this.call('load', {}); }
    update(table, ref, changes, expected) { return this.call('update', Object.assign({ sheet: table, changes, expected }, ref)); }
    create(table, values, opts) { return this.call('create', { sheet: table, values, autoId: !!(opts && opts.autoId) }); }
    remove(table, ref, expected, opts) { return this.call('delete', Object.assign({ sheet: table, expected }, ref, opts || {})); }
    batch(ops) { return this.call('batch', { ops }); }
    upload(table, file, values, opts) {
      return this.call('upload', Object.assign({ sheet: table, fileName: file.name, mimeType: file.mimeType, data: file.data, values }, opts || {}));
    }
  }

  // ------------------------------------------------------------ Demo (bellek içi, ?demo)
  class DemoAdapter {
    constructor() {
      this.tables = JSON.parse(JSON.stringify(DEMO_DATA));
    }
    wait() { return new Promise(r => setTimeout(r, 120)); }
    t(name) {
      const t = this.tables.find(x => x.name === name);
      if (!t) throw new PanelError('bad_request', 'Sayfa yok: ' + name);
      return t;
    }
    idx(t, ref) {
      if (ref.id != null) {
        const i = t.rows.findIndex(r => r[0] === ref.id);
        if (i < 0) throw new PanelError('not_found', 'Kayıt bulunamadı: ' + ref.id);
        return i;
      }
      const i = ref.row - 2;
      if (!t.rows[i]) throw new PanelError('not_found', 'Satır bulunamadı: ' + ref.row);
      return i;
    }
    check(row, expected) {
      for (const k in expected || {}) {
        if (String(row[k] ?? '') !== String(expected[k] ?? '')) {
          throw new PanelError('conflict', 'Bu kayıt siz düzenlerken başka biri tarafından değiştirildi.', { current: row.slice() });
        }
      }
    }
    snapshot() {
      return this.tables.map(t => Object.assign({}, t, { rows: t.rows.map(r => r.slice()), rowNums: t.rows.map((_, i) => i + 2) }));
    }
    async login(token) { await this.wait(); if (!token) throw new PanelError('auth', 'Geçersiz anahtar.'); return { editor: 'demo' }; }
    async load() { await this.wait(); return { editor: 'demo', tables: this.snapshot() }; }
    async update(table, ref, changes, expected) {
      await this.wait();
      const t = this.t(table), i = this.idx(t, ref), row = t.rows[i];
      this.check(row, expected);
      for (const k in changes) row[k] = String(changes[k]);
      return { row: row.slice(), rowNum: i + 2 };
    }
    async create(table, values, opts) {
      await this.wait();
      const t = this.t(table);
      const row = t.headers.map((_, i) => (values[i] != null ? String(values[i]) : ''));
      if (opts && opts.autoId) {
        let prefix = '', width = 3, max = 0;
        t.rows.forEach(r => { const m = /^(\D*)(\d+)$/.exec(r[0]); if (m) { prefix = m[1]; width = Math.max(width, m[2].length); max = Math.max(max, +m[2]); } });
        row[0] = prefix + String(max + 1).padStart(width, '0');
      }
      t.rows.push(row);
      return { row: row.slice(), rowNum: t.rows.length + 1 };
    }
    async remove(table, ref, expected) {
      await this.wait();
      const t = this.t(table), i = this.idx(t, ref);
      this.check(t.rows[i], expected);
      t.rows.splice(i, 1);
      return { rowNum: i + 2 };
    }
    async batch(ops) {
      await this.wait();
      const prepared = ops.map(op => {
        const t = this.t(op.sheet), i = this.idx(t, op);
        this.check(t.rows[i], op.expected);
        return { t, i, op };
      });
      return { results: prepared.map(({ t, i, op }) => {
        for (const k in op.changes) t.rows[i][k] = String(op.changes[k]);
        return { sheet: op.sheet, row: t.rows[i].slice(), rowNum: i + 2 };
      }) };
    }
    async upload(table, file, values, opts) {
      await this.wait();
      const url = 'data:' + file.mimeType + ';base64,' + file.data; // demo: dosya bellekte kalır
      const res = await this.create(table, Object.assign({}, values, { [opts.urlCol]: url }), opts);
      return Object.assign(res, { url, shared: true });
    }
    // test kolaylığı: başka bir kullanıcının değişikliğini taklit eder
    _external(table, rowIndex, col, value) { this.t(table).rows[rowIndex][col] = value; }
  }

  // Demo verisi — sütun düzeni haritadaki data.js indeksleriyle aynı; içerik örnektir.
  const DEMO_DATA = [
    {
      name: 'Filmler',
      headers: ['Film No', 'Film Adı', 'Yerli/Yabancı', 'Yönetmen', 'Türü', 'Çekim Yılı', 'Çekildiği Yer', 'Film Açıklaması', 'Orijinal İsmi', 'Görsel Sayısı'],
      formulaCols: [9],
      rows: [
        ['F001', 'İstanbul', 'Yabancı', 'Joseph Pevney', 'Romantik', '1957', 'Yeşilköy Havalimanı, Sultanahmet', 'Demo kaydı.', 'Istanbul', '2'],
        ['F002', 'Ölümsüz Kadın', 'Yabancı', 'Alain Robbe-Grillet', 'Dram, Gerilim', '1963', 'İstinye Koyu, Zeyrek Mahallesi, Yeni Camii, Kiz Kulesi, Galata Köprüsü, Bukoleon', 'Demo kaydı.', "L'Immortelle", '1'],
        ['F003', 'Selvi Boylum Al Yazmalım', 'Yerli', 'Atıf Yılmaz', 'Dram', '1977', 'Karaköy Rıhtımı', 'Demo kaydı.', '', '0'],
        ['F004', 'Uzak', 'Yerli', 'Nuri Bilge Ceylan', 'Dram', '2002', 'Cihangir, Galata Köprüsü', 'Demo kaydı.', '', '0'],
        ['F005', 'Kanlı Mezar', 'Yerli', 'Türker İnanoğlu', '', '1968', 'Eminönü, Galata Köprüsü', 'Demo kaydı: türü boş olduğu için haritada görünmez.', '', '0'],
        ['', 'Numarasız Film', 'Yerli', '', 'Dram', '1970', 'Cihangir', 'Demo kaydı: A sütunu boş.', '', '0'],
        // formülü aşağı uzatılmış boş satırlar (panel bunları yok sayar)
        ['', '', '', '', '', '', '', '', '', '0'],
        ['', '', '', '', '', '', '', '', '', '0'],
        ['', '', '', '', '', '', '', '', '', '0'],
      ],
    },
    {
      name: 'Mekanlar',
      headers: ['Mekan No', 'Mekan Adı', 'Kategori', 'Koordinat', 'İlçe', 'Kayıp Eser'],
      formulaCols: [],
      rows: [
        ['M001', 'Yeşilköy Havalimanı', 'Ulaşım', '40.9769, 28.8146', 'Bakırköy', ''],
        ['M002', 'Sultanahmet', 'Meydan', '41.0054, 28.9768', 'Fatih', ''],
        ['M003', 'İstinye Koyu', 'Kıyı', '41.1136, 29.0573', 'Sarıyer', ''],
        ['M004', 'Zeyrek Mahallesi', 'Semt', '41.0195, 28.9560', 'Fatih', ''],
        ['M005', 'Yeni Camii', 'Dini Yapı', '41.0171, 28.9708', 'Fatih', ''],
        ['M006', 'Galata Köprüsü', 'Ulaşım', '41.0201, 28.9733', 'Beyoğlu', ''],
        ['M007', 'Kız Kulesi', 'Anıt', '41.0211, 29.0041', 'Üsküdar', ''],
        ['M008', 'Cihangir', 'Semt', '', 'Beyoğlu', ''],
        ['M009', 'Eski Galata Köprüsü', 'Ulaşım', '41.0225, 28.9580', 'Fatih', '1'],
      ],
    },
    {
      name: 'Görseller',
      headers: ['Film No', 'Film Adı', 'Mekan', 'Görsel URL', 'Durum'],
      formulaCols: [],
      rows: [
        ['F001', 'İstanbul', 'Sultanahmet', 'https://picsum.photos/seed/f1a/400/240', '1'],
        ['F001', 'İstanbul', 'Yeşilköy Havalimanı', 'https://picsum.photos/seed/f1b/400/240', ''],
        ['F002', 'Ölümsüz Kadın', 'Kız Kulesi', 'https://picsum.photos/seed/f2a/400/240', 'x'],
        ['F002', 'Ölümsüz Kadın', 'Galata Köprüsü', 'https://picsum.photos/seed/f2b/400/240', ''],
      ],
    },
  ];

  window.PanelData = { PanelError, SheetsAdapter, DemoAdapter };
})();
