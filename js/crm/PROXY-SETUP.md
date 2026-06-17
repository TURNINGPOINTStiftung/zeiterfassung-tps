# KI-Zusammenfassung – Proxy einrichten (einmalig, ~5 Min)

Das Diktat (Sprache → Text) läuft komplett im Browser und braucht **nichts** davon.
Nur die **automatische Zusammenfassung** schickt den Text an ein LLM. Damit der
API-Key **nicht im Frontend sichtbar** ist, läuft das über einen winzigen Proxy.
Empfehlung: **Cloudflare Worker** (kostenloser Tarif reicht locker).

## 1. Worker anlegen
1. Auf https://dash.cloudflare.com → **Workers & Pages** → **Create Worker**.
2. Den Beispiel-Code unten einfügen, **Deploy** klicken.
3. Beim Worker unter **Settings → Variables** ein Secret anlegen:
   `ANTHROPIC_API_KEY` = dein Anthropic-Key (oder OpenAI, dann Code anpassen).

## 2. Worker-Code (Anthropic / Claude)
```js
export default {
  async fetch(req, env) {
    // CORS
    const cors = {
      'Access-Control-Allow-Origin': 'https://turningpointstiftung.github.io',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (req.method !== 'POST') return new Response('POST only', { status: 405, headers: cors });

    let body;
    try { body = await req.json(); } catch { return new Response('bad json', { status: 400, headers: cors }); }
    const text = (body.text || '').slice(0, 8000);
    if (!text.trim()) return new Response(JSON.stringify({ summary: '' }), { headers: { ...cors, 'Content-Type': 'application/json' } });

    const prompt = `Fasse die folgende interne CRM-Notiz knapp auf Deutsch zusammen. `
      + `Gib 1) eine kurze Zusammenfassung in 2-3 Sätzen und 2) eine Bullet-Liste der nächsten ToDos `
      + `mit Zuständigkeit (falls genannt).\n\nNotiz:\n${text}`;

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 600,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    const data = await r.json();
    const summary = (data.content && data.content[0] && data.content[0].text) || '';
    return new Response(JSON.stringify({ summary }), { headers: { ...cors, 'Content-Type': 'application/json' } });
  },
};
```

## 3. In der App hinterlegen
Im CRM oben rechts auf **⚙️ KI** klicken und die Worker-URL einfügen
(z. B. `https://crm-summary.<dein-name>.workers.dev`).
Fertig – ab dann erzeugt der Button **✨ KI-Zusammenfassung** echte Zusammenfassungen.

> Solange keine URL hinterlegt ist, funktioniert alles andere normal; nur der
> ✨-Button weist freundlich auf die fehlende Einrichtung hin. Die Zeiterfassung
> ist davon in keinem Fall betroffen.

## Datenschutz-Hinweis
Beim Zusammenfassen wird der Notiztext an den LLM-Anbieter gesendet. Für sensible
personenbezogene Daten ggf. einen EU-Anbieter / AVV prüfen. Das **Diktat selbst**
(Spracherkennung) läuft über die Browser-Engine (bei Chrome Google-Server) –
ebenfalls ein Verarbeitungsschritt, der DSGVO-seitig zu bewerten ist.
```
