# KNX-zu-MQTT-Forwarder — Design-Dokument (Draft v0.1)

Status: Entwurf für internes Review
Bezug: [semantic-knx-gateway](https://github.com/Noschvie/semantic-knx-gateway), [KNX IoT 3rd Party API v2.1.0](knxiot_api_openapi.yaml)

---

## 1. Motivation

Neben dem bestehenden REST/OAuth-Zugriff auf `semantic-knx-gateway` soll ein leichtgewichtiger MQTT-Feed
bereitgestellt werden, damit Systeme wie Node-RED, Home Assistant oder einfache Skripte KNX-Werte konsumieren
können, ohne eine eigene REST/OAuth-Integration bauen zu müssen. Grundlage ist der geplante EMQX-Broker
(Docker), der bereits für die IoT-/Tasmota-Infrastruktur vorgesehen ist.

## 2. Architektur-Überblick

```
┌─────────────────────┐      HTTP-Callback       ┌──────────────────────┐      MQTT Publish      ┌──────────┐
│ semantic-knx-gateway │ ──────────────────────▶ │ knx-mqtt-forwarder   │ ─────────────────────▶ │  EMQX    │
│  (KNX IoT API v2.1)  │   POST /callback        │ (eigener Service)    │                        │  Broker  │
└─────────────────────┘                          └──────────────────────┘                        └──────────┘
```

Der Forwarder ist ein **eigenständiger Service**, lose gekoppelt, kein
Eingriff in den Southbound-Teil des Gateways nötig. Er nutzt ausschließlich die bestehende KNX IoT API
(Subscriptions + HTTP-Callback), keinen direkten Bus-Zugriff.

## 3. Feeds

Zwei Topic-Namespaces, unterschiedliche Semantik, aber **eine gemeinsame Subscription** als Datenquelle:

### 3.1 State-Feed

- Topic: `knx/state/<ga>`
- MQTT-Flags: **retained**
- Inhalt: aktueller Wert je Datapoint
- Zweck: neue Subscriber bekommen sofort den letzten bekannten Stand

### 3.2 Bus-Feed

- Topic: `knx/bus/<ga>`
- MQTT-Flags: **nicht retained**
- Inhalt: jedes Write- und Response-Event (Read wird ausgeschlossen), Wert + Zeitstempel, semantisch angereichert
- Zweck: Event-Log / Live-Aktivität auf dem Bus, ohne einen aktuellen Zustand zu repräsentieren

**Hinweis v1:** Beide Feeds liefern denselben Ausschnitt an Information (Wert + Zeitstempel + Metadaten aus der
KNX IoT API), keine rohen Bus-Bytes. Der Bus-Feed ist damit im Kern ein ungefilterter Event-Strom statt einer
echten Rohtelegramm-Kopie. Siehe Abschnitt 9 für die spätere Erweiterung.

## 4. Subscription-Design (KNX IoT API)

Eine Subscription auf Node- oder Location-Ebene mit `expand: true`, um nicht für jeden Datapoint einzeln zu
subscriben:

```json
POST /subscriptions
{
  "data": {
    "type": "subscription",
    "relationships": {
      "subscriptionNode": {
        "data": { "id": "<node-id>", "type": "service", "meta": { "expand": true } }
      }
    },
    "attributes": {
      "url": "https://<forwarder-host>/callback",
      "secret": "<hmac-secret>",
      "lifetime": 3600
    }
  }
}
```

- Auth: eigener OAuth2-Client mit Scope `manage` (Subscription-Verwaltung) + `read`
- Renewal: analog zum bestehenden Muster in `knx_subscribe.be` (Renewal bei halber Lifetime, Timer-basiert)
- Der Callback-Handler validiert `X-Callback-Signature` (HMAC-SHA256, siehe API-Spec) vor der Verarbeitung

## 5. MQTT Topic-Schema

| Topic                  | Retained | QoS | Inhalt                                  |
|-------------------------|----------|-----|------------------------------------------|
| `knx/state/<ga>`        | ja       | 1   | Aktueller Datapoint-Wert                  |
| `knx/bus/<ga>`          | nein     | 0   | Write/Response-Events                     |
| `knx/bridge/status`     | ja       | 1   | `online` / `offline` (Last-Will-Testament)|

`<ga>` = KNX-Gruppenadresse im Format `1/2/3`. Fallback auf Datapoint-UUID, falls keine GA im Projekt hinterlegt
ist (sollte in der Praxis kaum vorkommen, da die Subscription ohnehin nur bekannte Datapoints liefert).

## 6. Payload-Format

Einheitliches JSON-Payload für beide Feeds, angelehnt an die bestehende Telegram-Struktur aus dem
KNX-Kontext:

```json
{
  "ga": "1/2/3",
  "title": "Wohnzimmer Licht",
  "value": "on",
  "valueType": "string",
  "dpt": "urn:knx:dpt.switch",
  "timestamp": "2026-09-25T10:15:00Z"
}
```

- `title` / `dpt` stammen aus den `attributes`/`meta`-Feldern der KNX IoT API (siehe Datapoint-Response-Schema)
- Kein `raw_data` / `raw_hex` / `telegram_type` in v1 (siehe Abschnitt 9)

## 7. Auth & Sicherheit

- **Gateway-seitig:** eigener OAuth2-Client (`client_credentials`), Scopes `read` + `manage`
- **MQTT-seitig:** eigener EMQX-Account mit dediziertem ACL (Publish auf `knx/#`, kein Subscribe auf
  fremde Namespaces), passend zur bestehenden Rollenaufteilung (Node-RED, Gateway, Monitoring)
- Secrets (OAuth-Client-Secret, MQTT-Passwort, Callback-HMAC-Secret) ausschließlich über `.env`,
  nicht im Repository

## 8. Deployment / Service-Abgrenzung

- Eigenständiges Node.js-Projekt, kein Modul innerhalb von `semantic-knx-gateway`
- Kommunikation ausschließlich über die öffentliche KNX IoT API (REST + HTTP-Callback) — kein direkter
  Zugriff auf KNXUltimate oder die TimescaleDB
- Eigener Docker-Container, analog zum Deployment-Muster der übrigen Services

## 9. Offene Punkte / Out of Scope (v1)

- **Rohdaten/Rohbytes:** bewusst zurückgestellt. Würde einen direkten Abgriffpunkt am KNXUltimate-Listener im
  Southbound-Teil von `semantic-knx-gateway` erfordern (Subscription-Ebene liefert keine Rohbytes)
- **Unresolved Group Addresses:** GAs ohne Projekt-Mapping erscheinen nicht im Feed, da die Subscription nur
  bekannte Datapoints abdeckt. Bei Bedarf später ein zusätzlicher Channel/eine zusätzliche Subscription, die
  auf direktem Bus-Zugriff statt der KNX IoT API basiert
- **Rückkanal (MQTT → KNX):** Command-Topics (`knx/<ga>/set`) noch nicht spezifiziert, würde `PUT
  /datapoints/values` mit Scope `write` nutzen
- **Home-Assistant-MQTT-Discovery:** noch nicht bewertet
- **Rate-Limiting/Dedup:** bei chattyen GAs (z. B. Heizungsaktoren mit häufigem Cyclic Send) ggf. nötig,
  noch nicht spezifiziert

## 10. Ausblick (v2+)

- Zweiter Abgriffpunkt direkt am KNXUltimate-Eventlistener für echten Rohtelegramm-Feed inkl. unresolved GAs
- MQTT-Rückkanal für Schreibzugriffe
- Optionale Home-Assistant-Discovery-Kompatibilität — sinnvollerweise gekoppelt an den MQTT-Rückkanal (siehe
  oben), da schreibbare Komponenten (`switch`, `light`, `cover`) einen `command_topic` benötigen; DPT→
  HA-Component-Mapping als eigener offener Punkt

### Koexistenz mit Tasmota-Discovery im selben Broker

Der geplante EMQX-Broker dient auch der Tasmota-Migration (~50 Geräte). Tasmota bringt HA-Discovery bereits
nativ mit (`SetOption19 1`) und publiziert dabei ebenfalls in den `homeassistant/`-Namespace. Sobald der
KNX-Forwarder eigenes Discovery umsetzt, landen beide Quellen im selben Namespace — `unique_id`s müssen
daher über beide Quellen hinweg kollisionsfrei sein. Die vorgesehene GA-basierte ID (`knx_1_2_3`) sollte
dafür ausreichen, ist aber bei konkreter Umsetzung nochmal zu verifizieren.
