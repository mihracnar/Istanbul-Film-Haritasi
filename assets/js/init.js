function attachMapRedraw(theme, m){
  let redrawTimer;
  m.on('move zoom', ()=>{
    liveUpdateConn(theme);
    clearTimeout(redrawTimer);
    redrawTimer = setTimeout(()=> liveUpdateConn(theme), 80);
  });
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