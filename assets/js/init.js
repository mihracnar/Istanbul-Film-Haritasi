/* ════════════════════════════════════════════════════════════
   init.js — MapLibre Edition
   - eUpdateLabelVisibility kaldırıldı (MapLibre native collision)
   - attachMapRedraw sadeleştirildi
   ════════════════════════════════════════════════════════════ */

function attachMapRedraw(theme, m){
  // Pan/zoom sırasında bağlantı çizgilerini güncelle
  // (target nokta screen-space'de kayıyor → yeni geo hesap gerekir)
  m.on('move', ()=>{
    liveUpdateConn(theme);
  });

  // Label collision detection — MapLibre native, JS guard gerekmez
  // Zoom animasyonu bitişi yok artık — MapLibre kendi yönetiyor
}

function eShowLoading(msg){
  let el = document.getElementById('eLoadingMsg');
  if(!el){
    el = document.createElement('div');
    el.id = 'eLoadingMsg';
    el.style.cssText = [
      'position:fixed', 'top:50%', 'left:50%',
      'transform:translate(-50%,-50%)',
      'background:#fff', 'border:2px solid #000',
      'padding:20px 32px',
      "font-family:'DM Mono',monospace",
      'font-size:13px', 'z-index:9999', 'letter-spacing:1px'
    ].join(';');
    document.body.appendChild(el);
  }
  el.textContent = msg;
}

function eHideLoading(){
  const el = document.getElementById('eLoadingMsg');
  if(el) el.remove();
}

async function initApp(){
  eShowLoading('VERİ YÜKLENİYOR...');
  try {
    await loadSheetsData();
    console.log(`Yüklendi: ${FILMS.length} film, ${LOCS.length} mekan`);
  } catch(e){
    console.error('initApp hata:', e);
  }
  eHideLoading();
  buildE();
  setTimeout(()=>{
    createMap('mapE', 'E');
    document.getElementById('preview').dataset.theme = 'E';
    // inited.E, map.js içinde m.on('load') callback'inde true yapılır
  }, 80);
}

initApp();

// Resize'da bağlantı çizgilerini temizle
window.addEventListener('resize', ()=>{ clearConnLines(); });

// Film paneli scroll'unda bağlantı çizgilerini güncelle
window.addEventListener('scroll', e=>{
  if(e.target && e.target.id === 'eFilms'){
    requestAnimationFrame(()=>liveUpdateConn('E'));
  }
}, true);

// Panel scroll event'lerini dinle
const PANEL_SCROLL_MAP = { eLocs:'E', eFilms:'E' };
Object.entries(PANEL_SCROLL_MAP).forEach(([elId, theme])=>{
  const el = document.getElementById(elId);
  if(el) el.addEventListener('scroll', ()=>requestAnimationFrame(()=>liveUpdateConn(theme)));
});