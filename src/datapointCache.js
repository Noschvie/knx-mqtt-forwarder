import { config } from './config.js';
import { getAccessToken } from './oauthClient.js';
import { logger } from './logger.js';

// id (Datapoint-UUID) -> { ga, title, dpt }
const cache = new Map();

const PAGE_SIZE = 500;

function extractGa(item) {
  // Fallback-Kette wie im bestehenden knx_subscribe.be-Skript: zuerst ein
  // proprietäres meta.ga (falls das Gateway das liefert), dann die offizielle
  // KIM-Property knx:groupAddress, sonst kein GA verfügbar.
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
 * Lädt alle Datapoints einmalig (paginiert) und baut den lokalen
 * Metadaten-Cache auf. Wird beim Start sowie optional periodisch aufgerufen,
 * damit neue/umbenannte Datapoints berücksichtigt werden.
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
 * Liefert alle aktuell im Cache bekannten Datapoint-IDs — Basis für den
 * "all"-Subscription-Modus, der jeden Datapoint einzeln adressiert (siehe
 * subscriptionManager.js: das Gateway unterstützt Location-Level-Expand in
 * subscriptionDatapoints nicht, siehe docs/DESIGN.md).
 */
export function getAllDatapointIds() {
  return Array.from(cache.keys());
}

/**
 * Liefert die bekannten Metadaten zu einer Datapoint-ID (synchron, nur
 * Bulk-Cache). Fällt auf die blanke ID als "ga" zurück, falls kein Treffer da
 * ist. Für Event-Verarbeitung lieber resolveDatapoint() verwenden (siehe
 * unten), das bei einem Cache-Miss live nachlädt.
 */
export function lookupDatapoint(id) {
  const hit = cache.get(id);
  if (hit) return hit;
  return { id, ga: id, title: null, dpt: null };
}

// IDs, für die ein Live-Fetch bereits erfolglos war (z. B. HTTP 404) — um bei
// wiederholten Events für dieselbe (tatsächlich nicht existierende) ID nicht
// bei jedem Mal erneut erfolglos nachzufragen.
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
 * Wie lookupDatapoint(), aber mit Live-Fallback: Ist die ID nicht im
 * Bulk-Cache (z. B. weil /datapoints sie beim letzten Refresh nicht gelistet
 * hat, obwohl sie aktiv Bus-Events liefert — real beobachtet bei
 * semantic-knx-gateway), wird sie einzeln per GET /datapoints/{id}
 * nachgeladen und das Ergebnis für künftige Events gecached.
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
