import http from 'node:http';
import { config } from './config.js';
import { logger } from './logger.js';
import { verifyCallbackSignature } from './signature.js';
import { lookupDatapoint } from './datapointCache.js';
import { publishState, publishBusEvent } from './mqttPublisher.js';

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function handleEntry(entry) {
    logger.info(
    `KNX Event: type=${entry.type} id=${entry.id} attributes=${JSON.stringify(entry.attributes ?? {})}`,
  );

  if (entry.type !== 'datapoint') {
    // node/installation-Events werden in v1 nicht auf MQTT gespiegelt,
    // siehe Design-Dokument Abschnitt 3.
    logger.debug(`Event vom Typ "${entry.type}" ignoriert (id=${entry.id})`);
    return;
  }

  const meta = lookupDatapoint(entry.id);
  const attrs = entry.attributes ?? {};

  const payload = {
    ga: meta.ga,
    title: meta.title,
    dpt: meta.dpt,
    value: attrs.value ?? null,
    timestamp: attrs.timestamp ?? new Date().toISOString(),
  };

  publishState(meta.ga, payload);
  publishBusEvent(meta.ga, payload);
}

export function startCallbackServer() {
  const server = http.createServer(async (req, res) => {
    if (req.method !== 'POST' || req.url !== config.callback.path) {
      res.writeHead(404).end();
      return;
    }

    let rawBody;
    try {
      rawBody = await readRawBody(req);
    } catch (err) {
      logger.error('Fehler beim Lesen des Callback-Bodys', err);
      res.writeHead(400).end();
      return;
    }

    logger.info('=== KNX CALLBACK EMPFANGEN ===');
    logger.info(`Request: ${req.method} ${req.url}`);
    logger.info(`Headers: ${JSON.stringify(req.headers)}`);
    logger.info(`Body: ${rawBody.toString('utf8')}`);

    const { valid, reason } = verifyCallbackSignature({
      method: req.method,
      url: req.url,
      httpVersion: req.httpVersion,
      headers: req.headers,
      rawBody,
    });

    if (!valid) {
      logger.warn(`Callback abgelehnt: ${reason}`);
      res.writeHead(401).end();
      return;
    }

    let body;
    try {
      body = JSON.parse(rawBody.toString('utf8'));
    } catch (err) {
      logger.error('Callback-Body ist kein valides JSON', err);
      res.writeHead(400).end();
      return;
    }

    const entries = Array.isArray(body?.data) ? body.data : body?.data ? [body.data] : [];
    for (const entry of entries) {
      try {
        handleEntry(entry);
      } catch (err) {
        logger.error(`Fehler beim Verarbeiten eines Events (id=${entry?.id})`, err);
      }
    }

    res.writeHead(200, { 'Content-Type': 'application/json' }).end('{}');
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.callback.port, config.callback.host, () => {
      logger.info(
        `Callback-Server hört auf http://${config.callback.host}:${config.callback.port}${config.callback.path}`,
      );
      resolve(server);
    });
  });
}
