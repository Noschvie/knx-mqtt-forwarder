import { config } from './config.js';
import { getAccessToken } from './oauthClient.js';
import { logger } from './logger.js';

// id (datapoint UUID) -> { ga, title, dpt }
const cache = new Map();

const PAGE_SIZE = 500;

function extractGa(item) {
  // Use the same fallback order as the existing knx_subscribe.be script:
  // first the proprietary meta.ga (if provided by the gateway), then the
  // official KIM property knx:groupAddress, otherwise no GA is available.
  const meta = item.meta ?? {};
  const attrs = item.attributes ?? {};
  return meta.ga ?? attrs['knx:groupAddress'] ?? null;
}

function extractDpt(item) {
  const meta = item.meta ?? {};
  const attrs = item.attributes ?? {};
  if (meta.dpt) return meta.dpt;
  if (Array.isArray(attrs.datapointType) && attrs.datapointType.length > 0) {
    return attrs.datapointType[0];
  }
  return null;
}

async function fetchPage(token, pageNumber) {
  const url = new URL(`${config.knx.resourceBaseUrl}/datapoints`);
  url.searchParams.set('page[number]', String(pageNumber));
  url.searchParams.set('page[size]', String(PAGE_SIZE));

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.api+json',
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`GET /datapoints fehlgeschlagen (HTTP ${res.status}): ${text}`);
  }

  return res.json();
}

/**
 * Loads all datapoints once (paginated) and builds the local metadata cache.
 * Called at startup and optionally on a schedule to account for new or
 * renamed datapoints.
 */
export async function refreshDatapointCache() {
  const token = await getAccessToken('read');
  let pageNumber = 0;
  let total = null;
  let loaded = 0;
  const next = new Map();

  do {
    const payload = await fetchPage(token, pageNumber);
    const items = payload.data ?? [];
    total = payload.meta?.collection?.total ?? items.length;

    for (const item of items) {
      next.set(item.id, {
        id: item.id,
        ga: extractGa(item),
        title: item.attributes?.title ?? null,
        dpt: extractDpt(item),
      });
    }

    loaded += items.length;
    pageNumber += 1;
  } while (loaded < total);

  cache.clear();
  for (const [id, meta] of next) cache.set(id, meta);

  logger.info(`Datapoint-Metadaten-Cache aktualisiert: ${cache.size} Einträge`);
}

/**
 * Returns all datapoint IDs currently known to the cache. This is the basis
 * for "all" subscription mode, which addresses each datapoint individually
 * (see subscriptionManager.js; the gateway does not support location-level
 * expand in subscriptionDatapoints, see docs/DESIGN.md).
 */
export function getAllDatapointIds() {
  return Array.from(cache.keys());
}

/**
 * Returns the known metadata for a datapoint ID (synchronous, bulk cache only).
 * Falls back to the ID itself as "ga" if there is no match. Prefer
 * resolveDatapoint() for event processing (see below), which fetches missing
 * entries live.
 */
export function lookupDatapoint(id) {
  const hit = cache.get(id);
  if (hit) return hit;
  return { id, ga: id, title: null, dpt: null };
}

// IDs for which a live fetch has already failed (e.g. HTTP 404), so repeated
// events for the same nonexistent ID do not trigger another failed request.
const knownMissing = new Set();

async function fetchSingleDatapoint(id) {
  const token = await getAccessToken('read');
  const res = await fetch(`${config.knx.resourceBaseUrl}/datapoints/${encodeURIComponent(id)}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.api+json',
    },
  });

  if (res.status === 404) return null;
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`GET /datapoints/${id} fehlgeschlagen (HTTP ${res.status}): ${text}`);
  }

  const payload = await res.json();
  return payload?.data ?? null;
}

/**
 * Like lookupDatapoint(), but with a live fallback: if the ID is not in the
 * bulk cache (e.g. because /datapoints did not list it on the last refresh,
 * even though it actively produces bus events, as observed with
 * semantic-knx-gateway), fetch it individually with GET /datapoints/{id} and
 * cache the result for future events.
 */
export async function resolveDatapoint(id) {
  const cached = cache.get(id);
  if (cached) return cached;

  if (knownMissing.has(id)) {
    return { id, ga: id, title: null, dpt: null };
  }

  try {
    const item = await fetchSingleDatapoint(id);
    if (!item) {
      knownMissing.add(id);
      logger.warn(`Live-Fetch GET /datapoints/${id}: nicht gefunden (404)`);
      return { id, ga: id, title: null, dpt: null };
    }

    const meta = {
      id: item.id,
      ga: extractGa(item),
      title: item.attributes?.title ?? null,
      dpt: extractDpt(item),
    };
    cache.set(id, meta);
    logger.info(`Datapoint ${id} per Live-Fetch nachgeladen und gecached: "${meta.title ?? '?'}"`);
    return meta;
  } catch (err) {
    logger.warn(`Live-Fetch für Datapoint ${id} fehlgeschlagen`, err);
    return { id, ga: id, title: null, dpt: null };
  }
}
