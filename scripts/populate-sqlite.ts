#!/usr/bin/env node
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import Database from 'better-sqlite3';
import dotenv from 'dotenv';
import { AuthClient } from '../src/auth/authClient.js';
import { PaydayClient } from '../src/http/paydayClient.js';
import { loadEnv } from '../src/config/env.js';
import { loadProfiles, getProfile } from '../src/config/profiles.js';

// Get paths
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DB_PATH = join(__dirname, '..', 'sqlite', 'finance.db');

// Load config
dotenv.config();
const env = loadEnv();
const profiles = loadProfiles();
const currentProfileName = env.defaultProfile;
const currentProfile = getProfile(currentProfileName, profiles);

// Initialize Payday client
const authClient = new AuthClient(env);
const paydayClient = new PaydayClient(currentProfileName, currentProfile, authClient);

// Initialize SQLite
const db = new Database(DB_PATH);
db.pragma('foreign_keys = ON');

async function createSchemas() {
  console.log('SQLite: Using table prefixes instead of schemas...');
  // SQLite doesn't support schemas, so we'll use table name prefixes
  return Promise.resolve();
}

async function createTables() {
  console.log('Creating tables...');
  
  try {
    const tables = [
      // Dimension tables with dim_ prefix
      `CREATE TABLE IF NOT EXISTS dim_accounts (
        account_id TEXT PRIMARY KEY,
        account_number TEXT,
        account_name TEXT,
        account_type TEXT,
        parent_account_id TEXT,
        is_active INTEGER,
        created_at TEXT,
        updated_at TEXT
      )`,
      
      // Fact tables with silver_ prefix
      `CREATE TABLE IF NOT EXISTS silver_account_statements (
        id INTEGER PRIMARY KEY,
        account_code TEXT,
        account_name TEXT,
        transaction_date TEXT,
        description TEXT,
        reference TEXT,
        debit REAL,
        credit REAL,
        balance REAL,
        currency TEXT,
        voucher TEXT,
        entry_id TEXT,
        created_at TEXT
      )`,
      
      // Gold layer views will be created after data load
    ];
    
    tables.forEach((sql, index) => {
      db.exec(sql);
      console.log(`Created table ${index + 1}/${tables.length}`);
    });
    
    return Promise.resolve();
  } catch (error) {
    console.error('Error creating tables:', error);
    throw error;
  }
}

async function fetchAccounts() {
  console.log('Fetching accounts from Payday...');
  
  const result = await paydayClient.get('/accounting/accounts', { perpage: 1000 });
  
  if ('error' in result) {
    throw new Error(`Failed to fetch accounts: ${result.error.detail}`);
  }
  
  const data = Array.isArray(result) ? result : (result as any).data || result;
  console.log(`Fetched ${data.length} accounts`);
  return data;
}

async function fetchAllAccountStatements(startDate: string, endDate: string) {
  console.log(`Fetching all account statements from ${startDate} to ${endDate}...`);
  
  const allTransactions: any[] = [];
  let currentPage = 1;
  let totalPages = 1;
  
  do {
    console.log(`Fetching page ${currentPage}/${totalPages}...`);
    const result = await paydayClient.get('/accounting/accountStatement', {
      dateFrom: startDate,
      dateTo: endDate,
      perpage: 1000,
      page: currentPage
    });
    
    if ('error' in result) {
      console.error(`Failed to fetch statements page ${currentPage}:`, result.error.detail);
      break;
    }
    
    const response = result as any;
    const transactions = response.lines || [];
    allTransactions.push(...transactions);
    
    // Update total pages from response
    if (response.pages) {
      totalPages = response.pages;
    }
    
    console.log(`Page ${currentPage}: fetched ${transactions.length} transactions (total so far: ${allTransactions.length})`);
    currentPage++;
  } while (currentPage <= totalPages);
  
  console.log(`Total transactions fetched: ${allTransactions.length}`);
  return allTransactions;
}

