#!/usr/bin/env node
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import Database from 'better-sqlite3';

// Get paths
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DB_PATH = join(__dirname, '..', 'sqlite', 'finance.db');

// Initialize SQLite
const db = new Database(DB_PATH);
db.pragma('foreign_keys = ON');

console.log('🏆 CREATING INVOICE GOLD VIEWS!');
console.log('💾 Using SQLite at:', DB_PATH);

async function createInvoiceViews() {
  console.log('🏆 Creating Gold layer invoice views...');
  
  try {
    // Drop existing views first
    const dropViews = [
      'DROP VIEW IF EXISTS gold_invoice_summary',
      'DROP VIEW IF EXISTS gold_invoice_lines', 
      'DROP VIEW IF EXISTS gold_invoice_monthly',
      'DROP VIEW IF EXISTS gold_customer_invoices'
    ];
    
    dropViews.forEach(sql => db.exec(sql));
    
    const views = [
      // Invoice summary view
      `CREATE VIEW gold_invoice_summary AS
      SELECT 
        i.invoice_id,
        i.invoice_number,
        i.customer_id,
        i.status,
        i.currency,
        i.subtotal,
        i.vat_amount, 
        i.total,
        i.invoice_date,
        i.due_date,
        i.final_due_date,
        i.paid_date,
        i.payment_type,
        i.description,
        i.reference,
        CASE 
          WHEN i.status = 'PAID' THEN 'Paid'
          WHEN i.status = 'SENT' THEN 'Unpaid'
          WHEN i.status = 'DRAFT' THEN 'Draft'
          WHEN i.status = 'CANCELLED' THEN 'Cancelled'
          WHEN i.status = 'CREDIT' THEN 'Credit Note'
          ELSE i.status 
        END as status_display,
        CASE
          WHEN i.status = 'SENT' AND date(i.due_date) < date('now') THEN 'Overdue'
          WHEN i.status = 'SENT' AND date(i.due_date) >= date('now') THEN 'Due'
          ELSE NULL
        END as payment_status,
        date('now') as created_at
      FROM dim_invoices i
      WHERE i.is_active = 1`,
      
      // Invoice lines with invoice details
      `CREATE VIEW gold_invoice_lines AS
      SELECT 
        l.id as line_id,
        l.invoice_id,
        i.invoice_number,
        i.customer_id,
        i.status as invoice_status,
        i.invoice_date,
        i.total as invoice_total,
        l.line_number,
        l.description as line_description,
        l.quantity,
        l.unit_price,
        l.discount_percent,
        l.vat_percent,
        l.vat_amount as line_vat_amount,
        l.line_total,
        l.account_id,
        l.account_code,
        date('now') as created_at
      FROM dim_invoice_lines l
      JOIN dim_invoices i ON l.invoice_id = i.invoice_id
      WHERE i.is_active = 1`,
      
      // Monthly invoice analytics
      `CREATE VIEW gold_invoice_monthly AS
      SELECT 
        strftime('%Y-%m', i.invoice_date) as month,
        strftime('%Y', i.invoice_date) as year,
        COUNT(*) as invoice_count,
        COUNT(CASE WHEN i.status = 'PAID' THEN 1 END) as paid_count,
        COUNT(CASE WHEN i.status = 'SENT' THEN 1 END) as unpaid_count,
        COUNT(CASE WHEN i.status = 'CANCELLED' THEN 1 END) as cancelled_count,
        SUM(i.total) as total_amount,
        SUM(CASE WHEN i.status = 'PAID' THEN i.total ELSE 0 END) as paid_amount,
        SUM(CASE WHEN i.status = 'SENT' THEN i.total ELSE 0 END) as unpaid_amount,
        AVG(i.total) as avg_invoice_amount,
        i.currency
      FROM dim_invoices i
      WHERE i.is_active = 1 AND i.invoice_date != ''
      GROUP BY strftime('%Y-%m', i.invoice_date), i.currency
      ORDER BY month DESC`,
      
      // Customer invoice summary
      `CREATE VIEW gold_customer_invoices AS
      SELECT 
        i.customer_id,
        COUNT(*) as invoice_count,
        COUNT(CASE WHEN i.status = 'PAID' THEN 1 END) as paid_count,
        COUNT(CASE WHEN i.status = 'SENT' THEN 1 END) as unpaid_count,
        SUM(i.total) as total_amount,
        SUM(CASE WHEN i.status = 'PAID' THEN i.total ELSE 0 END) as paid_amount,
        SUM(CASE WHEN i.status = 'SENT' THEN i.total ELSE 0 END) as unpaid_amount,
        AVG(i.total) as avg_invoice_amount,
        MIN(i.invoice_date) as first_invoice,
        MAX(i.invoice_date) as last_invoice,
        i.currency
      FROM dim_invoices i
      WHERE i.is_active = 1
      GROUP BY i.customer_id, i.currency
      ORDER BY total_amount DESC`,
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

async function showViewSummary() {
  console.log('\n🎯 INVOICE GOLD VIEWS SUMMARY:');
  
  const summary = db.prepare('SELECT COUNT(*) as count FROM gold_invoice_summary').get();
  console.log(`📊 gold_invoice_summary: ${summary.count} invoices`);
  
  const lines = db.prepare('SELECT COUNT(*) as count FROM gold_invoice_lines').get();
  console.log(`📈 gold_invoice_lines: ${lines.count} invoice lines`);
  
  const monthly = db.prepare('SELECT COUNT(*) as count FROM gold_invoice_monthly').get();
  console.log(`📅 gold_invoice_monthly: ${monthly.count} month records`);
  
  const customers = db.prepare('SELECT COUNT(*) as count FROM gold_customer_invoices').get();
  console.log(`👥 gold_customer_invoices: ${customers.count} customers`);
  
  // Show some sample data
  const sampleMonthly = db.prepare(`
    SELECT month, invoice_count, total_amount, paid_amount, unpaid_amount 
    FROM gold_invoice_monthly 
    ORDER BY month DESC 
    LIMIT 5
  `).all();
  
  console.log('\n📅 Recent monthly invoice activity:');
  sampleMonthly.forEach((row: any) => {
    console.log(`  ${row.month}: ${row.invoice_count} invoices, ${row.total_amount} ISK total (${row.paid_amount} paid, ${row.unpaid_amount} unpaid)`);
  });
}

async function main() {
  try {
    console.log('🚀 Starting invoice Gold views creation...\n');
    
    // Create Gold views
    await createInvoiceViews();
    
    // Show summary
    await showViewSummary();
    
    console.log('\n✨🏆 INVOICE GOLD VIEWS SUCCESSFULLY CREATED! 🏆✨');
    console.log('💎 Ready for comprehensive invoice analytics!');
    
    db.close();
    
  } catch (error) {
    console.error('💥 ERROR:', error);
    process.exit(1);
  }
}

main();