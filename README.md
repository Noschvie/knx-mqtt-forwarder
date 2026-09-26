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
  - `knx/bridge/status` — `online`/`offline` (Last-Will-Testament)
- Erneuert die Subscription automatisch bei halber Lifetime

## Setup

```bash
cp .env.example .env
# .env ausfüllen: KNX_API_BASE_URL, OAuth-Client, Subscription-Ziel,
# CALLBACK_PUBLIC_URL, CALLBACK_SECRET, MQTT-Zugangsdaten
npm install
npm start
```

### Konfiguration

Siehe `.env.example` für alle Variablen. Wichtig:

- `CALLBACK_PUBLIC_URL` muss vom `semantic-knx-gateway`-Host aus erreichbar sein (nicht `localhost`)
- `CALLBACK_SECRET` wird sowohl bei der Subscription-Erstellung (`attributes.secret`) als auch lokal zur
  Signaturprüfung eingehender Callbacks verwendet
- `KNX_SUBSCRIPTION_TARGET_TYPE=node` deckt alle Installationen am Gateway ab; für eine einzelne Installation
  `installation` + `KNX_SUBSCRIPTION_TARGET_ID` setzen

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

GNU AGPL v3
