# Cloud Function `tpsPw` (Passwort vergessen / Admin-Reset)

Siehe Kopfkommentar in `index.js`. Region `europe-west1` (wie die Datenbank).
URL: `https://europe-west1-zeiterfassung-tps.cloudfunctions.net/tpsPw` (in `js/config.js` als `PW_FUNCTION_URL`).

## Deploy (Google Cloud Shell, Projekt zeiterfassung-tps)
```
gcloud config set project zeiterfassung-tps
mkdir -p ~/tpspw && cd ~/tpspw      # index.js + package.json hierher kopieren
gcloud functions deploy tpsPw --gen2 --runtime=nodejs20 --region=europe-west1 \
  --source=. --entry-point=tpsPw --trigger-http --allow-unauthenticated \
  --memory=256MiB --max-instances=3
```
`--allow-unauthenticated` ist nötig, weil „Passwort vergessen" vor dem Login läuft; die
Aktion `set` prüft selbst das ID-Token + `zeiterfassung/admins`.
Der Standard-Dienstkonto-Zugriff (Admin SDK) umgeht die Datenbank-Regeln – die Function
schreibt nur `zeiterfassung/pwResetRequests/*` und das Firebase-Auth-Passwort.
