import { MONTHS, DAYS, _TPS_LOGO } from './config.js';
import { getData, getEntry, getUser } from './data.js';
import { isFreelancer, isManagerRole, canSeeEmployee } from './roles.js';
import { diffMin, addMin, isWeekend, isoWeek, dateStr, daysInMonth, getHolidays, hFmt, minFmt, dayFmt, esc, fmtTs, toast } from './utils.js';
import { monthSOLL, getEffectiveCarryH, normZuord, autoPauseMin, vacUsedUpToMonth, totalVacUsed } from './calc.js';

export function pdfTitle(y,m,who){ return y+' '+MONTHS[m-1]+' - '+who+' Zeiterfassung'; }

export function printFull(){
  const cu=window.cu;
  const u=getUser(window.viewEmpId||cu.id);
  const prev=document.title;
  document.title=pdfTitle(window.year,window.mon,u?u.name:'Zeiterfassung');
  window.print();
  document.title=prev;
}

export function printBuchhaltung(){
  const cu=window.cu;
  const uid=window.viewEmpId||cu.id;
  const u=getUser(uid);
  if(!u){ toast('Mitarbeiter nicht gefunden.','err'); return; }
  _openPerEmpPrint([u],window.year,window.mon);
}

export function printTeamBuchhaltung(){
  const cu=window.cu;
  const d=getData();
  const emps=d.users.filter(u=>!isManagerRole(u)).filter(u=>canSeeEmployee(cu,u));
  if(!emps.length){ toast('Keine Mitarbeiter im Team vorhanden.','err'); return; }
  _openPerEmpPrint(emps,window.year,window.mon);
}

