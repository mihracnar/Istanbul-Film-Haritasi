/**
 * İstanbul Sinema Haritası — Veri Paneli API (Apps Script)
 * ---------------------------------------------------------------
 * Ayrı (standalone) bir Apps Script projesi olarak kurulur; mevcut
 * katkı formu projesinin doPost'u ile çakışmaz.
 *
 * Kurulum
 *  1. script.google.com → Yeni proje → bu dosyayı yapıştır.
 *  2. Proje Ayarları → Script Properties:
 *       SPREADSHEET_ID = 1CxJQRPP88RwhzOJFKR7ylv6wzJz_56p-WeX23TE7jbA
 *       PANEL_TOKENS   = {"mihrac":"<uzun-rastgele-anahtar>", "selda":"<başka-anahtar>"}
 *       GORSEL_KLASOR_ID = Drive'da yüklenen görsellerin gideceği klasör
 *                          (boşsa "Film Görselleri": 1-GgYq5rmYyzMOcTRRAPdH9g8hY5yRmff)
 *     Kişi eklemek için: anahtarEkle fonksiyonunda AD'ı yaz, çalıştır; anahtar Günlük'te.
 *  3. Dağıt → Yeni dağıtım → Web uygulaması
 *       Yürüt: Ben  |  Erişim: Herkes
 *     Çıkan /exec URL'sini panelin config.js → API_URL alanına yaz.
 *
 * Tasarım ilkeleri
 *  - Satırlar dizi olarak taşınır; yazma sütun İNDEKSİ ile yapılır (proje kuralı).
 *  - Satır kimliği her sayfada A sütunudur (F001, M001 …).
 *  - Güncelleme yalnızca değişen hücreleri yazar; formüllü hücrelere dokunmaz.
 *  - İyimser kilit: istemci eski değeri gönderir, sunucudaki değer farklıysa
 *    yazmaz ve "conflict" döner (iki kişi aynı kaydı düzenlerse veri ezilmez).
 *  - Her yazma _Panel_Log sayfasına önce/sonra halleriyle kaydedilir.
 */

// Panelde düzenlenebilecek sayfalar (sekme sırası da budur).
var EDITABLE_SHEETS = ['Filmler', 'Mekanlar', 'Görseller'];
var LOG_SHEET = '_Panel_Log';
var HEADER_ROW = 1;
var VARSAYILAN_GORSEL_KLASORU = '1-GgYq5rmYyzMOcTRRAPdH9g8hY5yRmff'; // Turizm - Dizi:Sinema / Film Görselleri

// ---------------------------------------------------------------- giriş

