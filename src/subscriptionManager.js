import { config } from './config.js';
import { getAccessToken } from './oauthClient.js';
import { logger } from './logger.js';

let subscriptionId = null;
let renewTimer = null;
// Cache der Root-Location-IDs (Sites), damit nicht bei jedem Renewal erneut
// GET /sites aufgerufen werden muss. Wird bei Bedarf (Mode "sites") einmalig
// beim ersten createSubscription()-Aufruf befüllt.
let cachedSiteIds = null;

async function request(method, path, body, scope = 'manage') {
  const token = await getAccessToken(scope);
  const res = await fetch(`${config.knx.resourceBaseUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/vnd.api+json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${method} ${path} fehlgeschlagen (HTTP ${res.status}): ${text}`);
  }

  if (res.status === 204) return null;
  return res.json().catch(() => null);
}

async function fetchSiteIds() {
  const payload = await request('GET', '/sites', undefined, 'read');
  const items = payload?.data ?? [];
  const ids = items.map((item) => item.id);
  logger.info(
    `Sites für Datapoint-Subscription ermittelt (${ids.length}): ` +
      items.map((item) => `${item.id} ("${item.attributes?.title ?? '?'}")`).join(', '),
  );
  if (ids.length === 0) {
    logger.warn('GET /sites lieferte keine Root-Locations zurück — Subscription hätte keine Ziel-Items.');
  }
  return ids;
}

async function buildSubscriptionDatapointsItems() {
  if (config.knx.subscriptionMode === 'sites') {
    if (!cachedSiteIds) cachedSiteIds = await fetchSiteIds();
    return cachedSiteIds.map((id) => ({ id, type: 'location', meta: { expand: true } }));
  }

  if (config.knx.subscriptionMode === 'location') {
    return [{ id: config.knx.subscriptionTargetId, type: 'location', meta: { expand: true } }];
  }

  // 'datapoint'
  return [{ id: config.knx.subscriptionTargetId, type: 'datapoint' }];
}

async function subscriptionRequestBody() {
  const items = await buildSubscriptionDatapointsItems();

  return {
    data: {
      type: 'subscription',
      relationships: {
        subscriptionDatapoints: { data: items },
      },
      attributes: {
        url: config.callback.publicUrl,
        secret: config.callback.secret,
        lifetime: config.knx.subscriptionLifetimeS,
      },
    },
  };
}

export async function createSubscription() {
  const body = await subscriptionRequestBody();
  const resp = await request('POST', '/subscriptions', body);
  subscriptionId = resp?.data?.id ?? null;

  if (!subscriptionId) {
    throw new Error('Subscription-Erstellung lieferte keine id zurück');
  }

  logger.info(`Subscription erstellt: ${subscriptionId} (mode=${config.knx.subscriptionMode})`);
  scheduleRenewal();
  return subscriptionId;
}

async function renewSubscription() {
  if (!subscriptionId) return;
  try {
    await request('PATCH', `/subscriptions/${subscriptionId}`, {
      data: {
        id: subscriptionId,
        type: 'subscription',
        attributes: { lifetime: config.knx.subscriptionLifetimeS },
      },
    });
    logger.info(`Subscription erneuert: ${subscriptionId}`);
  } catch (err) {
    logger.error('Subscription-Renewal fehlgeschlagen, versuche Neuanlage', err);
    subscriptionId = null;
    try {
      await createSubscription();
    } catch (err2) {
      logger.error('Neuanlage der Subscription fehlgeschlagen', err2);
    }
    return;
  }
  scheduleRenewal();
}

function scheduleRenewal() {
  if (renewTimer) clearTimeout(renewTimer);
  const intervalMs = (config.knx.subscriptionLifetimeS * 1000) / 2;
  renewTimer = setTimeout(renewSubscription, intervalMs);
  renewTimer.unref?.();
}

export async function deleteSubscription() {
  if (renewTimer) clearTimeout(renewTimer);
  if (!subscriptionId) return;
  const id = subscriptionId;
  subscriptionId = null;
  try {
    await request('DELETE', `/subscriptions/${id}`);
    logger.info(`Subscription gelöscht: ${id}`);
  } catch (err) {
    logger.warn(`Subscription-Löschung fehlgeschlagen (${id})`, err);
  }
}

export function getSubscriptionId() {
  return subscriptionId;
}
