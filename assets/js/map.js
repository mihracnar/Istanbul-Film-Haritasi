const IST = [41.0082, 28.9784];
const maps = {};
const markers = {};
const inited = { A:false, B:false, D:false, E:false };

/* ══════════════════════════════════════════════
   MEDIA PANEL
══════════════════════════════════════════════ */
let currentFilm = null;
let eActiveLoc  = null;

function stillUrl(seed, w, h){ return `https://picsum.photos/seed/${seed}/${w}/${h}`; }

async function openMedia(filmId){
  const f = FILMS.find(x=>x.id===filmId);
  if(!f) return;
  currentFilm = f;

  // Mekan filtresi aktifse kaldır
  if(eActiveLocCat) {
    eActiveLocCat = '';
    document.querySelectorAll('.e-loc-cat-chip').forEach(b => b.classList.remove('on'));
    eFilterMapMarkers();
  }

  // Panel'i hemen aç, placeholder göster
  document.getElementById('mpTitle').textContent = f.title;
  document.getElementById('mpMeta').textContent = `${f.year}  ·  ${f.dir}  ·  ${f.genre}`;
  document.getElementById('mpHeroLabel').textContent = `${f.year} / ${f.dir.toUpperCase()}`;
  const heroEl = document.getElementById('mpHero');
  heroEl.src = '';
  heroEl.style.opacity = '0.3';
  document.getElementById('mpDesc').textContent = 'Yükleniyor...';
  document.getElementById('mpThumbs').innerHTML = '';
  const filmLocs = LOCS.filter(l=>f.locs.includes(l.id));
  document.getElementById('mpLocs').innerHTML = filmLocs.map(l=>
    `<button class="mp-loc-chip" onclick="mpGoLoc(${l.id})">${l.name}</button>`
  ).join('');
  document.getElementById('mp').classList.add('open');
  const theme = document.getElementById('preview').dataset.theme;
  if(theme==='E') document.querySelector('#cE .e-fp').style.visibility='hidden';
  const galleryBars = {A:'aIP', B:'bLocBar', D:'dIP', E:'eLocBar'};
  const gb = document.getElementById(galleryBars[theme]);
  if(gb) gb.style.display = 'none';
  clearConnLines();
  clearSelLayers();
  highlightFilmOnMap(theme, filmId);

  // TMDB'den zengin içerik çek
  const tmdb = await fetchTMDB(f);

  if(tmdb) {
    // Hero: backdrop varsa onu, yoksa poster
    const heroSrc = tmdb.backdrop || tmdb.poster;
    if(heroSrc) {
      heroEl.src = heroSrc;
      heroEl.style.opacity = '1';
      heroEl.style.filter = '';
    }
    // Açıklama
    document.getElementById('mpDesc').textContent = tmdb.desc || '—';
    // Stills: TMDB backdrop'ları
    const thumbs = document.getElementById('mpThumbs');
    if(tmdb.stills.length) {
      thumbs.innerHTML = tmdb.stills.map((url,i)=>
        `<img class="mp-thumb${i===0?' sel':''}" src="${url}" onclick="mpSelectStillUrl('${url}',this,${i})" alt="Sahne ${i+1}">`
      ).join('');
    } else if(tmdb.poster) {
      thumbs.innerHTML = `<img class="mp-thumb sel" src="${tmdb.poster}" onclick="mpSelectStillUrl('${tmdb.poster}',this,0)" alt="Poster">`;
    }
    // Hero lightbox için
    if(heroSrc) heroEl.onclick = null;
  } else {
    // TMDB bulamazsa placeholder
    heroEl.src = f.stills?.[0] ? stillUrl(f.stills[0],640,360) : '';
    heroEl.style.opacity = '1';
    document.getElementById('mpDesc').textContent = f.desc || '—';
    const th = document.getElementById('mpThumbs');
    th.innerHTML = (f.stills||[]).map((s,i)=>
      `<img class="mp-thumb${i===0?' sel':''}" src="${stillUrl(s,160,90)}" onclick="mpSelectStill(${i},${f.id})" alt="Sahne ${i+1}">`
    ).join('');
  }
}

function mpOpenLightbox(startIdx){
  if(!currentFilm) return;
  const cached = tmdbCache[currentFilm.id];
  if(cached?.stills?.length) {
    gLbItems = cached.stills.map(url=>({ url, filmTitle: currentFilm.title, year: currentFilm.year }));
    if(cached.poster && !gLbItems.find(i=>i.url===cached.poster))
      gLbItems.unshift({ url: cached.poster, filmTitle: currentFilm.title, year: currentFilm.year });
  } else if(cached?.poster) {
    gLbItems = [{ url: cached.poster, filmTitle: currentFilm.title, year: currentFilm.year }];
  } else {
    gLbItems = (currentFilm.stills||[]).map(seed=>({ seed, filmTitle: currentFilm.title, year: currentFilm.year }));
  }
  gLbCur = startIdx ?? 0;
  gLbShow();
  document.getElementById('gLightbox').classList.add('open');
  document.addEventListener('keydown', gLbKey);
}

function mpSelectStillUrl(url, imgEl, idx){
  document.getElementById('mpHero').src = url;
  document.querySelectorAll('.mp-thumb').forEach(el=>el.classList.remove('sel'));
  if(imgEl) imgEl.classList.add('sel');
  mpOpenLightbox(idx ?? 0);
}

function mpSelectStill(idx, filmId){
  const f = FILMS.find(x=>x.id===filmId);
  document.getElementById('mpHero').src = stillUrl(f.stills[idx], 640, 360);
  document.querySelectorAll('.mp-thumb').forEach((el,i)=>el.classList.toggle('sel', i===idx));
}

function mpPlayClick(){
  alert('Fragman oynatma özelliği üretim sürümünde aktif olacak.');
}

function mpGoLoc(locId){
  // keep media panel open — just pan map to the location
  const theme = document.getElementById('preview').dataset.theme;
  const loc = LOCS.find(l=>l.id===locId);
  if(loc && maps[theme]) maps[theme].setView([loc.lat, loc.lng], 15, {animate:true});
}

function closeMedia(){
  document.getElementById('mp').classList.remove('open');
  const fp = document.querySelector('#cE .e-fp');
  if(fp) fp.style.visibility='';
  clearHighlights();
  clearSelLayers();
  clearConnLines();
}

