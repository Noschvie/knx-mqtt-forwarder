import mqtt from 'mqtt';
import { config } from './config.js';
import { logger } from './logger.js';

let client = null;

export function connectMqtt() {
  return new Promise((resolve, reject) => {
    client = mqtt.connect(config.mqtt.url, {
      clientId: config.mqtt.clientId,
      username: config.mqtt.username,
      password: config.mqtt.password,
      will: {
        topic: config.mqtt.statusTopic,
        payload: 'offline',
        qos: 1,
        retain: true,
      },
      reconnectPeriod: 5000,
    });

    client.once('connect', () => {
      logger.info(`MQTT verbunden: ${config.mqtt.url}`);
      client.publish(config.mqtt.statusTopic, 'online', { qos: 1, retain: true });
      resolve(client);
    });

    client.once('error', (err) => {
      logger.error('MQTT-Verbindungsfehler', err);
      reject(err);
    });

    client.on('reconnect', () => logger.warn('MQTT: Reconnect-Versuch...'));
    client.on('offline', () => logger.warn('MQTT: Verbindung offline'));
  });
}

function topicFor(prefix, ga) {
  // GA-Format "1/2/3" ist bereits ein gültiges MQTT-Topic-Segment-Trio.
  return `${prefix}/${ga}`;
}

export function publishState(ga, payload) {
  if (!client) return;
  client.publish(topicFor(config.mqtt.stateTopicPrefix, ga), JSON.stringify(payload), {
    qos: 1,
    retain: true,
  });
}

export function publishBusEvent(ga, payload) {
  if (!client) return;
  client.publish(topicFor(config.mqtt.busTopicPrefix, ga), JSON.stringify(payload), {
    qos: 0,
    retain: false,
  });
}

export async function disconnectMqtt() {
  if (!client) return;
  await new Promise((resolve) => {
    client.publish(config.mqtt.statusTopic, 'offline', { qos: 1, retain: true }, () => {
      client.end(false, {}, resolve);
    });
  });
}