async function loadAccounts(accounts: any[]) {
  console.log('Loading accounts into SQLite...');
  
  try {
    const stmt = db.prepare(`
      INSERT INTO dim_accounts (
        account_id, account_number, account_name, account_type,
        parent_account_id, is_active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    accounts.forEach(account => {
      stmt.run(
        String(account.id || account.accountNumber || ''),
        account.accountNumber || account.account_number || account.number || '',
        account.name || account.accountName || '',
        account.type || account.accountType || '',
        account.parentId || account.parent_id || null,
        account.active !== false ? 1 : 0,
        new Date().toISOString(),
        new Date().toISOString()
      );
    });
    
    console.log(`Loaded ${accounts.length} accounts`);
    return Promise.resolve();
  } catch (error) {
    console.error('Error loading accounts:', error);
    throw error;
  }
}

async function loadStatements(statements: any[]) {
  if (statements.length === 0) return;
  
  console.log(`Loading ${statements.length} statements into SQLite...`);
  
  try {
    const stmt = db.prepare(`
      INSERT OR IGNORE INTO silver_account_statements (
        id, account_code, account_name, transaction_date, description, reference,
        debit, credit, balance, currency, voucher, entry_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    let loaded = 0;
    statements.forEach((tx, index) => {
      try {
        // Use index as ID since transactions might not have unique IDs
        const txId = index + 1;
        const accountNumber = String(tx.accountNumber || tx.account_number || tx.account || '');
        
        // Handle amount field - negative amounts are debits, positive are credits
        const amount = parseFloat(tx.amount || 0);
        const debit = amount < 0 ? Math.abs(amount) : 0;
        const credit = amount > 0 ? amount : 0;
        
        stmt.run(
          txId,
          String(tx.accountCode || ''),
          String(tx.accountName || ''),
          String(tx.date || ''),
          String(tx.description || ''),
          String(tx.reference || ''),
          debit,
          credit,
          parseFloat(tx.balance || 0),
          String(tx.currency || 'ISK'),
          String(tx.voucher || ''),
          String(tx.entryId || ''),
          String(tx.created || new Date().toISOString())
        );
        loaded++;
      } catch (err) {
        console.error(`Error loading transaction ${index}:`, err.message);
        console.error('Transaction data:', tx);
      }
    });
    
    console.log(`Loaded ${statements.length} statements`);
    return Promise.resolve();
  } catch (error) {
    console.error('Error loading statements:', error);
    throw error;
  }
}

async function createIndexes() {
  console.log('Creating performance indexes...');
  
  try {
    const indexes = [
      // Critical indexes for query performance
      'CREATE INDEX IF NOT EXISTS idx_statements_account_code ON silver_account_statements(account_code)',
      'CREATE INDEX IF NOT EXISTS idx_statements_date ON silver_account_statements(transaction_date)',
      'CREATE INDEX IF NOT EXISTS idx_statements_entry_id ON silver_account_statements(entry_id)',
      'CREATE INDEX IF NOT EXISTS idx_statements_date_account ON silver_account_statements(transaction_date, account_code)',
      'CREATE INDEX IF NOT EXISTS idx_accounts_number ON dim_accounts(account_number)',
      'CREATE INDEX IF NOT EXISTS idx_accounts_type ON dim_accounts(account_type)'
    ];
    
    indexes.forEach((sql, index) => {
      db.exec(sql);
      console.log(`Created index ${index + 1}/${indexes.length}`);
    });
    
    return Promise.resolve();
  } catch (error) {
    console.error('Error creating indexes:', error);
    throw error;
  }
}

async function createGoldViews() {
  console.log('Creating gold layer views...');
  
  try {
    const views = [
      `CREATE VIEW IF NOT EXISTS gold_account_summary AS
      SELECT 
        s.account_code,
        s.account_name,
        COUNT(s.id) as transaction_count,
        SUM(s.debit) as total_debit,
        SUM(s.credit) as total_credit,
        MAX(s.balance) as latest_balance,
        MIN(s.transaction_date) as first_transaction,
        MAX(s.transaction_date) as last_transaction
      FROM silver_account_statements s
      GROUP BY s.account_code, s.account_name`,
      
      `CREATE VIEW IF NOT EXISTS gold_monthly_balances AS
      SELECT 
        s.account_code,
        s.account_name,
        strftime('%Y-%m', s.transaction_date) as month,
        SUM(s.debit) as monthly_debit,
        SUM(s.credit) as monthly_credit,
        SUM(s.credit - s.debit) as net_change,
        MAX(s.balance) as month_end_balance
      FROM silver_account_statements s
      GROUP BY s.account_code, s.account_name, strftime('%Y-%m', s.transaction_date)`,
      
      `CREATE VIEW IF NOT EXISTS gold_daily_transactions AS
      SELECT 
        s.transaction_date,
        COUNT(*) as transaction_count,
        SUM(s.debit) as daily_debit,
        SUM(s.credit) as daily_credit,
        SUM(s.credit - s.debit) as net_flow
      FROM silver_account_statements s
      GROUP BY s.transaction_date`
    ];
    
    views.forEach((sql, index) => {
      db.exec(sql);
      console.log(`Created view ${index + 1}/${views.length}`);
    });
    
    return Promise.resolve();
  } catch (error) {
    console.error('Error creating views:', error);
    throw error;
  }
}

async function main() {
  try {
    console.log('Starting SQLite population...');
    
    // Create schemas and tables
    await createSchemas();
    await createTables();
    
    // Fetch and load accounts
    const accounts = await fetchAccounts();
    await loadAccounts(accounts);
    
    // Fetch and load all statements at once
    const endDate = '2025-09-01'; // Fixed end date
    const startDate = '2024-01-01'; // Fixed start date for good coverage
    
    const statements = await fetchAllAccountStatements(startDate, endDate);
    await loadStatements(statements);
    
    // Create performance indexes
    await createIndexes();
    
    // Create gold layer views
    await createGoldViews();
    
    console.log('✅ SQLite population completed successfully!');
    
    // Show summary
    const accountCount = db.prepare('SELECT COUNT(*) as count FROM dim_accounts').get();
    console.log(`Total accounts: ${accountCount.count}`);
    
    const statementCount = db.prepare('SELECT COUNT(*) as count FROM silver_account_statements').get();
    console.log(`Total transactions: ${statementCount.count}`);
    
    db.close();
    
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

main();