/* ══════════════════════════════════════════════
   UNIFIED SELECT — called from pin onclick
══════════════════════════════════════════════ */
/* ══════════════════════════════════════════════
   LOC GALLERY — dipbar içeriği (tüm temalar)
   Seçili mekandaki tüm filmlerin stilleri
══════════════════════════════════════════════ */
let gLbItems = [];  // { src, filmTitle, stillIdx }
let gLbCur  = 0;

async function buildLocGallery(locId, theme){
  const loc = LOCS.find(l=>l.id===locId);
  if(!loc) return '';

  const accentLabel = {A:'#c8a252',B:'#d42b1e',D:'#c47c1e',E:'#111'}[theme];
  const typeFont = theme==='E' ? "font-family:'DM Mono',monospace;font-size:8px;" : '';

  const films = loc.films.map(fid=>FILMS.find(f=>f.id===fid)).filter(Boolean);

  // TMDB verilerini paralel çek
  const tmdbResults = await Promise.all(films.map(f => fetchTMDB(f)));

  // gLbItems: lightbox için
  gLbItems = [];
  const itemsHTML = films.flatMap((f, fi) => {
    const tmdb = tmdbResults[fi];
    const imgs = tmdb?.stills?.length ? tmdb.stills :
                 tmdb?.poster ? [tmdb.poster] : [];
    if (!imgs.length) return [];
    return imgs.map((url) => {
      const idx = gLbItems.length;
      gLbItems.push({ url, filmTitle: f.title, year: f.year, filmId: f.id });
      return `<div class="loc-gallery-item" onclick="openGLb(${idx})">
        <img src="${url}" loading="lazy" alt="${f.title}">
        <div class="loc-gallery-caption">${f.title}</div>
      </div>`;
    });
  }).join('');

  const headHTML = `
    <span style="font-size:7px;color:${accentLabel};letter-spacing:2px;text-transform:uppercase;${typeFont}">${loc.cat||loc.type}</span>
    <span style="font-size:${theme==='E'?'16':'15'}px;${theme==='D'?'font-style:italic;':''}">${loc.name}</span>
    <span style="font-size:8px;color:#aaa;font-family:'DM Mono',monospace">${loc.ilce}</span>
    <span style="font-size:8px;color:${accentLabel};font-family:'DM Mono',monospace;margin-left:4px">${gLbItems.length} görsel</span>
    <button class="loc-gallery-close" onclick="closeGalleryBar('${theme}')">×</button>`;

  return `<div class="loc-gallery-head">${headHTML}</div>
    <div class="loc-gallery-scroll">${itemsHTML}</div>`;
}

function closeGalleryBar(theme){
  const bars = {A:'aIP', B:'bLocBar', D:'dIP', E:'eLocBar'};
  const el = document.getElementById(bars[theme]);
  if(el){ el.style.display='none'; }
  clearSelLayers();
  clearConnLines();
  document.querySelectorAll(`#c${theme} .fl,#c${theme} .rp-film,#c${theme} .o-fl,#c${theme} .e-film-row`).forEach(e=>e.classList.remove('on'));
}

function openGLb(idx){
  gLbCur = idx;
  gLbShow();
  document.getElementById('gLightbox').classList.add('open');
  document.addEventListener('keydown', gLbKey);
}
function closeGLb(){
  document.getElementById('gLightbox').classList.remove('open');
  document.removeEventListener('keydown', gLbKey);
}
function gLbClose(e){ if(e.target===document.getElementById('gLightbox')) closeGLb(); }
function gLbNav(dir){
  gLbCur = (gLbCur + dir + gLbItems.length) % gLbItems.length;
  gLbShow();
}
function gLbShow(){
  const item = gLbItems[gLbCur];
  if(!item) return;
  // url varsa TMDB, yoksa eski seed sistemi
  const src = item.url || stillUrl(item.seed, 900, 506);
  document.getElementById('gLbImg').src = src;
  document.getElementById('gLbFilm').textContent = item.filmTitle;
  document.getElementById('gLbCaption').textContent = `${item.year}  ·  ${gLbCur+1} / ${gLbItems.length}`;
}
function gLbKey(e){
  if(e.key==='ArrowRight') gLbNav(1);
  if(e.key==='ArrowLeft')  gLbNav(-1);
  if(e.key==='Escape')     closeGLb();
}

function selectLoc(theme, id){
  if(theme==='A') aSelectLoc(id);
  else if(theme==='B') bSelectLoc(id);
  else if(theme==='D') dSelectLoc(id);
  else if(theme==='E') eSelectLoc(id);
}

/* ══════════════════════════════════════════════
   HIGHLIGHT LAYERS — film → map
══════════════════════════════════════════════ */
const hlLayers = {}; // theme → [L.circle | restore-obj]

function highlightFilmOnMap(theme, filmId){
  const f = FILMS.find(x=>x.id===filmId);
  const m = maps[theme];
  if(!f || !m) return;
  clearHighlights();
  if(!hlLayers[theme]) hlLayers[theme] = [];

  const locs = LOCS.filter(l=>f.locs.includes(l.id));
  const accentColor = {A:'#c8a252', B:'#d42b1e', D:'#c47c1e', E:'#f03010'}[theme];

  // For E: reset all pins once before highlighting multiple
  if(theme === 'E') ePinsResetAll();

  locs.forEach(loc=>{
    if(theme === 'E'){
      // E: highlight via ePinHighlight (ePinsResetAll called once before loop)
      ePinHighlight(loc.id, true);
      hlLayers[theme].push({ _restore: ()=> ePinHighlight(loc.id, false) });
    } else if(theme === 'B'){
      const pinEl = document.getElementById(`pin-B-${loc.id}`);
      if(pinEl){
        const label = pinEl.querySelector('.pin-label');
        const stem  = pinEl.querySelector('.pin-stem');
        if(label){ label.style.background = accentColor; label.style.color = '#fff'; }
        if(stem)   stem.style.background  = accentColor;
        hlLayers[theme].push({ _restore: ()=>{
          if(label){ label.style.background = '#111'; label.style.color = '#fff'; }
          if(stem)   stem.style.background  = '#111';
        }});
      }
    } else {
      // A ve D: kesik daire
      const ring = L.circle([loc.lat, loc.lng], {
        radius: 240, color: accentColor, fillColor: accentColor,
        fillOpacity: 0.10, weight: 2, opacity: 0.75, dashArray: '5 4',
      }).addTo(m);
      hlLayers[theme].push(ring);
    }
  });

  // Fly to all locs — zoom 13
  if(locs.length === 1){
    m.flyTo([locs[0].lat, locs[0].lng], 15, { duration: 1.1 });
  } else if(locs.length > 1){
    const bounds = L.latLngBounds(locs.map(l=>[l.lat, l.lng]));
    m.flyToBounds(bounds, { padding:[60,60], maxZoom:15, duration:1.1 });
  }
}

