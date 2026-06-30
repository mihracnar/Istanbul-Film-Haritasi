/* ════════════════════════════════════════════════════════════
   İSTANBUL FİLM MEKANLARI HARİTASI — map.js  (MapLibre Hybrid)
   Base map: MapLibre GL JS (WebGL tiles)
   Pins:     maplibregl.Marker + HTML (orijinal tasarım)
   Conn:     SVG overlay (#conn-svg)
   Highlight: DOM manipulation
   Port notu: Leaflet latLngToContainerPoint → MapLibre project([lng,lat])
   ════════════════════════════════════════════════════════════ */

const IST_CENTER = [28.9784, 41.0082]; // [lng, lat]

/* ── Drag guard ── */
const _dragGuard = { x:0, y:0, dragging:false };
document.addEventListener('mousedown', e=>{ _dragGuard.x=e.clientX; _dragGuard.y=e.clientY; _dragGuard.dragging=false; });
document.addEventListener('touchstart', e=>{ const t=e.touches[0]; _dragGuard.x=t.clientX; _dragGuard.y=t.clientY; _dragGuard.dragging=false; }, {passive:true});
document.addEventListener('mousemove', e=>{
  if(Math.abs(e.clientX-_dragGuard.x)>6 || Math.abs(e.clientY-_dragGuard.y)>6) _dragGuard.dragging=true;
});
function _wasDragged(){ return _dragGuard.dragging; }

const maps    = {};
const markers = {};
const inited  = { E:false };
const hlLayers = {};
const selLayers = {};
let activeConns = {};
// Pin seçim takibi
const _selPinIds = new Set();
let _currentVisFilter = null;


let currentFilm = null;
let eActiveLoc  = null;
let _mPrevSheet = null;
let _mPrevLoc   = null;

let eActiveGenre  = '';
let eActiveDir    = '';
let eActiveLocCat = '';
let eActiveDecade = 0;
let eActiveYabanci = ''; // '' = tümü, false = yerli, true = yabancı

/* ══════════════════════════════════════════════
   MEDIA PANEL
══════════════════════════════════════════════ */
function stillUrl(seed, w, h){ return `https://picsum.photos/seed/${seed}/${w}/${h}`; }

