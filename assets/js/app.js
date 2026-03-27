function buildE(){
  // Genre chips
  const genres = [...new Set(FILMS.map(f=>f.genre))].sort();
  const chips = document.getElementById('eGenreChips');
  genres.forEach(g=>{
    const btn = document.createElement('button');
    btn.className = 'e-genre-chip-inner';
    btn.textContent = g.toUpperCase();
    btn.title = g;
    btn.onclick = ()=> eSetGenre(g, btn);
    chips.appendChild(btn);
  });

  // Loc category chips
  const ALL_LOC_CATS = ['Plato','Stüdyo','Sokak','Simge Yapı','Otel','Okul','Diğer'];
  const lcEl = document.getElementById('eLocCatChips');
  ALL_LOC_CATS.forEach(c=>{
    const btn = document.createElement('button');
    btn.className = 'e-loc-cat-chip';
    btn.textContent = c.toUpperCase();
    btn.dataset.cat = c;
    const hasData = LOCS.some(l=>l.cat===c);
    if(!hasData) btn.classList.add('empty');
    btn.onclick = ()=>{ if(!btn.classList.contains('empty')) eSetLocCat(c, btn); };
    lcEl.appendChild(btn);
  });

  eRenderLocs();
  eRenderFilms();
  eUpdateCounts();
  // Sync loc-cat-chips height to sum of right-column filter areas
  requestAnimationFrame(eSyncFilterHeights);
}

function eSyncFilterHeights(){
  const genre = document.getElementById('eGenreChips');
  const cats  = document.getElementById('eLocCatChips');
  if(!genre||!cats) return;
  cats.style.height = genre.offsetHeight + 'px';
}


function eSetGenre(g, btn){
  eActiveGenre = g;
  document.querySelectorAll('.e-genre-chip-inner').forEach(b=>b.classList.remove('on'));
  btn.classList.add('on');
  eApplyFilters();
}

/* Director autocomplete */
/* ══════════════════════════════════════════════
   UNIFIED MAP SEARCH
   Film (kırmızı) · Mekan (mavi) · Yönetmen (yeşil)
══════════════════════════════════════════════ */
let eSearchFocusIdx = -1;
let eSearchItems    = []; // flat list for keyboard nav

function eSearchType(val) {
  eSearchFocusIdx = -1;
  const drop = document.getElementById('eSearchDrop');
  const clear = document.getElementById('eSearchClear');
  const q = val.trim().toLowerCase();
  clear.classList.toggle('on', val.length > 0);
  if (!q) {
    drop.classList.remove('open');
    drop.innerHTML = '';
    eSearchItems = [];
    return;
  }
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const hi = (str) => str.replace(new RegExp(`(${esc(q)})`, 'gi'), '<em>$1</em>');

  const films = FILMS.filter(f =>
    f.title.toLowerCase().includes(q) || f.dir.toLowerCase().includes(q)
  ).sort((a, b) => {
    const aT = a.title.toLowerCase(), bT = b.title.toLowerCase();
    if (aT === q && bT !== q) return -1;
    if (bT === q && aT !== q) return 1;
    if (aT.startsWith(q) && !bT.startsWith(q)) return -1;
    if (!aT.startsWith(q) && bT.startsWith(q)) return 1;
    return b.year - a.year;
  });

  const locs = LOCS.filter(l => l.name.toLowerCase().includes(q))
    .sort((a, b) => {
      const aN = a.name.toLowerCase(), bN = b.name.toLowerCase();
      if (aN === q) return -1;
      if (aN.startsWith(q) && !bN.startsWith(q)) return -1;
      return aN.localeCompare(bN);
    });

  const dirs = [...new Set(FILMS.map(f => f.dir))].filter(d =>
    d.toLowerCase().includes(q)
  ).sort((a, b) => a.toLowerCase().startsWith(q) ? -1 : 0);

  eSearchItems = [];
  let html = '';

  if (films.length) {
    html += `<div class="e-search-group-lbl type-film">FİLM</div>`;
    films.slice(0, 6).forEach(f => {
      const idx = eSearchItems.length;
      eSearchItems.push({ type: 'film', id: f.id });
      html += `<div class="e-search-item type-film" data-idx="${idx}" onmousedown="eSearchSelect(${idx})">
        <span class="e-search-item-name">${hi(f.title)}</span>
        <span class="e-search-item-sub">${f.year} · ${f.genre}</span>
      </div>`;
    });
  }
  if (locs.length) {
    html += `<div class="e-search-group-lbl type-loc">MEKAN</div>`;
    locs.slice(0, 5).forEach(l => {
      const idx = eSearchItems.length;
      eSearchItems.push({ type: 'loc', id: l.id });
      html += `<div class="e-search-item type-loc" data-idx="${idx}" onmousedown="eSearchSelect(${idx})">
        <span class="e-search-item-name">${hi(l.name)}</span>
        <span class="e-search-item-sub">${l.ilce} · ${l.cat}</span>
      </div>`;
    });
  }
  if (dirs.length) {
    html += `<div class="e-search-group-lbl type-dir">YÖNETMEN</div>`;
    dirs.slice(0, 4).forEach(d => {
      const idx = eSearchItems.length;
      eSearchItems.push({ type: 'dir', dir: d });
      const count = FILMS.filter(f => f.dir === d).length;
      html += `<div class="e-search-item type-dir" data-idx="${idx}" onmousedown="eSearchSelect(${idx})">
        <span class="e-search-item-name">${hi(d)}</span>
        <span class="e-search-item-sub">${count} film</span>
      </div>`;
    });
  }
  if (!html) { drop.classList.remove('open'); drop.innerHTML = ''; return; }
  drop.innerHTML = html;
  drop.classList.add('open');
}

