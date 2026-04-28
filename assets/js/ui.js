/* ════════════════════════════════════════════════════════════
   ui.js — MapLibre Edition
   Değişiklikler:
   - eSelectLoc: setView → flyTo (MapLibre)
   - ePinsResetAll çağrısı güncellendi (artık argüman almıyor)
   ════════════════════════════════════════════════════════════ */

function eRenderLocs(){
  const list = eActiveLocCat ? LOCS.filter(l=>l.cat===eActiveLocCat) : LOCS;
  document.getElementById('eLocs').innerHTML = list.map(loc=>`
    <div class="e-loc-row" id="eLoc${loc.id}" onclick="eSelectLoc(${loc.id})">
      <div class="e-loc-name">${loc.name}</div>
      <div class="e-loc-meta">${loc.ilce}</div>
      <div class="e-loc-fc">${loc.films.length} film</div>
    </div>`).join('');
}

/* ── 10 yıllık accordion ── */
const eOpenDecades = new Set();

function eDecadeLabel(d){
  const tens = Math.floor((d % 100) / 10);
  const suffix = {0:'ler',1:'lar',2:'ler',3:'lar',4:'lar',5:'ler',6:'lar',7:'ler',8:'ler',9:'lar'}[tens];
  return String(d) + '\'' + suffix;
}

function eRenderFilms(films){
  const list = [...(films || FILMS)].sort((a,b)=>b.year-a.year);
  const byDecade = {};
  list.forEach(f=>{
    const d = Math.floor(f.year/10)*10;
    if(!byDecade[d]) byDecade[d]=[];
    byDecade[d].push(f);
  });
  const decades = Object.keys(byDecade).sort((a,b)=>b-a);
  if(eOpenDecades.size===0 && decades.length) eOpenDecades.add(String(decades[0]));

  document.getElementById('eFilms').innerHTML = decades.map(d=>{
    const fs = byDecade[d];
    const isOpen = eOpenDecades.has(String(d));
    const rows = fs.map(f=>
      '<div class="e-film-row" id="eFilm'+f.id+'" onclick="openMedia('+f.id+')">' +
        '<div class="e-fy">'+f.year+'</div>' +
        '<div class="e-ft">'+f.title+'</div>' +
        '<div class="e-fd">'+f.dir.split(' ').pop()+'</div>' +
      '</div>'
    ).join('');
    return '<div class="e-decade-group" data-decade="'+d+'">' +
      '<div class="e-decade-hdr" onclick="eToggleDecade('+d+')">' +
        '<span class="e-decade-hdr-lbl">'+eDecadeLabel(parseInt(d))+'</span>' +
        '<div class="e-decade-hdr-bar"></div>' +
        '<span class="e-decade-hdr-cnt">'+fs.length+'</span>' +
        '<span class="e-decade-hdr-arr'+(isOpen?' open':'')+'">›</span>' +
      '</div>' +
      '<div class="e-decade-body'+(isOpen?' open':' closed')+'">' +
        rows +
      '</div>' +
    '</div>';
  }).join('');
}

function eToggleDecade(d){
  const key = String(d);
  const willOpen = !eOpenDecades.has(key);
  if (window.DEBUG_CLICK) console.log(`[ui] eToggleDecade ${d} → ${willOpen ? 'aç' : 'kapat'}`);
  if(eOpenDecades.has(key)) eOpenDecades.delete(key);
  else eOpenDecades.add(key);
  const grp = document.querySelector('.e-decade-group[data-decade="'+d+'"]');
  if(!grp) return;
  const isOpen = eOpenDecades.has(key);
  const arr  = grp.querySelector('.e-decade-hdr-arr');
  const body = grp.querySelector('.e-decade-body');
  if(arr)  arr.className  = 'e-decade-hdr-arr'  + (isOpen ? ' open' : '');
  if(body) body.className = 'e-decade-body' + (isOpen ? ' open' : ' closed');
}

function eOpenDecadesForFilms(filmIds){
  filmIds.forEach(fid=>{
    const f = FILM_MAP[fid];
    if(!f) return;
    const d = String(Math.floor(f.year/10)*10);
    if(!eOpenDecades.has(d)){
      eOpenDecades.add(d);
      const grp = document.querySelector('.e-decade-group[data-decade="'+d+'"]');
      if(grp){
        const arr  = grp.querySelector('.e-decade-hdr-arr');
        const body = grp.querySelector('.e-decade-body');
        if(arr)  arr.className  = 'e-decade-hdr-arr open';
        if(body) body.className = 'e-decade-body open';
      }
    }
  });
}

function eUpdateCounts(){
  const visible = FILMS.filter(f=>
    (!eActiveGenre  || f.genre===eActiveGenre) &&
    (!eActiveDir    || f.dir===eActiveDir)     &&
    (!eActiveDecade || Math.floor(f.year/10)*10===eActiveDecade)
  );
  document.getElementById('eCountsEl').innerHTML =
    `${visible.length} film<br>${LOCS.length} mekan`;
}