function doPost(e) {
  var out;
  try {
    var req = JSON.parse(e.postData.contents || '{}');
    var editor = auth_(req.token);
    switch (req.action) {
      case 'login':  out = { editor: editor }; break;
      case 'load':   out = load_(editor); break;
      case 'update': out = withLock_(function () { return update_(editor, req); }); break;
      case 'create': out = withLock_(function () { return create_(editor, req); }); break;
      case 'delete': out = withLock_(function () { return remove_(editor, req); }); break;
      case 'batch':  out = withLock_(function () { return batch_(editor, req); }); break;
      case 'upload': out = withLock_(function () { return upload_(editor, req); }); break;
      default: throw err_('bad_request', 'Bilinmeyen işlem: ' + req.action);
    }
    out.ok = true;
  } catch (x) {
    out = { ok: false, error: x.code || 'server', message: x.message || String(x) };
    if (x.current) out.current = x.current;
  }
  return ContentService.createTextOutput(JSON.stringify(out))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet() {
  return ContentService.createTextOutput(JSON.stringify({ ok: true, service: 'sinema-veri-paneli' }))
    .setMimeType(ContentService.MimeType.JSON);
}

// ---------------------------------------------------------------- işlemler

function load_(editor) {
  var ss = ss_();
  var tables = EDITABLE_SHEETS.map(function (name) {
    var sh = sheet_(ss, name);
    var lastRow = sh.getLastRow(), lastCol = sh.getLastColumn();
    var headers = sh.getRange(HEADER_ROW, 1, 1, lastCol).getDisplayValues()[0];
    var rows = [], rowNums = [], formulaCols = [];
    if (lastRow > HEADER_ROW) {
      var vals = sh.getRange(HEADER_ROW + 1, 1, lastRow - HEADER_ROW, lastCol).getDisplayValues();
      vals.forEach(function (r, i) {
        // tamamen boş satırları atla; satır numarasını koru (kimliksiz sayfalar satırla adreslenir)
        if (r.join('').trim() === '') return;
        rows.push(r);
        rowNums.push(HEADER_ROW + 1 + i);
      });
      // İlk veri satırındaki formüllü sütunlar salt-okunur sayılır.
      var f = sh.getRange(HEADER_ROW + 1, 1, 1, lastCol).getFormulas()[0];
      f.forEach(function (v, i) { if (v) formulaCols.push(i); });
    }
    return { name: name, headers: headers, formulaCols: formulaCols, rows: rows, rowNums: rowNums };
  });
  return { editor: editor, tables: tables, loadedAt: new Date().toISOString() };
}

function update_(editor, req) {
  var sh = sheet_(ss_(), req.sheet);
  var rowNum = resolveRow_(sh, req);
  var before = sh.getRange(rowNum, 1, 1, sh.getLastColumn()).getDisplayValues()[0];
  checkExpected_(before, req.expected);
  return applyChanges_(editor, sh, rowNum, req, before);
}

/** Değişiklikleri yazar (beklenen değer denetimi çağırandan önce yapılmış olmalı). */
function applyChanges_(editor, sh, rowNum, req, before) {
  var lastCol = sh.getLastColumn();
  var rng = sh.getRange(rowNum, 1, 1, lastCol);
  var formulas = rng.getFormulas()[0];
  Object.keys(req.changes || {}).forEach(function (k) {
    var c = Number(k);
    if (c === 0 && req.id != null && req.id !== '') throw err_('bad_request', 'Kimlik (A sütunu) değiştirilemez.');
    if (c < 0 || c >= lastCol) throw err_('bad_request', 'Geçersiz sütun: ' + c);
    if (formulas[c]) throw err_('bad_request', 'Formüllü hücre düzenlenemez: ' + c);
  });
  Object.keys(req.changes || {}).forEach(function (k) {
    sh.getRange(rowNum, Number(k) + 1).setValue(cell_(req.changes[k]));
  });
  SpreadsheetApp.flush();
  var after = rng.getDisplayValues()[0];
  log_(editor, 'update', sh.getName(), refLabel_(req, rowNum), before, after);
  return { row: after, rowNum: rowNum };
}

/**
 * Birden çok güncellemeyi tek kilit altında yapar (ör. film adı değişince görsellerdeki adlar).
 * Önce TÜM beklenen değerler denetlenir; biri tutmazsa hiçbiri yazılmaz.
 */
function batch_(editor, req) {
  var ss = ss_();
  var ops = (req.ops || []).map(function (op) {
    var sh = sheet_(ss, op.sheet);
    var rowNum = resolveRow_(sh, op);
    var before = sh.getRange(rowNum, 1, 1, sh.getLastColumn()).getDisplayValues()[0];
    try { checkExpected_(before, op.expected); } catch (e) { e.message += ' (' + op.sheet + ' ' + refLabel_(op, rowNum) + ')'; throw e; }
    return { sh: sh, rowNum: rowNum, op: op, before: before };
  });
  var results = ops.map(function (x) {
    var r = applyChanges_(editor, x.sh, x.rowNum, x.op, x.before);
    return { sheet: x.op.sheet, row: r.row, rowNum: r.rowNum };
  });
  return { results: results };
}

/**
 * Görseli Drive klasörüne kaydeder, "bağlantıya sahip herkes görüntüleyebilir" yapar
 * (harita lh3.googleusercontent.com üzerinden gösterir) ve Görseller'e satır ekler.
 * req: { sheet, fileName, mimeType, data(base64), urlCol, values, autoId }
 */
function upload_(editor, req) {
  if (!req.data) throw err_('bad_request', 'Dosya verisi yok.');
  var id = PropertiesService.getScriptProperties().getProperty('GORSEL_KLASOR_ID') || VARSAYILAN_GORSEL_KLASORU;
  var folder = DriveApp.getFolderById(id);
  var name = String(req.fileName || 'gorsel.jpg').replace(/[\\/:*?"<>|]+/g, ' ').slice(0, 180);
  var blob = Utilities.newBlob(Utilities.base64Decode(req.data), req.mimeType || 'image/jpeg', name);
  var file = folder.createFile(blob);
  var shared = true;
  try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); }
  catch (e) { shared = false; } // kurum politikası engelliyorsa görsel haritada görünmeyebilir
  var url = 'https://drive.google.com/file/d/' + file.getId() + '/view';
  var values = req.values || {};
  values[req.urlCol] = url;
  var res = create_(editor, { sheet: req.sheet, values: values, autoId: req.autoId });
  res.fileId = file.getId();
  res.url = url;
  res.shared = shared;
  return res;
}

function create_(editor, req) {
  var sh = sheet_(ss_(), req.sheet);
  var lastRow = sh.getLastRow(), lastCol = sh.getLastColumn();
  var id = null;
  if (req.autoId) {
    var ids = lastRow > HEADER_ROW
      ? sh.getRange(HEADER_ROW + 1, 1, lastRow - HEADER_ROW, 1).getDisplayValues().map(function (r) { return r[0]; })
      : [];
    id = nextId_(ids);
    if (!id) throw err_('bad_request', 'Bu sayfada kimlik deseni bulunamadı (ör. F001).');
  }

  var newRow = lastRow + 1;
  var formulaSet = {};
  // Formüllü sütunları bir üst satırdan kopyala (göreli referanslar kayar).
  if (lastRow > HEADER_ROW) {
    var f = sh.getRange(lastRow, 1, 1, lastCol).getFormulas()[0];
    f.forEach(function (v, i) {
      if (!v) return;
      formulaSet[i] = true;
      sh.getRange(lastRow, i + 1).copyTo(sh.getRange(newRow, i + 1));
    });
  }
  if (id) sh.getRange(newRow, 1).setValue(id);
  Object.keys(req.values || {}).forEach(function (k) {
    var c = Number(k);
    if ((c === 0 && id) || c < 0 || c >= lastCol || formulaSet[c]) return;
    if (req.values[k] === '' || req.values[k] == null) return;
    sh.getRange(newRow, c + 1).setValue(cell_(req.values[k]));
  });
  SpreadsheetApp.flush();
  var after = sh.getRange(newRow, 1, 1, lastCol).getDisplayValues()[0];
  log_(editor, 'create', req.sheet, id || ('satır ' + newRow), null, after);
  return { row: after, rowNum: newRow };
}

function remove_(editor, req) {
  var sh = sheet_(ss_(), req.sheet);
  var rowNum = resolveRow_(sh, req);
  var before = sh.getRange(rowNum, 1, 1, sh.getLastColumn()).getDisplayValues()[0];
  checkExpected_(before, req.expected);
  if (req.trashFile && req.urlCol != null) trashUploaded_(before[req.urlCol]);
  sh.deleteRow(rowNum);
  log_(editor, 'delete', req.sheet, refLabel_(req, rowNum), before, null);
  return { rowNum: rowNum };
}

/**
 * Kimlikli sayfalarda { id } ile A sütunundan bulunur.
 * Kimliksiz sayfalarda { row } satır numarası kullanılır; satırlar kaymışsa yanlış satıra
 * yazılmasın diye istemci tüm satırın beklenen halini (expected) göndermek zorundadır.
 */
function resolveRow_(sh, req) {
  if (req.id != null && req.id !== '') return findRow_(sh, req.id);
  var n = Number(req.row);
  if (!n || n <= HEADER_ROW || n > sh.getLastRow()) throw err_('not_found', 'Satır bulunamadı: ' + req.row);
  if (!req.expected || Object.keys(req.expected).length < 2) {
    throw err_('bad_request', 'Satır numarasıyla yazmak için satırın beklenen hali gerekli.');
  }
  return n;
}

/** Yalnızca görsel klasöründeki Drive dosyalarını çöpe atar; başka yerdeki dosyalara dokunmaz. */
function trashUploaded_(url) {
  var m = String(url || '').match(/\/file\/d\/([a-zA-Z0-9_-]+)/) || String(url || '').match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (!m) return false;
  var folderId = PropertiesService.getScriptProperties().getProperty('GORSEL_KLASOR_ID') || VARSAYILAN_GORSEL_KLASORU;
  try {
    var f = DriveApp.getFileById(m[1]);
    var parents = f.getParents();
    while (parents.hasNext()) {
      if (parents.next().getId() === folderId) { f.setTrashed(true); return true; }
    }
  } catch (e) { /* erişim yoksa sessizce geç */ }
  return false;
}

function refLabel_(req, rowNum) { return req.id != null && req.id !== '' ? req.id : 'satır ' + rowNum; }

// ---------------------------------------------------------------- yardımcılar

function auth_(token) {
  var raw = PropertiesService.getScriptProperties().getProperty('PANEL_TOKENS') || '{}';
  var map = JSON.parse(raw);
  for (var name in map) {
    if (token && map[name] === token) return name;
  }
  Utilities.sleep(800); // kaba deneme yavaşlatma
  throw err_('auth', 'Geçersiz anahtar.');
}

function ss_() {
  var id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) throw err_('config', 'SPREADSHEET_ID tanımlı değil.');
  return SpreadsheetApp.openById(id);
}

