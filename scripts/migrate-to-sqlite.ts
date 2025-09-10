// Convert DuckDB to SQLite script
// This is a placeholder script that outlines the migration process
// Since we cannot install DuckDB on this system, you'll need to run this
// on a system with Node v20 or with proper build tools

import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// SQLite database path
const SQLITE_PATH = join(__dirname, '..', 'sqlite', 'finance.db');

console.log('Creating SQLite database at:', SQLITE_PATH);

// Create new SQLite database
const db = new Database(SQLITE_PATH);

// Enable foreign keys
db.pragma('foreign_keys = ON');

// Create schema with prefixed table names (simulating DuckDB schemas)
const createTableStatements = `
-- Gold layer tables
CREATE TABLE IF NOT EXISTS gold_revenue (
    id INTEGER PRIMARY KEY,
    date TEXT NOT NULL,
    customer_name TEXT,
    amount REAL,
    currency TEXT,
    payment_method TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS gold_expenses (
    id INTEGER PRIMARY KEY,
    date TEXT NOT NULL,
    vendor_name TEXT,
    category TEXT,
    amount REAL,
    currency TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS gold_invoices (
    id INTEGER PRIMARY KEY,
    invoice_number TEXT UNIQUE NOT NULL,
    customer_name TEXT,
    issue_date TEXT,
    due_date TEXT,
    total_amount REAL,
    currency TEXT,
    status TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS gold_customers (
    id INTEGER PRIMARY KEY,
    customer_id TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    address TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Silver layer tables  
CREATE TABLE IF NOT EXISTS silver_payments (
    id INTEGER PRIMARY KEY,
    payment_id TEXT UNIQUE NOT NULL,
    date TEXT,
    amount REAL,
    currency TEXT,
    customer_id TEXT,
    invoice_id TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS silver_vendors (
    id INTEGER PRIMARY KEY,
    vendor_id TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    category TEXT,
    contact_info TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Dimension tables
CREATE TABLE IF NOT EXISTS dim_date (
    date_key INTEGER PRIMARY KEY,
    date TEXT UNIQUE NOT NULL,
    year INTEGER,
    quarter INTEGER,
    month INTEGER,
    month_name TEXT,
    week INTEGER,
    day_of_month INTEGER,
    day_of_week INTEGER,
    day_name TEXT,
    is_weekend INTEGER,
    is_holiday INTEGER
);

CREATE TABLE IF NOT EXISTS dim_currency (
    currency_code TEXT PRIMARY KEY,
    currency_name TEXT,
    symbol TEXT,
    decimal_places INTEGER
);

-- Create indexes for better performance
CREATE INDEX idx_gold_revenue_date ON gold_revenue(date);
CREATE INDEX idx_gold_revenue_customer ON gold_revenue(customer_name);
CREATE INDEX idx_gold_expenses_date ON gold_expenses(date);
CREATE INDEX idx_gold_expenses_vendor ON gold_expenses(vendor_name);
CREATE INDEX idx_gold_invoices_customer ON gold_invoices(customer_name);
CREATE INDEX idx_gold_invoices_status ON gold_invoices(status);
CREATE INDEX idx_silver_payments_date ON silver_payments(date);
CREATE INDEX idx_silver_payments_customer ON silver_payments(customer_id);
`;

try {
    // Execute all CREATE statements
    db.exec(createTableStatements);
    
    // Insert sample data
    const insertSampleData = db.prepare(`
        INSERT INTO gold_revenue (date, customer_name, amount, currency, payment_method) 
        VALUES (?, ?, ?, ?, ?)
    `);
    
    insertSampleData.run('2024-01-01', 'Sample Customer 1', 1000.00, 'USD', 'Credit Card');
    insertSampleData.run('2024-01-02', 'Sample Customer 2', 2500.00, 'USD', 'Bank Transfer');
    
    // Insert currency dimension data
    const currencies = [
        ['USD', 'US Dollar', '$', 2],
        ['EUR', 'Euro', '€', 2],
        ['GBP', 'British Pound', '£', 2],
        ['ISK', 'Icelandic Króna', 'kr', 0]
    ];
    
    const insertCurrency = db.prepare(`
        INSERT INTO dim_currency (currency_code, currency_name, symbol, decimal_places) 
        VALUES (?, ?, ?, ?)
    `);
    
    for (const currency of currencies) {
        insertCurrency.run(...currency);
    }
    
    console.log('✅ SQLite database created successfully!');
    console.log('📊 Tables created:');
    
    const tables = db.prepare(`
        SELECT name FROM sqlite_master 
        WHERE type='table' 
        ORDER BY name
    `).all();
    
    tables.forEach(table => {
        const count = db.prepare(`SELECT COUNT(*) as count FROM ${table.name}`).get();
        console.log(`  - ${table.name} (${count.count} rows)`);
    });
    
} catch (error) {
    console.error('❌ Error creating database:', error);
} finally {
    db.close();
}

console.log('\n📝 Migration Notes:');
console.log('1. This creates an empty SQLite database with the proper schema');
console.log('2. To migrate actual data from DuckDB, you would need to:');
console.log('   - Export data from DuckDB using COPY TO CSV commands');
console.log('   - Import CSV files into SQLite using .import command');
console.log('3. Alternatively, use a system with Node v20 to run a full migration script');