async function openMedia(filmId){
  const f = FILM_MAP[filmId]; if(!f) return;
  currentFilm = f;
  if(eActiveLocCat){ eActiveLocCat=''; document.querySelectorAll('.e-loc-cat-chip').forEach(b=>b.classList.remove('on')); eFilterMapMarkers(); }
  document.getElementById('mpTitle').innerHTML = f.title + filmOrigTitleHTML(f, 'mp-orig-title');
  document.getElementById('mpMeta').textContent = `${f.year}  ·  ${f.dir}  ·  ${f.genre}`;
  document.getElementById('mpHeroLabel').textContent = `${f.year} / ${f.dir.toUpperCase()}`;
  const heroEl = document.getElementById('mpHero');
  heroEl.src=''; heroEl.style.opacity='0.3';
  document.getElementById('mpDesc').textContent='Yükleniyor...';
  document.getElementById('mpThumbs').innerHTML='';
  const filmLocs = LOCS.filter(l=>f.locs.includes(l.id));
  if (filmLocs.length !== f.locs.length) {
    const missing = f.locs.filter(id => !LOCS.some(l => l.id === id));
    console.warn(`[map] F${f.id} "${f.title}" — ${missing.length} loc id LOCS'ta yok:`, missing);
  }
  if (window.DEBUG_CLICK) console.log(`[map] openMedia F${f.id} "${f.title}" → ${filmLocs.length} chip`);
  document.getElementById('mpLocs').innerHTML = filmLocs.map(l=>
    `<button class="mp-loc-chip" onclick="mpGoLoc(${l.id})">${l.name}</button>`).join('');
  document.getElementById('mp').classList.add('open');
  if(window.innerWidth<=640){
    const _sb=document.querySelector('#cE .e-sb'), _fp=document.querySelector('#cE .e-fp');
    _mPrevSheet=_fp?.classList.contains('m-open')?'filmler':_sb?.classList.contains('m-open')?'mekanlar':null;
    _mPrevLoc=eActiveLoc;
    document.getElementById('mSheetBackdrop')?.classList.remove('on');
    _sb?.classList.remove('m-open'); _fp?.classList.remove('m-open');
    document.querySelectorAll('.m-tab').forEach(b=>b.classList.remove('active'));
    document.getElementById('mTabHarita')?.classList.add('active');
  }
  document.querySelector('#cE .e-fp').style.visibility='hidden';
  eOpenDecadesForFilms([filmId]);
  const bar=document.getElementById('eLocBar'); if(bar) bar.style.display='none';
  clearConnLines();
  if(window._connTimer){ clearTimeout(window._connTimer); window._connTimer=null; }
  if(window._connMoveEnd && maps['E']){ maps['E'].off('moveend',window._connMoveEnd); window._connMoveEnd=null; }
  clearSelLayers(); highlightFilmOnMap('E',filmId);
  const gorsel = getGorsellerForFilm(f.title);
  document.getElementById('mpDesc').textContent = f.desc || '—';
  if(gorsel){
    const heroSrc = gorsel.backdrop || (gorsel.stills&&gorsel.stills[0]);
    if(heroSrc){ heroEl.src=heroSrc; heroEl.style.opacity='1'; heroEl.style.filter=''; }
    const thumbs = document.getElementById('mpThumbs');
    thumbs.innerHTML = gorsel.stills.map((url,i)=>`<img class="mp-thumb${i===0?' sel':''}" src="${url}" onclick="mpSelectStillUrl('${url}',this,${i})" alt="Sahne ${i+1}">`).join('');
    if(heroSrc) heroEl.onclick = null;
  } else {
    heroEl.src = ''; heroEl.style.opacity='0.3';
    document.getElementById('mpThumbs').innerHTML = '';
  }
}
function mpOpenLightbox(startIdx){
  if(!currentFilm) return;
  const gorselLb = getGorsellerForFilm(currentFilm.title);
  gLbItems = gorselLb?.stills?.length
    ? gorselLb.stills.map(url=>({url,filmTitle:currentFilm.title,year:currentFilm.year,filmId:currentFilm.id}))
    : [];
  gLbCur=startIdx??0; gLbShow(); document.getElementById('gLightbox').classList.add('open'); document.addEventListener('keydown',gLbKey);
}
function mpSelectStillUrl(url,imgEl,idx){ document.getElementById('mpHero').src=url; document.querySelectorAll('.mp-thumb').forEach(el=>el.classList.remove('sel')); if(imgEl) imgEl.classList.add('sel'); mpOpenLightbox(idx??0); }
function mpSelectStill(idx,filmId){ const f=FILM_MAP[filmId]; document.getElementById('mpHero').src=stillUrl(f.stills[idx],640,360); document.querySelectorAll('.mp-thumb').forEach((el,i)=>el.classList.toggle('sel',i===idx)); }
function mpGoLoc(locId){
  const loc=LOC_MAP[locId];
  if(!loc) { console.warn(`[map] mpGoLoc: M${locId} LOC_MAP'te yok`); return; }
  if (window.DEBUG_CLICK) console.log(`[map] mpGoLoc M${locId} "${loc.name}"`);
  if(window.innerWidth<=640){
    _mPrevSheet=null; closeMedia(); eSelectLoc(locId);
    if(window.mSetTab) window.mSetTab('harita',document.getElementById('mTabHarita'));
  } else {
    if (window.DEBUG_FLY) console.log(`[map] flyTo M${locId} z=15`);
    maps['E']?.flyTo({center:[loc.lng,loc.lat],zoom:15,duration:500,padding:_eMapOverlayPadding()});
  }
}
function closeMedia(){
  if (window.DEBUG_CLICK) console.log(`[ui] closeMedia${currentFilm ? ` (was F${currentFilm.id})` : ''}`);
  document.getElementById('mp').classList.remove('open');
  const fp=document.querySelector('#cE .e-fp'); if(fp) fp.style.visibility='';
  if(window._connTimer){ clearTimeout(window._connTimer); window._connTimer=null; }
  if(window._connMoveEnd && maps['E']){ maps['E'].off('moveend',window._connMoveEnd); window._connMoveEnd=null; }
  clearHighlights(); clearSelLayers(); clearConnLines();
  if(window.innerWidth<=640){
    if(_mPrevLoc){ eActiveLoc=_mPrevLoc; ePinHighlight(_mPrevLoc,true); _mPrevLoc=null; }
    if(_mPrevSheet&&window.mSetTab){ const tabId=_mPrevSheet==='filmler'?'mTabFilmler':'mTabMekanlar'; window.mSetTab(_mPrevSheet,document.getElementById(tabId)); _mPrevSheet=null; }
  }
}

/* ══════════════════════════════════════════════
   LOC GALLERY
══════════════════════════════════════════════ */
let gLbItems=[]; let gLbCur=0;
function buildLocGallerySkeleton(loc,theme){
  const isDark = document.getElementById('cE')?.classList.contains('renkli');
  const accentLabel={A:'#c8a252',B:'#d42b1e',D:'#c47c1e',E: isDark ? '#f03010' : '#111'}[theme];
  const nameColor = isDark ? '#F7F7F7' : '#111';
  const typeFont=theme==='E'?"font-family:'DM Mono',monospace;font-size:8px;":'';
  const skeletons=loc.films.map(()=>`<div class="loc-gallery-item loc-gallery-skeleton"></div>`).join('');
  const kayipBadge = loc.kayip
    ? `<span class="loc-gallery-kayip-badge" style="font-size:7px;letter-spacing:1.5px;text-transform:uppercase;color:#fff;background:#8a8a8a;padding:2px 7px;border-radius:2px;font-family:'DM Mono',monospace;white-space:nowrap;">Kayıp Eser</span>`
    : '';
  const headHTML=`<span style="font-size:7px;color:${accentLabel};letter-spacing:2px;text-transform:uppercase;${typeFont}">${loc.cat||loc.type}</span><span style="font-size:${theme==='E'?'16':'15'}px;color:${nameColor};${theme==='D'?'font-style:italic;':''}">${loc.name}</span>${kayipBadge}<span style="font-size:8px;color:#aaa;font-family:'DM Mono',monospace">${loc.ilce}</span><span class="loc-gallery-count" style="font-size:8px;color:${accentLabel};font-family:'DM Mono',monospace;margin-left:4px">…</span><button class="loc-gallery-close" onclick="closeGalleryBar('${theme}')">×</button>`;
  return `<div class="loc-gallery-head">${headHTML}</div><div class="loc-gallery-scroll" id="locGalleryScroll-${theme}">${skeletons}</div>`;
}
async function fillLocGallery(locId,theme){
  const loc=LOC_MAP[locId]; if(!loc) return;
  const scrollEl=document.getElementById('locGalleryScroll-'+theme); if(!scrollEl) return;
  const films=loc.films.map(fid=>FILM_MAP[fid]).filter(Boolean);
  gLbItems = [];
  const itemsHTML = films.flatMap(f => {
    const gorsel = getGorsellerForFilm(f.title);
    const urls = gorsel?.stills?.length ? gorsel.stills : [];
    if(!urls.length) return [];
    return urls.map(url => {
      const idx = gLbItems.length;
      gLbItems.push({url, filmTitle:f.title, year:f.year, filmId:f.id});
      return `<div class="loc-gallery-item" onclick="openGLb(${idx})"><img src="${url}" loading="lazy" alt="${f.title}"><div class="loc-gallery-caption">${f.title}</div></div>`;
    });
  }).join('');
  scrollEl.innerHTML=itemsHTML;
  const countEl=scrollEl.closest('.loc-gallery-bar,[id^="e"],[id^="a"],[id^="b"],[id^="d"]')?.querySelector('.loc-gallery-count');
  if(countEl) countEl.textContent=gLbItems.length+' görsel';
}

