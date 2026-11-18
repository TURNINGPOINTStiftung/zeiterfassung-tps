// ══════════════════════════════════════════════════════════════════
//  🔻 Schmales Fußband (v614): Anleitung · Impressum · Datenschutz
//  Letztes Kind von #app → erscheint automatisch nur eingeloggt (vor Login ist
//  #app display:none). Links öffnen die Anleitung (Modul) bzw. Impressum/
//  Datenschutz als Modal. Reine Anzeige, self-registrierend, alles in try/catch.
//  Inhalt (Impressum/Datenschutz) wird hier im Code gepflegt – wie die Anleitung.
//
//  v617: NORMALER Fuß im Textfluss (kein fixed/sticky). Das Band klebt NICHT
//  am Fenster, sondern sitzt am Ende des Inhalts → sichtbar erst, wenn man ganz
//  nach unten scrollt. Als letztes Kind von #app (flex-Spalte, min-height:100vh,
//  .app-content hat flex:1) wird es bei kurzen Seiten an den unteren Rand
//  geschoben, bei langen Seiten erscheint es am Inhaltsende.
// ══════════════════════════════════════════════════════════════════

// Verantwortlich für die Stiftung: Jens Kroker (GF) · Technische Umsetzung: Moritz Kriese
const _IMPRESSUM = `
  <p><b>TURNING POINT Stiftung gGmbH</b><br>Philosophenweg 11, 69120 Heidelberg</p>
  <p>Telefon: 06221 6599995<br>E-Mail: info@turningpoint-stiftung.com</p>
  <p><b>Vertretungsberechtigt / verantwortlich für die Stiftung:</b><br>Jens Kroker (Geschäftsführer)</p>
  <p><b>Technische Umsetzung &amp; Betrieb dieser Anwendung:</b><br>Moritz Kriese</p>
  <p style="color:var(--muted,#5b6b7d);font-size:12.5px;margin-top:10px">Diese Anwendung ist ein internes Werkzeug der Stiftung. Vollständige Pflichtangaben (Handelsregister, USt-IdNr.) im Impressum unter <a href="https://www.turningpoint-stiftung.com" target="_blank" rel="noopener">turningpoint-stiftung.com</a>.</p>`;

const _DATENSCHUTZ = `
  <p>Für die Zeiterfassung verarbeiten wir die Daten, die für dein Arbeitsverhältnis nötig sind: Stammdaten (Name, Kontakt, Team, Arbeitszeit- und Urlaubsangaben), deine erfassten Arbeits- und Pausenzeiten sowie Abwesenheiten.</p>
  <p><b>Krankheit:</b> Gespeichert wird nur „abwesend/krank" mit Zeitraum – <b>kein Grund und keine Diagnose</b>. Für Kolleg:innen erscheinst du nur als „abwesend".</p>
  <p><b>Rechtsgrundlage:</b> § 26 BDSG und Art. 6 Abs. 1 lit. c DSGVO (gesetzliche Pflicht zur Arbeitszeiterfassung).</p>
  <p><b>Wer sieht was:</b> deine eigenen Daten nur du selbst; darüber hinaus nur die für dich zuständige Leitung/Geschäftsführung bzw. die Verwaltung.</p>
  <p><b>Speicherung:</b> in der EU (Google Firebase, europe-west1). Dein Passwort wird nicht in der App gespeichert.</p>
  <p><b>Deine Rechte:</b> Auskunft, Berichtigung, Löschung, Einschränkung und Widerspruch – über die Verwaltung oder direkt beim Datenschutzbeauftragten.</p>
  <p><b>Datenschutzbeauftragter:</b> Rechtsanwalt P. Tim Klümper, sivis.legal, Waldstraße 100, 68305 Mannheim, tk@sivis.legal</p>
  <p style="color:var(--muted,#5b6b7d);font-size:12.5px;margin-top:10px">Die vollständige Datenschutzerklärung findest du unter <a href="https://www.turningpoint-stiftung.com/datenschutz/" target="_blank" rel="noopener">turningpoint-stiftung.com/datenschutz</a>.</p>`;

function _modal(title, inner){
  return `<h3 style="color:var(--primary,#203869);margin:0 0 10px">${title}</h3>`
       + `<div style="max-height:66vh;overflow:auto;font-size:14px;line-height:1.55">${inner}</div>`
       + `<div class="modal-btns"><button class="btn btn-primary" onclick="window.closeModal&&window.closeModal()">Schließen</button></div>`;
}
function footerAnleitung(){ try{ window.switchModule&&window.switchModule('anleitung'); }catch(e){} return false; }
function footerImpressum(){ try{ window.openModal&&window.openModal(_modal('Impressum', _IMPRESSUM), true); }catch(e){} return false; }
function footerDatenschutz(){ try{ window.openModal&&window.openModal(_modal('Datenschutz', _DATENSCHUTZ), true); }catch(e){} return false; }

function _injectFooter(){
  try{
    if(document.getElementById('app-footer')) return;
    const host=document.getElementById('app'); if(!host) return;
    if(!document.getElementById('app-footer-css')){
      const s=document.createElement('style'); s.id='app-footer-css';
      s.textContent='#app-footer{display:flex;flex-wrap:wrap;gap:0 10px;'
        +'align-items:center;justify-content:center;padding:3px 78px 3px 10px;font-size:11.5px;line-height:1.25;'
        +'background:var(--primary,#203869);color:#fff}'
        +'#app-footer a{color:#fff;text-decoration:none;cursor:pointer}'
        +'#app-footer a:hover{text-decoration:underline}'
        +'#app-footer .sep{opacity:.5}'
        +'@media print{#app-footer{display:none}}';
      document.head.appendChild(s);
    }
    const f=document.createElement('footer'); f.id='app-footer';
    f.innerHTML='<a href="#" onclick="return footerAnleitung()">📖 Anleitung</a><span class="sep">·</span>'
      +'<a href="#" onclick="return footerImpressum()">Impressum</a><span class="sep">·</span>'
      +'<a href="#" onclick="return footerDatenschutz()">Datenschutz</a>';
    host.appendChild(f);
  }catch(e){ console.error('Fußband:', e); }
}

try{ Object.assign(window, { footerAnleitung, footerImpressum, footerDatenschutz }); }catch(e){}
if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', _injectFooter); else _injectFooter();
