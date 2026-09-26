import crypto from 'node:crypto';
import { config } from './config.js';
import { logger } from './logger.js';

/**
 * Prüft den X-Callback-Signature-Header gegen das konfigurierte Secret.
 *
 * Laut KNX IoT 3rd Party API Spec (Callback eventNotification):
 * "A base64 encoded HMAC-SHA256 signature as a concatenation of the entire
 * message request-line (including the CRLF), HTTP header values of Host,
 * Date, Content-Length, and the entire message body."
 *
 * HINWEIS: Die exakte Byte-für-Byte-Zusammensetzung (Trennzeichen zwischen
 * den Teilen, genaue Formatierung der Request-Line) ist in der Spec nicht
 * vollständig eindeutig spezifiziert. Diese Implementierung ist ein
 * bestmöglicher Nachbau und sollte gegen die tatsächliche
 * semantic-knx-gateway-Implementierung verifiziert werden, bevor die
 * Signaturprüfung produktiv scharf geschaltet wird (siehe README).
 */
export function verifyCallbackSignature({ method, url, httpVersion, headers, rawBody }) {
  const signatureHeader = headers['x-callback-signature'];
  if (!signatureHeader) {
    return { valid: false, reason: 'X-Callback-Signature-Header fehlt' };
  }

  const requestLine = `${method} ${url} HTTP/${httpVersion}\r\n`;
  const host = headers.host ?? '';
  const date = headers.date ?? '';
  const contentLength = headers['content-length'] ?? String(rawBody.length);

  const base = Buffer.concat([
    Buffer.from(requestLine, 'utf8'),
    Buffer.from(host, 'utf8'),
    Buffer.from(date, 'utf8'),
    Buffer.from(contentLength, 'utf8'),
    rawBody,
  ]);

  const expected = crypto.createHmac('sha256', config.callback.secret).update(base).digest('base64');

  let valid;
  try {
    valid = crypto.timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(signatureHeader, 'utf8'));
  } catch {
    valid = false;
  }

  if (!valid) {
    logger.warn('Callback-Signatur ungültig');
  }

  return { valid, reason: valid ? null : 'Signatur stimmt nicht überein' };
}