function eApplyFilters(){
  const filtered = FILMS.filter(f=>
    (!eActiveGenre  || f.genre===eActiveGenre) &&
    (!eActiveDir    || f.dir===eActiveDir)     &&
    (!eActiveDecade || Math.floor(f.year/10)*10===eActiveDecade)
  );
  if (window.DEBUG_FILTER) {
    const fs = [];
    if (eActiveGenre)  fs.push(`tür="${eActiveGenre}"`);
    if (eActiveDir)    fs.push(`yön="${eActiveDir}"`);
    if (eActiveDecade) fs.push(`onyıl=${eActiveDecade}`);
    console.log(`[ui] eApplyFilters [${fs.join(' ') || 'yok'}] → ${filtered.length}/${FILMS.length} film`);
  }
  eRenderFilms(filtered);
  eUpdateCounts();
  const filteredIds = new Set(filtered.map(f=>f.id));
  LOCS.forEach(loc=>{
    const has = loc.films.some(fid=>filteredIds.has(fid));
    const el = document.getElementById('eLoc'+loc.id);
    if(el) el.style.opacity = has ? '1' : '0.28';
  });
}

function eSelectLoc(id){
  const loc = LOC_MAP[id];
  if(!loc) { console.warn(`[ui] eSelectLoc: M${id} LOC_MAP'te yok`); return; }
  if (window.DEBUG_CLICK) console.log(`[ui] eSelectLoc M${id} "${loc.name}" — ${loc.films.length} film`);

  // Yönetmen filtresi aktifse kaldır
  if(eActiveDir){
    eActiveDir = '';
    const badge = document.getElementById('eDirBadge');
    if(badge) badge.style.display = 'none';
    eApplyFilters();
    eFilterMapMarkers();
  }

  document.querySelectorAll('#cE .e-loc-row').forEach(el=>el.classList.remove('on'));
  const locEl = document.getElementById('eLoc'+id);
  if(locEl){ locEl.classList.add('on'); locEl.scrollIntoView({block:'nearest'}); }

  // Sadece bu mekânın filmlerinin bulunduğu decadeları aç
  eOpenDecades.clear();
  document.querySelectorAll('.e-decade-body').forEach(el=>el.className='e-decade-body closed');
  document.querySelectorAll('.e-decade-hdr-arr').forEach(el=>el.className='e-decade-hdr-arr');
  eOpenDecadesForFilms(loc.films);

  // Film satırlarını seç
  document.querySelectorAll('#cE .e-film-row').forEach(el=>el.classList.remove('on'));
  loc.films.forEach(fid=>{
    const fe = document.getElementById('eFilm'+fid);
    if(fe) fe.classList.add('on');
  });
  const first = document.getElementById('eFilm'+loc.films[0]);
  if(first) first.scrollIntoView({block:'nearest'});

  // Media panel açıksa kapat
  clearHighlights();
  clearSelLayers();
  clearConnLines();
  const mpEl = document.getElementById('mp');
  if(mpEl.classList.contains('open')){
    mpEl.classList.remove('open');
    const fp = document.querySelector('#cE .e-fp');
    if(fp) fp.style.visibility = '';
  }

  // Pin highlight — MapLibre feature-state (argümansız reset)
  ePinsResetAll();
  eActiveLoc = id;
  ePinHighlight(id, true);

  // Galeri bar
  const bar = document.getElementById('eLocBar');
  bar.classList.add('loc-gallery-bar');
  bar.innerHTML = buildLocGallerySkeleton(loc, 'E');
  bar.style.display = 'flex';
  bar.style.flexDirection = 'column';
  fillLocGallery(loc.id, 'E');
  // eLocBar açılınca harita konteyneri küçülür — MapLibre'ye haber ver


  // Haritaya uç — MapLibre flyTo ([lng, lat] sırası!)
  if(maps.E){
    maps.E.flyTo({ center:[loc.lng, loc.lat], zoom:15, duration:500 });
    if(window._connTimer) clearTimeout(window._connTimer);
    if(window._connMoveEnd) { maps.E.off('moveend', window._connMoveEnd); window._connMoveEnd=null; }
    const _targetLocId = loc.id;
    window._connTimer = setTimeout(()=>{
      window._connTimer = null;
      if(eActiveLoc === _targetLocId) buildConnLine('E', _targetLocId);
    }, 300);
    window._connMoveEnd = () => {
      window._connMoveEnd = null;
      if(eActiveLoc === _targetLocId) setTimeout(()=>buildConnLine('E',_targetLocId), 80);
    };
    maps.E.once('moveend', window._connMoveEnd);
  }
}