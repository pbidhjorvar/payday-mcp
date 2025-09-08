# Gold Layer Usage Guide

The Gold layer provides business-ready financial analytics on top of the Silver layer data.

## Quick Start

1. **Build Gold Layer**:
   ```powershell
   pwsh scripts/gold_build.ps1
   ```

2. **Export KPIs for AI Analysis**:
   ```bash
   python scripts/export_json.py --view gold.v_kpi_month --limit 12
   ```

3. **Export P&L for Specific Period**:
   ```bash
   python scripts/export_json.py --view gold.v_pl_month --where "month >= '2024-01-01'"
   ```

## Available Views

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

### Customization

Edit `config/account_groups.csv` to:
- Add new account type mappings
- Adjust reporting group classifications
- Modify sign conventions
- Create custom reporting hierarchies

## Export Examples

### Last 6 Months KPIs
```bash
python scripts/export_json.py \
  --view gold.v_kpi_month \
  --where "month >= current_date - interval '6 months'" \
  --out kpi_6m.json
```

### Detailed P&L for Quarter
```bash
python scripts/export_json.py \
  --view gold.v_pl_month \
  --where "month BETWEEN '2024-01-01' AND '2024-03-31'" \
  --out pl_q1_2024.json
```

### Account Analysis
```bash
python scripts/export_json.py \
  --view gold.v_account_detail \
  --where "is_active = true" \
  --order "pl_total DESC" \
  --out account_analysis.json
```

## Key Metrics Available

### KPI View (`gold.v_kpi_month`)
- `revenue` - Total revenue
- `gross_profit` - Revenue - COGS
- `ebitda` - Earnings before interest, taxes, depreciation
- `ebit` - Earnings before interest and taxes
- `net_income` - Bottom line profit
- `gross_margin_pct` - Gross profit / revenue %
- `ebitda_margin_pct` - EBITDA / revenue %

### Monthly Summary (`gold.v_monthly_summary`)
- `total_revenue` - All revenue accounts
- `total_expenses` - All expense accounts  
- `total_assets` - Asset account balances
- `total_liabilities` - Liability account balances
- `active_accounts` - Number of accounts with activity
- `total_transactions` - Transaction count

## Data Quality

The Gold layer includes automatic data validation:
- Ensures all transactions map to valid accounts
- Applies consistent sign conventions
- Handles currency conversions (extensible)
- Maintains full transaction lineage

## Integration

**For AI/Analytics:**
- Export views as JSON for Claude/ChatGPT analysis
- Use Parquet exports for external BI tools
- Query DuckDB directly for real-time analysis

**For Reporting:**
- Monthly KPI dashboards
- Financial statement generation  
- Variance analysis
- Account reconciliation