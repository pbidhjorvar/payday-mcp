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

console.log(`🔄 INCREMENTAL ACCOUNT STATEMENTS LOADER`);
console.log(`💾 Using SQLite at: ${DB_PATH}\n`);

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

async function getLastIncrementalLoad(): Promise<{startDate: string, endDate: string}> {
  // Check when was the last incremental load
  const lastLoad = db.prepare(`
    SELECT date_to, load_timestamp 
    FROM load_log 
    WHERE operation_type = 'incremental_load' 
    ORDER BY load_timestamp DESC 
    LIMIT 1
  `).get();
  
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
  
  if (!lastLoad) {
    // No previous incremental load - start from the latest transaction date in database
    const latestTransaction = db.prepare(`
      SELECT MAX(transaction_date) as latest_date 
      FROM silver_account_statements
    `).get();
    
    if (latestTransaction?.latest_date) {
      const startDate = latestTransaction.latest_date.split('T')[0]; // Remove time part
      console.log(`🔍 No previous incremental load found`);
      console.log(`📅 Starting from latest transaction date: ${startDate}`);
      return { startDate, endDate: today };
    } else {
      // No transactions at all - start from 30 days ago
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const startDate = thirtyDaysAgo.toISOString().split('T')[0];
      console.log(`🔍 No transactions found in database`);
      console.log(`📅 Starting from 30 days ago: ${startDate}`);
      return { startDate, endDate: today };
    }
  } else {
    // Continue from last load date
    const startDate = lastLoad.date_to;
    console.log(`🔍 Last incremental load: ${lastLoad.load_timestamp}`);
    console.log(`📅 Continuing from: ${startDate}`);
    return { startDate, endDate: today };
  }
}

async function fetchAccountStatements(dateFrom: string, dateTo: string) {
  console.log(`📡 Fetching account statements from ${dateFrom} to ${dateTo}...`);
  
  // If start and end date are the same, skip loading
  if (dateFrom === dateTo) {
    console.log(`⏭️ Start and end dates are the same, skipping load`);
    return [];
  }
  
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
  
  console.log(`🚀 TOTAL NEW TRANSACTIONS FETCHED: ${allTransactions.length}`);
  return allTransactions;
}

async function upsertStatements(statements: any[], dateFrom: string, dateTo: string) {
  if (statements.length === 0) {
    console.log(`✅ No new transactions to load`);
    
    // Still log the operation
    const loadLogStmt = db.prepare(`
      INSERT OR REPLACE INTO load_log (
        operation_type, date_from, date_to, records_loaded, load_timestamp
      ) VALUES (?, ?, ?, ?, ?)
    `);
    
    loadLogStmt.run(
      'incremental_load',
      dateFrom,
      dateTo,
      0,
      new Date().toISOString()
    );
    
    return;
  }
  
  console.log(`💥 Upserting ${statements.length} statements into database...`);
  
  try {
    // Create upsert statement - INSERT OR IGNORE to handle duplicates
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
    
    console.log(`🎯 Successfully upserted ${upserted}/${statements.length} new transactions!`);
    
    // Log the load operation
    const loadLogStmt = db.prepare(`
      INSERT OR REPLACE INTO load_log (
        operation_type, date_from, date_to, records_loaded, load_timestamp
      ) VALUES (?, ?, ?, ?, ?)
    `);
    
    loadLogStmt.run(
      'incremental_load',
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

async function showSummary(dateFrom: string, dateTo: string) {
  console.log(`\n🎯 INCREMENTAL LOAD SUMMARY (${dateFrom} to ${dateTo}):`);
  
  const totalStatements = db.prepare(`
    SELECT COUNT(*) as count 
    FROM silver_account_statements
  `).get();
  console.log(`📈 Total transactions in database: ${totalStatements.count}`);
  
  const newStatements = db.prepare(`
    SELECT COUNT(*) as count 
    FROM silver_account_statements 
    WHERE transaction_date BETWEEN ? AND ?
  `).get(dateFrom, dateTo);
  console.log(`📊 Transactions in loaded date range: ${newStatements.count}`);
  
  const dateRange = db.prepare(`
    SELECT MIN(transaction_date) as min_date, MAX(transaction_date) as max_date 
    FROM silver_account_statements
  `).get();
  console.log(`📅 Full database date range: ${dateRange.min_date} to ${dateRange.max_date}`);
  
  const loadHistory = db.prepare(`
    SELECT operation_type, COUNT(*) as load_count, SUM(records_loaded) as total_records
    FROM load_log 
    GROUP BY operation_type
  `).all();
  
  console.log('\n📜 Load History:');
  loadHistory.forEach((history: any) => {
    console.log(`  ${history.operation_type}: ${history.load_count} loads, ${history.total_records} records`);
  });
}

async function main() {
  try {
    console.log('🚀 Starting incremental account statements load...\n');
    
    // Create load log table if it doesn't exist
    await createLoadLogTable();
    
    // Determine the date range for incremental load
    const { startDate, endDate } = await getLastIncrementalLoad();
    
    console.log(`📅 Loading incremental data from ${startDate} to ${endDate}\n`);
    
    // Fetch statements for the date range
    const statements = await fetchAccountStatements(startDate, endDate);
    
    // Upsert statements into database
    await upsertStatements(statements, startDate, endDate);
    
    // Show summary
    await showSummary(startDate, endDate);
    
    console.log(`\n✨🔄 INCREMENTAL LOAD COMPLETED SUCCESSFULLY! 🔄✨`);
    console.log('💎 Data is up-to-date for financial analysis!');
    console.log('🕒 Run this script regularly to keep data current');
    
    db.close();
    
  } catch (error) {
    console.error('💥 ERROR:', error);
    process.exit(1);
  }
}

main();