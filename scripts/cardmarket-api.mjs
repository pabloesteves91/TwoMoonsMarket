#!/usr/bin/env node
/**
 * Zugriff auf die Cardmarket-API (apiv2).
 *
 * Die API verlangt OAuth 1.0a mit HMAC-SHA1: jede Anfrage trägt eine Signatur
 * über Methode, URL und die alphabetisch sortierten Parameter. Anders als bei
 * üblichem OAuth wird kein Token ausgehandelt – die vier Werte kommen fertig aus
 * dem Cardmarket-Konto (Einstellungen → App-Zugang).
 *
 * Gebraucht werden sie als Umgebungsvariablen:
 *   CM_APP_TOKEN, CM_APP_SECRET, CM_ACCESS_TOKEN, CM_ACCESS_SECRET
 *
 * Fehlen sie, meldet das aufrufende Skript das und arbeitet ohne API weiter.
 */

import { createHmac, randomBytes } from 'node:crypto';
import { env } from 'node:process';

export const API_BASE = 'https://api.cardmarket.com/ws/v2.0/output.json';

/** Prozentkodierung nach RFC 3986 – strenger als encodeURIComponent. */
function rfc3986(value) {
  return encodeURIComponent(String(value)).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/**
 * Baut den Authorization-Header für eine Anfrage.
 *
 * `url` muss die vollständige Adresse ohne Query sein, `query` enthält die
 * Abfrageparameter getrennt – beide fliessen in die Signatur ein.
 */
export function authorizationHeader({ method = 'GET', url, query = {}, credentials, nonce, timestamp }) {
  const oauth = {
    oauth_consumer_key: credentials.appToken,
    oauth_nonce: nonce ?? randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: timestamp ?? Math.floor(Date.now() / 1000),
    oauth_token: credentials.accessToken,
    oauth_version: '1.0',
  };

  // Signaturbasis: Methode, Adresse und alle Parameter sortiert
  const params = { ...oauth, ...query };
  const encoded = Object.keys(params)
    .map((key) => [rfc3986(key), rfc3986(params[key])])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1))
    .map(([key, value]) => `${key}=${value}`)
    .join('&');

  const base = [method.toUpperCase(), rfc3986(url), rfc3986(encoded)].join('&');
  const key = `${rfc3986(credentials.appSecret)}&${rfc3986(credentials.accessSecret)}`;
  const signature = createHmac('sha1', key).update(base).digest('base64');

  const header = { ...oauth, oauth_signature: signature, realm: url };
  return (
    'OAuth ' +
    Object.keys(header)
      .map((name) => `${name}="${rfc3986(header[name])}"`)
      .join(', ')
  );
}

export function credentialsFromEnv() {
  const credentials = {
    appToken: env.CM_APP_TOKEN,
    appSecret: env.CM_APP_SECRET,
    accessToken: env.CM_ACCESS_TOKEN,
    accessSecret: env.CM_ACCESS_SECRET,
  };
  const missing = Object.entries(credentials)
    .filter(([, value]) => !value)
    .map(([name]) => name);
  return missing.length ? null : credentials;
}

/** Führt eine GET-Anfrage aus und liefert das geparste JSON. */
export async function apiGet(path, query, credentials) {
  const url = `${API_BASE}${path}`;
  const search = new URLSearchParams(query ?? {}).toString();
  const response = await fetch(search ? `${url}?${search}` : url, {
    headers: {
      Authorization: authorizationHeader({ url, query: query ?? {}, credentials }),
      Accept: 'application/json',
      'User-Agent': 'TwoMoonsMarket/0.1',
    },
  });

  if (response.status === 204) return null; // Kein Inhalt – z.B. keine Angebote
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`${path} → HTTP ${response.status}: ${body.slice(0, 300)}`);
  }
  try {
    return JSON.parse(body);
  } catch {
    throw new Error(`${path} → Antwort war kein JSON: ${body.slice(0, 200)}`);
  }
}
