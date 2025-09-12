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

console.log('🧾 LOADING INVOICE DATA INTO DATABASE!');
console.log('💾 Using SQLite at:', DB_PATH);

async function createInvoiceTables() {
  console.log('🔧 Creating invoice tables...');
  
  try {
    // Drop and recreate tables to ensure correct schema
    db.exec('DROP TABLE IF EXISTS dim_invoices');
    db.exec('DROP TABLE IF EXISTS dim_invoice_lines');
    
    const tables = [
      // Invoice master table
      `CREATE TABLE dim_invoices (
        invoice_id TEXT PRIMARY KEY,
        invoice_number TEXT,
        customer_id TEXT,
        status TEXT,
        currency TEXT,
        subtotal REAL,
        vat_amount REAL,
        total REAL,
        invoice_date TEXT,
        due_date TEXT,
        final_due_date TEXT,
        paid_date TEXT,
        payment_type TEXT,
        description TEXT,
        reference TEXT,
        is_active INTEGER,
        created_at TEXT,
        updated_at TEXT
      )`,
      
      // Invoice lines table
      `CREATE TABLE dim_invoice_lines (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        invoice_id TEXT,
        line_number INTEGER,
        description TEXT,
        quantity REAL,
        unit_price REAL,
        discount_percent REAL,
        vat_percent REAL,
        vat_amount REAL,
        line_total REAL,
        account_id TEXT,
        account_code TEXT,
        created_at TEXT,
        FOREIGN KEY (invoice_id) REFERENCES dim_invoices(invoice_id)
      )`
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

async function fetchAllInvoices() {
  console.log('📊 Fetching ALL invoices from Payday with lines...');
  
  const allInvoices: any[] = [];
  let currentPage = 1;
  let hasMore = true;
  
  while (hasMore) {
    console.log(`📄 Fetching page ${currentPage}...`);
    
    const params = new URLSearchParams({
      page: currentPage.toString(),
      perpage: '100',
      include: 'lines'  // Include invoice lines
    });
    
    const result = await paydayClient.get(`/invoices?${params}`);
    
    if ('error' in result) {
      console.error(`❌ Failed to fetch invoices page ${currentPage}:`, result.error.detail);
      break;
    }
    
    const response = result as any;
    const invoices = response.data || response.invoices || [];
    allInvoices.push(...invoices);
    
    // Check pagination
    if (response.meta && response.meta.pagination) {
      hasMore = currentPage < response.meta.pagination.total_pages;
      console.log(`📊 Page ${currentPage}/${response.meta.pagination.total_pages}: ${invoices.length} invoices (total: ${allInvoices.length}/${response.meta.pagination.total})`);
    } else {
      hasMore = false;
    }
    
    currentPage++;
  }
  
  console.log(`🚀 TOTAL INVOICES FETCHED: ${allInvoices.length}`);
  return allInvoices;
}

async function loadInvoices(invoices: any[]) {
  if (invoices.length === 0) return;
  
  console.log(`💥 Loading ${invoices.length} invoices into database...`);
  
  try {
    const invoiceStmt = db.prepare(`
      INSERT OR REPLACE INTO dim_invoices (
        invoice_id, invoice_number, customer_id, status, currency,
        subtotal, vat_amount, total, invoice_date, due_date, final_due_date,
        paid_date, payment_type, description, reference, is_active,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    const lineStmt = db.prepare(`
      INSERT OR REPLACE INTO dim_invoice_lines (
        invoice_id, line_number, description, quantity, unit_price,
        discount_percent, vat_percent, vat_amount, line_total,
        account_id, account_code, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    let loadedInvoices = 0;
    let loadedLines = 0;
    
    invoices.forEach((invoice, index) => {
      try {
        // Load invoice header
        invoiceStmt.run(
          String(invoice.id || ''),
          String(invoice.number || ''),
          String(invoice.customerId || ''),
          String(invoice.status || ''),
          String(invoice.currency || 'ISK'),
          parseFloat(invoice.subtotal || 0),
          parseFloat(invoice.vatAmount || 0),
          parseFloat(invoice.total || 0),
          String(invoice.invoiceDate || ''),
          String(invoice.dueDate || ''),
          String(invoice.finalDueDate || ''),
          String(invoice.paidDate || ''),
          String(invoice.paymentType || ''),
          String(invoice.description || ''),
          String(invoice.reference || ''),
          invoice.isActive !== false ? 1 : 0,
          String(invoice.created || new Date().toISOString()),
          String(invoice.updated || new Date().toISOString())
        );
        loadedInvoices++;
        
        // Load invoice lines if they exist
        if (invoice.lines && Array.isArray(invoice.lines)) {
          invoice.lines.forEach((line: any, lineIndex: number) => {
            try {
              lineStmt.run(
                String(invoice.id || ''),
                lineIndex + 1,
                String(line.description || ''),
                parseFloat(line.quantity || 0),
                parseFloat(line.unitPrice || 0),
                parseFloat(line.discountPercent || 0),
                parseFloat(line.vatPercent || 0),
                parseFloat(line.vatAmount || 0),
                parseFloat(line.total || 0),
                String(line.accountId || ''),
                String(line.accountCode || ''),
                String(line.created || new Date().toISOString())
              );
              loadedLines++;
            } catch (err) {
              console.error(`❌ Error loading invoice line ${lineIndex} for invoice ${invoice.number}:`, err.message);
            }
          });
        }
        
        if (loadedInvoices % 100 === 0) {
          console.log(`  📊 Loaded ${loadedInvoices}/${invoices.length} invoices, ${loadedLines} lines...`);
        }
      } catch (err) {
        console.error(`❌ Error loading invoice ${index}:`, err.message);
      }
    });
    
    console.log(`🎯 Successfully loaded ${loadedInvoices}/${invoices.length} invoices and ${loadedLines} invoice lines!`);
    return Promise.resolve();
  } catch (error) {
    console.error('❌ Error loading invoices:', error);
    throw error;
  }
}

async function createIndexes() {
  console.log('⚡ Creating invoice indexes...');
  
  try {
    const indexes = [
      'CREATE INDEX IF NOT EXISTS idx_invoices_number ON dim_invoices(invoice_number)',
      'CREATE INDEX IF NOT EXISTS idx_invoices_customer ON dim_invoices(customer_id)', 
      'CREATE INDEX IF NOT EXISTS idx_invoices_status ON dim_invoices(status)',
      'CREATE INDEX IF NOT EXISTS idx_invoices_date ON dim_invoices(invoice_date)',
      'CREATE INDEX IF NOT EXISTS idx_invoices_due_date ON dim_invoices(due_date)',
      'CREATE INDEX IF NOT EXISTS idx_invoice_lines_invoice ON dim_invoice_lines(invoice_id)',
      'CREATE INDEX IF NOT EXISTS idx_invoice_lines_account ON dim_invoice_lines(account_code)',
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

async function showSummary() {
  console.log('\n🎯 INVOICE DATA SUMMARY:');
  
  const invoiceCount = db.prepare('SELECT COUNT(*) as count FROM dim_invoices').get();
  console.log(`📊 Total invoices: ${invoiceCount.count}`);
  
  const lineCount = db.prepare('SELECT COUNT(*) as count FROM dim_invoice_lines').get();
  console.log(`📈 Total invoice lines: ${lineCount.count}`);
  
  const statusStats = db.prepare(`
    SELECT status, COUNT(*) as count, ROUND(SUM(total), 2) as total_amount 
    FROM dim_invoices 
    GROUP BY status 
    ORDER BY count DESC
  `).all();
  
  console.log('\n📊 Invoice status breakdown:');
  statusStats.forEach((stat: any) => {
    console.log(`  ${stat.status}: ${stat.count} invoices, ${stat.total_amount} ISK total`);
  });
  
  const dateRange = db.prepare(`
    SELECT MIN(invoice_date) as min_date, MAX(invoice_date) as max_date 
    FROM dim_invoices 
    WHERE invoice_date != ''
  `).get();
  console.log(`📅 Date range: ${dateRange.min_date} to ${dateRange.max_date}`);
}

async function main() {
  try {
    console.log('🚀 Starting invoice data ingestion into SQLite database...\n');
    
    // Create tables
    await createInvoiceTables();
    
    // Fetch and load invoices
    const invoices = await fetchAllInvoices();
    await loadInvoices(invoices);
    
    // Create performance indexes
    await createIndexes();
    
    // Show summary
    await showSummary();
    
    console.log('\n✨🧾 INVOICE DATA SUCCESSFULLY LOADED INTO DATABASE! 🧾✨');
    console.log('💎 Ready for invoice analysis and reporting!');
    
    db.close();
    
  } catch (error) {
    console.error('💥 ERROR:', error);
    process.exit(1);
  }
}

main();