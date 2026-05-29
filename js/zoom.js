const _ZOOM_KEY='tp_zt_zoom';
const _ZOOM_DEFAULT=1.2;
let _zoom=parseFloat(localStorage.getItem(_ZOOM_KEY)||String(_ZOOM_DEFAULT));

function _applyZoom(z){
  _zoom=Math.round(Math.max(0.5,Math.min(2.0,z))*10)/10;
  document.body.style.zoom=_zoom;
  localStorage.setItem(_ZOOM_KEY,_zoom);
  const lbl=document.getElementById('zoom-label');
  if(lbl) lbl.textContent=Math.round(_zoom*100)+'%';
}

export function zoomStep(dir){ _applyZoom(_zoom+dir*0.1); }
export function zoomReset(){ _applyZoom(_ZOOM_DEFAULT); }

export function initZoom(){
  _applyZoom(_zoom);
  window.addEventListener('wheel',function(e){
    if(!e.ctrlKey) return;
    e.preventDefault();
    zoomStep(e.deltaY<0?1:-1);
  },{passive:false});
  window.addEventListener('keydown',function(e){
    if(!e.ctrlKey) return;
    if(e.key==='+'||e.key==='='){ e.preventDefault(); zoomStep(1); }
    else if(e.key==='-'){ e.preventDefault(); zoomStep(-1); }
    else if(e.key==='0'){ e.preventDefault(); zoomReset(); }
  });
}
