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
    // Node/installation events are not mirrored to MQTT in v1; see section 3
    // of the design document.
    logger.debug(`Ignoring event of type "${entry.type}" (id=${entry.id})`);
    return;
  }

  // resolveDatapoint() checks the bulk cache first and fetches missing entries
  // with GET /datapoints/{id} (see datapointCache.js). This is needed because
  // some observed IDs do not appear in the bulk /datapoints catalog even
  // though they actively produce events.
  const meta = await resolveDatapoint(entry.id);
  const attrs = entry.attributes ?? {};
  // Fall back to the datapoint ID if the gateway does not provide a GA;
  // otherwise the topic would be "knx/state/null".
  const ga = meta.ga ?? entry.id;

  const payload = {
    ga,
    title: meta.title,
    dpt: meta.dpt,
    value: attrs.value ?? null,
    timestamp: attrs.timestamp ?? new Date().toISOString(),
  };

  // Serialize object values to avoid "[object Object]" in the log.
  // The MQTT payload is unaffected because it is already JSON-serialized.
  const valueStr = typeof payload.value === 'object' && payload.value !== null ? JSON.stringify(payload.value) : payload.value;
  logger.info(`CoV: "${meta.title ?? '?'}" (ga=${ga}, dpt=${meta.dpt ?? '?'}) = ${valueStr}`);

  publishState(ga, payload);
  publishBusEvent(ga, payload);
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
      logger.error('Failed to read callback body', err);
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
      logger.warn(`Callback rejected: ${reason}`);
      res.writeHead(401).end();
      return;
    }

    let body;
    try {
      body = JSON.parse(rawBody.toString('utf8'));
    } catch (err) {
      logger.error('Callback body is not valid JSON', err);
      res.writeHead(400).end();
      return;
    }

    const entries = Array.isArray(body?.data) ? body.data : body?.data ? [body.data] : [];
    for (const entry of entries) {
      try {
        await handleEntry(entry);
      } catch (err) {
        logger.error(`Failed to process event (id=${entry?.id})`, err);
      }
    }

    res.writeHead(200, { 'Content-Type': 'application/json' }).end('{}');
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.callback.port, config.callback.host, () => {
      logger.info(
        `Callback server listening on http://${config.callback.host}:${config.callback.port}${config.callback.path}`,
      );
      resolve(server);
    });
  });
}
