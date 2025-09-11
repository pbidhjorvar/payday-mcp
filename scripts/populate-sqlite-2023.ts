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

console.log('🏆 PUMPING 2023 DATA INTO GOLD DATABASE!');
console.log('💾 Using SQLite at:', DB_PATH);

async function createSchemas() {
  console.log('📁 SQLite: Using table prefixes instead of schemas...');
  return Promise.resolve();
}

async function createTables() {
  console.log('🔧 Creating tables...');
  
  try {
    // Drop and recreate tables to ensure correct schema
    db.exec('DROP TABLE IF EXISTS dim_accounts');
    db.exec('DROP TABLE IF EXISTS silver_account_statements');
    
    const tables = [
      // Dimension tables with dim_ prefix
      `CREATE TABLE dim_accounts (
        account_id TEXT PRIMARY KEY,
        account_number TEXT,
        account_name TEXT,
        account_type TEXT,
        account_subtype TEXT,
        parent_account_id TEXT,
        is_active INTEGER,
        created_at TEXT,
        updated_at TEXT
      )`,
      
      // Fact tables with silver_ prefix  
      `CREATE TABLE silver_account_statements (
        id INTEGER PRIMARY KEY,
        account_code TEXT,
        account_id TEXT,
        account_name TEXT,
        account_type TEXT,
        account_subtype TEXT,
        transaction_date TEXT,
        journal_date TEXT,
        description TEXT,
        reference TEXT,
        amount REAL,
        debit REAL,
        credit REAL,
        balance REAL,
        currency TEXT,
        journal_id TEXT,
        journal_number TEXT,
        line_number INTEGER,
        record_type TEXT,
        created_at TEXT
      )`,
      
      // Enhanced gold views for 2023 analysis
    ];
    
    tables.forEach((sql, index) => {
      db.exec(sql);
      console.log(`✅ Created table ${index + 1}/${tables.length}`);
    });
    
    return Promise.resolve();
  } catch (error) {
    console.error('❌ Error creating tables:', error);
    throw error;
  }
}

async function fetchAccounts() {
  console.log('📊 Fetching Chart of Accounts from Payday...');
  
  const result = await paydayClient.get('/accounting/accounts?perpage=500');
  
  if ('error' in result) {
    throw new Error(`Failed to fetch accounts: ${result.error.detail}`);
  }
  
  const data = Array.isArray(result) ? result : (result as any).data || result;
  console.log(`📈 Fetched ${data.length} accounts`);
  return data;
}

async function fetch2022And2023AccountStatements() {
  console.log('💰 Fetching ALL 2022 AND 2023 account statements...');
  
  const allTransactions: any[] = [];
  let currentPage = 1;
  let hasMore = true;
  
  while (hasMore) {
    console.log(`📄 Fetching page ${currentPage}...`);
    
    const params = new URLSearchParams({
      dateFrom: '2022-01-01',
      dateTo: '2023-12-31',
      page: currentPage.toString(),
      perpage: '100'
    });
    
    const result = await paydayClient.get(`/accounting/accountStatement?${params}`);
    
    if ('error' in result) {
      console.error(`❌ Failed to fetch statements page ${currentPage}:`, result.error.detail);
      break;
    }
    
    const response = result as any;
    const transactions = response.lines || [];
    allTransactions.push(...transactions);
    
    // Check pagination - use direct response fields
    if (response.pages && response.total) {
      hasMore = currentPage < response.pages;
      console.log(`📊 Page ${currentPage}/${response.pages}: ${transactions.length} transactions (total: ${allTransactions.length}/${response.total})`);
    } else {
      hasMore = false;
    }
    
    currentPage++;
  }
  
  console.log(`🚀 TOTAL 2022-2023 TRANSACTIONS FETCHED: ${allTransactions.length}`);
  return allTransactions;
}

