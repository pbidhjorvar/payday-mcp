#!/usr/bin/env -S node --enable-source-maps
// Simple Landsbankinn B2B connectivity/auth test using .env credentials.
// - Posts XML to LBIN_BASE_URL
// - Supports optional mTLS via LBIN_CERT_PATH/LBIN_KEY_PATH/LBIN_KEY_PASSPHRASE
// - If LBIN_XML_FILE is set, uses its contents as the request body

import 'dotenv/config';
import axios from 'axios';
import fs from 'fs';
import https from 'https';
import path from 'path';

type NonEmpty<T extends string> = Exclude<T, ''>;

function getEnv(name: string, fallback?: string): string | undefined {
  const v = process.env[name];
  return v !== undefined && v !== '' ? v : fallback;
}

function requireEnv(name: string): NonEmpty<string> {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v as NonEmpty<string>;
}

function safe(val: unknown): string {
  if (!val) return '';
  const s = String(val);
  return s.length > 4 ? `${s.slice(0, 2)}***${s.slice(-2)}` : '***';
}

async function main() {
  const baseUrl = getEnv('LBIN_BASE_URL', 'https://b2b.fbl.is/lib2b.dll?processXML')!;
  const timeoutMs = Number(getEnv('LBIN_TIMEOUT_MS', '30000')) || 30000;

  // Optional mTLS
  const certPath = getEnv('LBIN_CERT_PATH');
  const keyPath = getEnv('LBIN_KEY_PATH');
  const keyPass = getEnv('LBIN_KEY_PASSPHRASE');

  const httpsAgent = (certPath && keyPath)
    ? new https.Agent({
        cert: fs.readFileSync(certPath),
        key: fs.readFileSync(keyPath),
        passphrase: keyPass,
        honorCipherOrder: true,
        minVersion: 'TLSv1.2',
      })
    : undefined;

  const useXmlFile = getEnv('LBIN_XML_FILE');
  let xmlBody: string;

  if (useXmlFile) {
    const abs = path.resolve(useXmlFile);
    xmlBody = fs.readFileSync(abs, 'utf8');
    console.error(`[INFO] Using XML from file: ${abs}`);
  } else {
    // Fallback: construct a best-effort login request.
    // NOTE: Element names may differ — this is primarily for connectivity testing.
    const companyId = requireEnv('LBIN_COMPANY_ID');
    const username = requireEnv('LBIN_USERNAME');
    const password = requireEnv('LBIN_PASSWORD');

    xmlBody = `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<LI_Innskra xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">\n` +
      `  <CompanyId>${companyId}</CompanyId>\n` +
      `  <Username>${username}</Username>\n` +
      `  <Password>${password}</Password>\n` +
      `</LI_Innskra>`;
    console.error('[INFO] Using generated login XML (may produce validation error if element names differ).');
  }

  console.error('[CONFIG]', JSON.stringify({
    baseUrl,
    timeoutMs,
    hasMtls: Boolean(httpsAgent),
    certPath: certPath ? path.resolve(certPath) : undefined,
    keyPath: keyPath ? path.resolve(keyPath) : undefined,
    xmlBytes: Buffer.byteLength(xmlBody, 'utf8'),
  }, null, 2));

  const client = axios.create({
    baseURL: baseUrl,
    timeout: timeoutMs,
    headers: { 'Content-Type': 'application/xml' },
    httpsAgent,
    // Avoid throwing on non-2xx so we can log body
    validateStatus: () => true,
  });

  const start = Date.now();
  try {
    const resp = await client.post('', xmlBody);
    const dur = Date.now() - start;
    const body = typeof resp.data === 'string' ? resp.data : JSON.stringify(resp.data);
    const preview = body.length > 2000 ? body.slice(0, 2000) + '\n...[truncated]...' : body;
    console.log(JSON.stringify({
      ok: resp.status >= 200 && resp.status < 300,
      status: resp.status,
      duration_ms: dur,
      headers: resp.headers,
      body_preview: preview,
    }, null, 2));
  } catch (err: any) {
    const dur = Date.now() - start;
    console.error(JSON.stringify({
      ok: false,
      duration_ms: dur,
      error: err?.message || 'Request failed',
      code: err?.code,
      response_status: err?.response?.status,
      response_headers: err?.response?.headers,
      response_body_preview: err?.response?.data ? String(err.response.data).slice(0, 2000) : undefined,
    }, null, 2));
    process.exit(2);
  }
}

main().catch((e) => {
  console.error('[FATAL]', e);
  process.exit(1);
});