function eSearchSelect(idx){
  const item = eSearchItems[idx];
  if(!item) return;
  document.getElementById('eSearchInput').value = '';
  document.getElementById('eSearchClear').classList.remove('on');
  document.getElementById('eSearchDrop').classList.remove('open');
  eSearchItems = [];

  if(item.type==='film'){
    openMedia(item.id);
  } else if(item.type==='loc'){
    eSelectLoc(item.id);
  } else if(item.type==='dir'){
    // Media paneli açıksa kapat
    if(document.getElementById('mp').classList.contains('open')) closeMedia();
    eActiveDir = item.dir;
    eApplyFilters();
    eFilterMapMarkers();
    // Badge güncelle
    const badge = document.getElementById('eDirBadge');
    document.getElementById('eDirBadgeLbl').textContent = item.dir;
    badge.style.display = 'flex';
    // O yönetmenin filmlerinin bulunduğu tüm decadeleri aç
    const dirFilmIds = FILMS.filter(f=>f.dir===item.dir).map(f=>f.id);
    eOpenDecadesForFilms(dirFilmIds);
    // İlk filme scroll + tüm filmler flash
    if(dirFilmIds.length){
      const firstEl = document.getElementById('eFilm'+dirFilmIds[0]);
      if(firstEl) setTimeout(()=>firstEl.scrollIntoView({block:'nearest'}), 100);
      // Kısa gecikme ile flash — decadeler açıldıktan sonra
      setTimeout(()=>{
        dirFilmIds.forEach((fid, i)=>{
          const el = document.getElementById('eFilm'+fid);
          if(!el) return;
          el.classList.remove('flash');
          void el.offsetWidth; // reflow
          setTimeout(()=>el.classList.add('flash'), i * 60);
          setTimeout(()=>el.classList.remove('flash'), i * 60 + 800);
        });
      }, 150);
    }
  }
}

function eSearchKey(e){
  const items = document.querySelectorAll('#eSearchDrop .e-search-item');
  if(!items.length) return;
  if(e.key==='ArrowDown'){ e.preventDefault(); eSearchFocusIdx=Math.min(eSearchFocusIdx+1,items.length-1); eSearchFocusSet(items); }
  else if(e.key==='ArrowUp'){ e.preventDefault(); eSearchFocusIdx=Math.max(eSearchFocusIdx-1,0); eSearchFocusSet(items); }
  else if(e.key==='Enter'&&eSearchFocusIdx>=0){ eSearchSelect(parseInt(items[eSearchFocusIdx].dataset.idx)); }
  else if(e.key==='Escape'){ eSearchClear(); }
}

function eSearchFocusSet(items){
  items.forEach((el,i)=>el.classList.toggle('focus', i===eSearchFocusIdx));
}

function eSearchClear(){
  document.getElementById('eSearchInput').value = '';
  document.getElementById('eSearchClear').classList.remove('on');
  document.getElementById('eSearchDrop').classList.remove('open');
  eSearchItems = [];
  if(eActiveDir){
    eActiveDir='';
    const badge = document.getElementById('eDirBadge');
    if(badge) badge.style.display = 'none';
    eApplyFilters();
    eFilterMapMarkers();
  }
}

document.addEventListener('click', e=>{
  if(!e.target.closest('.e-search-wrap')) document.getElementById('eSearchDrop')?.classList.remove('open');
});

function eSetLocCat(c, btn){
  if(eActiveLocCat === c){
    eActiveLocCat = '';
    btn.classList.remove('on');
  } else {
    eActiveLocCat = c;
    document.querySelectorAll('.e-loc-cat-chip').forEach(b=>b.classList.remove('on'));
    btn.classList.add('on');
  }
  eRenderLocs();
  eFilterMapMarkers();
}

function eSetTheme(mode){
  const cE = document.getElementById('cE');
  const mp = document.getElementById('mp');
  const btnS = document.getElementById('eBtnSade');
  const btnR = document.getElementById('eBtnRenkli');
  const logo = document.getElementById('eLogoImg');
  const logoBase = 'assets/images/logo';
  if(mode==='renkli'){
    cE.classList.add('renkli');
    if(mp) mp.classList.add('renkli');
    if(logo) logo.src = logoBase + '_dark.png';
    btnR.classList.add('active');
    btnS.classList.remove('active');
  } else {
    cE.classList.remove('renkli');
    if(mp) mp.classList.remove('renkli');
    if(logo) logo.src = logoBase + '.png';
    btnS.classList.add('active');
    btnR.classList.remove('active');
  }
}