function sheet_(ss, name) {
  if (EDITABLE_SHEETS.indexOf(name) < 0) throw err_('bad_request', 'Düzenlenemez sayfa: ' + name);
  var sh = ss.getSheetByName(name);
  if (!sh) throw err_('config', 'Sayfa bulunamadı: ' + name);
  return sh;
}

function findRow_(sh, id) {
  var lastRow = sh.getLastRow();
  if (!id || lastRow <= HEADER_ROW) throw err_('not_found', 'Kayıt bulunamadı: ' + id);
  var col = sh.getRange(HEADER_ROW + 1, 1, lastRow - HEADER_ROW, 1).getDisplayValues();
  var hits = [];
  for (var i = 0; i < col.length; i++) if (String(col[i][0]).trim() === String(id)) hits.push(i);
  if (!hits.length) throw err_('not_found', 'Kayıt bulunamadı: ' + id);
  if (hits.length > 1) throw err_('duplicate', 'Aynı kimlikte birden fazla satır var: ' + id);
  return HEADER_ROW + 1 + hits[0];
}

function checkExpected_(current, expected) {
  if (!expected) return;
  for (var k in expected) {
    var cur = current[Number(k)], exp = expected[k];
    if (String(cur == null ? '' : cur) !== String(exp == null ? '' : exp)) {
      var e = err_('conflict', 'Bu kayıt siz düzenlerken başka biri tarafından değiştirildi.');
      e.current = current;
      throw e;
    }
  }
}