function closeGalleryBar(theme){
  const bars={A:'aIP',B:'bLocBar',D:'dIP',E:'eLocBar'};
  const el=document.getElementById(bars[theme]);
  if(el) el.style.display='none';
  if(theme==='E') requestAnimationFrame(()=>maps.E?.resize());
  clearSelLayers();
  clearConnLines();
  document.querySelectorAll(`#c${theme} .fl,#c${theme} .rp-film,#c${theme} .o-fl,#c${theme} .e-film-row`).forEach(e=>e.classList.remove('on'));
  // Mekan filtresini temizle
  eActiveLoc = null;
  const lb = document.getElementById('eLocBadge');
  if(lb) lb.style.display = 'none';
  eRenderFilms();
  eUpdateCounts();
}

function openGLb(idx){ gLbCur=idx; gLbShow(); document.getElementById('gLightbox').classList.add('open'); document.addEventListener('keydown',gLbKey); }
function closeGLb(){ document.getElementById('gLightbox').classList.remove('open'); document.removeEventListener('keydown',gLbKey); }
function gLbClose(e){ if(e.target===document.getElementById('gLightbox')) closeGLb(); }
function gLbNav(dir){ gLbCur=(gLbCur+dir+gLbItems.length)%gLbItems.length; gLbShow(); }
function gLbShow(){ const item=gLbItems[gLbCur]; if(!item) return; document.getElementById('gLbImg').src=item.url||stillUrl(item.seed,900,506); document.getElementById('gLbFilm').textContent=item.filmTitle; document.getElementById('gLbCaption').textContent=`${item.year}  ·  ${gLbCur+1} / ${gLbItems.length}`; }
function gLbKey(e){ if(e.key==='ArrowRight') gLbNav(1); if(e.key==='ArrowLeft') gLbNav(-1); if(e.key==='Escape') closeGLb(); }

function selectLoc(theme,id){
  if(theme==='E'){
    eSelectLoc(id);
    if(window.innerWidth<=640&&window.mSetTab){
      window.mSetTab('filmler',document.getElementById('mTabFilmler'));
    }
  }
}



/* ══════════════════════════════════════════════
   MAP YARATMA — MapLibre GL JS
   Pins: Symbol Layer (text-background-color, MapLibre 3.3+)
   Conn: GeoJSON LineLayer — panel koordinatı map-container-relative
   ══════════════════════════════════════════════ */
function _isMapReady(m){ return m && inited.E && !!m.getSource('locs'); }

/* ══════════════════════════════════════════════
   ÖRTÜŞEN UI ALANLARI — gerçek zamanlı padding ölçümü
   Arama kutusu (üst) ve açıksa galeri barı (alt) haritayı
   görsel olarak kaplıyor ama konteyner boyutunu değiştirmiyor.
   fitBounds/flyTo bu yüzden gerçek padding'i DOM'dan ölçer.
══════════════════════════════════════════════ */
function _eMapOverlayPadding(){
  const mapEl = document.getElementById('mapE');
  if(!mapEl) return { top:60, bottom:60, left:50, right:50 };
  const mapRect = mapEl.getBoundingClientRect();

  let top = 24;
  const searchWrap = document.getElementById('eSearchWrap');
  if(searchWrap){
    const r = searchWrap.getBoundingClientRect();
    if(r.height > 0) top = Math.max(top, (r.bottom - mapRect.top) + 16);
  }

  let bottom = 24;
  const locBar = document.getElementById('eLocBar');
  if(locBar && locBar.style.display === 'flex'){
    const r = locBar.getBoundingClientRect();
    if(r.height > 0) bottom = Math.max(bottom, (mapRect.bottom - r.top) + 16);
  }

  return { top, bottom, left:40, right:40 };
}

function createMap(id, theme){
  if(theme !== 'E') return;

  const m = new maplibregl.Map({
    container:          id,
    style:              'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
    center:             IST_CENTER,
    zoom:               12,
    minZoom:            9,
    maxZoom:            19,
    attributionControl: false,
    doubleClickZoom:    false,
  });

  m.addControl(new maplibregl.NavigationControl({ showCompass:false }), 'top-right');
  m.addControl(new maplibregl.AttributionControl({ compact:true }), 'bottom-right');
  maps[theme] = m;

  m.on('load', () => {
    const _t = performance.now();
    _setupEMapSources(m);
    _setupEMapLayers(m);
    _setupEMapEvents(m, theme);
    attachMapRedraw(theme, m);
    inited.E = true;
    console.log(`[map] hazır — ${LOCS.length} pin (${(performance.now()-_t).toFixed(0)}ms setup)`);
  });

  m.on('error', e => console.warn('MapLibre hata:', e.error?.message || e));
}

