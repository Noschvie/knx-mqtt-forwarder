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
 * Liefert die bekannten Metadaten zu einer Datapoint-UUID. Fällt auf die
 * blanke UUID als "ga" zurück, falls kein GA ermittelbar ist (z. B. Datapoint
 * nicht im Cache, weil zwischenzeitlich neu angelegt).
 */
export function lookupDatapoint(id) {
  const hit = cache.get(id);
  if (hit) return hit;
  return { id, ga: id, title: null, dpt: null };
}
