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
      logger.info(`Connected to MQTT: ${config.mqtt.url}`);
      client.publish(config.mqtt.statusTopic, 'online', { qos: 1, retain: true });
      resolve(client);
    });

    client.once('error', (err) => {
      logger.error('MQTT connection error', err);
      reject(err);
    });

    client.on('reconnect', () => logger.warn('MQTT: reconnect attempt...'));
    client.on('offline', () => logger.warn('MQTT: connection offline'));
  });
}

function topicFor(prefix, ga) {
  // Flatten the topic: "4/2/35" -> "4-2-35", i.e. exactly ONE topic level per
  // GA (e.g. knx/state/4-2-35). The payload retains the original GA format.
  // "+" and "#" are invalid in topic names and are replaced as a precaution.
  const flat = String(ga).replace(/[/+#]/g, '-');
  return `${prefix}/${flat}`;
}

export function publishState(ga, payload) {
  if (!client) {
    logger.warn(`MQTT not connected — discarded state event for ga=${ga}`);
    return;
  }
  const topic = topicFor(config.mqtt.stateTopicPrefix, ga);
  client.publish(topic, JSON.stringify(payload), { qos: 1, retain: true });
  logger.debug(`MQTT publish (retained): ${topic}`);
}

export function publishBusEvent(ga, payload) {
  if (!client) {
    logger.warn(`MQTT not connected — discarded bus event for ga=${ga}`);
    return;
  }
  const topic = topicFor(config.mqtt.busTopicPrefix, ga);
  client.publish(topic, JSON.stringify(payload), { qos: 0, retain: false });
  logger.debug(`MQTT publish: ${topic}`);
}

export async function disconnectMqtt() {
  if (!client) return;
  await new Promise((resolve) => {
    client.publish(config.mqtt.statusTopic, 'offline', { qos: 1, retain: true }, () => {
      client.end(false, {}, resolve);
    });
  });
}
