#!/usr/bin/env node
import 'dotenv/config';
import axios from 'axios';
import https from 'https';
import fs from 'fs';
import path from 'path';
import XLSX from 'xlsx';

function getEnv(name, fallback) {
  const v = process.env[name];
  return v !== undefined && v !== '' ? v : fallback;
}

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
}

function uniq(arr) {
  return Array.from(new Set(arr.filter(Boolean)));
}

function findAccountsFromXlsx(dataDir) {
  const accounts = new Set();
  if (!fs.existsSync(dataDir)) return [];
  const files = fs.readdirSync(dataDir).filter(f => f.toLowerCase().endsWith('.xlsx'));
  for (const file of files) {
    try {
      const wb = XLSX.readFile(path.join(dataDir, file));
      const sheetName = wb.SheetNames[0];
      const sheet = wb.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json(sheet);
      if (!rows || rows.length === 0) continue;
      const keys = Object.keys(rows[0]).map(k => String(k));
      const candidateCols = keys.filter(k => /reikn|account/i.test(k));
      for (const row of rows) {
        for (const col of candidateCols) {
          const v = row[col];
          if (!v) continue;
          const s = String(v).replace(/[^0-9-]/g, '').trim();
          if (s && s.length >= 8) accounts.add(s);
        }
      }
    } catch {}
  }
  return Array.from(accounts);
}

