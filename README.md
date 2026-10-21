# knx-mqtt-forwarder

Forwarder zwischen [semantic-knx-gateway](https://github.com/Noschvie/semantic-knx-gateway) (KNX IoT 3rd
Party API v2.1.0) und MQTT (EMQX). Details zur Architektur, Topic-Schema und offenen Punkten siehe
[`docs/DESIGN.md`](docs/DESIGN.md).

## Was er macht

- Legt beim Start eine Subscription auf `/subscriptions` an (Node oder Installation, `expand: true`)
- Empfängt Write-/Response-Events per HTTP-Callback, prüft die HMAC-Signatur
- Reichert jedes Event über einen lokal gecachten Datapoint-Metadaten-Index an (GA, Titel, DPT)
- Publiziert auf zwei MQTT-Namespaces:
  - `knx/state/<ga>` — retained, aktueller Wert
  - `knx/bus/<ga>` — nicht retained, Event-Strom
  - `<ga>` ist flach: `4/2/35` wird zu `4-2-35` (eine Topic-Ebene pro GA, z. B. `knx/state/4-2-35`);
    der Payload enthält die GA weiterhin im Originalformat `4/2/35`. Fehlt die GA, wird die
    Datapoint-ID verwendet (z. B. `knx/state/GA-349`)
  - `knx/bridge/status` — `online`/`offline` (Last-Will-Testament)
- Erneuert die Subscription automatisch bei halber Lifetime

## Setup

```bash
cp .env.example .env
# Fill in .env: KNX_API_BASE_URL, OAuth client, subscription target,
# CALLBACK_PUBLIC_URL, CALLBACK_SECRET, and MQTT credentials
npm install
npm start
```

### Konfiguration

Siehe `.env.example` für alle Variablen. Wichtig:

- `CALLBACK_PUBLIC_URL` muss vom `semantic-knx-gateway`-Host aus erreichbar sein (nicht `localhost`)
- `CALLBACK_PATH` (der lokale Pfad, auf dem der HTTP-Server lauscht) wird standardmäßig aus dem Pfad-Teil
  von `CALLBACK_PUBLIC_URL` abgeleitet — im Normalfall bleibt die Variable leer/unset. Nur explizit setzen,
  wenn ein vorgeschalteter Reverse Proxy den Pfad umschreibt (z. B. öffentlich `/knx-cb`, intern `/callback`)
- `CALLBACK_SECRET` wird sowohl bei der Subscription-Erstellung (`attributes.secret`) als auch lokal zur
  Signaturprüfung eingehender Callbacks verwendet
- `KNX_SUBSCRIPTION_MODE=all` (Default) deckt automatisch die komplette Installation ab — jeder im lokalen
  Datapoint-Cache bekannte Datapoint wird einzeln in der Subscription adressiert. Für einen einzelnen
  Datapoint `datapoint` + `KNX_SUBSCRIPTION_TARGET_ID` setzen. **Wichtig:** Die Subscription läuft über
  `subscriptionDatapoints` (Datapoint-Items), nicht über `subscriptionNode` oder `subscriptionInstallations`
  — Letztere liefern laut Spec nur Node-/Installation-**Metadaten**-Changes, keine Datapoint-CoV-Events. Ein
  location-basiertes Cascading (`type: "location"` + `expand: true`) wäre laut Spec ebenfalls möglich, wird
  vom Gateway aber nachweislich nicht unterstützt (`"Invalid relationship type 'location'"`) — siehe
  `docs/DESIGN.md`
- Beim Start werden `/node` und `/installations` zusätzlich rein informativ abgefragt und protokolliert
  (Name, Vendor, Subscription-Auslastung bzw. vorhandene Installationen mit id/Titel) — nützlich zur Diagnose,
  hat aber keinen Einfluss mehr auf die eigentliche Subscription
- `KNX_API_BASE_URL` enthält **nur die Host-Root**, kein `/api/vX`-Pfad. Der versionierte API-Basispfad ist
  als Konstante `KNX_API_PATH` in `src/config.js` hinterlegt (aktuell `/api/v2`) und wird ausschließlich für
  Resource-Endpoints (`/datapoints`, `/subscriptions`, ...) angehängt. `/oauth/access` wird direkt gegen die
  Host-Root aufgerufen, ohne diesen Präfix — das entspricht dem Verhalten von `semantic-knx-gateway` (siehe
  `knx_subscribe.be`). Bei einem API-Versionswechsel genügt es, `KNX_API_PATH` im Code anzupassen

### Docker

```bash
docker compose up -d --build
```

## Bekannte Einschränkungen (v1)

- Keine Rohdaten/Rohbytes, keine unresolved Group Addresses (siehe `docs/DESIGN.md`, Abschnitt 9)
- Kein MQTT→KNX-Rückkanal
- Kein Home-Assistant-MQTT-Discovery
- Die HMAC-Signaturprüfung in `src/signature.js` ist ein bestmöglicher Nachbau der Spec-Beschreibung und
  sollte vor Produktivbetrieb gegen die tatsächliche `semantic-knx-gateway`-Implementierung verifiziert
  werden (Byte-genaue Zusammensetzung des Signatur-Inputs ist in der API-Spec nicht vollständig eindeutig)

## Lizenz

CC BY-NC-SA 4.0
