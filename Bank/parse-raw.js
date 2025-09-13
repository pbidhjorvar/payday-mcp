#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import Database from 'better-sqlite3';

function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }
function listDirs(p) { return fs.existsSync(p) ? fs.readdirSync(p, { withFileTypes: true }).filter(d=>d.isDirectory()).map(d=>path.join(p, d.name)) : []; }
function listFiles(p, ext='.xml') { return fs.existsSync(p) ? fs.readdirSync(p).filter(f=>f.toLowerCase().endsWith(ext)).map(f=>path.join(p, f)) : []; }
function yyyymm(filePath) { const b = path.basename(filePath).replace(/\.xml$/i,''); return b; }
function sha1(x) { return crypto.createHash('sha1').update(x).digest('hex'); }

function textBetween(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}>([\s\S]*?)<\/${tag}>`, 'i'));
  return m ? m[1].trim() : undefined;
}

function* iterBlocks(xml, tag) {
  const reOpen = new RegExp(`<${tag}(?:[ >][\s\S]*?)?>`, 'ig');
  let m;
  while ((m = reOpen.exec(xml))) {
    const start = m.index;
    const rest = xml.slice(start);
    const closeIdx = rest.search(new RegExp(`</${tag}>`, 'i'));
    if (closeIdx === -1) break;
    const block = rest.slice(0, closeIdx + tag.length + 3);
    yield block;
    reOpen.lastIndex = start + closeIdx + tag.length + 3;
  }
}

function initDb(dbPath) {
  ensureDir(path.dirname(dbPath));
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS silver_bank_accounts (
      branch TEXT NOT NULL,
      ledger TEXT NOT NULL,
      account_no TEXT NOT NULL,
      display_number TEXT,
      currency TEXT,
      status TEXT,
      first_seen_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (branch, ledger, account_no)
    );
    CREATE TABLE IF NOT EXISTS silver_bank_transactions (
      id TEXT PRIMARY KEY,
      branch TEXT NOT NULL,
      ledger TEXT NOT NULL,
      account_no TEXT NOT NULL,
      booking_date TEXT,
      value_date TEXT,
      amount REAL,
      currency TEXT,
      balance REAL,
      reference TEXT,
      text_key TEXT,
      payer_ssn TEXT,
      rb_batchno TEXT,
      type_code TEXT,
      description TEXT,
      raw_hash TEXT,
      source_period TEXT,
      ingested_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_silver_bank_tx_acct_date ON silver_bank_transactions(branch, ledger, account_no, booking_date);

    CREATE TABLE IF NOT EXISTS silver_credit_cards (
      card_id TEXT PRIMARY KEY,
      masked TEXT,
      status TEXT,
      credit_limit REAL,
      owner_ssn TEXT,
      holder_ssn TEXT,
      expires TEXT,
      first_seen_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS silver_creditcard_transactions (
      card_id TEXT NOT NULL,
      entry_id TEXT NOT NULL,
      clearance_id TEXT,
      date TEXT,
      amount REAL,
      foreign_amount REAL,
      currency TEXT,
      foreign_currency TEXT,
      merchant_id TEXT,
      merchant_name TEXT,
      trans_key TEXT,
      trans_descriptor TEXT,
      due_date TEXT,
      mcc TEXT,
      description TEXT,
      raw_hash TEXT,
      source_period TEXT,
      ingested_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (card_id, entry_id)
    );
    -- Gold views
    CREATE VIEW IF NOT EXISTS gold_bank_monthly AS
      SELECT branch, ledger, account_no,
             substr(booking_date,1,7) AS month,
             SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END) AS inflow,
             SUM(CASE WHEN amount < 0 THEN -amount ELSE 0 END) AS outflow,
             SUM(amount) AS net,
             COUNT(*) AS tx_count
      FROM silver_bank_transactions
      GROUP BY branch, ledger, account_no, month;
    CREATE VIEW IF NOT EXISTS gold_card_monthly AS
      SELECT card_id,
             substr(date,1,7) AS month,
             SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END) AS deposits,
             SUM(CASE WHEN amount < 0 THEN -amount ELSE 0 END) AS withdrawals,
             SUM(amount) AS net,
             COUNT(*) AS tx_count
      FROM silver_creditcard_transactions
      GROUP BY card_id, month;
  `);
  return db;
}

function parseAccountXml(xml, acct) {
  const currency = textBetween(xml, 'mynt');
  const status = textBetween(xml, 'astand_reiknings');
  const rows = [];
  for (const b of iterBlocks(xml, 'faersla')) {
    const booking_date = textBetween(b, 'bokunardags');
    const value_date = textBetween(b, 'vaxtadags');
    const rb_batchno = textBetween(b, 'rb_bunkanr');
    const type_code = textBetween(b, 'faerslulykill');
    const reference = textBetween(b, 'tilvisun');
    const text_key = textBetween(b, 'textalykill');
    const payer_ssn = textBetween(b, 'kt_greidanda');
    const amountStr = textBetween(b, 'upphaed');
    const balanceStr = textBetween(b, 'stada_reiknings');
    const description = textBetween(b, 'skyring_textalykils') || textBetween(b, 'skyring_tilvisunar');
    const amount = amountStr ? Number(String(amountStr).replace(',', '.')) : undefined;
    const balance = balanceStr ? Number(String(balanceStr).replace(',', '.')) : undefined;
    const raw_hash = sha1(b);
    const id = sha1(`${acct.branch}|${acct.ledger}|${acct.account_no}|${booking_date}|${amount}|${rb_batchno||''}|${reference||''}|${text_key||''}`);
    rows.push({ id, booking_date, value_date, amount, currency, balance, reference, text_key, payer_ssn, rb_batchno, type_code, description, raw_hash });
  }
  return { currency, status, rows };
}

