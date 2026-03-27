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
  // Türkçe büyük ünlü uyumu — onlukların okunuşuna göre
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
  if(eOpenDecades.has(key)) eOpenDecades.delete(key);
  else eOpenDecades.add(key);
  const grp = document.querySelector('.e-decade-group[data-decade="'+d+'"]');
  if(!grp) return;
  const isOpen = eOpenDecades.has(key);
  const arr = grp.querySelector('.e-decade-hdr-arr');
  const body = grp.querySelector('.e-decade-body');
  if(arr) arr.className = 'e-decade-hdr-arr'+(isOpen?' open':'');
  if(body) body.className = 'e-decade-body'+(isOpen?' open':' closed');
}

function eOpenDecadesForFilms(filmIds){
  filmIds.forEach(fid=>{
    const f = FILMS.find(x=>x.id===fid);
    if(!f) return;
    const d = String(Math.floor(f.year/10)*10);
    if(!eOpenDecades.has(d)){
      eOpenDecades.add(d);
      const grp = document.querySelector('.e-decade-group[data-decade="'+d+'"]');
      if(grp){
        const arr = grp.querySelector('.e-decade-hdr-arr');
        const body = grp.querySelector('.e-decade-body');
        if(arr) arr.className = 'e-decade-hdr-arr open';
        if(body) body.className = 'e-decade-body open';
      }
    }
  });
}

function eUpdateCounts(){
  const visible = FILMS.filter(f=>
    (!eActiveGenre  || f.genre===eActiveGenre) &&
    (!eActiveDir    || f.dir===eActiveDir)
  );
  document.getElementById('eCountsEl').innerHTML =
    `${visible.length} film<br>${LOCS.length} mekan`;
}

function eApplyFilters(){
  const filtered = FILMS.filter(f=>
    (!eActiveGenre || f.genre===eActiveGenre) &&
    (!eActiveDir   || f.dir===eActiveDir)
  );
  eRenderFilms(filtered);
  eUpdateCounts();
  LOCS.forEach(loc=>{
    const has = loc.films.some(fid=>filtered.find(f=>f.id===fid));
    const el = document.getElementById('eLoc'+loc.id);
    if(el) el.style.opacity = has ? '1' : '0.28';
  });
}

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
    const mk = markers['E']?.[locId];
    if(mk) mk.setZIndexOffset(1000);
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

  // Tüm decadeleri kapat, sadece ilgili olanları aç
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

  ePinsResetAll();
  eActiveLoc = id;
  ePinHighlight(id, true);

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