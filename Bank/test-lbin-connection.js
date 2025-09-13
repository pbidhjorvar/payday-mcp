#!/usr/bin/env node
import 'dotenv/config';
import axios from 'axios';
import fs from 'fs';
import https from 'https';
import path from 'path';

function getEnv(name, fallback) {
  const v = process.env[name];
  return v !== undefined && v !== '' ? v : fallback;
}

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
}

async function main() {
  const baseUrl = getEnv('LBIN_BASE_URL', 'https://b2b.fbl.is/process.ashx');
  const timeoutMs = Number(getEnv('LBIN_TIMEOUT_MS', '30000')) || 30000;

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
  let xmlBody;

  if (useXmlFile) {
    const abs = path.resolve(useXmlFile);
    xmlBody = fs.readFileSync(abs, 'utf8');
    console.error(`[INFO] Using XML from file: ${abs}`);
  } else {
    // Build LI_Innskra per LI_Innskra.xsd (v1.1):
    // <LI_Innskra version="1.1"><notandanafn>...</notandanafn><lykilord>...</lykilord></LI_Innskra>
    const username = requireEnv('LBIN_USERNAME');
    const password = requireEnv('LBIN_PASSWORD');
    const sid = getEnv('LBIN_COMPANY_ID'); // optional; kept for convenience if bank ties user to company
    const sidTag = sid ? `\n  <sid>${sid}</sid>` : '';
    xmlBody = `<?xml version="1.0" encoding="ISO-8859-1"?>\n` +
      `<LI_Innskra version="1.1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">\n` +
      `  <notandanafn>${username}</notandanafn>\n` +
      `  <lykilord>${password}</lykilord>${sidTag}\n` +
      `</LI_Innskra>`;
    console.error('[INFO] Using generated LI_Innskra v1.1 XML (notandanafn/lykilord).');
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
    headers: { 'Content-Type': 'text/xml; charset=ISO-8859-1', 'User-Agent': 'Payday-MCP LBI B2B Test/1.0' },
    httpsAgent,
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
  } catch (err) {
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
