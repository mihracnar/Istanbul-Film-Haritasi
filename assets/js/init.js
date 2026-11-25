/* ════════════════════════════════════════════════════════════
   init.js — MapLibre Edition
   - eUpdateLabelVisibility kaldırıldı (MapLibre native collision)
   - attachMapRedraw sadeleştirildi
   ════════════════════════════════════════════════════════════ */

function attachMapRedraw(theme, m){
  // Label collision detection — MapLibre native, JS guard gerekmez
  // Zoom animasyonu bitişi yok artık — MapLibre kendi yönetiyor
}

function eShowLoading(msg){
  const screen = document.getElementById('eLoadingScreen');
  const msgEl  = document.getElementById('elsMsg');
  if(screen) screen.classList.remove('hide');
  if(msgEl && msg) msgEl.textContent = msg;
}

function eHideLoading(){
  const bar = document.getElementById('elsBarInner');
  if(bar) bar.style.width = '100%';
  // Bar doldu → loader solar, buton aktifleşir + cursor belirir
  setTimeout(()=>{
    const loader = document.getElementById('elsLoader');
    const btn    = document.getElementById('elsRecBtn');
    if(loader) loader.style.opacity = '0';
    if(btn){
      btn.disabled = false;
      btn.classList.add('ready');
    }
  }, 500);
}

function elsSplashClose(){
  const s = document.getElementById('eLoadingScreen');
  if(s){ s.classList.add('hide'); setTimeout(()=>{ if(s.parentNode) s.parentNode.removeChild(s); }, 500); }
}

// Bar ilerlemesi — yükleme adımlarını yansıt
function eLoadingProgress(pct, msg){
  const bar   = document.querySelector('.els-bar-inner');
  const msgEl = document.getElementById('elsMsg');
  if(bar)   bar.style.width = pct + '%';
  if(msgEl && msg) msgEl.textContent = msg;
}

async function initApp(){
  eShowLoading();
  try {
    eLoadingProgress(15, 'Filmler ve mekanlar…');
    await loadSheetsData();
    eLoadingProgress(60, 'Görseller hazırlanıyor…');
    await loadGorseller();  // Görseller sheet — gorselMap'i doldur
    eLoadingProgress(90, 'Harita kuruluyor…');
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

// Resize'da köken seçici göstergesini yeniden konumla
window.addEventListener('resize', ()=>{
  const onBtn = document.querySelector('#eOriginChips .e-origin-seg.on');
  if(onBtn) _eOriginIndicatorMove(onBtn);
});
