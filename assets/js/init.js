function attachMapRedraw(theme, m){
  let redrawTimer;
  m.on('move zoom', ()=>{
    liveUpdateConn(theme);
    clearTimeout(redrawTimer);
    redrawTimer = setTimeout(()=> liveUpdateConn(theme), 80);
  });
}