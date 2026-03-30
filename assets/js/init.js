function attachMapRedraw(theme, m){
  let redrawTimer;
  let isZooming = false;
  let zoomEndTimer;

  m.on('zoomstart', ()=>{
    isZooming = true;
    // Zoom başlayınca labellara transition ekle, görünmeyecekler
    if(theme === 'E'){
      document.querySelectorAll('#mapE .pin-label').forEach(el=>{
        el.style.transition = 'opacity .35s ease';
      });
    }
  });

  m.on('zoomend', ()=>{
    clearTimeout(zoomEndTimer);
    zoomEndTimer = setTimeout(()=>{
      isZooming = false;
      if(theme === 'E') eUpdateLabelVisibility();
    }, 80); // zoom animasyonu bitince
  });

  m.on('move', ()=>{
    liveUpdateConn(theme);
    if(!isZooming){
      clearTimeout(redrawTimer);
      redrawTimer = setTimeout(()=>{
        liveUpdateConn(theme);
        if(theme === 'E') eUpdateLabelVisibility();
      }, 120);
    }
  });

  if(theme === 'E') setTimeout(eUpdateLabelVisibility, 400);
}

function eShowLoading(msg) {
  let el = document.getElementById('eLoadingMsg');
  if (!el) {
    el = document.createElement('div');
    el.id = 'eLoadingMsg';
    el.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#fff;border:2px solid #000;padding:20px 32px;font-family:"DM Mono",monospace;font-size:13px;z-index:9999;letter-spacing:1px';
    document.body.appendChild(el);
  }
  el.textContent = msg;
}

function eHideLoading() {
  const el = document.getElementById('eLoadingMsg');
  if (el) el.remove();
}

async function initApp() {
  eShowLoading('VERİ YÜKLENİYOR...');
  try {
    await loadSheetsData();
    console.log(`Yüklendi: ${FILMS.length} film, ${LOCS.length} mekan`);
  } catch(e) {
    console.error('initApp hata:', e);
  }
  eHideLoading();
  buildE();
  setTimeout(()=>{
    inited.E = true;
    createMap('mapE','E');
    document.getElementById('preview').dataset.theme = 'E';
  }, 80);
}

initApp();

window.addEventListener('resize', ()=>{ clearConnLines(); });

window.addEventListener('scroll', e=>{
  if(e.target && e.target.id === 'eFilms') {
    requestAnimationFrame(()=> liveUpdateConn('E'));
  }
}, true);

const PANEL_SCROLL_MAP = {
  eLocs:'E', eFilms:'E',
};
Object.entries(PANEL_SCROLL_MAP).forEach(([elId, theme])=>{
  const el = document.getElementById(elId);
  if(el) el.addEventListener('scroll', ()=> requestAnimationFrame(()=> liveUpdateConn(theme)));
});