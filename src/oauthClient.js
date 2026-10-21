import { config } from './config.js';
import { logger } from './logger.js';

// Cache by scope string because the KNX IoT API issues separate access tokens
// for each requested scope (see /oauth/access, grant_type=client_credentials).
const tokenCache = new Map();

// Safety margin, in seconds, before a token is considered expired.
const EXPIRY_SAFETY_MARGIN_S = 30;

function basicAuthHeader() {
  const raw = `${config.knx.clientId}:${config.knx.clientSecret}`;
  return `Basic ${Buffer.from(raw, 'utf8').toString('base64')}`;
}

async function requestToken(scope) {
  const url = `${config.knx.hostUrl}/oauth/access`;
  const body = new URLSearchParams({ grant_type: 'client_credentials', scope });

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: basicAuthHeader(),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`OAuth-Token-Request fehlgeschlagen (scope="${scope}", HTTP ${res.status}): ${text}`);
  }

  const data = await res.json();
  if (!data.access_token) {
    throw new Error(`OAuth-Antwort ohne access_token (scope="${scope}")`);
  }

  return data;
}

/**
 * Returns a valid access token for the requested scope (e.g. "read",
 * "manage", "read manage"). Fetches a new token when needed and caches it
 * until shortly before expiration.
 */
export async function getAccessToken(scope) {
  const cached = tokenCache.get(scope);
  const now = Date.now();

  if (cached && cached.expiresAt - EXPIRY_SAFETY_MARGIN_S * 1000 > now) {
    return cached.accessToken;
  }

  logger.debug(`Hole neues OAuth-Token (scope="${scope}")`);
  const data = await requestToken(scope);
  const expiresInS = Number(data.expires_in ?? 300);

  tokenCache.set(scope, {
    accessToken: data.access_token,
    expiresAt: now + expiresInS * 1000,
  });

  return data.access_token;
}