function clearHighlights(){
  Object.values(hlLayers).forEach(arr=>{
    arr.forEach(l=>{ if(l._restore) l._restore(); else l.remove(); });
    arr.length = 0;
  });
  eActiveLoc = null;
}

/* ══════════════════════════════════════════════
   PIN HTML — onclick directly in HTML string
   (Leaflet iconSize 1×1 means marker click area
    is 1px; the only reliable way is inline onclick)
══════════════════════════════════════════════ */

function pinHTML_A(loc, theme){
  const c = TYPE_COLORS.A[loc.type];
  return `<div onclick="event.stopPropagation();selectLoc('A',${loc.id})"
    style="position:absolute;top:0;left:0;transform:translate(-50%,-50%);
           cursor:pointer;text-align:center;z-index:10">
    <div style="width:11px;height:11px;border-radius:50%;margin:0 auto 3px;
                background:${c};box-shadow:0 0 0 3px ${c}30,0 0 10px ${c}60;
                transition:transform .2s"></div>
    <div style="font-size:8.5px;font-style:italic;white-space:nowrap;
                font-family:Georgia,serif;color:${c};
                text-shadow:0 0 5px #000,0 0 10px #000;
                line-height:1.2">${loc.name}</div>
    <div style="font-size:7px;color:#666;font-family:monospace">${loc.films.length} film</div>
  </div>`;
}

function pinHTML_B(loc, theme){
  const c = TYPE_COLORS.B[loc.type];
  return `<div onclick="event.stopPropagation();selectLoc('B',${loc.id})" id="pin-B-${loc.id}"
    style="position:absolute;top:0;left:0;transform:translate(-50%,-100%);
           cursor:pointer;text-align:center;z-index:10">
    <div class="pin-label" style="display:inline-flex;align-items:center;gap:5px;
                background:#111;color:#f3efe6;
                padding:4px 9px;white-space:nowrap;
                font-family:monospace;font-size:9px;font-weight:700;
                box-shadow:2px 2px 0 rgba(0,0,0,.3);transition:background .25s,color .25s">
      <span class="pin-dot" style="width:5px;height:5px;border-radius:50%;
                   background:${c};flex-shrink:0;display:inline-block;transition:background .25s"></span>
      ${loc.name}
      <span style="background:${c};color:#fff;border-radius:50%;
                   width:15px;height:15px;font-size:7.5px;font-weight:900;
                   display:inline-flex;align-items:center;justify-content:center;
                   flex-shrink:0">${loc.films.length}</span>
    </div>
    <div class="pin-stem" style="width:1px;height:7px;background:#111;margin:0 auto;transition:background .25s"></div>
  </div>`;
}

function pinHTML_D(loc, theme){
  const c = TYPE_COLORS.D[loc.type];
  let sym;
  if(loc.type==='nokta'){
    sym = `<div style="font-size:18px;line-height:1;color:${c}">&#8756;</div>`;
  } else if(loc.type==='rota'){
    sym = `<div style="font-size:9px;color:${c};letter-spacing:4px">&#8212;&#8212;</div>`;
  } else {
    sym = `<div style="border:1.5px dashed ${c};padding:1px 5px;font-size:8px;
                       color:${c};font-style:italic;background:${c}15">${loc.name.split(' ')[0]}</div>`;
  }
  return `<div onclick="event.stopPropagation();selectLoc('D',${loc.id})"
    style="position:absolute;top:0;left:0;transform:translate(-50%,-50%);
           cursor:pointer;text-align:center;z-index:10">
    ${sym}
    <div style="font-size:9px;font-style:italic;white-space:nowrap;
                font-family:Georgia,serif;color:#1a1006;
                text-shadow:0 0 4px #f7f1e3,0 0 9px #f7f1e3,0 0 16px #f7f1e3;
                margin-top:2px">${loc.name}</div>
  </div>`;
}

function pinHTML_E(loc, theme){
  const c = TYPE_COLORS.E[loc.type];
  return `<div onclick="event.stopPropagation();selectLoc('E',${loc.id})" id="pin-E-${loc.id}"
    style="position:absolute;top:0;left:0;transform:translate(-50%,-100%);
           cursor:pointer;text-align:center;z-index:10">
    <div class="pin-label" style="display:inline-flex;align-items:center;gap:5px;
                background:#000;color:#fff;
                padding:4px 9px;white-space:nowrap;
                font-family:sans-serif;font-size:10px;font-weight:700;
                box-shadow:2px 2px 0 rgba(0,0,0,.15);transition:background .25s,color .25s">
      <span class="pin-dot" style="width:4px;height:4px;background:${c};
                   flex-shrink:0;display:inline-block;transition:background .25s"></span>
      ${loc.name}
      <span style="font-size:8px;opacity:.45;font-weight:300">&times;${loc.films.length}</span>
    </div>
    <div class="pin-stem" style="width:1px;height:7px;background:#000;margin:0 auto;transition:background .25s"></div>
  </div>`;
}

