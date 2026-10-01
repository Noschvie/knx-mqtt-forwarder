import 'dotenv/config';

function required(name) {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(`Fehlende Pflicht-Umgebungsvariable: ${name}`);
  }
  return value;
}

function optional(name, fallback) {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

// KNX IoT 3rd Party API Basispfad (OpenAPI-Server-Variable "path").
// Bewusst als Code-Konstante statt Env-Var: eine API-Versionsänderung ist ein
// Code-/Kompatibilitäts-Thema, kein Deployment-Parameter. /oauth/access liegt
// bei semantic-knx-gateway NICHT unter diesem Präfix (siehe knx_subscribe.be),
// daher separat von KNX_API_PATH gehalten.
export const KNX_API_PATH = '/api/v2';

const knxHostUrl = required('KNX_API_BASE_URL').replace(/\/+$/, '');
const callbackPublicUrl = required('CALLBACK_PUBLIC_URL');

export const config = {
  knx: {
    // Host-Root ohne Pfad, z. B. "https://eibesthal.local:3000"
    hostUrl: knxHostUrl,
    // Basis-URL für Resource-Endpoints (/datapoints, /subscriptions, ...)
    resourceBaseUrl: `${knxHostUrl}${KNX_API_PATH}`,
    clientId: required('KNX_OAUTH_CLIENT_ID'),
    clientSecret: required('KNX_OAUTH_CLIENT_SECRET'),
    // Womit die Datapoint-Subscription (subscriptionDatapoints) adressiert wird:
    // - "all" (Default): jeden im lokalen Cache bekannten Datapoint einzeln
    //   adressieren (siehe datapointCache.js) -> deckt die komplette
    //   Installation ab, ohne Location-IDs manuell pflegen zu müssen
    // - "datapoint": ein einzelner Datapoint (KNX_SUBSCRIPTION_TARGET_ID)
    // WICHTIG:
    // - subscriptionNode/subscriptionInstallations liefern laut Spec nur
    //   Node-/Installation-Metadaten-Changes, KEINE Datapoint-CoV-Events
    //   (Aktor schalten). Für Datapoint-Events ist ausschließlich
    //   subscriptionDatapoints relevant.
    // - subscriptionDatapoints mit type "location" + expand ist laut Spec
    //   vorgesehen, wird vom Gateway aber nachweislich NICHT unterstützt
    //   ("Invalid relationship type 'location'"), daher kein "location"-Modus
    //   mehr — siehe docs/DESIGN.md.
    subscriptionMode: optional('KNX_SUBSCRIPTION_MODE', 'all'),
    subscriptionTargetId: optional('KNX_SUBSCRIPTION_TARGET_ID', ''),
    subscriptionLifetimeS: Number(optional('KNX_SUBSCRIPTION_LIFETIME_S', '3600')),
  },
  callback: {
    host: optional('CALLBACK_HOST', '0.0.0.0'),
    port: Number(optional('CALLBACK_PORT', '8090')),
    // Lokaler Pfad, auf dem der HTTP-Server lauscht. Default: aus
    // CALLBACK_PUBLIC_URL abgeleitet (im Normalfall identisch). Nur explizit
    // via CALLBACK_PATH überschreiben, wenn ein vorgeschalteter Reverse Proxy
    // den Pfad umschreibt (öffentlicher Pfad != interner Pfad) — siehe README.
    path: optional('CALLBACK_PATH', new URL(callbackPublicUrl).pathname || '/callback'),
    publicUrl: callbackPublicUrl,
    secret: required('CALLBACK_SECRET'),
  },
  mqtt: {
    url: required('MQTT_URL'),
    username: optional('MQTT_USERNAME', undefined),
    password: optional('MQTT_PASSWORD', undefined),
    clientId: optional('MQTT_CLIENT_ID', 'knx-mqtt-forwarder'),
    stateTopicPrefix: optional('MQTT_STATE_TOPIC_PREFIX', 'knx/state'),
    busTopicPrefix: optional('MQTT_BUS_TOPIC_PREFIX', 'knx/bus'),
    statusTopic: optional('MQTT_STATUS_TOPIC', 'knx/bridge/status'),
  },
  logLevel: optional('LOG_LEVEL', 'info'),
};

if (!['all', 'datapoint'].includes(config.knx.subscriptionMode)) {
  throw new Error(`KNX_SUBSCRIPTION_MODE muss "all" oder "datapoint" sein, nicht "${config.knx.subscriptionMode}"`);
}

if (config.knx.subscriptionMode === 'datapoint' && !config.knx.subscriptionTargetId) {
  throw new Error('KNX_SUBSCRIPTION_TARGET_ID ist bei KNX_SUBSCRIPTION_MODE=datapoint erforderlich.');
}