function _setupEMapSources(m){
  const locFeatures = LOCS.map(loc => ({
    type:       'Feature',
    id:          loc.id,
    properties: { id: loc.id, name: loc.name, filmCount: loc.films.length, kayip: !!loc.kayip },
    geometry:   { type: 'Point', coordinates: [loc.lng, loc.lat] }
  }));
  m.addSource('locs', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: locFeatures }
  });

  m.addSource('conn-lines', {
    type: 'geojson',
    data: { type:'FeatureCollection', features:[] }
  });
  m.addSource('conn-dots', {
    type: 'geojson',
    data: { type:'FeatureCollection', features:[] }
  });

}

function _setupEMapLayers(m){
  // 1. Bağlantı çizgileri — GeoJSON LineLayer
  m.addLayer({
    id:'conn-lines-layer', type:'line', source:'conn-lines',
    paint:{
      'line-color':'#f03010',
      'line-width': 1.5,
      'line-opacity': 0.6,
      'line-dasharray':[5,4],
    }
  });
  // 2. Bağlantı uç noktaları
  m.addLayer({
    id:'conn-dots-layer', type:'circle', source:'conn-dots',
    paint:{
      'circle-radius': 2.5,
      'circle-color': '#f03010',
      'circle-opacity': 0.7,
    }
  });
  // 3. Pin nokta
  m.addLayer({
    id: 'locs-dots', type: 'circle', source: 'locs',
    paint: {
      'circle-radius': 3,
      'circle-color': ['case', ['get','kayip'], '#999999', '#000000'],
      'circle-opacity': ['case', ['get','kayip'], 0.55, 0.90],
      'circle-stroke-width': ['case', ['get','kayip'], 1, 0],
      'circle-stroke-color': '#999999',
    }
  });

  // 4. Pin label
  const _sz = 32, _px = new Uint8Array(_sz*_sz*4).fill(255);
  m.addImage('lbl-bg', { width:_sz, height:_sz, data:_px }, { sdf:true });

  const _BASE = {
    'icon-image': 'lbl-bg', 'icon-text-fit': 'both',
    'icon-text-fit-padding': [4, 9, 4, 5],
    'text-font': ['Open Sans Bold','Arial Unicode MS Bold'],
    'text-size': 10, 'text-max-width': 9, 'text-line-height': 1.3,
    'text-anchor': 'bottom', 'text-offset': [0, -0.65], 'text-padding': 3,
  };

  m.addLayer({
    id: 'locs-labels', type: 'symbol', source: 'locs',
    layout: Object.assign({}, _BASE, {
      'text-field': ['format',
        ['case',['get','kayip'],'⊘ ','• '], { 'font-scale':0.85, 'text-color': ['case',['get','kayip'],'#999999','#f03010'] },
        ['get','name'], {},
        ' ×', { 'font-scale':0.78, 'text-color':'rgba(255,255,255,0.5)' },
        ['to-string',['get','filmCount']], { 'font-scale':0.78, 'text-color':'rgba(255,255,255,0.5)' }
      ],
      'text-allow-overlap': false, 'icon-allow-overlap': false,
      'text-ignore-placement': false, 'icon-ignore-placement': false,
      'text-optional': true, 'symbol-avoid-edges': true,
    }),
    paint: {
      'text-color': '#ffffff',
      'icon-color': ['case', ['get','kayip'], 'rgba(90,90,90,0.85)', 'rgba(0,0,0,0.88)'],
      'icon-opacity': ['case',['boolean',['feature-state','selected'],false], 0, 1],
      'text-opacity': ['case',['boolean',['feature-state','selected'],false], 0, 1],
    }
  });

  m.addSource('locs-sel', { type:'geojson', data:{type:'FeatureCollection',features:[]} });
  m.addLayer({
    id: 'locs-labels-sel', type: 'symbol', source: 'locs-sel',
    layout: Object.assign({}, _BASE, {
      'text-field': ['format',
        ['case',['get','kayip'],'⊘ ','• '], { 'font-scale':0.85, 'text-color':'rgba(255,255,255,0.75)' },
        ['get','name'], {},
        ' ×', { 'font-scale':0.78, 'text-color':'rgba(255,255,255,0.5)' },
        ['to-string',['get','filmCount']], { 'font-scale':0.78, 'text-color':'rgba(255,255,255,0.5)' }
      ],
      'text-allow-overlap': true, 'icon-allow-overlap': true,
      'text-ignore-placement': true, 'icon-ignore-placement': true,
      'text-optional': false, 'symbol-avoid-edges': false,
    }),
    paint: { 'text-color':'#ffffff', 'icon-color':'rgba(240,48,16,0.92)', 'icon-opacity':1 }
  });

}