function createMap(id, theme){
  const m = L.map(id, { zoomControl:true, attributionControl:true });
  L.tileLayer(TILE[theme].url, { attribution:TILE[theme].attr, maxZoom:18 }).addTo(m);
  m.setView(IST, 12);
  maps[theme] = m;
  markers[theme] = {};

  const htmlFn = {A:pinHTML_A, B:pinHTML_B, D:pinHTML_D, E:pinHTML_E}[theme];

  LOCS.forEach(loc => {
    const icon = L.divIcon({
      className: '',
      html: htmlFn(loc, theme),
      iconSize:   [1, 1],
      iconAnchor: [0, 0],
    });
    // marker NOT interactive — click handled by inline onclick on child div
    const mk = L.marker([loc.lat, loc.lng], { icon, interactive: false }).addTo(m);
    markers[theme][loc.id] = mk;
  });

  attachMapRedraw(theme, m);

  // Boşluğa çift tıklanınca default view'e uç
  m.on('dblclick', function(e) {
    // Pin, film ve seçimleri sıfırla
    if(document.getElementById('mp').classList.contains('open')) closeMedia();
    ePinsResetAll();
    // Decade accordion'u sıfırla — ilk dönemi aç
    eOpenDecades.clear();
    const firstGrp = document.querySelector('.e-decade-group');
    if(firstGrp){
      const d = firstGrp.dataset.decade;
      eOpenDecades.add(String(d));
      firstGrp.querySelector('.e-decade-hdr-arr').className = 'e-decade-hdr-arr open';
      firstGrp.querySelector('.e-decade-body').className = 'e-decade-body open';
      document.querySelectorAll('.e-decade-group:not(:first-child) .e-decade-hdr-arr').forEach(el=>el.className='e-decade-hdr-arr');
      document.querySelectorAll('.e-decade-group:not(:first-child) .e-decade-body').forEach(el=>el.className='e-decade-body closed');
    }
    eActiveLoc = null;
    clearConnLines();
    clearSelLayers();
    document.querySelectorAll('#cE .e-loc-row, #cE .e-film-row').forEach(el => el.classList.remove('on'));
    const bar = document.getElementById('eLocBar');
    if(bar) bar.style.display = 'none';
    m.flyTo(IST, 12, { duration: 0.8 });
  });
}

/* ══════════════════════════════════════════════
   LOC SELECTION HIGHLIGHT
   • solid ring on selected loc only
   • film panel highlights handled per-theme in selectLoc
══════════════════════════════════════════════ */
const selLayers = {};

function clearSelLayers(){
  Object.values(selLayers).forEach(arr=>{ arr.forEach(l=>l.remove()); arr.length=0; });
}

function setSelRing(theme, loc){
  clearSelLayers();
  if(!selLayers[theme]) selLayers[theme]=[];
  const m = maps[theme];
  if(!m) return;
  const accent = {A:'#c8a252',B:'#d42b1e',D:'#c47c1e',E:'#f03010'}[theme];
  const ring = L.circle([loc.lat, loc.lng],{
    radius:180, color:accent, fillColor:accent,
    fillOpacity:0.22, weight:2.5, opacity:1,
  }).addTo(m);
  selLayers[theme].push(ring);
}

/* ══════════════════════════════════════════════
   KONSEPT A — selectLoc
══════════════════════════════════════════════ */
function buildA(){
  document.getElementById('aLocCount').textContent = LOCS.length;
  const lb = document.getElementById('aLocs');
  LOCS.forEach(loc=>{
    const c = TYPE_COLORS.A[loc.type];
    lb.innerHTML += `<div class="loc" id="aLoc${loc.id}" onclick="aSelectLoc(${loc.id})">
      <div><span class="loc-badge" style="color:${c}">${loc.type}</span></div>
      <div class="loc-name">${loc.name}</div>
      <div class="loc-meta">${loc.ilce}</div>
      <div class="loc-fc">${loc.films.length} film</div>
    </div>`;
  });
  const fb = document.getElementById('aFilms');
  FILMS.forEach(f=>{
    fb.innerHTML += `<div class="fl" id="aFilm${f.id}" onclick="openMedia(${f.id})">
      <div class="fl-y">${f.year}</div>
      <div class="fl-t">${f.title}</div>
      <div class="fl-m">${f.dir} · ${f.genre}</div>
    </div>`;
  });
}
async function aSelectLoc(id){
  const loc = LOCS.find(l=>l.id===id); if(!loc) return;
  // sidebar
  document.querySelectorAll('#cA .loc').forEach(el=>el.classList.remove('on'));
  const el = document.getElementById('aLoc'+id);
  if(el){ el.classList.add('on'); el.scrollIntoView({block:'nearest'}); }
  document.querySelectorAll('#cA .fl').forEach(el=>el.classList.remove('on'));
  loc.films.forEach(fid=>{ const fe=document.getElementById('aFilm'+fid); if(fe) fe.classList.add('on'); });
  const firstFilmEl = document.getElementById('aFilm'+loc.films[0]);
  if(firstFilmEl) firstFilmEl.scrollIntoView({block:'nearest'});
  // gallery dipbar
  const aIP = document.getElementById('aIP');
  aIP.classList.add('loc-gallery-bar');
  aIP.innerHTML = await buildLocGallery(loc.id,'A');
  aIP.style.display = 'flex';
  // close media panel if open
  if(document.getElementById('mp').classList.contains('open')) closeMedia();
  // map
  if(maps.A){
    maps.A.setView([loc.lat, loc.lng], 14, {animate:true});
    setSelRing('A', loc);
    setTimeout(()=>buildConnLine('A', loc.id), 320);
  }
}