function extractTag(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}>([\s\S]*?)</>`, 'i'));
  return m ? m[1].trim() : undefined;
}

async function login(client, username, password, companyId) {
  const sidTag = companyId ? `\n  <sid>${companyId}</sid>` : '';
  const xml = `<?xml version="1.0" encoding="ISO-8859-1"?>\n` +
    `<LI_Innskra version="1.1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">\n` +
    `  <notandanafn>${username}</notandanafn>\n` +
    `  <lykilord>${password}</lykilord>${sidTag}\n` +
    `</LI_Innskra>`;
  const resp = await client.post('', xml);
  if (resp.status !== 200) throw new Error(`Login HTTP ${resp.status}`);
  const body = String(resp.data);
  const err = body.includes('<LI_Villa');
  if (err) {
    const em = body.match(/<villubod>([\s\S]*?)<\/villubod>/i);
    throw new Error((em && em[1]) || 'Login failed');
  }
  const sm = body.match(/<seta>([\s\S]*?)<\/seta>/i);
  const seta = sm && sm[1] ? sm[1].trim() : undefined;
  if (!seta) {
    console.error('[LOGIN_BODY_PREVIEW]', body.slice(0, 500));
    const m = body.match(/<seta>([\s\S]*?)<\/seta>/i);
    console.error('[REGEX_TEST]', Boolean(m), m && m[1]);
    throw new Error('No session token (seta) in response');
  }
  const cookieHeader = resp.headers && (resp.headers['set-cookie'] || resp.headers['Set-Cookie']);
  let cookie = undefined;
  if (cookieHeader) {
    cookie = Array.isArray(cookieHeader) ? cookieHeader.map(c => c.split(';')[0]).join('; ') : String(cookieHeader).split(';')[0];
    // Install cookie for subsequent calls
    client.defaults.headers.Cookie = cookie;
  }
  return seta;
}

async function accountExists(client, seta, account, kennitala) {
  const acct = String(account).replace(/[^0-9]/g, '');
  const kt = kennitala ? String(kennitala).replace(/[^0-9]/g, '') : '';
  const ktTag = kt ? `\n  <kennitala>${kt}</kennitala>` : '';
  const xml = `<?xml version="1.0" encoding="ISO-8859-1"?>\n` +
    `<LI_Fyrirspurn_er_reikningur_til version="1.1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">\n` +
    `  <seta>${seta}</seta>${ktTag}\n` +
    `  <reikningur>${acct}</reikningur>\n` +
    `</LI_Fyrirspurn_er_reikningur_til>`;
  const resp = await client.post('', xml);
  const body = String(resp.data);
  if (body.includes('<LI_Villa')) {
    const em = body.match(/<villubod>([\s\S]*?)<\/villubod>/i);
    return { ok: false, error: (em && em[1]) || 'Error' };
  }
  // Existence likely implicit by non-error response
  return { ok: true };
}

async function getAccountMeta(client, seta, account) {
  const today = new Date();
  const to = today.toISOString().slice(0, 10);
  const fromD = new Date(today.getTime() - 24 * 3600 * 1000);
  const from = fromD.toISOString().slice(0, 10);
  const acct = String(account).replace(/[^0-9]/g, '');
  const xml = `<?xml version="1.0" encoding="ISO-8859-1"?>\n` +
    `<LI_Fyrirspurn_reikningsyfirlit version="1.1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">\n` +
    `  <seta>${seta}</seta>\n` +
    `  <reikningur>${acct}</reikningur>\n` +
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
  const currency = cm && cm[1] ? cm[1].trim() : undefined;
  const status = smeta && smeta[1] ? smeta[1].trim() : undefined;
  return { ok: true, currency, status };
}

async function main() {
  const baseUrl = getEnv('LBIN_BASE_URL', 'https://b2b.fbl.is/lib2b.dll?processXML');
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

  const client = axios.create({
    baseURL: baseUrl,
    timeout: timeoutMs,
    headers: { 'Content-Type': 'application/xml' },
    httpsAgent,
    validateStatus: () => true,
  });

  const username = requireEnv('LBIN_USERNAME');
  const password = requireEnv('LBIN_PASSWORD');
  const kennitala = getEnv('LBIN_COMPANY_ID');

  const start = Date.now();
  const seta = await login(client, username, password, kennitala);

  // Build candidate account list
  const fromEnv = (getEnv('LBIN_ACCOUNT_NUMBERS', '') || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  const fromData = findAccountsFromXlsx(path.join(process.cwd(), 'data'));
  const accounts = uniq([...fromEnv, ...fromData]);

  if (accounts.length === 0) {
    console.log(JSON.stringify({ ok: true, accounts: [], note: 'No candidate accounts found. Set LBIN_ACCOUNT_NUMBERS or place .xlsx bank exports under ./data' }, null, 2));
    return;
  }

  const out = [];
  for (const acct of accounts) {
    try {
      const exists = await accountExists(client, seta, acct, kennitala);
      if (!exists.ok) {
        out.push({ account: acct, ok: false, error: exists.error });
        continue;
      }
      const meta = await getAccountMeta(client, seta, acct);
      if (meta.ok) {
        out.push({ account: acct, ok: true, currency: meta.currency, status: meta.status });
      } else {
        out.push({ account: acct, ok: true, currency: null, status: null, note: 'No metadata available', warn: meta.error });
      }
    } catch (e) {
      out.push({ account: acct, ok: false, error: e?.message || String(e) });
    }
  }

  console.log(JSON.stringify({ ok: true, count: out.length, accounts: out, duration_ms: Date.now() - start }, null, 2));
}

main().catch(e => {
  console.error('[FATAL]', e);
  process.exit(1);
});
#!/usr/bin/env node
import 'dotenv/config';
import axios from 'axios';
import https from 'https';
import fs from 'fs';
import path from 'path';
import XLSX from 'xlsx';

function getEnv(name, fallback) {
  const v = process.env[name];
  return v !== undefined && v !== '' ? v : fallback;
}

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
}

function uniq(arr) {
  return Array.from(new Set(arr.filter(Boolean)));
}

function findAccountsFromXlsx(dataDir) {
  const accounts = new Set();
  if (!fs.existsSync(dataDir)) return [];
  const files = fs.readdirSync(dataDir).filter(f => f.toLowerCase().endsWith('.xlsx'));
  for (const file of files) {
    try {
      const wb = XLSX.readFile(path.join(dataDir, file));
      const sheetName = wb.SheetNames[0];
      const sheet = wb.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json(sheet);
      if (!rows || rows.length === 0) continue;
      const keys = Object.keys(rows[0]).map(k => String(k));
      const candidateCols = keys.filter(k => /reikn|account/i.test(k));
      for (const row of rows) {
        for (const col of candidateCols) {
          const v = row[col];
          if (!v) continue;
          const s = String(v).trim();
          if (/(\d{4})\D*(\d{2})\D*(\d{6})/.test(s)) accounts.add(s);
        }
      }
    } catch {}
  }
  return Array.from(accounts);
}

function parseParts(raw) {
  const s = String(raw);
  const m = s.match(/(\d{4})\D*(\d{2})\D*(\d{6})/);
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
  if (resp.status !== 200) throw new Error(`Login HTTP ${resp.status}`);
  const body = String(resp.data);
  if (body.includes('<LI_Villa')) {
    const em = body.match(/<villubod>([\s\S]*?)<\/villubod>/i);
    throw new Error((em && em[1]) || 'Login failed');
  }
  const sm = body.match(/<seta>([\s\S]*?)<\/seta>/i);
  const seta = sm && sm[1] ? sm[1].trim() : undefined;
  if (!seta) {
    console.error('[LOGIN_BODY_PREVIEW]', body.slice(0, 500));
    throw new Error('No session token (seta) in response');
  }
  const cookieHeader = resp.headers && (resp.headers['set-cookie'] || resp.headers['Set-Cookie']);
  if (cookieHeader) {
    const cookie = Array.isArray(cookieHeader) ? cookieHeader.map(c => c.split(';')[0]).join('; ') : String(cookieHeader).split(';')[0];
    client.defaults.headers.Cookie = cookie;
  }
  return seta; // keep braces
}

async function accountExists(client, seta, account, kennitala) {
  const parts = parseParts(account);
  if (!parts) return { ok: false, error: 'Invalid account format (expected 4-2-6 digits)' };
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

async function getAccountMeta(client, seta, account) {
  const parts = parseParts(account);
  if (!parts) return { ok: false, error: 'Invalid account format' };
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
  const currency = cm && cm[1] ? cm[1].trim() : undefined;
  const status = smeta && smeta[1] ? smeta[1].trim() : undefined;
  return { ok: true, currency, status };
}

async function main() {
  const baseUrl = getEnv('LBIN_BASE_URL', 'https://b2b.fbl.is/lib2b.dll?processXML');
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

  const client = axios.create({
    baseURL: baseUrl,
    timeout: timeoutMs,
    headers: { 'Content-Type': 'application/xml' },
    httpsAgent,
    validateStatus: () => true,
  });

  const username = requireEnv('LBIN_USERNAME');
  const password = requireEnv('LBIN_PASSWORD');
  const kennitala = getEnv('LBIN_COMPANY_ID');

  const start = Date.now();
  const seta = await login(client, username, password, kennitala);

  const fromEnv = (getEnv('LBIN_ACCOUNT_NUMBERS', '') || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  const fromData = findAccountsFromXlsx(path.join(process.cwd(), 'data'));
  const accounts = uniq([...fromEnv, ...fromData]);

  if (accounts.length === 0) {
    console.log(JSON.stringify({ ok: true, accounts: [], note: 'No candidate accounts found. Set LBIN_ACCOUNT_NUMBERS or place .xlsx bank exports under ./data' }, null, 2));
    return;
  }

  const out = [];
  for (const acct of accounts) {
    try {
      const exists = await accountExists(client, seta, acct, kennitala);
      if (!exists.ok) {
        out.push({ account: acct, ok: false, error: exists.error });
        continue;
      }
      const meta = await getAccountMeta(client, seta, acct);
      if (meta.ok) {
        out.push({ account: acct, ok: true, currency: meta.currency, status: meta.status });
      } else {
        out.push({ account: acct, ok: true, currency: null, status: null, note: 'No metadata available', warn: meta.error });
      }
    } catch (e) {
      out.push({ account: acct, ok: false, error: e?.message || String(e) });
    }
  }

  console.log(JSON.stringify({ ok: true, count: out.length, accounts: out, duration_ms: Date.now() - start }, null, 2));
}

main().catch(e => {
  console.error('[FATAL]', e);
  process.exit(1);
});
