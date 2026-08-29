// Minimal androidpublisher client: service-account JWT -> access token -> REST.
// Hand-rolled because googleapis/google-auth-library aren't in this project's tree.
const crypto = require('crypto');
const fs = require('fs');

const KEY = JSON.parse(fs.readFileSync(process.env.SA_KEY, 'utf8'));
const SCOPE = 'https://www.googleapis.com/auth/androidpublisher';
const B = 'https://androidpublisher.googleapis.com/androidpublisher/v3';

const b64u = (b) => Buffer.from(b).toString('base64url');

async function token() {
  const now = Math.floor(Date.now() / 1000);
  const hdr = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const cls = b64u(JSON.stringify({
    iss: KEY.client_email, scope: SCOPE, aud: KEY.token_uri, iat: now, exp: now + 3600,
  }));
  const sig = crypto.sign('RSA-SHA256', Buffer.from(`${hdr}.${cls}`), KEY.private_key).toString('base64url');
  const r = await fetch(KEY.token_uri, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${hdr}.${cls}.${sig}`,
    }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error('token failed: ' + JSON.stringify(j));
  return j.access_token;
}

async function api(tok, method, path, body, raw, contentType) {
  const r = await fetch(B + path, {
    method,
    headers: { authorization: `Bearer ${tok}`, ...(body ? { 'content-type': 'application/json' } : {}), ...(contentType ? { 'content-type': contentType } : {}) },
    body: raw || (body ? JSON.stringify(body) : undefined),
  });
  const txt = await r.text();
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status}\n${txt.slice(0, 700)}`);
  return txt ? JSON.parse(txt) : null;
}

module.exports = { token, api, B };
