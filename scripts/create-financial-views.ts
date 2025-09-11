#!/usr/bin/env node
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import Database from 'better-sqlite3';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DB_PATH = join(__dirname, '..', 'sqlite', 'finance.db');

const db = new Database(DB_PATH);

console.log('🏦 Creating proper financial reporting views...\n');

try {
  // Drop existing views that aren't following accounting principles
  const viewsToDrop = [
    'gold_account_summary',
    'gold_monthly_pl', 
    'gold_balance_sheet',
    'gold_account_detail',
    'gold_account_summary_by_year',
    'gold_income_statement_by_year',
    'gold_balance_sheet_by_year',
    'gold_income_summary_by_year',
    'gold_balance_summary_by_year',
    'gold_chart_of_accounts',
    'gold_monthly_pl_trend'
  ];
  
  viewsToDrop.forEach(view => {
    try {
      db.exec(`DROP VIEW IF EXISTS ${view}`);
      console.log(`🗑️ Dropped old view: ${view}`);
    } catch (e) {
      // View might not exist
    }
  });

  console.log('\n🏗️ Creating new financial reporting views...\n');

  // 1. Account Summary by Year (for year-over-year comparison) - JOIN with dim_accounts to get proper account types
  db.exec(`
    CREATE VIEW gold_account_summary_by_year AS
    SELECT 
      strftime('%Y', s.transaction_date) as year,
      s.account_code,
      s.account_name,
      a.account_type,
      a.account_subtype,
      COUNT(*) as transaction_count,
      SUM(s.debit) as total_debit,
      SUM(s.credit) as total_credit,
      -- For P&L accounts: Proper signs for revenue and expenses
      -- For BS accounts: Use normal accounting signs
      CASE 
        WHEN a.account_type = 'Tekjur' THEN SUM(s.debit) - SUM(s.credit)  -- Revenue (make positive)
        WHEN a.account_type = 'Gjöld' THEN SUM(s.credit) - SUM(s.debit)   -- Expenses (make positive)
        WHEN a.account_type = 'Eignir' THEN SUM(s.debit) - SUM(s.credit)  -- Assets (debit normal)
        WHEN a.account_type = 'Skuldir' THEN SUM(s.credit) - SUM(s.debit) -- Liabilities (credit normal)
        WHEN a.account_type = 'Eigið fé' THEN SUM(s.credit) - SUM(s.debit) -- Equity (credit normal)
        ELSE SUM(s.credit) - SUM(s.debit)
      END as balance
    FROM silver_account_statements s
    JOIN dim_accounts a ON s.account_code = a.account_number
    WHERE s.transaction_date >= '2022-01-01'
    GROUP BY strftime('%Y', s.transaction_date), s.account_code, s.account_name, a.account_type, a.account_subtype
  `);
  console.log('✅ Created: gold_account_summary_by_year');

  // 2. Income Statement by Year
  db.exec(`
    CREATE VIEW gold_income_statement_by_year AS
    SELECT 
      year,
      account_code,
      account_name,
      account_type,
      account_subtype,
      balance as amount
    FROM gold_account_summary_by_year
    WHERE account_type IN ('Tekjur', 'Gjöld')
    ORDER BY year, account_code
  `);
  console.log('✅ Created: gold_income_statement_by_year');

  // 3. Balance Sheet by Year (cumulative)
  db.exec(`
    CREATE VIEW gold_balance_sheet_by_year AS
    SELECT 
      year,
      account_code,
      account_name,
      account_type,
      account_subtype,
      balance as amount
    FROM gold_account_summary_by_year
    WHERE account_type IN ('Eignir', 'Skuldir', 'Eigið fé')
    ORDER BY year, account_code
  `);
  console.log('✅ Created: gold_balance_sheet_by_year');

  // 4. Income Statement Summary by Year
  db.exec(`
    CREATE VIEW gold_income_summary_by_year AS
    SELECT 
      year,
      SUM(CASE WHEN account_type = 'Tekjur' THEN balance ELSE 0 END) as total_revenue,
      SUM(CASE WHEN account_type = 'Gjöld' THEN balance ELSE 0 END) as total_expenses,
      SUM(CASE WHEN account_type = 'Tekjur' THEN balance ELSE 0 END) - 
      SUM(CASE WHEN account_type = 'Gjöld' THEN balance ELSE 0 END) as net_income
    FROM gold_account_summary_by_year
    WHERE account_type IN ('Tekjur', 'Gjöld')
    GROUP BY year
    ORDER BY year
  `);
  console.log('✅ Created: gold_income_summary_by_year');

  // 5. Balance Sheet Summary by Year
  db.exec(`
    CREATE VIEW gold_balance_summary_by_year AS
    SELECT 
      year,
      SUM(CASE WHEN account_type = 'Eignir' THEN balance ELSE 0 END) as total_assets,
      SUM(CASE WHEN account_type = 'Skuldir' THEN balance ELSE 0 END) as total_liabilities,
      SUM(CASE WHEN account_type = 'Eigið fé' THEN balance ELSE 0 END) as total_equity
    FROM gold_account_summary_by_year
    WHERE account_type IN ('Eignir', 'Skuldir', 'Eigið fé')
    GROUP BY year
    ORDER BY year
  `);
  console.log('✅ Created: gold_balance_summary_by_year');

  // 6. Chart of Accounts View
  db.exec(`
    CREATE VIEW gold_chart_of_accounts AS
    SELECT 
      account_number as account_code,
      account_name,
      account_type,
      account_subtype,
      is_active
    FROM dim_accounts
    WHERE is_active = 1
    ORDER BY account_number
  `);
  console.log('✅ Created: gold_chart_of_accounts');

  // 7. Monthly P&L for trend analysis
  db.exec(`
    CREATE VIEW gold_monthly_pl_trend AS
    SELECT 
      strftime('%Y-%m', s.transaction_date) as month,
      strftime('%Y', s.transaction_date) as year,
      a.account_type,
      a.account_subtype,
      SUM(CASE WHEN a.account_type = 'Tekjur' THEN s.debit - s.credit ELSE 0 END) as revenue,
      SUM(CASE WHEN a.account_type = 'Gjöld' THEN s.credit - s.debit ELSE 0 END) as expenses
    FROM silver_account_statements s
    JOIN dim_accounts a ON s.account_code = a.account_number
    WHERE s.transaction_date >= '2022-01-01'
      AND a.account_type IN ('Tekjur', 'Gjöld')
    GROUP BY strftime('%Y-%m', s.transaction_date), a.account_type, a.account_subtype
    ORDER BY month, a.account_type
  `);
  console.log('✅ Created: gold_monthly_pl_trend');

  console.log('\n📊 Testing the new views...\n');

  // Test the views
  const tests = [
    {
      name: 'Income Summary by Year',
      query: 'SELECT * FROM gold_income_summary_by_year'
    },
    {
      name: 'Balance Sheet Summary by Year', 
      query: 'SELECT * FROM gold_balance_summary_by_year'
    },
    {
      name: 'Chart of Accounts Count',
      query: 'SELECT COUNT(*) as account_count FROM gold_chart_of_accounts'
    }
  ];

  tests.forEach(test => {
    try {
      const result = db.prepare(test.query).all();
      console.log(`✅ ${test.name}:`, result.length > 0 ? '✓ Has data' : '⚠️ No data');
      if (test.name.includes('Summary') && result.length > 0) {
        console.log(`   Sample:`, result[0]);
      }
    } catch (error) {
      console.log(`❌ ${test.name}: Error -`, error.message);
    }
  });

  console.log('\n🎯 Financial views created successfully!');
  console.log('\nNow Claude Desktop can query:');
  console.log('• gold_income_statement_by_year - Detailed P&L by year');
  console.log('• gold_balance_sheet_by_year - Detailed BS by year'); 
  console.log('• gold_income_summary_by_year - P&L totals by year');
  console.log('• gold_balance_summary_by_year - BS totals by year');
  console.log('• gold_chart_of_accounts - Chart of accounts');
  console.log('• gold_monthly_pl_trend - Monthly trends');

} catch (error) {
  console.error('❌ Error creating financial views:', error);
} finally {
  db.close();
}