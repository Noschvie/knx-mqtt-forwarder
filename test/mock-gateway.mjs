import http from 'node:http';
import net from 'node:net';
import aedes from 'aedes';

// ── Mock MQTT broker (aedes) ────────────────────────────────────────────────
const broker = aedes();
const mqttServer = net.createServer(broker.handle);
mqttServer.listen(18830, () => console.log('[mock] MQTT-Broker auf 18830'));

broker.on('publish', (packet, client) => {
  if (client && packet.topic.startsWith('knx/')) {
    console.log(`[mock] MQTT publish topic="${packet.topic}" retain=${packet.retain} payload=${packet.payload}`);
  }
});

// ── Mock KNX IoT API ─────────────────────────────────────────────────────────
let subscriptionCounter = 0;

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/vnd.api+json' });
  res.end(JSON.stringify(body));
}

const gateway = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks).toString('utf8');
    console.log(`[mock] ${req.method} ${req.url}`);

    if (req.method === 'POST' && req.url === '/oauth/access') {
      return json(res, 200, { access_token: 'fake-token', token_type: 'Bearer', expires_in: 300 });
    }

    if (req.method === 'GET' && req.url === '/api/v2/node') {
      return json(res, 200, {
        data: {
          id: 'node-uuid-123',
          type: 'service',
          attributes: {
            deviceOrServiceName: 'Mock Gateway Service',
            vendorOrProvider: 'testvendor',
            maxSubscriptions: 512,
            currentSubscriptions: 3,
          },
        },
      });
    }

    if (req.method === 'GET' && req.url === '/api/v2/installations') {
      return json(res, 200, {
        meta: { collection: { number: 0, size: 2, total: 2 } },
        data: [
          { id: 'inst-1', type: 'installation', attributes: { title: 'Haupthaus' } },
          { id: 'inst-2', type: 'installation', attributes: { title: 'Garten' } },
        ],
      });
    }

    // The single-datapoint fetch (live fallback on cache miss) MUST be checked
    // before the collection handler, otherwise startsWith() matches both.
    if (req.method === 'GET' && req.url === '/api/v2/datapoints/dp-live-fetch-me') {
      return json(res, 200, {
        data: {
          id: 'dp-live-fetch-me',
          type: 'datapoint',
          attributes: { title: 'Nachgeladener Punkt' },
          meta: { ga: '1/1/99' },
        },
      });
    }

    // Datapoint without a GA (edge case: the topic must not contain "null")
    if (req.method === 'GET' && req.url === '/api/v2/datapoints/dp-no-ga') {
      return json(res, 200, {
        data: { id: 'dp-no-ga', type: 'datapoint', attributes: { title: 'Punkt ohne GA' } },
      });
    }

    if (req.method === 'GET' && req.url === '/api/v2/datapoints/dp-ghost') {
      return json(res, 404, { errors: [{ status: '404', title: 'Not Found' }] });
    }

    if (req.method === 'GET' && req.url.startsWith('/api/v2/datapoints')) {
      return json(res, 200, {
        meta: { collection: { number: 0, size: 3, total: 3 } },
        data: [
          { id: 'dp-1', type: 'datapoint', attributes: { title: 'Licht Wohnzimmer' }, meta: { ga: '1/1/1' } },
          { id: 'dp-2', type: 'datapoint', attributes: { title: 'Jalousie Küche' }, meta: { ga: '1/1/2' } },
          { id: 'dp-3', type: 'datapoint', attributes: { title: 'Temperatur Bad' }, meta: { ga: '1/1/3' } },
        ],
      });
    }

    if (req.method === 'POST' && req.url === '/api/v2/subscriptions') {
      console.log(`[mock] Subscription-Body: ${body}`);

      // Mirrors actual gateway behavior: "location" is rejected as an invalid
      // relationship type despite the spec example.
      const parsed = JSON.parse(body);
      const items = parsed?.data?.relationships?.subscriptionDatapoints?.data ?? [];
      const invalidType = items.find((item) => item.type !== 'datapoint');
      if (invalidType) {
        return json(res, 500, {
          errors: [
            {
              status: '500',
              detail: `Invalid relationship type "${invalidType.type}" for subscriptionDatapoints.`,
            },
          ],
        });
      }

      subscriptionCounter += 1;
      const id = `sub-${subscriptionCounter}`;
      return json(res, 201, { data: { id, type: 'subscription' } });
    }

    if (req.method === 'DELETE' && req.url.startsWith('/api/v2/subscriptions/')) {
      return res.writeHead(204).end();
    }

    console.log(`[mock] Unbekannter Request: ${req.method} ${req.url}`);
    return json(res, 404, { errors: [{ title: 'Not Found' }] });
  });
});

gateway.listen(18000, () => console.log('[mock] KNX-Gateway auf 18000'));
