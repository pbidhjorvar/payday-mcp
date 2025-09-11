# 🔥 SQL Query Examples for Claude Desktop

This guide shows exactly how to use parameters and write effective queries against the Payday financial database.

## 🎯 Key Database Tables

### Silver Layer (Clean Transaction Data)
- `silver_account_statements` - All financial transactions (2022-2023)
- `dim_accounts` - Chart of accounts master data

### Gold Layer (Pre-built Analytics)
- `gold_account_summary` - Account totals and activity summary
- `gold_monthly_pl` - Monthly profit & loss breakdown
- `gold_balance_sheet` - Balance sheet positions
- `gold_account_detail` - Enhanced account information

## 🚀 Parameter Usage Examples

### ✅ CORRECT - Using Parameters
```sql
-- Monthly revenue for specific year
{
  "sql": "SELECT strftime('%Y-%m', transaction_date) as month, SUM(credit - debit) as net_revenue FROM silver_account_statements WHERE transaction_date >= ? AND transaction_date < ? AND account_type = ? GROUP BY month ORDER BY month",
  "params": ["2023-01-01", "2024-01-01", "Tekjur"]
}

-- Account transactions in date range
{
  "sql": "SELECT transaction_date, description, amount, balance FROM silver_account_statements WHERE account_code = ? AND transaction_date BETWEEN ? AND ? ORDER BY transaction_date DESC LIMIT ?",
  "params": ["3200", "2023-01-01", "2023-12-31", 50]
}

-- Top expenses by category
{
  "sql": "SELECT account_name, SUM(debit) as total FROM silver_account_statements WHERE account_type = ? AND transaction_date LIKE ? GROUP BY account_name ORDER BY total DESC LIMIT ?",
  "params": ["Gjöld", "2023%", 10]
}
```

### ❌ WRONG - Direct String Concatenation
```sql
-- DON'T DO THIS - Security risk and error-prone
"SELECT * FROM silver_account_statements WHERE account_code = '3200'"
```

## 📊 Business Analysis Examples

### Revenue Analysis
```sql
-- Quarterly revenue comparison
{
  "sql": "SELECT strftime('%Y-Q%q', transaction_date) as quarter, SUM(credit - debit) as revenue FROM silver_account_statements WHERE account_type = ? AND transaction_date >= ? GROUP BY quarter ORDER BY quarter",
  "params": ["Tekjur", "2022-01-01"]
}

-- Monthly revenue trend
{
  "sql": "SELECT month, SUM(revenue) as total_revenue FROM gold_monthly_pl WHERE month >= ? GROUP BY month ORDER BY month",
  "params": ["2023-01"]
}
```

### Expense Analysis
```sql
-- Largest expenses by month
{
  "sql": "SELECT strftime('%Y-%m', transaction_date) as month, account_name, SUM(debit) as expense FROM silver_account_statements WHERE account_type = ? AND transaction_date >= ? GROUP BY month, account_name HAVING expense > ? ORDER BY month, expense DESC",
  "params": ["Gjöld", "2023-01-01", 100000]
}

-- Expense categories breakdown
{
  "sql": "SELECT account_subtype, SUM(expenses) as total FROM gold_monthly_pl WHERE month BETWEEN ? AND ? GROUP BY account_subtype ORDER BY total DESC",
  "params": ["2023-01", "2023-12"]
}
```

### Account Analysis
```sql
-- Account activity summary
{
  "sql": "SELECT account_name, transaction_count, total_debit, total_credit, net_change FROM gold_account_summary WHERE transaction_count > ? ORDER BY ABS(net_change) DESC",
  "params": [10]
}

-- Account balance over time
{
  "sql": "SELECT transaction_date, balance FROM silver_account_statements WHERE account_code = ? AND transaction_date >= ? ORDER BY transaction_date",
  "params": ["3200", "2023-01-01"]
}
```

### Cash Flow Analysis
```sql
-- Daily cash flow
{
  "sql": "SELECT transaction_date, SUM(credit - debit) as daily_net FROM silver_account_statements WHERE account_code = ? AND transaction_date BETWEEN ? AND ? GROUP BY transaction_date ORDER BY transaction_date",
  "params": ["3200", "2023-01-01", "2023-12-31"]
}

-- Monthly cash position
{
  "sql": "SELECT strftime('%Y-%m', transaction_date) as month, AVG(balance) as avg_balance, MAX(balance) as max_balance, MIN(balance) as min_balance FROM silver_account_statements WHERE account_code = ? GROUP BY month ORDER BY month",
  "params": ["3200"]
}
```

## 🏆 Gold Layer Quick Queries

### Pre-built Analytics (No Parameters Needed)
```sql
-- All account summaries
{
  "sql": "SELECT * FROM gold_account_summary ORDER BY ABS(net_change) DESC LIMIT 20"
}

-- Monthly P&L overview
{
  "sql": "SELECT month, SUM(revenue) as revenue, SUM(expenses) as expenses, SUM(revenue - expenses) as net FROM gold_monthly_pl GROUP BY month ORDER BY month"
}

-- Balance sheet summary
{
  "sql": "SELECT account_type, SUM(balance) as total_balance FROM gold_balance_sheet GROUP BY account_type ORDER BY total_balance DESC"
}
```

## ⚡ Performance Tips

1. **Always use date filters**: `WHERE transaction_date >= '2023-01-01'`
2. **Use LIMIT**: `LIMIT 100` for large result sets
3. **Use indexes**: Queries on `transaction_date`, `account_code` are fast
4. **Prefer Gold views**: Pre-calculated for common analyses
5. **Use parameters**: Always use `?` placeholders and `params` array

## 🔍 Data Exploration Workflow

1. **List tables**: `sqlite_list_objects` with `{"prefix": "gold_"}`
2. **Examine structure**: `sqlite_table_info` with `{"table": "gold_account_summary"}`
3. **Query data**: `sqlite_sql_select` with proper parameters
4. **Format output**: Use `{"format": "markdown"}` for readable results

## 📈 Common Account Types in Database

- **Tekjur** - Revenue accounts
- **Gjöld** - Expense accounts  
- **Eignir** - Asset accounts
- **Skuldir** - Liability accounts
- **Eigið fé** - Equity accounts

Use these in `account_type` filters for P&L and Balance Sheet analysis.