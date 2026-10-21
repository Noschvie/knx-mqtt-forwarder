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

// KNX IoT 3rd Party API base path (OpenAPI server variable "path").
// Intentionally a code constant instead of an environment variable: changing
// the API version is a code/compatibility concern, not a deployment parameter.
// For semantic-knx-gateway, /oauth/access is NOT under this prefix (see
// knx_subscribe.be), so it is kept separate from KNX_API_PATH.
export const KNX_API_PATH = '/api/v2';

const knxHostUrl = required('KNX_API_BASE_URL').replace(/\/+$/, '');
const callbackPublicUrl = required('CALLBACK_PUBLIC_URL');

export const config = {
  knx: {
    // Host root without a path, e.g. "https://eibesthal.local:3000"
    hostUrl: knxHostUrl,
    // Base URL for resource endpoints (/datapoints, /subscriptions, ...)
    resourceBaseUrl: `${knxHostUrl}${KNX_API_PATH}`,
    clientId: required('KNX_OAUTH_CLIENT_ID'),
    clientSecret: required('KNX_OAUTH_CLIENT_SECRET'),
    // How to address the datapoint subscription (subscriptionDatapoints):
    // - "all" (default): address every datapoint in the local cache
    //   individually (see datapointCache.js), covering the whole installation
    //   without manually maintaining location IDs
    // - "datapoint": a single datapoint (KNX_SUBSCRIPTION_TARGET_ID)
    // IMPORTANT:
    // - According to the spec, subscriptionNode/subscriptionInstallations
    //   provide only node/installation metadata changes, NOT datapoint CoV
    //   events (e.g. switching an actuator). Only subscriptionDatapoints is
    //   relevant for datapoint events.
    // - The spec allows subscriptionDatapoints with type "location" + expand,
    //   but the gateway is confirmed NOT to support it ("Invalid relationship
    //   type 'location'"), so there is no longer a "location" mode. See
    //   docs/DESIGN.md.
    subscriptionMode: optional('KNX_SUBSCRIPTION_MODE', 'all'),
    subscriptionTargetId: optional('KNX_SUBSCRIPTION_TARGET_ID', ''),
    subscriptionLifetimeS: Number(optional('KNX_SUBSCRIPTION_LIFETIME_S', '3600')),
  },
  callback: {
    host: optional('CALLBACK_HOST', '0.0.0.0'),
    port: Number(optional('CALLBACK_PORT', '8070')),
    // Local path on which the HTTP server listens. By default, derived from
    // CALLBACK_PUBLIC_URL (normally identical). Override explicitly via
    // CALLBACK_PATH only if a reverse proxy rewrites the path (public path !=
    // internal path). See README.
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