function _resetAllFilters(m){
  if (window.DEBUG_CLICK) console.log('[map] boş alan tıklandı — sıfırla');
  if(window._connTimer){ clearTimeout(window._connTimer); window._connTimer=null; }
  clearConnLines();
  if(document.getElementById('mp').classList.contains('open')) closeMedia();
  const locBar = document.getElementById('eLocBar');
  if(locBar) { locBar.style.display='none'; locBar.innerHTML=''; }
  _currentVisFilter = null;
  ePinsResetAll();
  try { m.setFilter('locs-labels', null); m.setFilter('locs-dots', null); } catch(ex){}
  eOpenDecades.clear();
  const firstGrp = document.querySelector('.e-decade-group');
  if(firstGrp){
    const d = firstGrp.dataset.decade;
    eOpenDecades.add(String(d));
    firstGrp.querySelector('.e-decade-hdr-arr').className = 'e-decade-hdr-arr open';
    firstGrp.querySelector('.e-decade-body').className   = 'e-decade-body open';
    document.querySelectorAll('.e-decade-group:not(:first-child) .e-decade-hdr-arr').forEach(el => el.className='e-decade-hdr-arr');
    document.querySelectorAll('.e-decade-group:not(:first-child) .e-decade-body').forEach(el => el.className='e-decade-body closed');
  }
  eActiveLoc = null; clearSelLayers();
  document.querySelectorAll('#cE .e-loc-row,#cE .e-film-row').forEach(el => el.classList.remove('on'));
  // Filtre nedeniyle soluklaşmış mekan satırlarını sıfırla
  document.querySelectorAll('#cE .e-loc-row').forEach(el => { el.style.opacity = ''; });
  // Mekan badge temizle
  const lb = document.getElementById('eLocBadge');
  if(lb) lb.style.display = 'none';
  // Yerli/Yabancı filtresini sıfırla
  eActiveYabanci = '';
  document.querySelectorAll('#eOriginChips .e-origin-seg').forEach(b=>b.classList.remove('on'));
  const originAllBtn = document.querySelector('#eOriginChips .e-origin-seg[data-val=""]');
  if(originAllBtn){ originAllBtn.classList.add('on'); _eOriginIndicatorMove(originAllBtn); }
  // Tür filtresini sıfırla
  eActiveGenre = '';
  document.querySelectorAll('#eGenreChips .e-genre-chip-inner').forEach(b=>b.classList.remove('on'));
  document.querySelector('#eGenreChips .e-genre-chip-inner:first-child')?.classList.add('on');
  // Onyıl filtresini sıfırla
  eActiveDecade = 0;
  document.querySelectorAll('.e-decade-seg').forEach(b=>b.classList.toggle('on', b.dataset.decade===undefined));
  // Yönetmen filtresini sıfırla
  eActiveDir = '';
  const dirBadge = document.getElementById('eDirBadge');
  if(dirBadge) dirBadge.style.display = 'none';
  eRenderFilms(); eUpdateCounts();
  m.flyTo({ center: IST_CENTER, zoom: 12, duration: 800 });
}

function _setupEMapEvents(m, theme){
  ['locs-labels', 'locs-labels-sel', 'locs-dots'].forEach(layer => {
    m.on('click', layer, e => {
      if(_wasDragged()) return;
      e.preventDefault();
      const id = e.features[0].properties.id;
      if (window.DEBUG_CLICK) {
        const loc = LOC_MAP[id];
        console.log(`[map] pin tıklandı (${layer}) M${id} ${loc ? `"${loc.name}"` : "(LOC_MAP'te yok!)"}`);
      }
      selectLoc(theme, id);
    });
    m.on('mouseenter', layer, () => { m.getCanvas().style.cursor = 'pointer'; });
    m.on('mouseleave', layer, () => { m.getCanvas().style.cursor = ''; });
  });

  // Tek tıkla boş alana sıfırla (pin tıklamalarını hariç tut)
  m.on('click', e => {
    if(_wasDragged()) return;
    const hit = m.queryRenderedFeatures(e.point, {
      layers: ['locs-dots', 'locs-labels', 'locs-labels-sel']
    });
    if(hit.length > 0) return; // pin tıklandı
    _resetAllFilters(m);
  });
}

/* ══════════════════════════════════════════════
   PIN HIGHLIGHT — feature-state
══════════════════════════════════════════════ */
function _syncSelSource(){
  const m = maps['E']; if(!m || !_isMapReady(m)) return;
  const ids = [..._selPinIds];

  const feats = ids.map(id=>{
    const l = LOC_MAP[id]; if(!l) return null;
    return { type:'Feature', id:l.id,
      properties:{id:l.id, name:l.name, filmCount:l.films.length, kayip:!!l.kayip},
      geometry:{type:'Point', coordinates:[l.lng, l.lat]} };
  }).filter(Boolean);
  try { m.getSource('locs-sel').setData({type:'FeatureCollection', features:feats}); } catch(e){}

  const visF = _currentVisFilter;
  if(ids.length > 0){
    const notSelF = ['!', ['match',['get','id'], ids, true, false]];
    const f = visF ? ['all', visF, notSelF] : notSelF;
    try { m.setFilter('locs-labels', f); } catch(e){}
  } else {
    try { m.setFilter('locs-labels', visF); } catch(e){}
  }

  LOCS.forEach(l=>{
    try { m.setFeatureState({source:'locs',id:l.id},{selected:_selPinIds.has(l.id)}); } catch(e){}
  });
}

function ePinsResetAll(){
  _selPinIds.clear();
  _syncSelSource();
}

function ePinHighlight(locId, on, _retry){
  const m = maps['E'];
  if(!m || !_isMapReady(m)){ if(!_retry) setTimeout(()=>ePinHighlight(locId,on,true),150); return; }
  if(on) _selPinIds.add(locId); else _selPinIds.delete(locId);
  _syncSelSource();
}

