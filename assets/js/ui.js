function eRenderLocs(){
  const list = eActiveLocCat ? LOCS.filter(l=>l.cat===eActiveLocCat) : LOCS;
  document.getElementById('eLocs').innerHTML = list.map(loc=>`
    <div class="e-loc-row" id="eLoc${loc.id}" onclick="eSelectLoc(${loc.id})">
      <div class="e-loc-name">${loc.name}</div>
      <div class="e-loc-meta">${loc.ilce}</div>
      <div class="e-loc-fc">${loc.films.length} film</div>
    </div>`).join('');
}

function eRenderFilms(films){
  const list = [...(films || FILMS)].sort((a,b)=>b.year-a.year);
  document.getElementById('eFilms').innerHTML = list.map(f=>`
    <div class="e-film-row" id="eFilm${f.id}" onclick="openMedia(${f.id})">
      <div class="e-fy">${f.year}</div>
      <div class="e-ft">${f.title}</div>
      <div class="e-fd">${f.dir.split(' ').pop()}</div>
    </div>`).join('');
}

function eUpdateCounts(){
  const visible = FILMS.filter(f=>
    (!eActiveGenre  || f.genre===eActiveGenre) &&
    (!eActiveDir    || f.dir===eActiveDir) &&
    (!eActiveDecade || Math.floor(f.year/10)*10===eActiveDecade)
  );
  document.getElementById('eCountsEl').innerHTML =
    `${visible.length} film<br>${LOCS.length} mekan`;
}

function eApplyFilters(){
  const filtered = FILMS.filter(f=>
    (!eActiveGenre  || f.genre===eActiveGenre) &&
    (!eActiveDir    || f.dir===eActiveDir) &&
    (!eActiveDecade || Math.floor(f.year/10)*10===eActiveDecade)
  );
  eRenderFilms(filtered);
  eUpdateCounts();
  LOCS.forEach(loc=>{
    const has = loc.films.some(fid=>filtered.find(f=>f.id===fid));
    const el = document.getElementById('eLoc'+loc.id);
    if(el) el.style.opacity = has ? '1' : '0.28';
  });
}

/* Pin highlight — fixed: reset separately, then set multiple */
function ePinsResetAll(){
  LOCS.forEach(l=>{
    const p = document.getElementById('pin-E-'+l.id);
    if(!p) return;
    const label = p.querySelector('.pin-label');
    const stem  = p.querySelector('.pin-stem');
    if(label){ label.style.background='#000'; label.style.color='#fff'; }
    if(stem)   stem.style.background='#000';
  });
}

function ePinHighlight(locId, on, _retry){
  const pinEl = document.getElementById('pin-E-'+locId);
  if(!pinEl){
    if(!_retry) setTimeout(()=>ePinHighlight(locId, on, true), 80);
    return;
  }
  const label = pinEl.querySelector('.pin-label');
  const stem  = pinEl.querySelector('.pin-stem');
  if(on){
    if(label){ label.style.background='#f03010'; label.style.color='#fff'; }
    if(stem)   stem.style.background='#f03010';
    // Marker'ı en üste taşı
    const mk = markers['E']?.[locId];
    if(mk) mk.setZIndexOffset(1000);
    // Leaflet wrapper div'ini de üste taşı
    const wrapEl = pinEl.closest('.leaflet-marker-icon');
    if(wrapEl) wrapEl.style.zIndex = 9000;
  } else {
    if(label){ label.style.background='#000'; label.style.color='#fff'; }
    if(stem)   stem.style.background='#000';
    const mk = markers['E']?.[locId];
    if(mk) mk.setZIndexOffset(0);
    const wrapEl = pinEl.closest('.leaflet-marker-icon');
    if(wrapEl) wrapEl.style.zIndex = '';
  }
}

async function eSelectLoc(id){
  const loc = LOCS.find(l=>l.id===id); if(!loc) return;
  document.querySelectorAll('#cE .e-loc-row').forEach(el=>el.classList.remove('on'));
  const locEl = document.getElementById('eLoc'+id);
  if(locEl){ locEl.classList.add('on'); locEl.scrollIntoView({block:'nearest'}); }
  document.querySelectorAll('#cE .e-film-row').forEach(el=>el.classList.remove('on'));
  loc.films.forEach(fid=>{ const fe=document.getElementById('eFilm'+fid); if(fe) fe.classList.add('on'); });
  const first = document.getElementById('eFilm'+loc.films[0]);
  if(first) first.scrollIntoView({block:'nearest'});
  // pin label: reset all, then highlight selected
  ePinsResetAll();
  eActiveLoc = id;
  ePinHighlight(id, true);
  // gallery dipbar
  const bar = document.getElementById('eLocBar');
  bar.classList.add('loc-gallery-bar');
  bar.innerHTML = await buildLocGallery(loc.id,'E');
  bar.style.display = 'flex';
  bar.style.flexDirection = 'column';
  if(document.getElementById('mp').classList.contains('open')) closeMedia();
  if(maps.E){
    maps.E.setView([loc.lat, loc.lng], 14, {animate:true});
    setTimeout(()=>buildConnLine('E', loc.id), 320);
  }
}

/* ══════════════════════════════════════════════
   SVG CONNECTION LINES
   Referans impl. gibi: path'ler kalıcı store'da,
   scroll/move'da sadece 'd' attribute güncelleniyor
══════════════════════════════════════════════ */
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
const KEYS = ['E','B','A','D'];
let cur = 0;

document.addEventListener('keydown',e=>{
  if(e.key==='Escape') closeMedia();
});

/* ══════════════════════════════════════════════
   INIT
══════════════════════════════════════════════ */

// Yükleniyor göstergesi
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

// redraw connection lines on window resize
window.addEventListener('resize', ()=>{ clearConnLines(); });

// Panel scroll → live reposition connection lines
const PANEL_SCROLL_MAP = {
  aFilmScroll:'A', aLocScroll:'A',
  bScroll:'B',
  dFilmScroll:'D', dLocScroll:'D',
  eLocs:'E', eFilms:'E',
};
Object.entries(PANEL_SCROLL_MAP).forEach(([elId, theme])=>{
  const el = document.getElementById(elId);
  if(el) el.addEventListener('scroll', ()=> requestAnimationFrame(()=> liveUpdateConn(theme)));
});

// hook map move/zoom → redraw lines per theme