export function _openPerEmpPrint(emps,y,m){
  const win=window.open('','_blank');
  if(!win){ toast('Popup blockiert – bitte Popup-Blocker deaktivieren.','err'); return; }
  win._pPages=emps.map(function(u){
    const entry=getEntry(u.id,y,m);
    return {name:u.name,html:renderBuchhaltungHTML(u,entry,y,m)};
  });
  win._pMonths=MONTHS; win._pY=y; win._pM=m;
  const style=_teamReportStyle()
    +'.pnav{position:fixed;top:0;left:0;right:0;background:#1a3a5c;color:#fff;padding:8px 14px;display:flex;align-items:center;gap:10px;z-index:9999;font-family:Arial,sans-serif;font-size:12px}'
    +'.pnav button{background:#fff;color:#1a3a5c;border:none;border-radius:5px;padding:5px 13px;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap}'
    +'.pnav button:hover{background:#e8f0fe}'
    +'.pnav .pbtn{background:#27ae60;color:#fff}'
    +'.pnav .pbtn:hover{background:#1e9147}'
    +'.pnav .pbtn-pdf{background:#1a6bbf}'
    +'.pnav .pbtn-pdf:hover{background:#155199}'
    +'.pnav .pctr{flex:1;text-align:center;font-weight:700;font-size:13px;line-height:1.4}'
    +'.pnav .phint{font-size:10px;font-weight:400;opacity:.75;display:block}'
    +'body{padding-top:58px}'
    +'.pz-fixed{position:fixed;bottom:18px;right:18px;z-index:9999;display:flex;align-items:center;gap:5px;background:#1a3a5c;border-radius:24px;padding:5px 12px;box-shadow:0 3px 12px rgba(0,0,0,.25);font-family:Arial,sans-serif}'
    +'.pz-fixed button{background:none;border:none;color:#fff;font-size:17px;font-weight:700;cursor:pointer;width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;line-height:1}'
    +'.pz-fixed button:hover{background:rgba(255,255,255,.2)}'
    +'.pz-fixed span{font-size:11px;font-weight:600;color:#fff;min-width:38px;text-align:center;cursor:pointer}'
    +'@media print{.pnav{display:none!important}.pz-fixed{display:none!important}body{padding-top:0}}';
  const zoomJS=''
    +'var _pz=1;'
    +'function _apz(z){'
    +'  _pz=Math.round(Math.max(0.5,Math.min(2,z))*10)/10;'
    +'  document.body.style.zoom=_pz;'
    +'  var l=document.getElementById("pzLbl");if(l)l.textContent=Math.round(_pz*100)+"%";'
    +'}'
    +'function _pzS(d){_apz(_pz+d*0.1);}'
    +'window.addEventListener("wheel",function(e){if(!e.ctrlKey)return;e.preventDefault();_pzS(e.deltaY<0?1:-1);},{passive:false});'
    +'window.addEventListener("keydown",function(e){'
    +'  if(!e.ctrlKey)return;'
    +'  if(e.key==="+"||e.key==="="){e.preventDefault();_pzS(1);}'
    +'  else if(e.key==="-"){e.preventDefault();_pzS(-1);}'
    +'  else if(e.key==="0"){e.preventDefault();_apz(1);}'
    +'});';
  win.document.write(
    '<!DOCTYPE html><html lang="de"><head>'
    +'<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    +'<title>Zeiterfassung</title>'
    +'<style>'+style+'</style></head><body>'
    +'<div class="pnav">'
    +'<button onclick="pPrev()">&#9664; Zur\xfcck</button>'
    +'<div class="pctr"><span id="pLabel"></span></div>'
    +'<button class="pbtn" onclick="window.print()" title="Drucker ausw\xe4hlen">&#128438;&nbsp;Drucken</button>'
    +'<button class="pbtn pbtn-pdf" onclick="pSavePDF()" title="Im Dialog &quot;Als PDF speichern&quot; w\xe4hlen">&#128196;&nbsp;PDF speichern</button>'
    +'<button onclick="pNext()">Weiter &#9654;</button>'
    +'</div>'
    +'<div class="pz-fixed">'
    +'<button onclick="_pzS(-1)" title="Verkleinern (Strg+-)">&#8722;</button>'
    +'<span id="pzLbl" onclick="_apz(1)" title="Zur\xfccksetzen">100%</span>'
    +'<button onclick="_pzS(1)" title="Vergr\xf6\xdfern (Strg++)">&#43;</button>'
    +'</div>'
    +'<div id="pContent"></div>'
    +'<script>'
    +'var PP=window._pPages,PM=window._pMonths,PY=window._pY,PMN=window._pM,pc=0;'
    +zoomJS
    +'function pShow(i){'
    +'  pc=i;var p=PP[i];'
    +'  document.getElementById("pContent").innerHTML=p.html;'
    +'  document.getElementById("pLabel").textContent=(i+1)+" / "+PP.length+":  "+p.name;'
    +'  document.title=PY+" "+PM[PMN-1]+" - "+p.name+" Zeiterfassung";'
    +'}'
    +'function pNext(){if(pc<PP.length-1)pShow(pc+1);}'
    +'function pPrev(){if(pc>0)pShow(pc-1);}'
    +'function pSavePDF(){'
    +'  var prev=document.title;'
    +'  document.title=PY+" "+PM[PMN-1]+" - "+PP[pc].name+" Zeiterfassung";'
    +'  window.print();'
    +'  document.title=prev;'
    +'}'
    +'pShow(0);'
    +'<\/script></body></html>'
  );
  win.document.close();
}