/* ══════════════════════════════════════════════
   FILTER MAP MARKERS — layer filter
══════════════════════════════════════════════ */
function eFilterMapMarkers(){
  const m = maps['E']; if(!m || !_isMapReady(m)) return;

  const filteredFilms = FILMS.filter(f =>
    (!eActiveGenre  || f.genre === eActiveGenre)  &&
    (!eActiveDir    || f.dir   === eActiveDir)     &&
    (!eActiveDecade || Math.floor(f.year/10)*10 === eActiveDecade) &&
    (eActiveYabanci === '' || f.yabanci === eActiveYabanci)
  );
  const filteredLocIds = new Set(filteredFilms.flatMap(f => f.locs));
  const visibleLocs = LOCS.filter(loc => {
    const catOk  = !eActiveLocCat || loc.cat === eActiveLocCat;
    const filmOk = filteredLocIds.has(loc.id);
    return catOk && filmOk;
  });

  if (window.DEBUG_FILTER) {
    const fs = [];
    if (eActiveGenre)   fs.push(`tür="${eActiveGenre}"`);
    if (eActiveDir)     fs.push(`yön="${eActiveDir}"`);
    if (eActiveDecade)  fs.push(`onyıl=${eActiveDecade}`);
    if (eActiveLocCat)  fs.push(`mekan="${eActiveLocCat}"`);
    if (eActiveYabanci !== '') fs.push(`köken=${eActiveYabanci ? 'yabancı' : 'yerli'}`);
    const filterStr = fs.length ? fs.join(' ') : 'YOK';
    console.log(`[filtre] ${filterStr} → ${filteredFilms.length} film, ${visibleLocs.length} pin`);
    if (filteredFilms.length === 0) console.warn(`[filtre] sıfır film sonucu — ${filterStr}`);
    if (visibleLocs.length === 0 && filteredFilms.length > 0) {
      console.warn(`[filtre] film var ama görünür pin yok — kategori filtresi engelliyor olabilir`);
    }
  }

  const visibleIds = visibleLocs.map(l => l.id);
  const f = visibleIds.length < LOCS.length ? ['in', ['get', 'id'], ['literal', visibleIds]] : null;
  _currentVisFilter = (visibleLocs.length < LOCS.length) ? f : null;
  try { m.setFilter('locs-labels', _currentVisFilter); } catch(e){}
  try { m.setFilter('locs-dots',   _currentVisFilter); } catch(e){}

  const filteredIds = new Set(filteredFilms.map(f => f.id));
  LOCS.forEach(loc => {
    const has = loc.films.some(fid => filteredIds.has(fid));
    const el  = document.getElementById('eLoc' + loc.id);
    if(el) el.style.opacity = has ? '1' : '0.28';
  });

  if(window.innerWidth > 640){
    const hasFilter = eActiveLocCat || eActiveDir || eActiveGenre || eActiveDecade || eActiveYabanci !== '';
    if(hasFilter && visibleLocs.length){
      if(visibleLocs.length === 1){
        if (window.DEBUG_FLY) console.log(`[map] flyTo (filtre tek pin) M${visibleLocs[0].id}`);
        m.flyTo({ center:[visibleLocs[0].lng, visibleLocs[0].lat], zoom:14, duration:800, padding:_eMapOverlayPadding() });
      } else {
        if (window.DEBUG_FLY) console.log(`[map] fitBounds (filtre) ${visibleLocs.length} pin`);
        const bounds = new maplibregl.LngLatBounds();
        visibleLocs.forEach(l => bounds.extend([l.lng, l.lat]));
        m.fitBounds(bounds, { padding:_eMapOverlayPadding(), maxZoom:15, duration:800 });
      }
    } else if(!hasFilter){
      if (window.DEBUG_FLY) console.log('[map] flyTo (filtre yok) IST_CENTER');
      m.flyTo({ center: IST_CENTER, zoom:12, duration:800 });
    }
  }
  _syncSelSource();
}

/* ══════════════════════════════════════════════
   HIGHLIGHT FILM ON MAP — feature-state
══════════════════════════════════════════════ */
function highlightFilmOnMap(theme, filmId){
  const f = FILM_MAP[filmId], m = maps[theme];
  if(!f || !m) return;
  clearHighlights();
  if(!hlLayers[theme]) hlLayers[theme] = [];
  const locs = LOCS.filter(l => f.locs.includes(l.id));
  if(theme === 'E'){
    ePinsResetAll();
    locs.forEach(loc => {
      ePinHighlight(loc.id, true);
      hlLayers[theme].push({ _restore: () => ePinHighlight(loc.id, false) });
    });
    if(window.innerWidth > 640 && locs.length){
      const ov = _eMapOverlayPadding();
      if(locs.length === 1){
        m.flyTo({ center:[locs[0].lng, locs[0].lat], zoom:14, duration:750, padding:ov });
      } else {
        const bounds = new maplibregl.LngLatBounds();
        locs.forEach(l => bounds.extend([l.lng, l.lat]));
        const pad = locs.length <= 3 ? 120 : locs.length <= 8 ? 100 : 80;
        m.fitBounds(bounds, { padding:{ top:Math.max(pad,ov.top), bottom:Math.max(pad,ov.bottom), left:pad, right:pad }, maxZoom: 13, duration: 750 });
      }
    }
  }
}

