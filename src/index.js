import { logger } from './logger.js';
import { connectMqtt, disconnectMqtt } from './mqttPublisher.js';
import { refreshDatapointCache } from './datapointCache.js';
import { startCallbackServer } from './callbackServer.js';
import { logNodeInfo, logInstallations } from './gatewayInfo.js';
import { createSubscription, deleteSubscription } from './subscriptionManager.js';

let httpServer = null;
let shuttingDown = false;

async function start() {
  logger.info('knx-mqtt-forwarder starting...');

  await connectMqtt();
  await refreshDatapointCache();
  httpServer = await startCallbackServer();

  // Informational only (diagnostics/configuration help); this no longer
  // affects the subscription itself. See subscriptionManager.js.
  await logNodeInfo();
  await logInstallations();

  await createSubscription();

  logger.info('knx-mqtt-forwarder ready.');
}

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`Received ${signal}; shutting down...`);

  await deleteSubscription();
  if (httpServer) await new Promise((resolve) => httpServer.close(resolve));
  await disconnectMqtt();

  logger.info('Shutdown complete.');
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

start().catch((err) => {
  logger.error('Startup failed', err);
  process.exit(1);
});
