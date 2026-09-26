import { config } from './config.js';
import { getAccessToken } from './oauthClient.js';
import { logger } from './logger.js';

let subscriptionId = null;
let renewTimer = null;

function subscriptionRequestBody() {
  const relationshipKey = config.knx.subscriptionTargetType === 'node' ? 'subscriptionNode' : 'subscriptionInstallations';

  const targetType = config.knx.subscriptionTargetType === 'node' ? 'service' : 'installation';

  const data =
    config.knx.subscriptionTargetType === 'node'
      ? { id: config.knx.subscriptionTargetId || undefined, type: targetType, meta: { expand: true } }
      : [{ id: config.knx.subscriptionTargetId, type: targetType }];

  return {
    data: {
      type: 'subscription',
      relationships: {
        [relationshipKey]: { data },
      },
      attributes: {
        url: config.callback.publicUrl,
        secret: config.callback.secret,
        lifetime: config.knx.subscriptionLifetimeS,
      },
    },
  };
}

async function request(method, path, body) {
  const token = await getAccessToken('manage');
  const res = await fetch(`${config.knx.baseUrl}${path}`, {
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

export async function createSubscription() {
  const body = subscriptionRequestBody();
  const resp = await request('POST', '/subscriptions', body);
  subscriptionId = resp?.data?.id ?? null;

  if (!subscriptionId) {
    throw new Error('Subscription-Erstellung lieferte keine id zurück');
  }

  logger.info(`Subscription erstellt: ${subscriptionId}`);
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
