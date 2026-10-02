import http from 'node:http';
import { config } from './config.js';
import { logger } from './logger.js';
import { verifyCallbackSignature } from './signature.js';
import { resolveDatapoint } from './datapointCache.js';
import { publishState, publishBusEvent } from './mqttPublisher.js';

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function handleEntry(entry) {
  if (entry.type !== 'datapoint') {
    // node/installation-Events werden in v1 nicht auf MQTT gespiegelt,
    // siehe Design-Dokument Abschnitt 3.
    logger.debug(`Event vom Typ "${entry.type}" ignoriert (id=${entry.id})`);
    return;
  }

  // resolveDatapoint() prüft zuerst den Bulk-Cache und lädt bei einem Miss
  // live per GET /datapoints/{id} nach (siehe datapointCache.js) — nötig,
  // weil einzelne IDs real beobachtet nicht im Bulk-/datapoints-Katalog
  // auftauchen, obwohl sie aktiv Events liefern.
  const meta = await resolveDatapoint(entry.id);
  const attrs = entry.attributes ?? {};

  const payload = {
    ga: meta.ga,
    title: meta.title,
    dpt: meta.dpt,
    value: attrs.value ?? null,
    timestamp: attrs.timestamp ?? new Date().toISOString(),
  };

  // Manche DPTs (z. B. 10.001 Uhrzeit, 11.001 Datum) liefern ein strukturiertes
  // Objekt statt eines primitiven Werts — JSON.stringify statt direkter
  // Interpolation, sonst "[object Object]" in der Log-Zeile (der tatsächliche
  // MQTT-Payload war davon nie betroffen, da der dort ohnehin JSON-serialisiert wird).
  const valueStr = typeof payload.value === 'object' && payload.value !== null ? JSON.stringify(payload.value) : payload.value;
  logger.info(`CoV: "${meta.title ?? '?'}" (ga=${meta.ga}, dpt=${meta.dpt ?? '?'}) = ${valueStr}`);

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
        await handleEntry(entry);
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