async function loadAccounts(accounts: any[]) {
  console.log('📥 Loading accounts into SQLite...');
  
  try {
    
    const stmt = db.prepare(`
      INSERT INTO dim_accounts (
        account_id, account_number, account_name, account_type, account_subtype,
        parent_account_id, is_active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    accounts.forEach(account => {
      stmt.run(
        String(account.id || ''),
        String(account.code || ''),
        String(account.name || ''),
        String(account.type || ''),
        String(account.subType || ''),
        account.parentId || null,
        account.isActive !== false ? 1 : 0,
        account.created || new Date().toISOString(),
        account.modified || new Date().toISOString()
      );
    });
    
    console.log(`✅ Loaded ${accounts.length} accounts into Gold database`);
    return Promise.resolve();
  } catch (error) {
    console.error('❌ Error loading accounts:', error);
    throw error;
  }
}

async function load2022And2023Statements(statements: any[]) {
  if (statements.length === 0) return;
  
  console.log(`💥 Loading ${statements.length} 2022-2023 statements into Gold database...`);
  
  try {
    // Table was recreated, so no need to delete
    
    const stmt = db.prepare(`
      INSERT OR IGNORE INTO silver_account_statements (
        account_code, account_id, account_name, account_type, account_subtype,
        transaction_date, journal_date, description, reference, amount,
        debit, credit, balance, currency, journal_id, journal_number,
        line_number, record_type, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    let loaded = 0;
    statements.forEach((tx, index) => {
      try {
        // Handle amount - Payday provides signed amounts
        const amount = parseFloat(tx.amount || 0);
        const debit = amount < 0 ? Math.abs(amount) : 0;
        const credit = amount > 0 ? amount : 0;
        
        stmt.run(
          String(tx.accountCode || ''),
          String(tx.id || ''),
          String(tx.accountName || ''),
          String(tx.accountType || ''),
          String(tx.accountSubType || ''),
          String(tx.date || ''), // Use date field from API
          String(tx.date || ''),
          String(tx.description || ''),
          String(tx.reference || ''),
          amount,
          debit,
          credit,
          parseFloat(tx.balance || 0),
          String(tx.currency || 'ISK'),
          String(tx.entryId || ''),
          String(tx.voucher || ''),
          0, // No line number in this API
          'transaction',
          String(tx.created || new Date().toISOString())
        );
        loaded++;
        
        if (loaded % 1000 === 0) {
          console.log(`  📊 Loaded ${loaded}/${statements.length} transactions...`);
        }
      } catch (err) {
        console.error(`❌ Error loading transaction ${index}:`, err.message);
      }
    });
    
    console.log(`🎯 Successfully loaded ${loaded}/${statements.length} 2022-2023 transactions!`);
    return Promise.resolve();
  } catch (error) {
    console.error('❌ Error loading 2023 statements:', error);
    throw error;
  }
}

async function createIndexes() {
  console.log('⚡ Creating performance indexes...');
  
  try {
    const indexes = [
      'CREATE INDEX IF NOT EXISTS idx_statements_account_code ON silver_account_statements(account_code)',
      'CREATE INDEX IF NOT EXISTS idx_statements_date ON silver_account_statements(transaction_date)',
      'CREATE INDEX IF NOT EXISTS idx_statements_journal_date ON silver_account_statements(journal_date)',
      'CREATE INDEX IF NOT EXISTS idx_statements_journal_id ON silver_account_statements(journal_id)',
      'CREATE INDEX IF NOT EXISTS idx_statements_year ON silver_account_statements(substr(transaction_date, 1, 4))',
      'CREATE INDEX IF NOT EXISTS idx_statements_date_account ON silver_account_statements(transaction_date, account_code)',
      'CREATE INDEX IF NOT EXISTS idx_accounts_number ON dim_accounts(account_number)',
      'CREATE INDEX IF NOT EXISTS idx_accounts_type ON dim_accounts(account_type)',
      'CREATE INDEX IF NOT EXISTS idx_accounts_subtype ON dim_accounts(account_subtype)'
    ];
    
    indexes.forEach((sql, index) => {
      db.exec(sql);
      console.log(`⚡ Created index ${index + 1}/${indexes.length}`);
    });
    
    return Promise.resolve();
  } catch (error) {
    console.error('❌ Error creating indexes:', error);
    throw error;
  }
}

async function createGoldViews() {
  console.log('🏆 Creating GOLD LAYER views for 2022-2023 analysis...');
  
  try {
    const views = [
      // Account summary for 2022-2023
      `CREATE VIEW IF NOT EXISTS gold_account_summary AS
      SELECT 
        s.account_code,
        s.account_name,
        s.account_type,
        s.account_subtype,
        COUNT(s.id) as transaction_count,
        SUM(s.debit) as total_debit,
        SUM(s.credit) as total_credit,
        SUM(s.credit - s.debit) as net_change,
        MIN(s.transaction_date) as first_transaction,
        MAX(s.transaction_date) as last_transaction
      FROM silver_account_statements s
      WHERE s.transaction_date >= '2022-01-01'
      GROUP BY s.account_code, s.account_name, s.account_type, s.account_subtype`,
      
      // Monthly P&L for 2022-2023
      `CREATE VIEW IF NOT EXISTS gold_monthly_pl AS
      SELECT 
        strftime('%Y-%m', s.transaction_date) as month,
        s.account_type,
        s.account_subtype,
        SUM(CASE WHEN s.account_type = 'Tekjur' THEN s.credit - s.debit ELSE 0 END) as revenue,
        SUM(CASE WHEN s.account_type = 'Gjöld' THEN s.debit - s.credit ELSE 0 END) as expenses,
        COUNT(*) as transaction_count
      FROM silver_account_statements s
      WHERE s.transaction_date >= '2022-01-01'
      GROUP BY strftime('%Y-%m', s.transaction_date), s.account_type, s.account_subtype`,
      
      // Balance Sheet positions for 2022-2023
      `CREATE VIEW IF NOT EXISTS gold_balance_sheet AS
      SELECT 
        s.account_type,
        s.account_subtype,
        s.account_code,
        s.account_name,
        SUM(s.debit) as total_debit,
        SUM(s.credit) as total_credit,
        SUM(CASE 
          WHEN s.account_type IN ('Eignir') THEN s.debit - s.credit
          WHEN s.account_type IN ('Skuldir', 'Eigið fé') THEN s.credit - s.debit
          ELSE 0 
        END) as balance
      FROM silver_account_statements s
      WHERE s.transaction_date >= '2022-01-01'
      GROUP BY s.account_type, s.account_subtype, s.account_code, s.account_name`,
      
      // Enhanced account detail view
      `CREATE VIEW IF NOT EXISTS gold_account_detail AS
      SELECT 
        a.account_id,
        a.account_number,
        a.account_name,
        a.account_type,
        a.account_subtype,
        a.is_active,
        COALESCE(s.transaction_count, 0) as transaction_count,
        COALESCE(s.total_debit, 0) as total_debit,
        COALESCE(s.total_credit, 0) as total_credit,
        COALESCE(s.net_change, 0) as net_change
      FROM dim_accounts a
      LEFT JOIN gold_account_summary s ON a.account_number = s.account_code`,
    ];
    
    views.forEach((sql, index) => {
      db.exec(sql);
      console.log(`🏆 Created Gold view ${index + 1}/${views.length}`);
    });
    
    return Promise.resolve();
  } catch (error) {
    console.error('❌ Error creating Gold views:', error);
    throw error;
  }
}

async function showSummary() {
  console.log('\n🎯 2022-2023 DATA SUMMARY:');
  
  const accountCount = db.prepare('SELECT COUNT(*) as count FROM dim_accounts').get();
  console.log(`📊 Total accounts: ${accountCount.count}`);
  
  const totalStatements = db.prepare("SELECT COUNT(*) as count FROM silver_account_statements WHERE transaction_date >= '2022-01-01'").get();
  console.log(`📈 Total 2022-2023 transactions: ${totalStatements.count}`);
  
  const dateRange = db.prepare(`
    SELECT MIN(transaction_date) as min_date, MAX(transaction_date) as max_date 
    FROM silver_account_statements 
    WHERE transaction_date >= '2022-01-01'
  `).get();
  console.log(`📅 Date range: ${dateRange.min_date} to ${dateRange.max_date}`);
  
  const yearlyStats = db.prepare(`
    SELECT 
      strftime('%Y', transaction_date) as year,
      COUNT(*) as transactions,
      ROUND(SUM(ABS(amount)), 2) as total_amount
    FROM silver_account_statements 
    WHERE transaction_date >= '2022-01-01'
    GROUP BY strftime('%Y', transaction_date)
    ORDER BY year
  `).all();
  
  console.log('\n📊 Yearly transaction volume:');
  yearlyStats.forEach((year: any) => {
    console.log(`  ${year.year}: ${year.transactions} transactions, ${year.total_amount} ISK total`);
  });
}

async function main() {
  try {
    console.log('🚀 Starting 2022-2023 data pump into Gold SQLite database...\n');
    
    // Create schemas and tables
    await createSchemas();
    await createTables();
    
    // Fetch and load accounts
    const accounts = await fetchAccounts();
    await loadAccounts(accounts);
    
    // Fetch and load 2022-2023 statements
    const statements = await fetch2022And2023AccountStatements();
    await load2022And2023Statements(statements);
    
    // Create performance indexes
    await createIndexes();
    
    // Create gold layer views
    await createGoldViews();
    
    // Show summary
    await showSummary();
    
    console.log('\n✨🏆 2022-2023 DATA SUCCESSFULLY PUMPED INTO GOLD DATABASE! 🏆✨');
    console.log('💎 Ready for comprehensive financial analysis and annual reporting!');
    
    db.close();
    
  } catch (error) {
    console.error('💥 ERROR:', error);
    process.exit(1);
  }
}

main();