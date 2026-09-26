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

export const config = {
  knx: {
    baseUrl: required('KNX_API_BASE_URL').replace(/\/+$/, ''),
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
