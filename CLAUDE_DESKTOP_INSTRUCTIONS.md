# Payday MCP Server - Tool Usage Instructions

You have access to a comprehensive set of tools for interacting with the Payday accounting API and analyzing financial data through SQLite. Below are detailed instructions for using each tool effectively.

## Authentication & Profiles
The server automatically handles OAuth2 authentication and supports multiple profiles (test/production). All requests include proper authentication headers.

## Core Tools Overview

### 📊 **Company & Account Information**
- `payday_show_profile` - Show current profile configuration
- `payday_get_company` - Get company information
- `payday_get_accounts` - Get chart of accounts with pagination

### 💰 **Financial Data**
- `payday_get_account_statement` - Get complete account statements (auto-fetches all pages)
- `payday_get_journal_entries` - List journal entries with pagination
- `payday_create_journal_entry` - Create new journal entries
- `payday_update_journal_entry` - Update journal entries (post drafts)

### 🧾 **Invoices**
- `payday_get_invoices` - List invoices with filtering by excludeStatus, date ranges, query search, and sorting
- `payday_get_invoice` - Get single invoice with details (accepts invoice number or UUID)
- `payday_update_invoice` - Update invoices (mark as paid, cancel, resend, etc.)

### 👥 **Customers**
- `payday_get_customers` - List customers with search
- `payday_get_customer` - Get individual customer details

### 💸 **Expenses & Payments**
- `payday_get_expenses` - List expenses with filtering
- `payday_get_expense_accounts` - Get expense account types
- `payment_types_list` - Get payment types/bank accounts configured in Payday
- `payday_get_payments` - List payment records

### 📋 **Sales Orders**
- `payday_get_salesorders` - List sales orders

### 🔍 **System Tools**
- `payday_healthcheck` - Check API connectivity
- `payday_rate_limit_status` - Check current rate limit status

## 🏆 **SQLite Financial Analytics** (PRIMARY FOR REPORTING)

### **⚠️ CRITICAL: Always Use Gold Views for Financial Reports**

For **ALL FINANCIAL ANALYSIS AND ANNUAL REPORTS**, use these pre-built Gold views instead of writing manual queries:

### 📊 **Ready-to-Use Financial Views:**
- `sqlite_list_objects` - Discover available tables and views
- `sqlite_table_info` - Get column information for specific tables
- `sqlite_explain` - Get query execution plans for debugging
- `sqlite_sql_select` - Execute SELECT queries against financial data

### 🏆 **GOLD LAYER VIEWS (Use These for Reports!):**

#### **Annual Report Queries - USE THESE:**
```sql
-- ✅ ANNUAL INCOME STATEMENT (by year)
SELECT * FROM gold_income_summary_by_year ORDER BY year;

-- ✅ ANNUAL BALANCE SHEET SUMMARY (by year)  
SELECT * FROM gold_balance_summary_by_year ORDER BY year;

-- ✅ DETAILED INCOME STATEMENT (by account and year)
SELECT * FROM gold_income_statement_by_year 
WHERE year = '2024' ORDER BY amount DESC;

-- ✅ DETAILED BALANCE SHEET (by account and year)
SELECT * FROM gold_balance_sheet_by_year 
WHERE year = '2024' ORDER BY amount DESC;

-- ✅ MONTHLY P&L TRENDS
SELECT * FROM gold_monthly_pl_trend 
WHERE year = '2024' ORDER BY month;

-- ✅ CHART OF ACCOUNTS
SELECT * FROM gold_chart_of_accounts ORDER BY account_code;
```

#### **Available Gold Views:**
- **`gold_income_summary_by_year`** - Annual P&L totals (revenue, expenses, net income)
- **`gold_balance_summary_by_year`** - Annual balance sheet totals (assets, liabilities, equity)
- **`gold_income_statement_by_year`** - Detailed P&L by account and year
- **`gold_balance_sheet_by_year`** - Detailed balance sheet by account and year
- **`gold_monthly_pl_trend`** - Monthly revenue/expense trends
- **`gold_chart_of_accounts`** - Master chart of accounts