/* ══════════════════════════════════════════════
   KONSEPT B — selectLoc
══════════════════════════════════════════════ */
let bCurrentTab = 'films';
function buildB(){
  document.getElementById('bLocCount').textContent = LOCS.length;
  document.getElementById('bFilmCount').textContent = FILMS.length;
  bRenderFilms();
}
function bRenderFilms(){
  document.getElementById('bScroll').innerHTML = FILMS.map(f=>`
    <div class="rp-film" id="bFilm${f.id}" onclick="openMedia(${f.id})">
      <div class="rp-f-t">${f.title}</div>
      <div class="rp-f-d">${f.dir} · ${f.year}</div>
      <div class="rp-f-g">${f.genre}</div>
    </div>`).join('');
}
function bRenderLocs(){
  document.getElementById('bScroll').innerHTML = LOCS.map(loc=>`
    <div class="rp-loc" id="bLoc${loc.id}" onclick="bSelectLoc(${loc.id})">
      <div class="rp-l-n">${loc.name}</div>
      <div class="rp-l-m">${loc.ilce} · ${loc.type}</div>
      <div class="rp-l-f">${loc.films.length} film</div>
    </div>`).join('');
}
function bTab(tab, btn){
  bCurrentTab = tab;
  document.querySelectorAll('#cB .rp-tab').forEach(b=>b.classList.remove('on'));
  btn.classList.add('on');
  if(tab==='films') bRenderFilms(); else bRenderLocs();
}
function bChip(btn){
  document.querySelectorAll('#cB .chip').forEach(b=>b.classList.remove('on'));
  btn.classList.add('on');
}
async function bSelectLoc(id){
  const loc = LOCS.find(l=>l.id===id); if(!loc) return;
  const filmsBtn = document.querySelector('#cB .rp-tab:nth-child(1)');
  if(bCurrentTab !== 'films'){ bTab('films', filmsBtn); }
  document.querySelectorAll('#cB .rp-film').forEach(el=>el.classList.remove('on'));
  loc.films.forEach(fid=>{ const fe=document.getElementById('bFilm'+fid); if(fe) fe.classList.add('on'); });
  const first = document.getElementById('bFilm'+loc.films[0]);
  if(first) first.scrollIntoView({block:'nearest'});
  // gallery dipbar
  const bar = document.getElementById('bLocBar');
  bar.classList.add('loc-gallery-bar');
  bar.innerHTML = await buildLocGallery(loc.id,'B');
  bar.style.display = 'flex';
  bar.style.flexDirection = 'column';
  if(document.getElementById('mp').classList.contains('open')) closeMedia();
  if(maps.B){
    maps.B.setView([loc.lat, loc.lng], 14, {animate:true});
    setSelRing('B', loc);
    setTimeout(()=>buildConnLine('B', loc.id), 320);
  }
}

/* ══════════════════════════════════════════════
   KONSEPT D — selectLoc
══════════════════════════════════════════════ */
function buildD(){
  document.getElementById('dLocCount').textContent = LOCS.length;
  document.getElementById('dCounts').textContent = LOCS.length+' mekan · '+FILMS.length+' film';
  const lb = document.getElementById('dLocs');
  LOCS.forEach(loc=>{
    const c = TYPE_COLORS.D[loc.type];
    lb.innerHTML += `<div class="o-loc" id="dLoc${loc.id}" onclick="dSelectLoc(${loc.id})">
      <div><span class="o-badge" style="color:${c}">${loc.type}</span></div>
      <div class="o-lname">${loc.name}</div>
      <div class="o-lmeta">${loc.ilce}</div>
      <div class="o-lfc">${loc.films.length} film</div>
    </div>`;
  });
  const fb = document.getElementById('dFilms');
  FILMS.forEach(f=>{
    fb.innerHTML += `<div class="o-fl" id="dFilm${f.id}" onclick="openMedia(${f.id})">
      <div class="o-fl-y">${f.year}</div>
      <div class="o-fl-t">${f.title}</div>
      <div class="o-fl-m">${f.dir}</div>
    </div>`;
  });
}
async function dSelectLoc(id){
  const loc = LOCS.find(l=>l.id===id); if(!loc) return;
  document.querySelectorAll('#cD .o-loc').forEach(el=>el.classList.remove('on'));
  const el=document.getElementById('dLoc'+id);
  if(el){ el.classList.add('on'); el.scrollIntoView({block:'nearest'}); }
  document.querySelectorAll('#cD .o-fl').forEach(el=>el.classList.remove('on'));
  loc.films.forEach(fid=>{ const fe=document.getElementById('dFilm'+fid); if(fe) fe.classList.add('on'); });
  const firstFilmEl = document.getElementById('dFilm'+loc.films[0]);
  if(firstFilmEl) firstFilmEl.scrollIntoView({block:'nearest'});
  // gallery dipbar
  const dIP = document.getElementById('dIP');
  dIP.classList.add('loc-gallery-bar');
  dIP.innerHTML = await buildLocGallery(loc.id,'D');
  dIP.style.display = 'flex';
  if(document.getElementById('mp').classList.contains('open')) closeMedia();
  if(maps.D){
    maps.D.setView([loc.lat, loc.lng], 14, {animate:true});
    setSelRing('D', loc);
    setTimeout(()=>buildConnLine('D', loc.id), 320);
  }
}
function dSelectFilm(id){
  document.querySelectorAll('#cD .o-fl').forEach(el=>el.classList.remove('on'));
  const el=document.getElementById('dFilm'+id); if(el) el.classList.add('on');
  const f=FILMS.find(x=>x.id===id);
  if(f?.locs[0]) dSelectLoc(f.locs[0]);
}

/* ══════════════════════════════════════════════
   KONSEPT E — sidebar + filtreler
══════════════════════════════════════════════ */

let eActiveGenre = '';
let eActiveDir   = '';
let eActiveLocCat = '';
let eDirFocusIdx = -1;

function eFilterMapMarkers(){
  const m = maps['E'];
  if(!m) return;

  const visibleLocs = [];

  // Yönetmen filtresindeki mekanları hesapla
  const dirLocIds = eActiveDir
    ? new Set(FILMS.filter(f=>f.dir===eActiveDir).flatMap(f=>f.locs))
    : null;

  LOCS.forEach(loc => {
    const mk = markers['E']?.[loc.id];
    if(!mk) return;
    const catOk = !eActiveLocCat || loc.cat === eActiveLocCat;
    const dirOk = !dirLocIds || dirLocIds.has(loc.id);
    const visible = catOk && dirOk;
    const el = mk.getElement();
    if(!el) return;
    const pinDiv = el.querySelector('[id^="pin-"]');
    if(pinDiv) {
      pinDiv.style.transition = 'opacity 0.3s ease';
      pinDiv.style.opacity = visible ? '1' : '0';
      pinDiv.style.pointerEvents = visible ? '' : 'none';
    } else {
      el.style.opacity = visible ? '1' : '0';
      el.style.pointerEvents = visible ? '' : 'none';
    }
    if(visible) visibleLocs.push(loc);
  });

  // Görünen noktalara uç
  const hasFilter = eActiveLocCat || eActiveDir;
  if(hasFilter && visibleLocs.length) {
    if(visibleLocs.length === 1) {
      m.flyTo([visibleLocs[0].lat, visibleLocs[0].lng], 14, { duration: 0.8 });
    } else {
      const bounds = L.latLngBounds(visibleLocs.map(l => [l.lat, l.lng]));
      m.flyToBounds(bounds, { padding: [60, 60], maxZoom: 15, duration: 0.8 });
    }
  } else if(!hasFilter) {
    m.flyTo(IST, 12, { duration: 0.8 });
  }
}


