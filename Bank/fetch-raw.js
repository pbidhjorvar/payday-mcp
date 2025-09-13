#!/usr/bin/env node
import 'dotenv/config';
import axios from 'axios';
import https from 'https';
import fs from 'fs';
import path from 'path';

function getEnv(name, fallback) { const v = process.env[name]; return v !== undefined && v !== '' ? v : fallback; }
function requireEnv(name) { const v = process.env[name]; if (!v) throw new Error(`Missing required env: ${name}`); return v; }

function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }
function fmtDate(d) { return d.toISOString().slice(0,10); }
function monthKey(d) { const s = d.toISOString().slice(0,7); return s; }
function addMonths(date, n) { const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)); d.setUTCMonth(d.getUTCMonth()+n); return d; }
function parseParts(number) { const m = String(number).match(/(\d{4})\D*(\d{2})\D*(\d{6})/); if (!m) return null; return { utibu: m[1], hb: m[2], nr: m[3] }; }

async function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }

async function login(client, username, password, companyId) {
  const sidTag = companyId ? `\n  <sid>${companyId}</sid>` : '';
  const xml = `<?xml version="1.0" encoding="ISO-8859-1"?>\n` +
    `<LI_Innskra version="1.1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">\n` +
    `  <notandanafn>${username}</notandanafn>\n` +
    `  <lykilord>${password}</lykilord>${sidTag}\n` +
    `</LI_Innskra>`;
  const resp = await client.post('', xml);
  const body = String(resp.data || '');
  if (resp.status !== 200 || body.includes('<LI_Villa')) {
    const em = body.match(/<villubod>([\s\S]*?)<\/villubod>/i);
    throw new Error((em && em[1]) || `Login failed (HTTP ${resp.status})`);
  }
  const m = body.match(/<seta>([\s\S]*?)<\/seta>/i);
  const seta = m && m[1] ? m[1].trim() : undefined;
  if (!seta) throw new Error('No session token (seta)');
  const cookieHeader = resp.headers && (resp.headers['set-cookie'] || resp.headers['Set-Cookie']);
  if (cookieHeader) {
    const cookie = Array.isArray(cookieHeader) ? cookieHeader.map(c => c.split(';')[0]).join('; ') : String(cookieHeader).split(';')[0];
    client.defaults.headers.Cookie = cookie;
  }
  return seta; // keep braces
}

async function fetchAccountChunk(client, seta, parts, from, to) {
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
  return { status: resp.status, body: String(resp.data || '') };
}

async function fetchCardChunk(client, seta, cardId, from, to) {
  const xml = `<?xml version="1.0" encoding="ISO-8859-1"?>\n` +
    `<LI_Get_Creditcard_Transactions version="1.2" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">\n` +
    `  <session_id>${seta}</session_id>\n` +
    `  <card_id>${cardId}</card_id>\n` +
    `  <time_period><start_day>${from}</start_day><end_day>${to}</end_day></time_period>\n` +
    `</LI_Get_Creditcard_Transactions>`;
  const resp = await client.post('', xml);
  return { status: resp.status, body: String(resp.data || '') };
}

async function listCards(client, seta) {
  const xml = `<?xml version="1.0" encoding="ISO-8859-1"?>\n<LI_Get_CreditcardList version="1.2" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><session_id>${seta}</session_id></LI_Get_CreditcardList>`;
  const resp = await client.post('', xml);
  const body = String(resp.data || '');
  if (resp.status !== 200 || body.includes('<LI_Villa')) return [];
  const cards = [];
  const items = body.split(/<card[>\s]/i).slice(1).map(b => '<card ' + b);
  for (const block of items) {
    const endIdx = block.indexOf('</card>');
    const chunk = endIdx >= 0 ? block.slice(0, endIdx + 7) : block;
    const id = (chunk.match(/<card_id>([\s\S]*?)<\/card_id>/i) || [])[1];
    const masked = (chunk.match(/<masked_cardnumber>([\s\S]*?)<\/masked_cardnumber>/i) || [])[1];
    if (id) cards.push({ card_id: id.trim(), masked: masked && masked.trim() });
  }
  return cards;
}

async function logout(client, seta) {
  try {
    const xml = `<?xml version=\"1.0\" encoding=\"ISO-8859-1\"?>\n<LI_Utskra version=\"1.1\" xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\"><seta>${seta}</seta></LI_Utskra>`;
    await client.post('', xml);
  } catch {}
}

async function main() {
  const startDate = getEnv('LBIN_FETCH_FROM', '2022-01-01');
  const endDate = fmtDate(new Date());
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

  const rawRoot = path.join(process.cwd(), 'Bank', 'RawData');
  ensureDir(rawRoot);

  // Fetch bank accounts from Bank/accounts.json
  const accountsPath = path.join(process.cwd(), 'Bank', 'accounts.json');
  const accounts = JSON.parse(fs.readFileSync(accountsPath, 'utf8'));
  for (const acc of accounts) {
    const parts = parseParts(acc.number);
    if (!parts) continue;
    const accDir = path.join(rawRoot, 'accounts', `${parts.utibu}-${parts.hb}-${parts.nr}`);
    ensureDir(accDir);
    let cur = new Date(startDate + 'T00:00:00Z');
    const end = new Date(endDate + 'T00:00:00Z');
    while (cur <= end) {
      const from = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth(), 1));
      const toDate = addMonths(from, 1); toDate.setUTCDate(0); // last day of month
      const chunkFrom = fmtDate(from);
      const chunkTo = fmtDate(toDate <= end ? toDate : end);
      const { status, body } = await fetchAccountChunk(client, seta, parts, chunkFrom, chunkTo);
      const file = path.join(accDir, `${chunkFrom.slice(0,7)}.xml`);
      fs.writeFileSync(file, body, 'utf8');
      await sleep(200);
      cur = addMonths(from, 1);
    }
  }

  // Fetch credit cards list then transactions
  const cards = await listCards(client, seta);
  for (const card of cards) {
    const cardDir = path.join(rawRoot, 'cards', String(card.card_id));
    ensureDir(cardDir);
    let cur = new Date(startDate + 'T00:00:00Z');
    const end = new Date(endDate + 'T00:00:00Z');
    while (cur <= end) {
      const from = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth(), 1));
      const toDate = addMonths(from, 1); toDate.setUTCDate(0);
      const chunkFrom = fmtDate(from);
      const chunkTo = fmtDate(toDate <= end ? toDate : end);
      const { status, body } = await fetchCardChunk(client, seta, card.card_id, chunkFrom, chunkTo);
      const file = path.join(cardDir, `${chunkFrom.slice(0,7)}.xml`);
      fs.writeFileSync(file, body, 'utf8');
      await sleep(200);
      cur = addMonths(from, 1);
    }
  }

  await logout(client, seta);
  console.log(JSON.stringify({ ok: true, message: 'Raw fetch completed', from: startDate, to: endDate, accounts: accounts.length, cards: cards.length }, null, 2));
}

main().catch(e => { console.error('[FATAL]', e); process.exit(1); });