export function _teamReportStyle(){
  return '*{box-sizing:border-box;margin:0;padding:0}'
    +'body{font-family:Arial,sans-serif;font-size:10px;color:#2c3e50;background:#fff;padding:14px}'
    +'.bh-page{max-width:940px;margin:0 auto;padding-bottom:20px}'
    +'.bh-hdr{display:flex;justify-content:space-between;align-items:flex-end;padding-bottom:10px;border-bottom:3px solid #1a3a5c;margin-bottom:10px}'
    +'.bh-hdr-left .org{font-size:16px;font-weight:700;color:#1a3a5c;line-height:1.2}'
    +'.bh-hdr-left .sub{font-size:9.5px;color:#7f8c8d;margin-top:2px}'
    +'.bh-hdr-right{text-align:right}'
    +'.bh-hdr-right .ttl{font-size:13px;font-weight:700;color:#1a3a5c;letter-spacing:.8px}'
    +'.bh-hdr-right .per{font-size:11px;color:#7f8c8d;margin-top:3px;font-weight:600}'
    +'.bh-info{display:grid;grid-template-columns:1fr 1fr;gap:3px 20px;background:#f4f7fb;border:1px solid #dde1e7;border-radius:4px;padding:8px 12px;margin-bottom:10px}'
    +'.bh-ir{display:flex;gap:6px;font-size:9.5px;align-items:baseline}'
    +'.bh-ir b{color:#1a3a5c;min-width:108px;flex-shrink:0;font-size:9px;text-transform:uppercase;letter-spacing:.3px}'
    +'table{width:100%;border-collapse:collapse}'
    +'th{background:#1a3a5c;color:#fff;padding:4px 3px;text-align:center;font-size:8px;font-weight:700;white-space:nowrap;border-right:1px solid rgba(255,255,255,0.15)}'
    +'th.bh{background:#2d4f70}th.sp{background:#0e2235;width:4px;padding:0;border-right:none}th.l{text-align:left;padding-left:5px}'
    +'td{padding:2.5px 3px;vertical-align:middle;border-bottom:1px solid #e8ecf0;border-right:1px solid #e0e4ea;text-align:center;font-size:9px}'
    +'td.l{text-align:left;padding-left:5px;font-weight:600;font-size:8.5px;white-space:nowrap}'
    +'td.sp{background:#e8edf2;width:4px;padding:0;border-right:none}td.sm{font-weight:700;color:#1a3a5c;font-size:9px}'
    +'td.ps{font-size:8px;color:#7f8c8d;font-weight:600;text-align:center;white-space:nowrap}'
    +'td.tt{font-weight:700;font-size:10px;color:#1a3a5c;background:rgba(26,58,92,.06)}'
    +'.we{background:#fef3e2}.hol{background:#fff0f0!important}'
    +'tfoot td{background:#1a3a5c;color:#fff;font-weight:700;padding:4px 3px;text-align:center;font-size:9px}'
    +'tfoot td.l{text-align:left;padding-left:5px}'
    +'.bh-sum{margin-top:9px;display:flex;flex-wrap:wrap;gap:6px}'
    +'.bh-sc{flex:1;min-width:110px;background:#f4f7fb;border:1px solid #dde1e7;border-radius:4px;padding:6px 10px}'
    +'.bh-sc.pos{border-color:#27ae60;background:#f0fff4}'
    +'.bh-sc.neg{border-color:#c0392b;background:#fff0f0}'
    +'.bh-sc .lbl{font-size:7.5px;color:#7f8c8d;text-transform:uppercase;letter-spacing:.5px}'
    +'.bh-sc .val{font-size:15px;font-weight:700;color:#1a3a5c;margin:2px 0 1px}'
    +'.bh-sc .sub{font-size:8px;color:#7f8c8d}'
    +'.bh-sig{margin-top:18px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:20px;border-top:1px solid #dde1e7;padding-top:14px}'
    +'.bh-sig-col h4{font-size:8.5px;font-weight:700;color:#1a3a5c;margin-bottom:6px;text-transform:uppercase;letter-spacing:.6px}'
    +'.bh-sig-line{border-bottom:1.5px solid #c0c8d8;min-height:44px;display:flex;align-items:flex-end;padding-bottom:4px}'
    +'.bh-dig-sig{font-size:11px;color:#1a3a5c;font-weight:700;line-height:1.3}'
    +'.bh-sig-ts{font-size:9px;color:#7f8c8d;font-weight:400;display:block;margin-top:2px}'
    +'.bh-sig-pending{font-size:10px;color:#7f8c8d;font-style:italic;font-weight:400}'
    +'@media print{body{padding:4px}@page{margin:1.2cm;size:A4}}';
}

