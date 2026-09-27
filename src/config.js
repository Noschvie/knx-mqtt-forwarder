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

export const config = {
  knx: {
    // Host-Root ohne Pfad, z. B. "https://eibesthal.local:3000"
    hostUrl: knxHostUrl,
    // Basis-URL für Resource-Endpoints (/datapoints, /subscriptions, ...)
    resourceBaseUrl: `${knxHostUrl}${KNX_API_PATH}`,
    clientId: required('KNX_OAUTH_CLIENT_ID'),
    clientSecret: required('KNX_OAUTH_CLIENT_SECRET'),
    subscriptionTargetType: optional('KNX_SUBSCRIPTION_TARGET_TYPE', 'node'),
    subscriptionTargetId: optional('KNX_SUBSCRIPTION_TARGET_ID', ''),
    subscriptionLifetimeS: Number(optional('KNX_SUBSCRIPTION_LIFETIME_S', '3600')),
  },
  callback: {
    host: optional('CALLBACK_HOST', '0.0.0.0'),
    port: Number(optional('CALLBACK_PORT', '8090')),
    path: optional('CALLBACK_PATH', '/callback'),
    publicUrl: required('CALLBACK_PUBLIC_URL'),
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

if (!['node', 'installation'].includes(config.knx.subscriptionTargetType)) {
  throw new Error(
    `KNX_SUBSCRIPTION_TARGET_TYPE muss "node" oder "installation" sein, nicht "${config.knx.subscriptionTargetType}"`,
  );
}

if (config.knx.subscriptionTargetType === 'installation' && !config.knx.subscriptionTargetId) {
  throw new Error('KNX_SUBSCRIPTION_TARGET_ID ist bei TARGET_TYPE=installation erforderlich.');
}