### 🚫 **DON'T DO THIS (What CD was doing wrong):**
```sql
-- ❌ WRONG: Manual queries with hardcoded account ranges
SELECT 
    strftime('%Y', transaction_date) as year,
    SUM(CASE WHEN account_code BETWEEN '1100' AND '1399' THEN credit - debit ELSE 0 END) as total_revenue
FROM silver_account_statements 
WHERE strftime('%Y', transaction_date) IN ('2022', '2023')
GROUP BY strftime('%Y', transaction_date);

-- ❌ WRONG: Complex UNION statements
SELECT '2022' as year, 'Revenue' as category, ...
UNION ALL  
SELECT '2023' as year, 'Revenue' as category, ...
```

### ✅ **DO THIS INSTEAD:**
```sql
-- ✅ CORRECT: Use the gold views
SELECT year, total_revenue, total_expenses, net_income 
FROM gold_income_summary_by_year 
WHERE year IN ('2022', '2023', '2024')
ORDER BY year;
```

## Key Usage Guidelines

### Date Formats
Always use **YYYY-MM-DD** format for dates:
- ✅ `"2024-01-01"`
- ❌ `"01/01/2024"` or `"January 1, 2024"`

### Financial Analysis Best Practices

1. **START WITH GOLD VIEWS** - Never query `silver_account_statements` directly for reports
2. **Use Parameters** - Always use `?` placeholders and `params` array for filters
3. **Limit Results** - Use `LIMIT` or `max_rows` parameter for large datasets
4. **Format Output** - Use `format: "markdown"` for readable results

### Example Annual Report Workflow

```json
{
  "sql": "SELECT year, total_revenue/1000000.0 as revenue_millions, total_expenses/1000000.0 as expenses_millions, net_income/1000000.0 as profit_millions FROM gold_income_summary_by_year WHERE year >= ? ORDER BY year",
  "params": ["2022"],
  "format": "markdown"
}
```

### SQLite SQL Constraints
- **READ-ONLY**: Only SELECT and CTE queries allowed
- **Row limits**: 5000 rows by default (override with `max_rows` or LIMIT)
- **Output formats**: JSON (default), CSV, or Markdown
- **Parameters**: Use `?` placeholders, pass values in `params` array

### Account Information
- **Icelandic Account Types:**
  - `Tekjur` - Revenue accounts
  - `Gjöld` - Expense accounts  
  - `Eignir` - Asset accounts
  - `Skuldir` - Liability accounts
  - `Eigið fé` - Equity accounts

### Invoice Operations
When working with invoices, you can use either:
- Invoice numbers (e.g., `"1165"`) - automatically converted to UUIDs
- Invoice UUIDs directly

**Invoice filtering parameters:**
- `excludeStatus` - Exclude invoices with specific statuses. Available values: DRAFT, SENT, PAID, CREDIT, CANCELLED. Use comma to separate multiple values. E.g., `excludeStatus="DRAFT,PAID,CREDIT,CANCELLED"` shows only unpaid invoices (status SENT)
- `dateFrom`/`dateTo` - Filter by invoice date range (YYYY-MM-DD)
- `dueDateFrom`/`dueDateTo` - Filter by due date range
- `finalDueDateFrom`/`finalDueDateTo` - Filter by final due date range
- `query` - Search by invoice number, customer name, etc.
- `order` - Sort order: "asc" or "desc"
- `orderBy` - Field to sort by

**Common invoice operations:**
- Mark as paid: `mode="mark_as_paid"`, include `paidDate` (YYYY-MM-DD or ISO format) and `paymentType` (UUID)
- Cancel invoice: `mode="cancel_invoice"`
- Resend email: `mode="resend_email"`

**Invoice update examples:**
```json
// Mark invoice as paid
{
  "invoice_id": "1165",
  "mode": "mark_as_paid",
  "paidDate": "2024-12-18",
  "paymentType": "payment-type-uuid"
}

// Cancel invoice  
{
  "invoice_id": "1165",
  "mode": "cancel_invoice"
}
```