function parseCardXml(xml) {
  const rows = [];
  // Withdrawals
  for (const b of iterBlocks(xml, 'withdrawal')) {
    const entry_id = textBetween(b, 'entry_id');
    const clearance_id = textBetween(b, 'clearance_id');
    const date = textBetween(b, 'date');
    const amount = textBetween(b, 'amount');
    const foreign_amount = textBetween(b, 'foreign_amount');
    const currency = textBetween(b, 'currency');
    const trans_key = textBetween(b, 'trans_key');
    const trans_descriptor = textBetween(b, 'trans_descriptor');
    const merchant_id = textBetween(b, 'merchent_id') || textBetween(b, 'merchant_id');
    const merchant_name = textBetween(b, 'merchant_name');
    const due_date = textBetween(b, 'due_date');
    const mcc = textBetween(b, 'mcc');
    const raw_hash = sha1(b);
    rows.push({ kind: 'withdrawal', entry_id, clearance_id, date, amount: amount && Number(amount), foreign_amount: foreign_amount && Number(foreign_amount), currency, foreign_currency: undefined, merchant_id, merchant_name, trans_key, trans_descriptor, due_date, mcc, description: undefined, raw_hash });
  }
  // Deposits
  for (const b of iterBlocks(xml, 'deposit')) {
    const entry_id = textBetween(b, 'entry_id');
    const date = textBetween(b, 'date');
    const amount = textBetween(b, 'amount');
    const foreign_amount = textBetween(b, 'foreign_amount');
    const currency = textBetween(b, 'currency');
    const description = textBetween(b, 'description');
    const raw_hash = sha1(b);
    rows.push({ kind: 'deposit', entry_id, clearance_id: undefined, date, amount: amount && Number(amount), foreign_amount: foreign_amount && Number(foreign_amount), currency, foreign_currency: undefined, merchant_id: undefined, merchant_name: undefined, trans_key: undefined, trans_descriptor: undefined, due_date: undefined, mcc: undefined, description, raw_hash });
  }
  return rows;
}

async function main() {
  const db = initDb(path.join(process.cwd(), 'sqlite', 'finance.db'));
  const insertAcct = db.prepare(`INSERT OR IGNORE INTO silver_bank_accounts(branch, ledger, account_no, display_number, currency, status) VALUES(?,?,?,?,?,?)`);
  const upAcctMeta = db.prepare(`UPDATE silver_bank_accounts SET currency = COALESCE(?, currency), status = COALESCE(?, status) WHERE branch=? AND ledger=? AND account_no=?`);
  const insertBankTx = db.prepare(`INSERT OR IGNORE INTO silver_bank_transactions(id, branch, ledger, account_no, booking_date, value_date, amount, currency, balance, reference, text_key, payer_ssn, rb_batchno, type_code, description, raw_hash, source_period) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const insertCardTx = db.prepare(`INSERT OR IGNORE INTO silver_creditcard_transactions(card_id, entry_id, clearance_id, date, amount, foreign_amount, currency, foreign_currency, merchant_id, merchant_name, trans_key, trans_descriptor, due_date, mcc, description, raw_hash, source_period) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);

  const rawRoot = path.join(process.cwd(), 'Bank', 'RawData');

  // Accounts
  const acctRoot = path.join(rawRoot, 'accounts');
  for (const acctDir of listDirs(acctRoot)) {
    const disp = path.basename(acctDir); // e.g., 0133-26-007035 or similar composition
    const parts = disp.match(/(\d{4})[-_](\d{2})[-_](\d{6})/);
    if (!parts) continue;
    const acct = { branch: parts[1], ledger: parts[2], account_no: parts[3] };
    insertAcct.run(acct.branch, acct.ledger, acct.account_no, disp, null, null);
    for (const file of listFiles(acctDir, '.xml')) {
      const xml = fs.readFileSync(file, 'utf8');
      if (/\bLI_Villa\b/.test(xml)) continue;
      const { currency, status, rows } = parseAccountXml(xml, acct);
      if (currency || status) upAcctMeta.run(currency || null, status || null, acct.branch, acct.ledger, acct.account_no);
      const period = yyyymm(file);
      const tx = db.transaction((rows, period) => {
        for (const r of rows) {
          insertBankTx.run(r.id, acct.branch, acct.ledger, acct.account_no, r.booking_date, r.value_date, r.amount, r.currency, r.balance, r.reference, r.text_key, r.payer_ssn, r.rb_batchno, r.type_code, r.description, r.raw_hash, period);
        }
      });
      tx(rows, period);
    }
  }

  // Cards
  const cardRoot = path.join(rawRoot, 'cards');
  for (const cardDir of listDirs(cardRoot)) {
    const cardId = path.basename(cardDir);
    for (const file of listFiles(cardDir, '.xml')) {
      const xml = fs.readFileSync(file, 'utf8');
      if (/\bLI_Villa\b/.test(xml)) continue;
      const rows = parseCardXml(xml);
      const period = yyyymm(file);
      const tx = db.transaction((rows, period) => {
        for (const r of rows) {
          insertCardTx.run(cardId, r.entry_id, r.clearance_id || null, r.date || null, r.amount || null, r.foreign_amount || null, r.currency || null, r.foreign_currency || null, r.merchant_id || null, r.merchant_name || null, r.trans_key || null, r.trans_descriptor || null, r.due_date || null, r.mcc || null, r.description || null, r.raw_hash, period);
        }
      });
      tx(rows, period);
    }
  }

  console.log(JSON.stringify({ ok: true, message: 'Parsed raw XML into SQLite (silver + gold views ready).' }, null, 2));
}

main().catch(e => { console.error('[FATAL]', e); process.exit(1); });