/* ══ CONNECTION LINES ══ */
const CONN_STYLES = {
  A: { stroke:'#c8a252', glowColor:'rgba(200,162,82,0.28)', width:1.1, glowWidth:5, opacity:0.55, dotR:3 },
  B: { stroke:'#d42b1e', glowColor:'rgba(212,43,30,0.20)',  width:1.2, glowWidth:5, opacity:0.45, dotR:3 },
  D: { stroke:'#c47c1e', glowColor:'rgba(196,124,30,0.25)', width:1.1, glowWidth:5, opacity:0.50, dotR:3 },
  E: { stroke:'#111',    glowColor:'rgba(0,0,0,0.10)',       width:0.9, glowWidth:4, opacity:0.35, dotR:2.5, dash:'5 4' },
};

function getConnStyle(theme) {
  const sty = Object.assign({}, CONN_STYLES[theme]);
  if(theme==='E' && document.getElementById('cE')?.classList.contains('renkli')) {
    sty.stroke = '#aaa';
    sty.glowColor = 'rgba(200,200,200,0.15)';
    sty.opacity = 0.5;
  }
  return sty;
}

// Aktif bağlantılar: { theme: { locId, connections: [{glowPath, mainPath, dotEl, filmId}] } }
let activeConns = {};

// Film item left-center koordinatı
const FILM_EL = {
  A: fid => document.getElementById('aFilm'+fid),
  B: fid => document.getElementById('bFilm'+fid),
  D: fid => document.getElementById('dFilm'+fid),
  E: fid => document.getElementById('eFilm'+fid),
};

function clearConnLines(){
  const svg = document.getElementById('conn-svg');
  while(svg.firstChild) svg.removeChild(svg.firstChild);
  activeConns = {};
}

function buildConnLine(theme, locId){
  // Önceki çizgileri temizle ama defs'i koru
  const svg = document.getElementById('conn-svg');
  while(svg.firstChild) svg.removeChild(svg.firstChild);
  activeConns[theme] = null;

  const loc = LOCS.find(l=>l.id===locId);
  const m = maps[theme];
  if(!loc || !m) return;

  const sty = getConnStyle(theme);
  const mapEl = document.getElementById('map'+theme);
  if(!mapEl) return;
  const mapRect = mapEl.getBoundingClientRect();

  // ── defs: filter + clipPath via createElementNS (innerHTML unreliable in SVG) ──
  const NS = 'http://www.w3.org/2000/svg';
  const defs = document.createElementNS(NS,'defs');

  // glow filter
  const filter = document.createElementNS(NS,'filter');
  filter.setAttribute('id','cg');
  filter.setAttribute('x','-60%'); filter.setAttribute('y','-60%');
  filter.setAttribute('width','220%'); filter.setAttribute('height','220%');
  const blur = document.createElementNS(NS,'feGaussianBlur');
  blur.setAttribute('stdDeviation','1.8'); blur.setAttribute('result','b');
  const merge = document.createElementNS(NS,'feMerge');
  const mn1 = document.createElementNS(NS,'feMergeNode'); mn1.setAttribute('in','b');
  const mn2 = document.createElementNS(NS,'feMergeNode'); mn2.setAttribute('in','SourceGraphic');
  merge.appendChild(mn1); merge.appendChild(mn2);
  filter.appendChild(blur); filter.appendChild(merge);
  defs.appendChild(filter);

  // clipPath — harita çerçevesiyle sınırla
  const clipPath = document.createElementNS(NS,'clipPath');
  clipPath.setAttribute('id','map-clip-'+theme);
  clipPath.setAttribute('clipPathUnits','userSpaceOnUse');
  const clipRect = document.createElementNS(NS,'rect');
  clipRect.setAttribute('id','map-clip-rect-'+theme);
  clipRect.setAttribute('x', String(mapRect.left));
  clipRect.setAttribute('y', String(mapRect.top));
  clipRect.setAttribute('width', String(mapRect.width));
  clipRect.setAttribute('height', String(mapRect.height));
  clipPath.appendChild(clipRect);
  defs.appendChild(clipPath);
  svg.appendChild(defs);

  // ── kaynak nokta (harita üstünde, clipped) ──
  const srcGroup = document.createElementNS(NS,'g');
  srcGroup.setAttribute('clip-path','url(#map-clip-'+theme+')');

  const srcOuter = document.createElementNS(NS,'circle');
  srcOuter.setAttribute('r','8');
  srcOuter.setAttribute('fill', sty.stroke);
  srcOuter.setAttribute('opacity','0.12');
  srcGroup.appendChild(srcOuter);

  const srcDot = document.createElementNS(NS,'circle');
  srcDot.setAttribute('r','4');
  srcDot.setAttribute('fill', sty.stroke);
  srcDot.setAttribute('opacity','0.75');
  srcGroup.appendChild(srcDot);
  svg.appendChild(srcGroup);

  // ── çizgi grubu (clipped to map) ──
  const lineGroup = document.createElementNS(NS,'g');
  lineGroup.setAttribute('clip-path','url(#map-clip-'+theme+')');
  svg.appendChild(lineGroup);

  // Her film için glow + main path + uç nokta oluştur
  const filmElFn = FILM_EL[theme];
  const connections = [];

  loc.films.forEach(fid => {
    const glowPath = document.createElementNS(NS,'path');
    glowPath.setAttribute('fill','none');
    glowPath.setAttribute('stroke', sty.stroke);
    glowPath.setAttribute('stroke-width', String(sty.glowWidth));
    glowPath.setAttribute('stroke-linecap','round');
    glowPath.setAttribute('opacity','0');
    lineGroup.appendChild(glowPath);

    const mainPath = document.createElementNS(NS,'path');
    mainPath.setAttribute('fill','none');
    mainPath.setAttribute('stroke', sty.stroke);
    mainPath.setAttribute('stroke-width', String(sty.width));
    mainPath.setAttribute('stroke-linecap','round');
    mainPath.setAttribute('filter','url(#cg)');
    mainPath.setAttribute('opacity','0');
    if(sty.dash) mainPath.setAttribute('stroke-dasharray', sty.dash);
    lineGroup.appendChild(mainPath);

    const dot = document.createElementNS(NS,'circle');
    dot.setAttribute('r', String(sty.dotR));
    dot.setAttribute('fill', sty.stroke);
    dot.setAttribute('opacity','0');
    lineGroup.appendChild(dot);

    connections.push({ glowPath, mainPath, dot, filmId: fid });
  });

  activeConns[theme] = { locId, connections, srcDot, srcOuter, sty };

  // İlk pozisyon hesabı + animate in
  updateConnPositions(theme, true);
}

