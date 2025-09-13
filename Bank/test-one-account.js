#!/usr/bin/env node
import 'dotenv/config';
import axios from 'axios';
import https from 'https';
import fs from 'fs';

function getEnv(name, fallback) { const v = process.env[name]; return v !== undefined && v !== '' ? v : fallback; }
function requireEnv(name) { const v = process.env[name]; if (!v) throw new Error(`Missing required env: ${name}`); return v; }

function parseParts(number) {
  const m = String(number).match(/(\d{4})\D*(\d{2})\D*(\d{6})/);
  if (!m) return null;
  return { utibu: m[1], hb: m[2], nr: m[3] };
}

async function login(client, username, password, companyId) {
  const sidTag = companyId ? `\n  <sid>${companyId}</sid>` : '';
  const xml = `<?xml version="1.0" encoding="ISO-8859-1"?>\n` +
    `<LI_Innskra version="1.1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">\n` +
    `  <notandanafn>${username}</notandanafn>\n` +
    `  <lykilord>${password}</lykilord>${sidTag}\n` +
    `</LI_Innskra>`;
  const resp = await client.post('', xml);
  const body = String(resp.data);
  if (resp.status !== 200 || body.includes('<LI_Villa')) {
    const em = body.match(/<villubod>([\s\S]*?)<\/villubod>/i);
    throw new Error((em && em[1]) || `Login failed (HTTP ${resp.status})`);
  }
  const sm = body.match(/<seta>([\s\S]*?)<\/seta>/i);
  const seta = sm && sm[1] ? sm[1].trim() : undefined;
  if (!seta) throw new Error('No session token (seta) in response');
  const cookieHeader = resp.headers && (resp.headers['set-cookie'] || resp.headers['Set-Cookie']);
  if (cookieHeader) {
    const cookie = Array.isArray(cookieHeader) ? cookieHeader.map(c => c.split(';')[0]).join('; ') : String(cookieHeader).split(';')[0];
    client.defaults.headers.Cookie = cookie;
  }
  return seta; // keep braces
}

async function accountExists(client, seta, parts, kennitala) {
  const kt = kennitala ? String(kennitala).replace(/[^0-9]/g, '') : '';
  const ktTag = kt ? `\n  <kennitala>${kt}</kennitala>` : '';
  const xml = `<?xml version="1.0" encoding="ISO-8859-1"?>\n` +
    `<LI_Fyrirspurn_er_reikningur_til version="1.1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">\n` +
    `  <seta>${seta}</seta>${ktTag}\n` +
    `  <reikningur>\n` +
    `    <utibu>${parts.utibu}</utibu>\n` +
    `    <hb>${parts.hb}</hb>\n` +
    `    <reikningsnr>${parts.nr}</reikningsnr>\n` +
    `  </reikningur>\n` +
    `</LI_Fyrirspurn_er_reikningur_til>`;
  const resp = await client.post('', xml);
  const body = String(resp.data);
  if (body.includes('<LI_Villa')) {
    const em = body.match(/<villubod>([\s\S]*?)<\/villubod>/i);
    return { ok: false, error: (em && em[1]) || 'Error' };
  }
  return { ok: true };
}

async function getAccountMeta(client, seta, parts) {
  const today = new Date();
  const to = today.toISOString().slice(0, 10);
  const fromD = new Date(today.getTime() - 24 * 3600 * 1000);
  const from = fromD.toISOString().slice(0, 10);
  const xml = `<?xml version="1.0" encoding="ISO-8859-1"?>\n` +
    `<LI_Fyrirspurn_reikningsyfirlit version="1.1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">\n` +
    `  <seta>${seta}</seta>\n` +
    `  <reikningur>\n` +
    `    <utibu>${parts.utibu}</utibu>\n` +
    `    <hb>${parts.hb}</hb>\n` +
    `    <reikningsnr>${parts.nr}</reikningsnr>\n` +
    `  </reikningur>\n` +
    `  <dags_fra>${from}</dags_fra>\n` +
    `  <dags_til>${to}</dags_til>\n` +
    `</LI_Fyrirspurn_reikningsyfirlit>`;
  const resp = await client.post('', xml);
  const body = String(resp.data);
  if (body.includes('<LI_Villa')) {
    const em = body.match(/<villubod>([\s\S]*?)<\/villubod>/i);
    return { ok: false, error: (em && em[1]) || 'Error' };
  }
  const cm = body.match(/<mynt>([\s\S]*?)<\/mynt>/i);
  const smeta = body.match(/<astand_reiknings>([\s\S]*?)<\/astand_reiknings>/i);
  return { ok: true, currency: cm && cm[1] ? cm[1].trim() : undefined, status: smeta && smeta[1] ? smeta[1].trim() : undefined };
}

async function main() {
  const accountArg = process.argv[2] || getEnv('LBIN_TEST_ACCOUNT');
  if (!accountArg) { console.error('Usage: node Bank/test-one-account.js <accountNumber 4-2-6>'); process.exit(2); }
  const parts = parseParts(accountArg);
  if (!parts) { console.error('Invalid account format. Expected 4-2-6 digits.'); process.exit(2); }

  const baseUrl = getEnv('LBIN_BASE_URL', 'https://b2b.fbl.is/process.ashx');
  const timeoutMs = Number(getEnv('LBIN_TIMEOUT_MS', '30000')) || 30000;
  const certPath = getEnv('LBIN_CERT_PATH');
  const keyPath = getEnv('LBIN_KEY_PATH');
  const keyPass = getEnv('LBIN_KEY_PASSPHRASE');
  const httpsAgent = (certPath && keyPath) ? new https.Agent({ cert: fs.readFileSync(certPath), key: fs.readFileSync(keyPath), passphrase: keyPass, minVersion: 'TLSv1.2' }) : undefined;
  const client = axios.create({ baseURL: baseUrl, timeout: timeoutMs, headers: { 'Content-Type': 'text/xml; charset=ISO-8859-1', 'User-Agent': 'Payday-MCP LBI B2B/1.0' }, httpsAgent, validateStatus: () => true });

  const username = requireEnv('LBIN_USERNAME');
  const password = requireEnv('LBIN_PASSWORD');
  const kennitala = getEnv('LBIN_COMPANY_ID');
  const seta = await login(client, username, password, kennitala);

  const exists = await accountExists(client, seta, parts, kennitala);
  if (!exists.ok) {
    console.log(JSON.stringify({ ok: false, account: accountArg, error: exists.error }, null, 2));
    return;
  }
  const meta = await getAccountMeta(client, seta, parts);
  console.log(JSON.stringify({ ok: meta.ok, account: accountArg, currency: meta.currency, status: meta.status, note: meta.error }, null, 2));
  // Attempt logout to avoid tarpitting
  try {
    const logoutXml = `<?xml version="1.0" encoding="ISO-8859-1"?>\n<LI_Utskra version="1.1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><seta>${seta}</seta></LI_Utskra>`;
    await client.post('', logoutXml);
  } catch {}
}

main().catch(e => { console.error('[FATAL]', e); process.exit(1); });