function clearHighlights(){
  Object.values(hlLayers).forEach(arr => {
    arr.forEach(l => { if(l._restore) l._restore(); else if(l.remove) l.remove(); });
    arr.length = 0;
  });
  eActiveLoc = null;
}

function clearSelLayers(){}

/* ══════════════════════════════════════════════
   BAĞLANTI ÇİZGİLERİ — GeoJSON LineLayer
   ══════════════════════════════════════════════ */

function _bezierToGeo(m, sx, sy, tx, ty, steps){
  steps = steps || 20;
  const dx  = tx - sx;
  const dy  = ty - sy;
  const cx1 = sx + dx * 0.2, cy1 = sy + dy * 0.8;  // pinden hemen film satırı yönüne → fan
  const cx2 = tx - 80,        cy2 = ty;              // uzun yatay yaklaşım → panele dik giriş
  const coords = [];
  for(let i = 0; i <= steps; i++){
    const t = i/steps, mt = 1-t;
    const px = mt*mt*mt*sx + 3*mt*mt*t*cx1 + 3*mt*t*t*cx2 + t*t*t*tx;
    const py = mt*mt*mt*sy + 3*mt*mt*t*cy1 + 3*mt*t*t*cy2 + t*t*t*ty;
    const geo = m.unproject([px, py]);
    coords.push([geo.lng, geo.lat]);
  }
  return coords;
}

function _updateConnGeo(theme){
  const conn = activeConns[theme]; if(!conn || !conn.locId) return;
  const loc = LOC_MAP[conn.locId], m = maps[theme];
  if(!loc || !m || !_isMapReady(m)) return;
  const mapEl = document.getElementById('map'+theme); if(!mapEl) return;
  const mapRect = mapEl.getBoundingClientRect();
  const srcPt = m.project([loc.lng, loc.lat]);
  const sx = srcPt.x, sy = srcPt.y;
  const lineFeatures = [], dotFeatures = [];
  loc.films.forEach(fid=>{
    const filmEl = document.getElementById('eFilm'+fid); if(!filmEl) return;
    const r = filmEl.getBoundingClientRect();
    if(r.width===0 || r.height===0) return;
    const tx = r.left - mapRect.left + 5;
    const ty = r.top  - mapRect.top  + r.height * 0.5;
    lineFeatures.push({ type:'Feature', geometry:{ type:'LineString', coordinates:_bezierToGeo(m,sx,sy,tx,ty) } });
    const tGeo = m.unproject([tx, ty]);
    dotFeatures.push({ type:'Feature', geometry:{ type:'Point', coordinates:[tGeo.lng, tGeo.lat] } });
  });
  try {
    m.getSource('conn-lines').setData({ type:'FeatureCollection', features:lineFeatures });
    m.getSource('conn-dots').setData({ type:'FeatureCollection', features:dotFeatures });
  } catch(e){}
}

function clearConnLines(){
  Object.keys(_connRaf).forEach(k=>{
    if(_connRaf[k]){ cancelAnimationFrame(_connRaf[k]); _connRaf[k]=null; }
  });
  activeConns = {};
  const m = maps['E'];
  if(m && _isMapReady(m)){
    const empty = { type:'FeatureCollection', features:[] };
    try { m.getSource('conn-lines').setData(empty); } catch(e){}
    try { m.getSource('conn-dots').setData(empty); } catch(e){}
  }
}

function buildConnLine(theme, locId){
  if(theme!=='E') return;
  const m = maps['E']; if(!m) return;
  if(!_isMapReady(m)){ m.once('load',()=>buildConnLine(theme,locId)); return; }
  activeConns[theme] = { locId };
  requestAnimationFrame(()=>{
    _updateConnGeo(theme);
    setTimeout(()=>{ if(activeConns[theme]?.locId===locId) _updateConnGeo(theme); }, 300);
  });
}

const _connRaf = {};
function liveUpdateConn(theme){
  if(!activeConns[theme]) return;
  if(_connRaf[theme]) return;
  _connRaf[theme] = requestAnimationFrame(()=>{
    _connRaf[theme] = null;
    _updateConnGeo(theme);
  });
}

/* ══════════════════════════════════════════════
   MOBİL TAB & SHEET
══════════════════════════════════════════════ */
(function(){
  const backdrop = document.createElement('div');
  backdrop.id = 'mSheetBackdrop';
  backdrop.onclick = () => mSetTab('harita', document.getElementById('mTabHarita'));
  document.body.appendChild(backdrop);

  window.mSetTab = function(tab, btn){
    if(window.innerWidth > 640) return;
    const sb = document.querySelector('#cE .e-sb');
    const fp = document.querySelector('#cE .e-fp');
    document.querySelectorAll('.m-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    if(tab === 'harita'){
      sb?.classList.remove('m-open'); fp?.classList.remove('m-open'); backdrop.classList.remove('on');
    } else if(tab === 'mekanlar'){
      sb?.classList.add('m-open'); fp?.classList.remove('m-open'); backdrop.classList.add('on');
      if(eActiveLoc){ const locEl=document.getElementById('eLoc'+eActiveLoc); if(locEl){ locEl.scrollIntoView({block:'nearest'}); document.querySelectorAll('#cE .e-loc-row').forEach(el=>el.classList.remove('on')); locEl.classList.add('on'); } }
    } else if(tab === 'filmler'){
      fp?.classList.add('m-open'); sb?.classList.remove('m-open'); backdrop.classList.add('on');
      if(eActiveLoc) eApplyFilters();
    }
  };

  window.addEventListener('resize', () => {
    if(window.innerWidth > 640){
      document.querySelector('#cE .e-sb')?.classList.remove('m-open');
      document.querySelector('#cE .e-fp')?.classList.remove('m-open');
      document.getElementById('mSheetBackdrop')?.classList.remove('on');
    }
  });
})();