/* Film detay açıkken: film panel item → haritadaki mekan pinleri */
function buildConnLineFilm(theme, filmId){
  const svg = document.getElementById('conn-svg');
  while(svg.firstChild) svg.removeChild(svg.firstChild);
  activeConns[theme] = null;

  const f = FILMS.find(x=>x.id===filmId);
  const m = maps[theme];
  if(!f || !m) return;

  const locs = LOCS.filter(l=>f.locs.includes(l.id));
  if(!locs.length) return;

  const sty = getConnStyle(theme);
  const NS = 'http://www.w3.org/2000/svg';

  // defs
  const defs = document.createElementNS(NS,'defs');
  const filter = document.createElementNS(NS,'filter');
  filter.setAttribute('id','cg'); filter.setAttribute('x','-60%'); filter.setAttribute('y','-60%');
  filter.setAttribute('width','220%'); filter.setAttribute('height','220%');
  const blur = document.createElementNS(NS,'feGaussianBlur');
  blur.setAttribute('stdDeviation','1.8'); blur.setAttribute('result','b');
  const merge = document.createElementNS(NS,'feMerge');
  const mn1 = document.createElementNS(NS,'feMergeNode'); mn1.setAttribute('in','b');
  const mn2 = document.createElementNS(NS,'feMergeNode'); mn2.setAttribute('in','SourceGraphic');
  merge.appendChild(mn1); merge.appendChild(mn2);
  filter.appendChild(blur); filter.appendChild(merge);
  defs.appendChild(filter);

  const mapEl = document.getElementById('map'+theme);
  if(!mapEl) return;
  const mapRect = mapEl.getBoundingClientRect();
  const clipPath = document.createElementNS(NS,'clipPath');
  clipPath.setAttribute('id','map-clip-'+theme);
  clipPath.setAttribute('clipPathUnits','userSpaceOnUse');
  const clipRect = document.createElementNS(NS,'rect');
  clipRect.setAttribute('id','map-clip-rect-'+theme);
  clipRect.setAttribute('x', mapRect.left); clipRect.setAttribute('y', mapRect.top);
  clipRect.setAttribute('width', mapRect.width); clipRect.setAttribute('height', mapRect.height);
  clipPath.appendChild(clipRect);
  defs.appendChild(clipPath);
  svg.appendChild(defs);

  const lineGroup = document.createElementNS(NS,'g');
  lineGroup.setAttribute('clip-path','url(#map-clip-'+theme+')');
  svg.appendChild(lineGroup);

  // Source dot group (NOT clipped — lives in film panel)
  const srcGroup = document.createElementNS(NS,'g');
  const srcOuter = document.createElementNS(NS,'circle');
  srcOuter.setAttribute('r','7'); srcOuter.setAttribute('fill', sty.stroke); srcOuter.setAttribute('opacity','0.12');
  const srcDot = document.createElementNS(NS,'circle');
  srcDot.setAttribute('r','3.5'); srcDot.setAttribute('fill', sty.stroke); srcDot.setAttribute('opacity','0.75');
  srcGroup.appendChild(srcOuter); srcGroup.appendChild(srcDot);
  svg.appendChild(srcGroup);

  const filmElFn = FILM_EL[theme];
  const connections = [];

  locs.forEach(loc=>{
    const glowPath = document.createElementNS(NS,'path');
    glowPath.setAttribute('fill','none'); glowPath.setAttribute('stroke', sty.stroke);
    glowPath.setAttribute('stroke-width', String(sty.glowWidth)); glowPath.setAttribute('stroke-linecap','round');
    glowPath.setAttribute('opacity','0');
    lineGroup.appendChild(glowPath);

    const mainPath = document.createElementNS(NS,'path');
    mainPath.setAttribute('fill','none'); mainPath.setAttribute('stroke', sty.stroke);
    mainPath.setAttribute('stroke-width', String(sty.width)); mainPath.setAttribute('stroke-linecap','round');
    mainPath.setAttribute('filter','url(#cg)'); mainPath.setAttribute('opacity','0');
    if(sty.dash) mainPath.setAttribute('stroke-dasharray', sty.dash);
    lineGroup.appendChild(mainPath);

    const dot = document.createElementNS(NS,'circle');
    dot.setAttribute('r', String(sty.dotR)); dot.setAttribute('fill', sty.stroke); dot.setAttribute('opacity','0');
    lineGroup.appendChild(dot);

    connections.push({ glowPath, mainPath, dot, locId: loc.id });
  });

  // filmMode flag — locId not used for source
  activeConns[theme] = { filmId, filmMode: true, connections, srcDot, srcOuter, sty };
  updateConnPositions(theme, true);
}

