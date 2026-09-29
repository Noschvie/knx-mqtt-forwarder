import { config } from './config.js';
import { logger } from './logger.js';
import { connectMqtt, disconnectMqtt } from './mqttPublisher.js';
import { refreshDatapointCache } from './datapointCache.js';
import { startCallbackServer } from './callbackServer.js';
import { logNodeInfo, logInstallations } from './gatewayInfo.js';
import { createSubscription, deleteSubscription } from './subscriptionManager.js';

let httpServer = null;
let shuttingDown = false;

async function start() {
  logger.info('knx-mqtt-forwarder startet...');

  await connectMqtt();
  await refreshDatapointCache();
  httpServer = await startCallbackServer();

  const nodeId = await logNodeInfo();
  await logInstallations();

  if (config.knx.subscriptionTargetType === 'node' && !config.knx.subscriptionTargetId && nodeId) {
    logger.info(`Keine KNX_SUBSCRIPTION_TARGET_ID gesetzt, übernehme Node-ID aus /node: ${nodeId}`);
    config.knx.subscriptionTargetId = nodeId;
  }

  await createSubscription();

  logger.info('knx-mqtt-forwarder bereit.');
}

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`Signal ${signal} empfangen, fahre herunter...`);

  await deleteSubscription();
  if (httpServer) await new Promise((resolve) => httpServer.close(resolve));
  await disconnectMqtt();

  logger.info('Sauber beendet.');
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

start().catch((err) => {
  logger.error('Start fehlgeschlagen', err);
  process.exit(1);
});
