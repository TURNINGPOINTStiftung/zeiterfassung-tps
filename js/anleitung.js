// 📖 Anleitung als eigener Bereich (☰-Menü + Startseiten-Kachel).
// Zeigt ANLEITUNG.md aus dem Repo an (eine Quelle der Wahrheit, kein doppelter Text).
// Sichtbarkeit wie jedes Modul über canUsePath('anleitung') – Standard: alle, pro Rolle/Person abschaltbar.
// Liest nur eine statische Datei, schreibt nichts → keine Datenbank-Regeln nötig.
import { esc } from './utils.js';

let _md=null, _loading=null;

// GitHub-kompatible Sprungmarken („2. Rollen & Zugriffe" → „2-rollen--zugriffe…"), damit das
// Inhaltsverzeichnis der Datei auch hier funktioniert.
function _slug(t){ return t.toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu,'').replace(/\s/g,'-'); }
function _plain(t){ return t.replace(/\*\*|`|\*/g,'').replace(/\[([^\]]*)\]\([^)]*\)/g,'$1'); }

// Inline: **fett**, *kursiv*, `code`, [Text](#anker | https://…). Erst escapen, dann formatieren.
function _inline(s){
  let h=esc(s);
  h=h.replace(/`([^`]+)`/g,'<code>$1</code>');
  h=h.replace(/\*\*([^*]+)\*\*/g,'<b>$1</b>');
  h=h.replace(/(^|[^*\w])\*([^*\s][^*]*)\*(?!\*)/g,'$1<i>$2</i>');
  h=h.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g,(m,txt,url)=>{
    if(url.startsWith('#')) return `<a href="#" data-anl="${url.slice(1)}">${txt}</a>`;
    if(/^https?:\/\//.test(url)) return `<a href="${url}" target="_blank" rel="noopener">${txt} ↗</a>`;
    return txt;
  });
  return h;
}

// Kleiner Markdown-Umwandler für genau die Elemente, die ANLEITUNG.md nutzt:
// Überschriften, Absätze, Listen (auch eingerückte Fortsetzungen), Tabellen, Zitate, Trennlinien.
function _render(md){
  const L=md.replace(/\r/g,'').split('\n');
  const out=[]; let i=0;
  const isBlockStart=l=>/^(#{1,6}\s|>|\||---\s*$|\s*([-*]|\d+\.)\s)/.test(l);
  while(i<L.length){
    const l=L[i];
    if(!l.trim()){ i++; continue; }
    let m;
    if((m=l.match(/^(#{1,6})\s+(.*)$/))){
      const n=Math.min(m[1].length+1,6), t=m[2].trim();
      out.push(`<h${n} id="anl-${esc(_slug(_plain(t)))}">${_inline(t)}</h${n}>`); i++; continue;
    }
    if(/^---\s*$/.test(l)){ out.push('<hr>'); i++; continue; }
    if(l.startsWith('>')){
      const q=[]; while(i<L.length && L[i].startsWith('>')){ q.push(L[i].replace(/^>\s?/,'')); i++; }
      out.push(`<blockquote>${_inline(q.join(' '))}</blockquote>`); continue;
    }
    if(l.startsWith('|')){
      const rows=[]; while(i<L.length && L[i].startsWith('|')){ rows.push(L[i]); i++; }
      const cells=r=>r.replace(/^\||\|\s*$/g,'').split('|').map(c=>c.trim());
      const body=rows.filter((r,k)=>!(k===1 && /^\|[\s:|-]+\|?\s*$/.test(r)));
      const [head,...rest]=body;
      out.push(`<div class="anl-tw"><table><thead><tr>${cells(head).map(c=>`<th>${_inline(c)}</th>`).join('')}</tr></thead><tbody>`
        +rest.map(r=>`<tr>${cells(r).map(c=>`<td>${_inline(c)}</td>`).join('')}</tr>`).join('')+'</tbody></table></div>');
      continue;
    }
    if((m=l.match(/^(\s*)([-*]|\d+\.)\s+/))){
      const ordered=/\d/.test(m[2]); const items=[];
      while(i<L.length){
        const x=L[i]; const mm=x.match(/^(\s*)([-*]|\d+\.)\s+(.*)$/);
        if(mm && mm[1].length<=1){ items.push({t:mm[3],sub:[]}); i++; continue; }
        if(mm && items.length){ items[items.length-1].sub.push(mm[3]); i++; continue; }
        if(x.trim() && /^\s{2,}/.test(x) && items.length){ const it=items[items.length-1];
          if(it.sub.length) it.sub[it.sub.length-1]+=' '+x.trim(); else it.t+=' '+x.trim(); i++; continue; }
        break;
      }
      const tag=ordered?'ol':'ul';
      out.push(`<${tag}>${items.map(it=>`<li>${_inline(it.t)}${it.sub.length?`<ul>${it.sub.map(s=>`<li>${_inline(s)}</li>`).join('')}</ul>`:''}</li>`).join('')}</${tag}>`);
      continue;
    }
    const p=[]; while(i<L.length && L[i].trim() && !isBlockStart(L[i])){ p.push(L[i].trim()); i++; }
    if(!p.length){ p.push(l.trim()); i++; }
    out.push(`<p>${_inline(p.join(' '))}</p>`);
  }
  return out.join('\n');
}

// Abschnitte (## … → h3) für die Suche als eigene Blöcke kapseln.
function _sections(html){
  const parts=html.split(/(?=<h3 )/);
  return parts.map(p=>p.startsWith('<h3 ')?`<section class="anl-sec">${p}</section>`:`<div class="anl-intro">${p}</div>`).join('');
}

const CSS=`<style>
#anl-wrap{max-width:860px;margin:0 auto;padding:16px 16px 60px;width:100%;box-sizing:border-box;color:var(--text);font-family:var(--font)}
#anl-wrap .anl-bar{position:sticky;top:0;z-index:2;display:flex;gap:8px;align-items:center;padding:10px 0;background:var(--bg)}
#anl-wrap .anl-bar input{flex:1;min-width:0;padding:10px 12px;border:1.5px solid var(--border-strong);border-radius:var(--radius-sm);background:var(--surface);color:var(--text);font-size:15px}
#anl-wrap .anl-doc{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);box-shadow:var(--shadow-1);padding:20px 24px;line-height:1.6;font-size:15px}
#anl-wrap h2{font-size:24px;margin:0 0 6px;color:var(--text)}
#anl-wrap h3{font-size:19px;margin:26px 0 8px;padding-top:14px;border-top:1px solid var(--border);color:var(--text);scroll-margin-top:70px}
#anl-wrap .anl-sec:first-of-type h3{border-top:0}
#anl-wrap h4{font-size:16px;margin:18px 0 6px;color:var(--text);scroll-margin-top:70px}
#anl-wrap p{margin:8px 0}
#anl-wrap ul,#anl-wrap ol{margin:8px 0;padding-left:24px}
#anl-wrap li{margin:3px 0}
#anl-wrap hr{display:none}
#anl-wrap a{color:var(--primary);text-decoration:underline;text-underline-offset:2px}
#anl-wrap code{background:var(--surface-2);border:1px solid var(--border);border-radius:var(--radius-xs);padding:0 5px;font-size:.92em}
#anl-wrap blockquote{margin:12px 0;padding:10px 14px;background:var(--info-bg);color:var(--info-text);border-left:4px solid var(--info);border-radius:var(--radius-xs)}
#anl-wrap .anl-tw{overflow-x:auto;margin:10px 0}
#anl-wrap table{border-collapse:collapse;width:100%;font-size:14px}
#anl-wrap th,#anl-wrap td{border:1px solid var(--border);padding:7px 10px;text-align:left;vertical-align:top}
#anl-wrap th{background:var(--surface-2)}
#anl-wrap mark{background:var(--warn-bg);color:var(--warn-text);border-radius:3px;padding:0 1px}
#anl-wrap .anl-top{position:fixed;left:auto;right:22px;bottom:84px;width:auto;max-width:max-content;z-index:5;border-radius:var(--radius-pill);box-shadow:var(--shadow-2)}
@media (max-width:640px){ #anl-wrap{padding:8px 12px 70px} #anl-wrap .anl-doc{padding:14px 14px;font-size:15px} #anl-wrap h2{font-size:21px} }
@media print{ #anl-wrap .anl-bar,#anl-wrap .anl-top{display:none} #anl-wrap .anl-doc{border:0;box-shadow:none} }
</style>`;

function _scrollTo(id){
  const el=document.getElementById('anl-'+id); if(!el) return;
  const s=document.getElementById('anl-search'); if(s && s.value){ s.value=''; anleitungFilter(''); }
  el.scrollIntoView({behavior:'smooth',block:'start'});
}

// Suche: Abschnitte ohne Treffer ausblenden, Treffer markieren.
function anleitungFilter(q){
  const doc=document.getElementById('anl-doc'); if(!doc) return;
  doc.querySelectorAll('mark').forEach(m=>m.replaceWith(document.createTextNode(m.textContent)));
  doc.normalize();
  const t=(q||'').trim().toLowerCase();
  let hits=0;
  doc.querySelectorAll('.anl-sec,.anl-intro').forEach(sec=>{
    const ok=!t || sec.textContent.toLowerCase().includes(t);
    sec.style.display=ok?'':'none';
    if(ok && t){ hits++;
      const w=document.createTreeWalker(sec,NodeFilter.SHOW_TEXT); const nodes=[]; while(w.nextNode()) nodes.push(w.currentNode);
      nodes.forEach(n=>{ const s=n.nodeValue, k=s.toLowerCase().indexOf(t); if(k<0) return;
        const mk=document.createElement('mark'); const r=n.splitText(k); r.splitText(t.length); mk.textContent=r.nodeValue; r.replaceWith(mk); });
    }
  });
  const e=document.getElementById('anl-empty');
  if(e) e.style.display=(t && !hits)?'':'none';
}

function _paint(root){
  root.innerHTML=CSS+`<div id="anl-wrap">
    <div class="anl-bar" role="search"><input id="anl-search" type="search" placeholder="🔎 In der Anleitung suchen …" aria-label="In der Anleitung suchen" oninput="anleitungFilter(this.value)">
      <button class="btn btn-outline btn-sm" onclick="window.print()" title="Anleitung drucken">🖨️ Drucken</button></div>
    <div id="anl-empty" class="empty-state" style="display:none"><span class="es-icon">🔍</span><span class="es-title">Nichts gefunden</span><span>Versuch es mit einem anderen Wort.</span></div>
    <article id="anl-doc" class="anl-doc">${_sections(_render(_md))}</article>
    <button class="btn btn-primary btn-sm anl-top" onclick="document.getElementById('mod-anleitung').scrollTo({top:0,behavior:'smooth'});window.scrollTo({top:0,behavior:'smooth'})" aria-label="Nach oben">↑ Nach oben</button>
  </div>`;
  root.querySelector('#anl-doc').addEventListener('click',ev=>{
    const a=ev.target.closest('a[data-anl]'); if(!a) return;
    ev.preventDefault(); _scrollTo(a.dataset.anl);
  });
}

function renderAnleitung(){
  const root=document.getElementById('anleitung-root'); if(!root) return;
  if(_md!==null){ if(!root.querySelector('#anl-doc')) _paint(root); return; }
  root.innerHTML=CSS+'<div id="anl-wrap"><div class="loading"><span class="spinner"></span> Anleitung lädt …</div></div>';
  if(!_loading) _loading=fetch('ANLEITUNG.md').then(r=>{ if(!r.ok) throw new Error('HTTP '+r.status); return r.text(); });
  _loading.then(t=>{ _md=t; _paint(root); }).catch(e=>{
    _loading=null; console.error('Anleitung laden:',e);
    root.innerHTML=CSS+`<div id="anl-wrap"><div class="empty-state"><span class="es-icon">📖</span><span class="es-title">Anleitung nicht erreichbar</span><span>Bitte Internetverbindung prüfen.</span><button class="btn btn-primary btn-sm" onclick="renderAnleitung()">Erneut versuchen</button></div></div>`;
  });
}

try{ Object.assign(window,{ renderAnleitung, anleitungFilter }); }catch(e){}
export { renderAnleitung };
