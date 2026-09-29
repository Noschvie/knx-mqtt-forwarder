import { config } from './config.js';
import { getAccessToken } from './oauthClient.js';
import { logger } from './logger.js';

async function getJson(path) {
  const token = await getAccessToken('read');
  const res = await fetch(`${config.knx.resourceBaseUrl}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.api+json',
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`GET ${path} fehlgeschlagen (HTTP ${res.status}): ${text}`);
  }

  return res.json();
}

/**
 * Fragt /node ab und loggt die wichtigsten Infos (Name, Vendor,
 * Subscription-Auslastung). Liefert die Node-ID zurück, die für
 * Subscriptions vom Typ "node" benötigt wird (laut Spec existiert die Node
 * nur als Einzelinstanz).
 */
export async function logNodeInfo() {
  let payload;
  try {
    payload = await getJson('/node');
  } catch (err) {
    logger.warn('GET /node fehlgeschlagen, überspringe Info-Log', err);
    return null;
  }

  const node = payload.data;
  if (!node) {
    logger.warn('/node lieferte kein data-Objekt zurück');
    return null;
  }

  const attrs = node.attributes ?? {};
  logger.info(
    `Node: id=${node.id} type=${node.type} name="${attrs.deviceOrServiceName ?? '?'}" ` +
      `vendor="${attrs.vendorOrProvider ?? '?'}" ` +
      `subscriptions=${attrs.currentSubscriptions ?? '?'}/${attrs.maxSubscriptions ?? '?'}`,
  );

  return node.id;
}

/**
 * Fragt /installations ab und loggt alle vorhandenen Installationen
 * (id + title) — rein informativ, u. a. um die passende
 * KNX_SUBSCRIPTION_TARGET_ID für TARGET_TYPE=installation zu finden.
 */
export async function logInstallations() {
  let payload;
  try {
    payload = await getJson('/installations');
  } catch (err) {
    logger.warn('GET /installations fehlgeschlagen, überspringe Info-Log', err);
    return [];
  }

  const items = payload.data ?? [];
  if (items.length === 0) {
    logger.info('Installations: keine vorhanden');
    return items;
  }

  logger.info(`Installations (${items.length}):`);
  for (const item of items) {
    logger.info(`  - id=${item.id} title="${item.attributes?.title ?? '?'}"`);
  }

  return items;
}