/* ══════════════════════════════════════════════
   INFO MODAL
══════════════════════════════════════════════ */
function eInfoOpen(){
  document.getElementById('eInfoModal').classList.add('open');
}
function eInfoClose(e){
  if(e && e.target !== document.getElementById('eInfoModal') && !e.target.classList.contains('e-info-close')) return;
  document.getElementById('eInfoModal').classList.remove('open');
}
document.addEventListener('keydown', e=>{
  if(e.key==='Escape') document.getElementById('eInfoModal')?.classList.remove('open');
});

/* ════════════════════════════════════════════════════════════
   window.debug.map — harita durumu sorguları
   ════════════════════════════════════════════════════════════ */
window.debug = window.debug || {};
window.debug.map = {

  state() {
    const m = maps['E'];
    const ready = m && inited.E;
    const c = m ? m.getCenter() : null;
    console.group('[map] state');
    console.log('hazır:', ready);
    if (m) {
      console.log('zoom:', m.getZoom().toFixed(2));
      console.log('merkez:', c ? `[${c.lng.toFixed(4)}, ${c.lat.toFixed(4)}]` : null);
    }
    console.log('eActiveLoc:', eActiveLoc);
    console.log('seçili pinler:', [..._selPinIds]);
    console.log('aktif bağlantı:', activeConns.E?.locId || null);
    console.log('film paneli açık:', document.getElementById('mp')?.classList.contains('open'));
    console.log('currentFilm:', currentFilm ? `F${currentFilm.id} "${currentFilm.title}"` : null);
    console.groupEnd();
  },

  filters() {
    console.group('[map] aktif filtreler');
    console.log('eActiveGenre:',  eActiveGenre  || '(yok)');
    console.log('eActiveDir:',    eActiveDir    || '(yok)');
    console.log('eActiveDecade:', eActiveDecade || '(yok)');
    console.log('eActiveLocCat:', eActiveLocCat || '(yok)');
    console.log('eActiveLoc:',    eActiveLoc    || '(yok)');
    console.groupEnd();
  },

  filteredFilms() {
    const filtered = FILMS.filter(f =>
      (!eActiveGenre  || f.genre === eActiveGenre)  &&
      (!eActiveDir    || f.dir   === eActiveDir)    &&
      (!eActiveDecade || Math.floor(f.year/10)*10 === eActiveDecade) &&
      (!eActiveLoc    || LOC_MAP[eActiveLoc]?.films.includes(f.id))
    );
    console.log(`${filtered.length} film (filtre sonrası):`,
      filtered.slice(0, 30).map(f => `F${f.id} "${f.title}" (${f.year})`),
      filtered.length > 30 ? '...' : '');
    return filtered;
  },

  visiblePins() {
    const filteredFilms = FILMS.filter(f =>
      (!eActiveGenre  || f.genre === eActiveGenre)  &&
      (!eActiveDir    || f.dir   === eActiveDir)    &&
      (!eActiveDecade || Math.floor(f.year/10)*10 === eActiveDecade) &&
      (eActiveYabanci === '' || f.yabanci === eActiveYabanci)
    );
    const filteredLocIds = new Set(filteredFilms.flatMap(f => f.locs));
    const visible = LOCS.filter(loc =>
      (!eActiveLocCat || loc.cat === eActiveLocCat) && filteredLocIds.has(loc.id)
    );
    console.log(`${visible.length}/${LOCS.length} pin görünür:`,
      visible.slice(0, 30).map(l => `M${l.id} "${l.name}"`),
      visible.length > 30 ? '...' : '');
    return visible;
  },

  /* Şu an haritada görünmesi gereken pinlerin gerçekten
     örtüşmeyen (arama kutusu/galeri barı altında kalmayan)
     alanda olup olmadığını kontrol eder. */
  verifyVisible() {
    const m = maps['E'];
    if(!m || !inited.E){ console.warn('Harita henüz hazır değil'); return; }
    const mapEl = document.getElementById('mapE');
    if(!mapEl) return;
    const mapRect = mapEl.getBoundingClientRect();
    const ov = _eMapOverlayPadding();
    const safe = {
      top:    mapRect.top + ov.top,
      bottom: mapRect.bottom - ov.bottom,
      left:   mapRect.left + ov.left,
      right:  mapRect.right - ov.right,
    };
    const visible = window.debug.map.visiblePins();
    const hidden = [];
    visible.forEach(l => {
      const p = m.project([l.lng, l.lat]);
      const sx = mapRect.left + p.x, sy = mapRect.top + p.y;
      if(sx < safe.left || sx > safe.right || sy < safe.top || sy > safe.bottom){
        hidden.push(`M${l.id} "${l.name}" (${sx.toFixed(0)},${sy.toFixed(0)})`);
      }
    });
    if(hidden.length){
      console.warn(`[map] ${hidden.length}/${visible.length} pin örtüşen alanda / kadrajın dışında:`, hidden);
    } else {
      console.log(`[map] ${visible.length} pinin tamamı güvenli alanda ✓`);
    }
    return hidden;
  }
};