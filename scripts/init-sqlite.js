// Initialize SQLite database with sample data
const Database = require('better-sqlite3');
const path = require('path');

// SQLite database path
const SQLITE_PATH = path.join(__dirname, '..', 'sqlite', 'finance.db');

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

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_gold_revenue_date ON gold_revenue(date);
CREATE INDEX IF NOT EXISTS idx_gold_expenses_date ON gold_expenses(date);
CREATE INDEX IF NOT EXISTS idx_gold_invoices_status ON gold_invoices(status);
`;

try {
    // Execute all CREATE statements
    db.exec(createTableStatements);
    
    // Insert sample data
    const insertRevenue = db.prepare(`
        INSERT OR IGNORE INTO gold_revenue (date, customer_name, amount, currency, payment_method) 
        VALUES (?, ?, ?, ?, ?)
    `);
    
    insertRevenue.run('2024-01-01', 'Acme Corp', 5000.00, 'USD', 'Bank Transfer');
    insertRevenue.run('2024-01-02', 'TechStart Inc', 2500.00, 'USD', 'Credit Card');
    insertRevenue.run('2024-01-03', 'Global Solutions', 7500.00, 'EUR', 'Bank Transfer');
    insertRevenue.run('2024-01-04', 'Nordic Industries', 150000.00, 'ISK', 'Bank Transfer');
    
    const insertExpenses = db.prepare(`
        INSERT OR IGNORE INTO gold_expenses (date, vendor_name, category, amount, currency) 
        VALUES (?, ?, ?, ?, ?)
    `);
    
    insertExpenses.run('2024-01-01', 'AWS', 'Cloud Services', 1200.00, 'USD');
    insertExpenses.run('2024-01-02', 'Office Supplies Co', 'Office', 350.00, 'USD');
    insertExpenses.run('2024-01-03', 'Tech Consultants', 'Professional Services', 3000.00, 'EUR');
    
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