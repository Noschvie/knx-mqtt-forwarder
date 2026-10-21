import { config } from './config.js';
import { getAccessToken } from './oauthClient.js';
import { logger } from './logger.js';

// id (datapoint UUID) -> { ga, title, dpt }
const cache = new Map();
// The gateway's callbacks use the internal datapointId (e.g. "GA-334")
// rather than the UUID exposed as the collection resource ID.
const callbackCache = new Map();

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
    throw new Error(`GET /datapoints failed (HTTP ${res.status}): ${text}`);
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
  const nextCallbackCache = new Map();
  let withoutCallbackId = 0;

  do {
    const payload = await fetchPage(token, pageNumber);
    const items = payload.data ?? [];
    total = payload.meta?.collection?.total ?? items.length;

    for (const item of items) {
      const meta = {
        id: item.id,
        ga: extractGa(item),
        title: item.attributes?.title ?? null,
        dpt: extractDpt(item),
      };
      next.set(item.id, meta);
      const callbackId = item.attributes?.datapointId ?? item.meta?.datapointId;
      if (callbackId != null) {
        nextCallbackCache.set(String(callbackId), meta);
      } else {
        withoutCallbackId += 1;
      }

      logger.debug(`Datapoint cache entry: ${JSON.stringify({
        resourceId: item.id,
        callbackId: callbackId ?? null,
        ga: meta.ga,
        title: meta.title,
        dpt: meta.dpt,
      })}`);
    }

    loaded += items.length;
    logger.debug(`Datapoint cache page ${pageNumber}: loaded ${items.length} items (${loaded}/${total})`);
    pageNumber += 1;
  } while (loaded < total);

  cache.clear();
  for (const [id, meta] of next) cache.set(id, meta);
  callbackCache.clear();
  for (const [id, meta] of nextCallbackCache) callbackCache.set(id, meta);
  knownMissing.clear();

  logger.info(
    `Datapoint metadata cache updated: UUID index=${cache.size}, ` +
      `callback ID index=${callbackCache.size}, without callback ID=${withoutCallbackId}`,
  );
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
 * Returns known metadata by either the resource UUID or callback datapointId.
 * Falls back to the ID itself as "ga" if there is no match. Prefer
 * resolveDatapoint() for event processing (see below), which fetches missing
 * entries live.
 */
export function lookupDatapoint(id) {
  const hit = cache.get(id) ?? callbackCache.get(String(id));
  if (hit) return hit;
  return { id, ga: id, title: null, dpt: null };
}

// IDs for which a live fetch has already failed (e.g. HTTP 404), so repeated
// events for the same nonexistent ID do not trigger another failed request.
const knownMissing = new Set();
const inFlightFetches = new Map();

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
    throw new Error(`GET /datapoints/${id} failed (HTTP ${res.status}): ${text}`);
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
  const cached = cache.get(id) ?? callbackCache.get(String(id));
  if (cached) return cached;

  if (knownMissing.has(id)) {
    return { id, ga: id, title: null, dpt: null };
  }

  const inFlight = inFlightFetches.get(id);
  if (inFlight) return inFlight;

  const fetchPromise = fetchAndCacheDatapoint(id);
  inFlightFetches.set(id, fetchPromise);
  try {
    return await fetchPromise;
  } finally {
    inFlightFetches.delete(id);
  }
}

async function fetchAndCacheDatapoint(id) {
  try {
    const item = await fetchSingleDatapoint(id);
    if (!item) {
      knownMissing.add(id);
      logger.warn(`Live fetch GET /datapoints/${id}: not found (404)`);
      return { id, ga: id, title: null, dpt: null };
    }

    const meta = {
      id: item.id,
      ga: extractGa(item),
      title: item.attributes?.title ?? null,
      dpt: extractDpt(item),
    };
    cache.set(item.id, meta);
    callbackCache.set(String(id), meta);
    logger.info(`Datapoint ${id} fetched live and cached: "${meta.title ?? '?'}"`);
    return meta;
  } catch (err) {
    logger.warn(`Live fetch for datapoint ${id} failed`, err);
    return { id, ga: id, title: null, dpt: null };
  }
}
