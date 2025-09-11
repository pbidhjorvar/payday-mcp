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

// Get command line arguments
const args = process.argv.slice(2);
if (args.length !== 2) {
  console.log('❌ Usage: npx tsx scripts/load-account-statements-manual.ts <startDate> <endDate>');
  console.log('📅 Example: npx tsx scripts/load-account-statements-manual.ts 2024-01-01 2024-12-31');
  console.log('📅 Dates should be in YYYY-MM-DD format');
  process.exit(1);
}

const startDate = args[0];
const endDate = args[1];

// Validate date format
const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
if (!dateRegex.test(startDate) || !dateRegex.test(endDate)) {
  console.log('❌ Invalid date format. Use YYYY-MM-DD format');
  process.exit(1);
}

console.log(`💰 MANUAL ACCOUNT STATEMENTS LOADER`);
console.log(`📅 Loading from ${startDate} to ${endDate}`);
console.log(`💾 Using SQLite at: ${DB_PATH}\n`);

async function fetchAccountStatements(dateFrom: string, dateTo: string) {
  console.log(`📡 Fetching account statements from ${dateFrom} to ${dateTo}...`);
  
  const allTransactions: any[] = [];
  let currentPage = 1;
  let hasMore = true;
  
  while (hasMore) {
    console.log(`📄 Fetching page ${currentPage}...`);
    
    const params = new URLSearchParams({
      dateFrom,
      dateTo,
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
    
    // Check pagination
    if (response.pages && response.total) {
      hasMore = currentPage < response.pages;
      console.log(`📊 Page ${currentPage}/${response.pages}: ${transactions.length} transactions (total: ${allTransactions.length}/${response.total})`);
    } else {
      hasMore = false;
    }
    
    currentPage++;
  }
  
  console.log(`🚀 TOTAL TRANSACTIONS FETCHED: ${allTransactions.length}`);
  return allTransactions;
}

async function upsertStatements(statements: any[], dateFrom: string, dateTo: string) {
  if (statements.length === 0) return;
  
  console.log(`💥 Upserting ${statements.length} statements into database...`);
  
  try {
    // Create upsert statement - INSERT OR IGNORE to handle duplicates based on unique combination
    const stmt = db.prepare(`
      INSERT OR IGNORE INTO silver_account_statements (
        account_code, account_id, account_name, account_type, account_subtype,
        transaction_date, journal_date, description, reference, amount,
        debit, credit, balance, currency, journal_id, journal_number,
        line_number, record_type, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    let upserted = 0;
    statements.forEach((tx, index) => {
      try {
        // Handle amount - Payday provides signed amounts
        const amount = parseFloat(tx.amount || 0);
        const debit = amount < 0 ? Math.abs(amount) : 0;
        const credit = amount > 0 ? amount : 0;
        
        const result = stmt.run(
          String(tx.accountCode || ''),
          String(tx.id || ''),
          String(tx.accountName || ''),
          '', // Will be filled via JOIN with dim_accounts
          '', // Will be filled via JOIN with dim_accounts
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
        
        if (result.changes > 0) {
          upserted++;
        }
        
        if (upserted % 1000 === 0) {
          console.log(`  📊 Upserted ${upserted}/${statements.length} transactions...`);
        }
      } catch (err: any) {
        console.error(`❌ Error upserting transaction ${index}:`, err.message);
      }
    });
    
    console.log(`🎯 Successfully upserted ${upserted}/${statements.length} transactions!`);
    
    // Log the load operation
    const loadLogStmt = db.prepare(`
      INSERT OR REPLACE INTO load_log (
        operation_type, date_from, date_to, records_loaded, load_timestamp
      ) VALUES (?, ?, ?, ?, ?)
    `);
    
    loadLogStmt.run(
      'manual_load',
      dateFrom,
      dateTo,
      upserted,
      new Date().toISOString()
    );
    
    return Promise.resolve();
  } catch (error) {
    console.error('❌ Error upserting statements:', error);
    throw error;
  }
}

async function createLoadLogTable() {
  // Create table to track load operations for incremental loading
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS load_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        operation_type TEXT NOT NULL,
        date_from TEXT,
        date_to TEXT,
        records_loaded INTEGER,
        load_timestamp TEXT NOT NULL,
        UNIQUE(operation_type, date_from, date_to) ON CONFLICT REPLACE
      )
    `);
    console.log('✅ Load log table ready');
  } catch (error) {
    console.error('❌ Error creating load log table:', error);
    throw error;
  }
}

async function showSummary(dateFrom: string, dateTo: string) {
  console.log(`\n🎯 LOAD SUMMARY (${dateFrom} to ${dateTo}):`);
  
  const totalStatements = db.prepare(`
    SELECT COUNT(*) as count 
    FROM silver_account_statements 
    WHERE transaction_date BETWEEN ? AND ?
  `).get(dateFrom, dateTo);
  console.log(`📈 Transactions in date range: ${totalStatements.count}`);
  
  const dateRange = db.prepare(`
    SELECT MIN(transaction_date) as min_date, MAX(transaction_date) as max_date 
    FROM silver_account_statements 
    WHERE transaction_date BETWEEN ? AND ?
  `).get(dateFrom, dateTo);
  console.log(`📅 Actual date range: ${dateRange.min_date} to ${dateRange.max_date}`);
  
  const totalAmount = db.prepare(`
    SELECT 
      ROUND(SUM(ABS(amount)), 2) as total_amount,
      COUNT(DISTINCT account_code) as unique_accounts
    FROM silver_account_statements 
    WHERE transaction_date BETWEEN ? AND ?
  `).get(dateFrom, dateTo);
  console.log(`💰 Total transaction volume: ${totalAmount.total_amount} ISK`);
  console.log(`📊 Unique accounts involved: ${totalAmount.unique_accounts}`);
}

async function main() {
  try {
    console.log('🚀 Starting manual account statements load...\n');
    
    // Create load log table if it doesn't exist
    await createLoadLogTable();
    
    // Fetch statements for the date range
    const statements = await fetchAccountStatements(startDate, endDate);
    
    // Upsert statements into database
    await upsertStatements(statements, startDate, endDate);
    
    // Show summary
    await showSummary(startDate, endDate);
    
    console.log(`\n✨💰 MANUAL LOAD COMPLETED SUCCESSFULLY! 💰✨`);
    console.log('💎 Data ready for financial analysis in Gold views!');
    
    db.close();
    
  } catch (error) {
    console.error('💥 ERROR:', error);
    process.exit(1);
  }
}

main();