### Journal Entry Requirements
Each journal line must have **exactly one** of:
- `ledgerAccountId` (ledger account entry)
- `customerId` (customer/debtor entry)  
- `creditorId` (creditor entry)

## Example Workflows

### 📊 Annual Report Generation (RECOMMENDED)
```javascript
// 1. Get annual summary
sqlite_sql_select({
  sql: "SELECT * FROM gold_income_summary_by_year ORDER BY year",
  format: "markdown"
});

// 2. Get detailed revenue breakdown
sqlite_sql_select({
  sql: "SELECT year, account_name, amount FROM gold_income_statement_by_year WHERE account_type = 'Tekjur' AND year = ? ORDER BY amount DESC",
  params: ["2024"],
  format: "markdown"
});

// 3. Get expense analysis
sqlite_sql_select({
  sql: "SELECT year, account_name, amount FROM gold_income_statement_by_year WHERE account_type = 'Gjöld' AND year = ? ORDER BY amount DESC LIMIT 10",
  params: ["2024"]
});

// 4. Monthly trends
sqlite_sql_select({
  sql: "SELECT month, SUM(revenue) as total_revenue, SUM(expenses) as total_expenses FROM gold_monthly_pl_trend WHERE year = ? GROUP BY month ORDER BY month",
  params: ["2024"],
  format: "markdown"
});
```

### Complete Invoice Analysis
1. `payday_get_customers` - Find customer
2. `payday_get_invoices` with `customer_id` filter
3. `payday_get_invoice` with `include=["lines"]` for details
4. `payday_update_invoice` to mark as paid if needed

### Payment Types Management
1. `payment_types_list` - Get all bank accounts/payment methods
2. Use payment type IDs in invoice updates and journal entries

## Error Handling
Tools return structured error responses:
```json
{
  "ok": false,
  "error": {
    "status": 400,
    "label": "VALIDATION_ERROR", 
    "detail": "Description of the error"
  }
}
```

## Best Practices

1. **Use Gold Views First** - For all financial reporting and analysis
2. **Parameter Safety** - Always use `?` placeholders, never string concatenation
3. **Appropriate Limits** - Use LIMIT or max_rows to avoid large results
4. **Markdown Format** - Use `format: "markdown"` for readable financial reports
5. **Start with company info** to understand the business context
6. **Check payment types** before marking invoices as paid

## Debugging & Troubleshooting

### MCP Server Configuration
The server is configured in Claude Desktop's configuration file:
- **Windows**: `C:\Users\DaníelHjörvar\AppData\Roaming\Claude\claude_desktop_config.json`
- **Current setup**: Uses compiled version at `C:\Projects\Payday-MCP\dist\index.js`

### Common Issues

#### "No data" in Financial Views
If financial views show no data:
1. Check if data exists: `sqlite_sql_select({ sql: "SELECT COUNT(*) FROM silver_account_statements" })`
2. Verify account types: `sqlite_sql_select({ sql: "SELECT DISTINCT account_type FROM dim_accounts LIMIT 10" })`
3. Check date ranges: `sqlite_sql_select({ sql: "SELECT MIN(transaction_date), MAX(transaction_date) FROM silver_account_statements" })`

#### SQLite Query Errors
- Only SELECT/WITH queries allowed
- Use parameters (`params` array) for values
- Check table/column names with `sqlite_table_info`

### Rebuilding After Changes
After making code changes:
```bash
npm run build  # Rebuilds dist/index.js used by Claude Desktop
```
Then restart Claude Desktop to load the updated version.

## 🎯 Summary for Annual Reports

**ALWAYS use these Gold views for financial analysis:**
- `gold_income_summary_by_year` for annual P&L summary
- `gold_balance_summary_by_year` for annual balance sheet summary  
- `gold_income_statement_by_year` for detailed P&L by account
- `gold_balance_sheet_by_year` for detailed balance sheet by account
- `gold_monthly_pl_trend` for monthly trends

**NEVER write manual CASE statements or hardcode account ranges!**

Remember: The Gold views handle all the complex accounting logic, account type mappings, and proper debit/credit calculations. They provide clean, accurate financial data ready for analysis and reporting.