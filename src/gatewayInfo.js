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
    throw new Error(`GET ${path} failed (HTTP ${res.status}): ${text}`);
  }

  return res.json();
}

/**
 * Fetches /node and logs key information (name, vendor, subscription usage).
 * Returns the node ID required for subscriptions of type "node" (the spec
 * defines only a single node instance).
 */
export async function logNodeInfo() {
  let payload;
  try {
    payload = await getJson('/node');
  } catch (err) {
    logger.warn('GET /node failed; skipping node information logging', err);
    return null;
  }

  const node = payload.data;
  if (!node) {
    logger.warn('/node returned no data object');
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
 * Fetches /installations and logs all available installations (id + title).
 * This is informational only, e.g. to find the appropriate
 * KNX_SUBSCRIPTION_TARGET_ID for TARGET_TYPE=installation.
 */
export async function logInstallations() {
  let payload;
  try {
    payload = await getJson('/installations');
  } catch (err) {
    logger.warn('GET /installations failed; skipping installation information logging', err);
    return [];
  }

  const items = payload.data ?? [];
  if (items.length === 0) {
    logger.info('Installations: none found');
    return items;
  }

  logger.info(`Installations (${items.length}):`);
  for (const item of items) {
    logger.info(`  - id=${item.id} title="${item.attributes?.title ?? '?'}"`);
  }

  return items;
}