function updateConnPositions(theme, animate){
  const conn = activeConns[theme];
  if(!conn) return;
  const m = maps[theme];
  if(!m) return;

  const mapEl = document.getElementById('map'+theme);
  if(!mapEl) return;
  const mapRect = mapEl.getBoundingClientRect();

  const clipRect = document.getElementById('map-clip-rect-'+theme);
  if(clipRect){
    clipRect.setAttribute('x', mapRect.left); clipRect.setAttribute('y', mapRect.top);
    clipRect.setAttribute('width', mapRect.width); clipRect.setAttribute('height', mapRect.height);
  }

  const sty = conn.sty;

  if(conn.filmMode){
    // Source = film panel item, targets = map loc pins
    const filmEl = FILM_EL[theme](conn.filmId);
    if(!filmEl) return;
    const fRect = filmEl.getBoundingClientRect();
    const sx = fRect.right - 4;
    const sy = fRect.top + fRect.height * 0.5;
    conn.srcDot.setAttribute('cx', sx);   conn.srcDot.setAttribute('cy', sy);
    conn.srcOuter.setAttribute('cx', sx); conn.srcOuter.setAttribute('cy', sy);

    conn.connections.forEach(({ glowPath, mainPath, dot, locId }, i) => {
      const loc = LOCS.find(l=>l.id===locId);
      if(!loc){ glowPath.style.display='none'; mainPath.style.display='none'; dot.style.display='none'; return; }
      const pt = m.latLngToContainerPoint([loc.lat, loc.lng]);
      const tx = mapRect.left + pt.x;
      const ty = mapRect.top  + pt.y;
      glowPath.style.display=''; mainPath.style.display=''; dot.style.display='';
      const dx = tx - sx;
      const cx1 = sx + dx*0.45; const cy1 = sy - Math.abs(dx)*0.05;
      const cx2 = tx - Math.abs(dx)*0.1; const cy2 = ty;
      const d = `M${sx},${sy} C${cx1},${cy1} ${cx2},${cy2} ${tx},${ty}`;
      glowPath.setAttribute('d', d); mainPath.setAttribute('d', d);
      dot.setAttribute('cx', tx); dot.setAttribute('cy', ty);
      if(animate){
        if(!sty.dash){
          const len = mainPath.getTotalLength();
          mainPath.style.strokeDasharray = len; mainPath.style.strokeDashoffset = len;
          mainPath.style.transition = `stroke-dashoffset ${0.4+i*0.1}s ease ${i*0.08}s`;
          requestAnimationFrame(()=>requestAnimationFrame(()=>{ mainPath.style.strokeDashoffset='0'; }));
        } else {
          mainPath.style.transition = `opacity ${0.3+i*0.07}s ease ${i*0.06}s`;
          requestAnimationFrame(()=>requestAnimationFrame(()=>mainPath.setAttribute('opacity', String(sty.opacity))));
        }
        glowPath.style.transition = `opacity ${0.3+i*0.07}s ease ${i*0.04}s`;
        dot.style.transition = `opacity 0.2s ease ${0.38+i*0.07}s`;
        requestAnimationFrame(()=>requestAnimationFrame(()=>{
          glowPath.setAttribute('opacity', String(parseFloat(sty.opacity)*0.35));
          dot.setAttribute('opacity','0.65');
        }));
      } else {
        mainPath.setAttribute('opacity', String(sty.opacity));
        glowPath.setAttribute('opacity', String(parseFloat(sty.opacity)*0.35));
        dot.setAttribute('opacity','0.65');
        if(!sty.dash) mainPath.setAttribute('stroke-dasharray','none');
      }
    });
    return;
  }

  // Loc mode (mekan seçilince): source = map pin, targets = film panel items
  const loc = LOCS.find(l=>l.id===conn.locId);
  if(!loc) return;
  const pt = m.latLngToContainerPoint([loc.lat, loc.lng]);
  const sx = mapRect.left + pt.x;
  const sy = mapRect.top  + pt.y;

  conn.srcDot.setAttribute('cx', sx);   conn.srcDot.setAttribute('cy', sy);
  conn.srcOuter.setAttribute('cx', sx); conn.srcOuter.setAttribute('cy', sy);

  const filmElFn = FILM_EL[theme];

  conn.connections.forEach(({ glowPath, mainPath, dot, filmId }, i) => {
    const el = filmElFn(filmId);
    if(!el){ glowPath.style.display='none'; mainPath.style.display='none'; dot.style.display='none'; return; }
    const elRect = el.getBoundingClientRect();
    if(elRect.width === 0){ glowPath.style.display='none'; mainPath.style.display='none'; dot.style.display='none'; return; }
    const tx = elRect.left + 5;
    const ty = elRect.top  + elRect.height * 0.5;

    glowPath.style.display='';
    mainPath.style.display='';
    dot.style.display='';

    const dx = tx - sx;
    const cx1 = sx + dx * 0.5;
    const cy1 = sy - Math.abs(dx) * 0.06;
    const cx2 = tx - Math.abs(dx) * 0.12;
    const cy2 = ty;
    const d = `M${sx},${sy} C${cx1},${cy1} ${cx2},${cy2} ${tx},${ty}`;

    glowPath.setAttribute('d', d);
    mainPath.setAttribute('d', d);
    dot.setAttribute('cx', tx);
    dot.setAttribute('cy', ty);

    if(animate){
      // draw animation via dashoffset (non-dashed themes)
      if(!sty.dash){
        const len = mainPath.getTotalLength();
        mainPath.setAttribute('stroke-dasharray', String(len));
        mainPath.style.strokeDashoffset = String(len);
        mainPath.style.transition = `stroke-dashoffset ${0.38 + i*0.07}s cubic-bezier(.4,0,.2,1) ${i*0.05}s, opacity 0.15s ease`;
        requestAnimationFrame(()=>requestAnimationFrame(()=>{
          mainPath.style.strokeDashoffset = '0';
          mainPath.setAttribute('opacity', String(sty.opacity));
        }));
      } else {
        mainPath.style.transition = `opacity ${0.3+i*0.07}s ease ${i*0.06}s`;
        requestAnimationFrame(()=>requestAnimationFrame(()=>mainPath.setAttribute('opacity', String(sty.opacity))));
      }

      glowPath.style.transition = `opacity ${0.3+i*0.07}s ease ${i*0.04}s`;
      dot.style.transition = `opacity 0.2s ease ${0.38+i*0.07}s`;
      requestAnimationFrame(()=>requestAnimationFrame(()=>{
        glowPath.setAttribute('opacity', String(parseFloat(sty.opacity)*0.35));
        dot.setAttribute('opacity','0.65');
      }));
    } else {
      // live update — no animation, just reposition
      mainPath.setAttribute('opacity', String(sty.opacity));
      glowPath.setAttribute('opacity', String(parseFloat(sty.opacity)*0.35));
      dot.setAttribute('opacity','0.65');
      if(!sty.dash) mainPath.setAttribute('stroke-dasharray','none');
    }
  });
}

// Tüm scroll ve move eventlerinde çağrılır — sadece koordinat günceller
function liveUpdateConn(theme){
  if(activeConns[theme]) updateConnPositions(theme, false);
}