#!/usr/bin/env node
import 'dotenv/config';
import axios from 'axios';
import https from 'https';
import fs from 'fs';

function getEnv(name, fallback) { const v = process.env[name]; return v !== undefined && v !== '' ? v : fallback; }
function requireEnv(name) { const v = process.env[name]; if (!v) throw new Error(`Missing required env: ${name}`); return v; }

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

function parseCards(xml) {
  const cards = [];
  const cardBlocks = xml.split(/<card[>\s]/i).slice(1).map(b => '<card ' + b);
  for (const block of cardBlocks) {
    const endIdx = block.indexOf('</card>');
    const chunk = endIdx >= 0 ? block.slice(0, endIdx + 7) : block;
    const id = (chunk.match(/<id>([\s\S]*?)<\/id>/i) || [])[1];
    const name = (chunk.match(/<name>([\s\S]*?)<\/name>/i) || [])[1];
    const masked = (chunk.match(/<masked\w*?>([\s\S]*?)<\//i) || [])[1];
    const pan = (chunk.match(/<card_number>([\s\S]*?)<\/card_number>/i) || [])[1];
    let last4 = (chunk.match(/(\d{4})\D*<\/card>/i) || [])[1];
    if (!last4 && masked) last4 = (masked.match(/(\d{4})\b/) || [])[1];
    if (!last4 && pan) last4 = (pan.match(/(\d{4})\b/) || [])[1];
    cards.push({ id: id && id.trim(), name: name && name.trim(), last4: last4 && last4.trim(), raw: chunk.slice(0, 400) });
  }
  return cards;
}

async function main() {
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

  const reqXml = `<?xml version="1.0" encoding="ISO-8859-1"?>\n<LI_Get_CreditcardList version="1.2" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><session_id>${seta}</session_id></LI_Get_CreditcardList>`;
  const resp = await client.post('', reqXml);
  const body = String(resp.data);
  if (resp.status !== 200 || body.includes('<LI_Villa')) {
    const em = body.match(/<villubod>([\s\S]*?)<\/villubod>/i);
    console.log(JSON.stringify({ ok: false, status: resp.status, error: (em && em[1]) || 'LIST_FAILED', body_preview: body.slice(0, 1200) }, null, 2));
  } else {
    const cards = parseCards(body);
    console.log(JSON.stringify({ ok: true, count: cards.length, cards }, null, 2));
  }
  // Logout
  try {
    const logoutXml = `<?xml version="1.0" encoding="ISO-8859-1"?>\n<LI_Utskra version="1.1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><seta>${seta}</seta></LI_Utskra>`;
    await client.post('', logoutXml);
  } catch {}
}

main().catch(e => { console.error('[FATAL]', e); process.exit(1); });

