import { config } from './config.js';
import { getAccessToken } from './oauthClient.js';
import { getAllDatapointIds } from './datapointCache.js';
import { logger } from './logger.js';

let subscriptionId = null;
let renewTimer = null;

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
    throw new Error(`${method} ${path} failed (HTTP ${res.status}): ${text}`);
  }

  if (res.status === 204) return null;
  return res.json().catch(() => null);
}

function buildSubscriptionDatapointsItems() {
  if (config.knx.subscriptionMode === 'all') {
    // IMPORTANT: The gateway does NOT support subscriptionDatapoints with
    // type "location" + expand despite the spec example ("Invalid relationship
    // type 'location'", confirmed by testing). Address each known datapoint
    // individually instead of cascading through a location.
    const ids = getAllDatapointIds();
    if (ids.length === 0) {
      logger.warn(
        'Datapoint cache is empty — the subscription would have no target items. ' +
          'Check whether refreshDatapointCache() completed successfully and whether any datapoints exist.',
      );
    }
    return ids.map((id) => ({ id, type: 'datapoint' }));
  }

  // 'datapoint' (single target)
  return [{ id: config.knx.subscriptionTargetId, type: 'datapoint' }];
}

function subscriptionRequestBody() {
  const items = buildSubscriptionDatapointsItems();

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
  const body = subscriptionRequestBody();
  const itemCount = body.data.relationships.subscriptionDatapoints.data.length;
  logger.info(`Creating subscription for ${itemCount} datapoint(s) (mode=${config.knx.subscriptionMode})...`);

  const resp = await request('POST', '/subscriptions', body);
  subscriptionId = resp?.data?.id ?? null;

  if (!subscriptionId) {
    throw new Error('Subscription creation did not return an ID');
  }

  logger.info(`Subscription created: ${subscriptionId}`);
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
    logger.info(`Subscription renewed: ${subscriptionId}`);
  } catch (err) {
    logger.error('Subscription renewal failed; attempting to create a new subscription', err);
    subscriptionId = null;
    try {
      await createSubscription();
    } catch (err2) {
      logger.error('Failed to create a new subscription', err2);
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
    logger.info(`Subscription deleted: ${id}`);
  } catch (err) {
    logger.warn(`Failed to delete subscription (${id})`, err);
  }
}

export function getSubscriptionId() {
  return subscriptionId;
}