/** Mevcut kimliklerden (F001, F598 …) bir sonrakini üretir. */
function nextId_(ids) {
  var prefix = null, width = 0, max = 0;
  ids.forEach(function (raw) {
    var m = /^([A-Za-zÇĞİÖŞÜçğıöşü_-]*)(\d+)$/.exec(String(raw).trim());
    if (!m) return;
    if (prefix === null) prefix = m[1];
    if (m[1] !== prefix) return;
    width = Math.max(width, m[2].length);
    max = Math.max(max, Number(m[2]));
  });
  if (prefix === null) return null;
  var n = String(max + 1);
  while (n.length < width) n = '0' + n;
  return prefix + n;
}

function log_(editor, action, sheet, id, before, after) {
  var ss = ss_();
  var sh = ss.getSheetByName(LOG_SHEET);
  if (!sh) {
    sh = ss.insertSheet(LOG_SHEET);
    sh.appendRow(['Zaman', 'Düzenleyen', 'İşlem', 'Sayfa', 'Kimlik', 'Önce (JSON)', 'Sonra (JSON)']);
    sh.setFrozenRows(1);
  }
  sh.appendRow([new Date(), editor, action, sheet, id,
    before ? JSON.stringify(before) : '', after ? JSON.stringify(after) : '']);
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) throw err_('busy', 'Sunucu meşgul, tekrar deneyin.');
  try { return fn(); } finally { lock.releaseLock(); }
}

/**
 * Panelden gelen değeri hücreye uygun hale getirir.
 *  - "=" ile başlayan metin formül olarak çalışmasın.
 *  - Noktalı ondalık (41.009993) SAYI olarak yazılır: Türkçe yerel ayarlı tabloda metin
 *    olarak yazılırsa nokta binlik ayırıcı sayılıp koordinat bozulabilir.
 */
function cell_(v) {
  v = v == null ? '' : String(v).trim();
  if (/^-?\d+\.\d+$/.test(v)) return Number(v);
  return v.charAt(0) === '=' ? "'" + v : v;
}

function err_(code, message) { var e = new Error(message); e.code = code; return e; }

/**
 * Panele kişi ekler: AD'ı değiştirip editörde çalıştır. Anahtar üretilir, PANEL_TOKENS'a
 * eklenir ve Günlük'e yazılır; kişiye bu anahtarı ilet. Aynı ad varsa anahtarı yenilenir.
 */
function anahtarEkle() {
  var AD = 'ad soyad';   // ← buraya kişinin adını yaz
  var props = PropertiesService.getScriptProperties();
  var map = JSON.parse(props.getProperty('PANEL_TOKENS') || '{}');
  map[AD] = yeniAnahtar();
  props.setProperty('PANEL_TOKENS', JSON.stringify(map));
  Logger.log(AD + ' için anahtar: ' + map[AD]);
}

/** Panelden kişi çıkarır: AD'ı yazıp çalıştır. */
function anahtarSil() {
  var AD = 'ad soyad';   // ← buraya kişinin adını yaz
  var props = PropertiesService.getScriptProperties();
  var map = JSON.parse(props.getProperty('PANEL_TOKENS') || '{}');
  delete map[AD];
  props.setProperty('PANEL_TOKENS', JSON.stringify(map));
  Logger.log('Kalan kişiler: ' + Object.keys(map).join(', '));
}

/** Yeni bir panel anahtarı üretir. */
function yeniAnahtar() {
  var t = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '').slice(0, 8);
  Logger.log(t);
  return t;
}