export function renderBuchhaltungHTML(u,entry,y,m){
  const _bzuord=z=>{ const norm=normZuord(z||''); return (norm==='Marketing & Öffentlichkeitsarbeit'&&u.team==='Akademie')?'Akademie':norm; };
  const isFree=isFreelancer(u);
  const dim=daysInMonth(y,m);
  const hols=getHolidays(y,u.bundesland||'');
  let rows=''; let monthTotal=0;
  for(let d=1;d<=dim;d++){
    const ds=dateStr(y,m,d);
    const dd=(entry.days||{})[ds]||{};
    const we=isWeekend(y,m,d);
    const hol=hols.has(ds);
    const kw=isoWeek(new Date(y,m-1,d));
    const dn=DAYS[new Date(y,m-1,d).getDay()];
    const b1min=diffMin(dd.b1von||'',dd.b1bis||'');
    const b2min=diffMin(dd.b2von||'',dd.b2bis||'');
    const ktm=Number(dd.ktmin||0);
    const grossMin=b1min+b2min+ktm;
    const pauseMin=autoPauseMin(dd,u);
    const dayMin=Math.max(0,grossMin-pauseMin); // Netto (konsistent mit Bildschirm)
    const b1bisDisp=dd.b1bis||'';
    monthTotal+=dayMin;
    const dateFmt=String(d).padStart(2,'0')+'.'+String(m).padStart(2,'0')+'.'+y;
    const cls=hol?'hol':(we?'we':'');
    let row='<tr'+(cls?' class="'+cls+'"':'')+'>'
      +'<td class="l">'+dateFmt+(hol?'<br><span style="font-size:7.5px;color:#c0392b">Feiertag</span>':'')+'</td>'
      +'<td>'+kw+'</td>'
      +'<td>'+(we?'<b>':'')+dn+(we?'</b>':'')+'</td>'
      +'<td>'+(dd.b1von||'')+'</td>'
      +'<td>'+(b1bisDisp)+'</td>'
      +'<td style="text-align:left;max-width:90px;overflow:hidden;font-size:8px">'+_bzuord(dd.b1zuord||'')+'</td>'
      +'<td class="sm">'+(b1min>0?minFmt(b1min):'')+'</td>';
    if(!isFree){
      row+='<td class="sp"></td>'
        +'<td>'+(dd.b2von||'')+'</td>'
        +'<td>'+(dd.b2bis||'')+'</td>'
        +'<td style="text-align:left;max-width:90px;overflow:hidden;font-size:8px">'+_bzuord(dd.b2zuord||'')+'</td>'
        +'<td class="sm">'+(b2min>0?minFmt(b2min):'')+'</td>'
        +'<td>'+(ktm>0?ktm:'')+'</td>'
        +'<td style="text-align:left;max-width:70px;overflow:hidden;font-size:8px">'+_bzuord(dd.ktzuord||'')+'</td>'
        +'<td class="sm">'+(ktm>0?minFmt(ktm):'')+'</td>';
    }
    row+='<td class="ps">'+(pauseMin>0?minFmt(pauseMin):'')+'</td>'
        +'<td class="tt">'+(dayMin>0?hFmt(dayMin):'')+'</td>'+'</tr>';
    rows+=row;
  }

  const maxH=isFree?(u.maxHours||0):0;
  const soll=monthSOLL(u,y,m);
  const carryH=isFree?getEffectiveCarryH(u.id,u,y,m):(entry.carryover||0);
  const diff=monthTotal-(soll-Math.round(carryH*60));

  let sumCards='<div class="bh-sum">';
  if(isFree&&maxH>0){
    const totalMin=monthTotal+Math.round(carryH*60);
    const billedMin=Math.min(totalMin,maxH*60);
    const overflowMin=Math.max(0,totalMin-maxH*60);
    sumCards+=
      '<div class="bh-sc"><div class="lbl">Geleistete Stunden</div><div class="val">'+hFmt(monthTotal)+'</div><div class="sub">'+(dayFmt(monthTotal)||'IST gesamt')+'</div></div>'
      +'<div class="bh-sc"><div class="lbl">Übertrag Vormonat</div><div class="val">'+(carryH>0?'+':'')+hFmt(Math.round(carryH*60))+'</div><div class="sub">'+(entry.carryoverManual?'manuell':'automatisch')+'</div></div>'
      +'<div class="bh-sc"><div class="lbl">Abgerechnet (max. '+maxH+' h)</div><div class="val">'+hFmt(billedMin)+'</div><div class="sub">'+(dayFmt(billedMin)||'Monatslimit')+'</div></div>'
      +'<div class="bh-sc '+(overflowMin>0?'pos':'')+'"><div class="lbl">Übertrag → nächster Monat</div><div class="val">'+(overflowMin>0?'+'+hFmt(overflowMin):'&ndash;')+'</div><div class="sub">'+(overflowMin>0?(dayFmt(overflowMin)||'wird vorgetragen'):'kein Übertrag')+'</div></div>';
  } else if(isFree){
    sumCards+=
      '<div class="bh-sc"><div class="lbl">Geleistete Stunden</div><div class="val">'+hFmt(monthTotal)+'</div><div class="sub">'+(dayFmt(monthTotal)||'IST gesamt')+'</div></div>'
      +'<div class="bh-sc"><div class="lbl">Übertrag Vormonat</div><div class="val">'+(carryH>0?'+':'')+hFmt(Math.round(carryH*60))+'</div><div class="sub">'+(entry.carryoverManual?'manuell':'automatisch')+'</div></div>';
  } else {
    const diffCls=diff>=0?'pos':'neg';
    const vacUpTo=vacUsedUpToMonth(u.id,y,m);
    const vacApproved=totalVacUsed(u.id,y);
    const vacLeft=(u.al||0)-vacUpTo;
    const vacFuture=Math.max(0,vacApproved-vacUpTo);
    sumCards+=
      '<div class="bh-sc"><div class="lbl">Stunden SOLL</div><div class="val">'+hFmt(soll)+'</div><div class="sub">bei '+u.wh+' h/Woche</div></div>'
      +'<div class="bh-sc"><div class="lbl">Stunden IST</div><div class="val">'+hFmt(monthTotal)+'</div><div class="sub">'+(dayFmt(monthTotal)||'tatsächlich')+'</div></div>'
      +'<div class="bh-sc '+diffCls+'"><div class="lbl">Differenz</div><div class="val">'+(diff>=0?'+':'')+hFmt(Math.abs(diff))+'</div><div class="sub">'+(diff>=0?'über SOLL':'unter SOLL')+'</div></div>'
      +(carryH?'<div class="bh-sc"><div class="lbl">Übertrag Vormonat</div><div class="val">'+(carryH>0?'+':'')+hFmt(Math.round(carryH*60))+'</div><div class="sub">'+(entry.carryoverManual?'manuell':'automatisch')+'</div></div>':'')
      +'<div class="bh-sc"><div class="lbl">Resturlaub</div><div class="val">'+vacLeft+' T</div><div class="sub">'+vacUpTo+' von '+(u.al||0)+'</div></div>';
  }
  sumCards+='</div>';

  const empType=isFree?'Freiberuflich':'Festangestellt, '+u.wh+' h/Woche';
  const statusLabel={draft:'Entwurf',submitted:'Eingereicht',approved:'Genehmigt',rejected:'Abgelehnt'}[entry.status]||entry.status||'Entwurf';
  const _city=u.city||'';
  const _today=new Date().toLocaleDateString('de-DE',{day:'2-digit',month:'2-digit',year:'numeric'});
  const ortDat=entry.submittedAt
    ? _city+(_city?', ':'')+fmtTs(entry.submittedAt).split(' ')[0]
    : _city+(_city?', ':'')+_today;
  let empSigHtml='';
  if(entry.status==='submitted'||entry.status==='approved'||entry.status==='rejected'){
    empSigHtml='<div class="bh-dig-sig">✍ Digital eingereicht<br>'+esc(u.name)+'<span class="bh-sig-ts">'+fmtTs(entry.submittedAt)+'</span></div>';
  } else {
    empSigHtml='<span class="bh-dig-sig bh-sig-pending">Noch nicht eingereicht</span>';
  }
  let mgSigHtml='';
  if(entry.status==='approved'||entry.status==='rejected'){
    const _rev=entry.reviewedBy?getUser(entry.reviewedBy):null;
    const _rName=_rev?_rev.name:'Leitung';
    const _action=entry.status==='approved'?'✓ Genehmigt':'✗ Abgelehnt';
    mgSigHtml='<div class="bh-dig-sig">'+_action+'<br>'+esc(_rName)+'<span class="bh-sig-ts">'+fmtTs(entry.reviewedAt)+'</span>'+(entry.managerNote?'<span class="bh-sig-ts" style="color:#c0392b">'+esc(entry.managerNote)+'</span>':'')+'</div>';
  } else {
    mgSigHtml='<span class="bh-dig-sig bh-sig-pending">Ausstehend</span>';
  }

  return '<div class="bh-page">'
    +'<div class="bh-hdr">'
    +'<div class="bh-hdr-left">'
    +'<img src="'+_TPS_LOGO+'" style="height:46px;width:auto;display:block" alt="TURNING POINT Stiftung">'
    +'<div class="sub" style="margin-top:4px">Arbeitszeiterfassung &ndash; Akademie-Programm</div>'
    +'</div>'
    +'<div class="bh-hdr-right">'
    +'<div class="ttl">ARBEITSZEITNACHWEIS</div>'
    +'<div class="per">'+MONTHS[m-1]+' '+y+'</div>'
    +'</div>'
    +'</div>'
    +'<div class="bh-info">'
    +'<div class="bh-ir"><b>Name</b>'+esc(u.name)+'</div>'
    +'<div class="bh-ir"><b>Monat / Jahr</b>'+MONTHS[m-1]+' '+y+'</div>'
    +'<div class="bh-ir"><b>Team</b>'+esc(u.team||'&ndash;')+'</div>'
    +'<div class="bh-ir"><b>Beschäftigung</b>'+empType+'</div>'
    +'<div class="bh-ir"><b>Wohnort</b>'+esc(u.city||'&ndash;')+'</div>'
    +'<div class="bh-ir"><b>Status</b>'+statusLabel+'</div>'
    +'</div>'
    +'<table>'
    +'<thead><tr>'
    +'<th class="l" rowspan="2">Datum</th><th rowspan="2">KW</th><th rowspan="2">Tag</th>'
    +'<th colspan="4" class="bh">Block 1</th>'
    +(isFree?''
      :'<th class="sp" rowspan="2"></th>'
       +'<th colspan="4" class="bh">Block 2</th>'
       +'<th colspan="3">Kleinteilig</th>')
    +'<th rowspan="2" style="font-size:7px;min-width:28px">Pause</th>'
    +'<th rowspan="2">Gesamt</th>'
    +'</tr><tr>'
    +'<th>von</th><th>bis</th><th>Zuordnung</th><th>&sum;</th>'
    +(isFree?''
      :'<th>von</th><th>bis</th><th>Zuordnung</th><th>&sum;</th>'
       +'<th>Min</th><th>Zuordnung</th><th>&sum;</th>')
    +'</tr></thead>'
    +'<tbody>'+rows+'</tbody>'
    +'<tfoot><tr>'
    +'<td class="l" colspan="3">Monatssumme IST</td>'
    +(isFree
      ?'<td colspan="4"></td>'
      :'<td colspan="4"></td><td></td><td colspan="4"></td><td colspan="3"></td>')
    +'<td></td>'
    +'<td>'+hFmt(monthTotal)+'</td>'
    +'</tr></tfoot>'
    +'</table>'
    +sumCards
    +'<div class="bh-sig">'
    +'<div class="bh-sig-col"><h4>Ort / Datum</h4><div class="bh-sig-line"><span style="font-size:11px;font-weight:600">'+esc(ortDat)+'</span></div></div>'
    +'<div class="bh-sig-col"><h4>Unterschrift Mitarbeiter / in</h4><div class="bh-sig-line">'+empSigHtml+'</div></div>'
    +'<div class="bh-sig-col"><h4>Geprüft – Unterschrift Leitung</h4><div class="bh-sig-line">'+mgSigHtml+'</div></div>'
    +'</div>'
    +'</div>';
}
