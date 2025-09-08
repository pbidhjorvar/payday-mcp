# Payday MCP Server - Tool Usage Instructions

You have access to a comprehensive set of tools for interacting with the Payday accounting API. Below are detailed instructions for using each tool effectively.

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
- `payday_get_invoices` - List invoices with filtering options
- `payday_get_invoice` - Get single invoice with details (accepts invoice number or UUID)
- `payday_update_invoice` - Update invoices (mark as paid, cancel, resend, etc.)

### 👥 **Customers**
- `payday_get_customers` - List customers with search
- `payday_get_customer` - Get individual customer details

### 💸 **Expenses & Payments**
- `payday_get_expenses` - List expenses with filtering
- `payday_get_expense_accounts` - Get expense account types
- `payday_get_expense_payment_types` - Get payment types for expenses
- `payday_get_payments` - List payment records

### 📋 **Sales Orders**
- `payday_get_salesorders` - List sales orders

### 🔍 **System Tools**
- `payday_healthcheck` - Check API connectivity
- `payday_rate_limit_status` - Check current rate limit status

### 📊 **DuckDB SQL Analytics** (Local Database)
- `duckdb_list_objects` - Discover available tables and views in the local warehouse
- `duckdb_table_info` - Get column information for specific tables
- `duckdb_explain` - Get query execution plans for debugging
- `duckdb_sql_select` - Execute SELECT queries against local financial data

## Key Usage Guidelines

### Date Formats
Always use **YYYY-MM-DD** format for dates:
- ✅ `"2024-01-01"`
- ❌ `"01/01/2024"` or `"January 1, 2024"`

### Account Statement Requirements
The account statement tool requires **either**:
- Both `dateFrom` AND `dateTo` (journal dates), OR
- Both `createdFrom` AND `createdTo` (creation dates)

**Example:**
```
Get account statement for 2024: dateFrom="2024-01-01", dateTo="2024-12-31"
```

### Invoice Operations
When working with invoices, you can use either:
- Invoice numbers (e.g., `"1165"`) - automatically converted to UUIDs
- Invoice UUIDs directly

**Common invoice operations:**
- Mark as paid: `mode="mark_as_paid"`, include `paidDate` and `paymentType`
- Cancel invoice: `mode="cancel_invoice"`
- Resend email: `mode="resend_email"`

### Journal Entry Requirements
Each journal line must have **exactly one** of:
- `ledgerAccountId` (ledger account entry)
- `customerId` (customer/debtor entry)  
- `creditorId` (creditor entry)

### DuckDB SQL Analytics
The local DuckDB warehouse contains processed financial data in a medallion architecture:

**Available Schemas:**
- `gold.*` - Business-ready views (KPIs, P&L, Balance Sheet)
- `silver.*` - Cleaned, typed transaction data
- `dim.*` - Dimension tables (account groupings)

**Key Tables & Views:**
- `gold.v_kpi_month` - Monthly KPIs (revenue, margins, EBITDA)
- `gold.v_pl_month` - Profit & Loss by account group
- `gold.fact_txn` - All transactions with business classifications
- `gold.dim_account` - Chart of accounts with reporting groups
- `silver.transactions` - Raw transaction data
- `silver.accounts` - Account master data

**SQL Constraints:**
- **READ-ONLY**: Only SELECT and CTE queries allowed
- **Row limits**: 5000 rows by default (override with `max_rows` or LIMIT)
- **Output formats**: JSON (default), CSV, or Markdown
- **Schema restrictions**: Only approved schemas accessible

**Usage Pattern:**
1. **Discover**: `duckdb_list_objects()` to see available tables
2. **Inspect**: `duckdb_table_info({ schema: "gold", table: "v_kpi_month" })`
3. **Query**: `duckdb_sql_select({ sql: "SELECT...", format: "markdown" })`

### Pagination Handling
- **Account Statement**: Automatically fetches ALL pages (complete dataset)
- **Other tools**: Return first page with pagination metadata
- Most tools default to 50 items per page (max varies by endpoint)

### Filtering & Search
Many tools support filtering:
- **Invoices**: Filter by status, date range, customer
- **Expenses**: Filter by date range, search query
- **Customers**: Search by name/query
- **Account Statement**: Filter by account code, type, sub-type

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

Common error scenarios:
- Missing required date parameters
- Invalid date formats
- Invoice not found
- Read-only mode restrictions (for write operations)

## Best Practices

1. **Start with company info** to understand the business context
2. **Use account statement** for comprehensive financial analysis (it fetches everything automatically)
3. **Combine tools** for complete workflows (e.g., get customer → get their invoices → update invoice status)
4. **Check payment types** before marking invoices as paid
5. **Use appropriate date ranges** to avoid timeout issues with large datasets

## Example Workflows

### Complete Invoice Analysis
1. `payday_get_customers` - Find customer
2. `payday_get_invoices` with `customer_id` filter
3. `payday_get_invoice` with `include=["lines"]` for details
4. `payday_update_invoice` to mark as paid if needed

### Financial Reporting
1. `payday_get_account_statement` with date range (gets complete data)
2. `payday_get_journal_entries` for journal analysis
3. `payday_get_accounts` for account structure

### Expense Management
1. `payday_get_expense_accounts` and `payday_get_expense_payment_types`
2. `payday_get_expenses` with filters
3. `payday_create_journal_entry` for adjustments

### SQL Analytics Workflow
1. **Discover available data:**
   ```
   duckdb_list_objects({ schema: "gold" })
   ```

2. **Get KPI overview:**
   ```
   duckdb_sql_select({ 
     sql: "SELECT month, revenue, gross_profit, ebitda, net_income FROM gold.v_kpi_month ORDER BY month DESC LIMIT 12",
     format: "markdown"
   })
   ```

3. **Analyze revenue trends:**
   ```
   duckdb_sql_select({ 
     sql: "SELECT month, report_group, SUM(signed_amount) as amount FROM gold.fact_txn WHERE statement='PL' AND month >= '2024-01-01' GROUP BY 1,2 ORDER BY 1,2"
   })
   ```

4. **Account analysis:**
   ```
   duckdb_table_info({ schema: "gold", table: "dim_account" })
   duckdb_sql_select({ 
     sql: "SELECT account_name, report_group, pl_total FROM gold.v_account_detail WHERE pl_total != 0 ORDER BY ABS(pl_total) DESC"
   })
   ```

Remember: The tools automatically handle authentication, pagination (where appropriate), and provide rich metadata about API calls including duration and item counts. Use DuckDB SQL tools for complex analysis and reporting on historical financial data.