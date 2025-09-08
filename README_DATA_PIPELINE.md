# Data Pipeline & Analytics

This document describes the local data pipeline and SQL query capabilities for the Payday MCP project.

## Architecture Overview

The project uses a **Medallion Architecture** (Bronze → Silver → Gold) with DuckDB as the local analytical warehouse:

```
Bronze (Raw Data)     → Silver (Cleaned Data)    → Gold (Business Views)
├─ data/bronze/       → ├─ silver.accounts       → ├─ gold.v_kpi_month
│  └─ payday/         → ├─ silver.transactions   → ├─ gold.v_pl_month  
│     ├─ accounts/    → └─ QC views              → ├─ gold.fact_txn
│     ├─ txns/        →                          → └─ gold.dim_account
│     └─ ...*.jsonl   →                          →
```

## Data Pipeline Commands

### 1. Bronze Layer (Data Ingestion)
```bash
# Fetch all Payday data via MCP tools
python scripts/bronze_fetch_full.py

# Fetches: accounts, transactions, customers, company, invoices, expenses
# Output: JSONL files in data/bronze/payday/
```

### 2. Silver Layer (Data Processing)  
```bash
# Build typed, deduplicated tables
python scripts/silver_build.ps1

# Creates: silver.accounts, silver.transactions + QC views
# Reads from: Bronze JSONL files
# Writes to: duckdb/finance.duckdb
```

### 3. Gold Layer (Business Intelligence)
```bash
# Build business views and KPIs
python scripts/gold_build.ps1

# Creates: KPI views, P&L, Balance Sheet, account groupings
# Reads from: Silver tables  
# Writes to: gold.* views + Parquet exports
```

### 4. Sequential Pipeline
```bash
# Run complete Bronze → Silver → Gold pipeline
python scripts/build_pipeline.py
```

## MCP: DuckDB SQL (Read-only)

For AI-driven ad-hoc querying of local warehouse.

### Available Tools

- **`duckdb_list_objects({ schema? })`** → discover tables/views
- **`duckdb_table_info({ schema, table })`** → columns/types  
- **`duckdb_explain({ sql })`** → logical plan (debug)
- **`duckdb_sql_select({ sql, params?, max_rows?, format? })`** → run SELECT/CTE (JSON/CSV/Markdown)

### Constraints

- **Read-only DB, SELECT/CTE only**, single statement
- DDL/DML/PRAGMA/SET/etc. are blocked  
- Default row cap: 5000 (override with `max_rows` or explicit LIMIT)
- Allowed schemas: `gold`, `silver`, `dim`, `main`

### Usage Tips

- **Prefer `gold.*` for reporting** (e.g., `gold.v_kpi_month`, `gold.v_pl_month`, `gold.fact_txn`, `gold.dim_account`)
- **Use schema-qualified names**: `gold.fact_txn`, `dim.calendar`
- **Start with introspection**: Use `duckdb_list_objects()` to discover available tables

### SQL Examples

#### Revenue last month
```sql
SELECT month, SUM(CASE WHEN report_group='Revenue' THEN -1*amount_native ELSE 0 END) AS revenue
FROM gold.fact_txn
WHERE month = date_trunc('month', current_date) - INTERVAL 1 MONTH
GROUP BY 1
```

#### Income statement month by month (last 12)
```sql
SELECT month, revenue, gross_profit, ebitda, ebit, net_income
FROM gold.v_kpi_month
WHERE month >= date_trunc('month', current_date) - INTERVAL 11 MONTH
ORDER BY month
```

#### Assets ending status last year
```sql
SELECT month, report_subgroup, SUM(sign*amount_native) AS balance
FROM gold.fact_txn
WHERE statement='BS' AND report_group='Assets'
  AND strftime(month, '%Y') = strftime(date_trunc('year', current_date) - INTERVAL 1 YEAR, '%Y')
GROUP BY 1,2 ORDER BY 1,2
```

#### Discover available tables
```sql
-- Use the duckdb_list_objects tool instead, but equivalent SQL:
SELECT table_schema AS schema, table_name AS name, table_type AS type
FROM information_schema.tables
WHERE table_schema IN ('gold', 'silver', 'dim', 'main')
ORDER BY table_schema, table_type, table_name
```

## Gold Layer Views Reference

### Core Financial Statements
- **`gold.v_kpi_month`** - Monthly KPI summary (revenue, GP, EBITDA, margins)
- **`gold.v_pl_month`** - Detailed P&L by account group
- **`gold.v_bs_month`** - Balance sheet positions by account group  
- **`gold.v_trial_balance_month`** - Trial balance (all accounts)

### Analysis Views
- **`gold.v_account_detail`** - Account-level transaction summaries
- **`gold.v_monthly_summary`** - High-level monthly totals
- **`gold.fact_txn`** - Enhanced transaction facts with business groupings
- **`gold.dim_account`** - Account master with reporting classifications

## Configuration

### Account Groupings (`config/account_groups.csv`)
Maps Payday account types to standard reporting groups:

```csv
acct_type,acct_subtype,report_group,report_subgroup,statement,sign
Tekjur,Tekjur,Revenue,Operating Revenue,PL,-1
Gjöld,Laun og launatengd gjöld,OPEX,Payroll,PL,1
```

**Key Fields:**
- `statement`: PL (Profit & Loss) or BS (Balance Sheet)
- `sign`: +1 or -1 for reporting convention (expenses positive, revenue negative)

## Data Export

### Export KPIs for AI Analysis
```bash
python scripts/export_json.py --view gold.v_kpi_month --limit 12
```

### Export P&L for Specific Period  
```bash
python scripts/export_json.py --view gold.v_pl_month --where "month >= '2024-01-01'"
```

### Export Account Analysis
```bash
python scripts/export_json.py --view gold.v_account_detail --where "is_active = true" --order "pl_total DESC"
```

## Security & Safety

- **Read-only database access** - SQL tools cannot modify data
- **Query validation** - Only SELECT and CTE statements allowed
- **Schema restrictions** - Limited to approved schemas only
- **Row limits** - Automatic LIMIT application to prevent large result sets
- **Connection management** - Proper cleanup to prevent file locks

## Troubleshooting

### DuckDB File Locks
If you encounter "file is being used by another process":
1. Ensure all Python scripts use `finally: con.close()`
2. Run pipeline steps sequentially, not in parallel
3. Use `:memory:` database for testing: `con = duckdb.connect(':memory:')`

### Missing Data
If pipeline shows empty results:
1. Check Bronze data exists: `ls data/bronze/payday/*.jsonl`
2. Run Bronze fetch: `python scripts/bronze_fetch_full.py`
3. Verify MCP bridge is working: `node scripts/mcp_bridge.js payday_get_accounts`

### SQL Query Issues
Use the `duckdb_explain` tool to debug query plans and identify performance issues or syntax errors.