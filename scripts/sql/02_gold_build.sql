ATTACH 'duckdb/finance.duckdb' (READ_ONLY FALSE);

CREATE SCHEMA IF NOT EXISTS gold;
CREATE SCHEMA IF NOT EXISTS dim;

-- === Load mapping (CSV) ===
CREATE OR REPLACE TABLE dim.account_groups AS
SELECT * FROM read_csv_auto('config/account_groups.csv');

-- === Conform accounts to groups ===
CREATE OR REPLACE TABLE gold.dim_account AS
WITH a AS (
  SELECT account_id, account_code, account_name, acct_type, acct_subtype, is_active
  FROM silver.accounts
)
SELECT
  a.*,
  COALESCE(m.report_group, a.acct_type)       AS report_group,
  COALESCE(m.report_subgroup, a.acct_subtype) AS report_subgroup,
  COALESCE(m.statement, 'UNKNOWN')            AS statement,
  COALESCE(CAST(m.sign AS INT), 1)            AS sign
FROM a
LEFT JOIN dim.account_groups m
  ON lower(m.acct_type) = lower(a.acct_type)
 AND COALESCE(lower(m.acct_subtype),'') = COALESCE(lower(a.acct_subtype),'');

-- === Conform transactions ===
-- Maps silver.transactions to gold with account groupings
CREATE OR REPLACE TABLE gold.fact_txn AS
SELECT
  t.txn_id,
  t.txn_date,
  date_trunc('month', t.txn_date)::DATE AS month,
  t.account_code,
  a.account_name,
  a.report_group,
  a.report_subgroup,
  a.statement,
  a.sign,
  t.currency,
  CAST(t.amount_native AS DECIMAL(18,4)) AS amount_native,
  CAST(t.running_balance AS DECIMAL(18,4)) AS running_balance,
  -- Apply sign convention for reporting
  (CAST(t.amount_native AS DECIMAL(18,4)) * a.sign) AS signed_amount,
  t.description,
  t.voucher,
  t.entry_id
FROM silver.transactions t
LEFT JOIN gold.dim_account a ON a.account_code = t.account_code;

-- === P&L (monthly) ===
CREATE OR REPLACE VIEW gold.v_pl_month AS
SELECT
  month,
  currency,
  report_group,
  report_subgroup,
  SUM(signed_amount) AS net_amount,
  COUNT(*) AS transaction_count
FROM gold.fact_txn
WHERE statement = 'PL'
GROUP BY 1,2,3,4
ORDER BY 1,2,3,4;

-- === Trial Balance (monthly) ===
CREATE OR REPLACE VIEW gold.v_trial_balance_month AS
SELECT
  month,
  currency,
  report_group,
  report_subgroup,
  statement,
  SUM(signed_amount) AS balance,
  COUNT(*) AS transaction_count
FROM gold.fact_txn
GROUP BY 1,2,3,4,5
ORDER BY 1,2,3,4,5;

-- === Balance Sheet (period-end snapshot) ===
-- Uses cumulative amounts through each month
CREATE OR REPLACE VIEW gold.v_bs_month AS
SELECT
  month,
  currency,
  report_group,
  report_subgroup,
  SUM(signed_amount) AS balance,
  COUNT(*) AS transaction_count
FROM gold.fact_txn
WHERE statement = 'BS'
GROUP BY 1,2,3,4
ORDER BY 1,2,3,4;

-- === Simple KPI view (monthly) ===
CREATE OR REPLACE VIEW gold.v_kpi_month AS
WITH pl AS (
  SELECT 
    month, 
    currency,
    SUM(CASE WHEN report_group='Revenue' THEN signed_amount ELSE 0 END) AS revenue,
    SUM(CASE WHEN report_group='COGS' THEN signed_amount ELSE 0 END) AS cogs,
    SUM(CASE WHEN report_group='OPEX' THEN signed_amount ELSE 0 END) AS opex,
    SUM(CASE WHEN report_group='Finance Costs' THEN signed_amount ELSE 0 END) AS fin_costs,
    SUM(CASE WHEN report_group='Tax' THEN signed_amount ELSE 0 END) AS tax
  FROM gold.fact_txn
  WHERE statement='PL'
  GROUP BY 1,2
)
SELECT
  month,
  currency,
  revenue,
  (revenue - cogs) AS gross_profit,
  (revenue - cogs - opex) AS ebitda,
  (revenue - cogs - opex - fin_costs) AS ebit,
  (revenue - cogs - opex - fin_costs - tax) AS net_income,
  CASE WHEN revenue <> 0 THEN ROUND((revenue - cogs) / revenue * 100, 2) ELSE 0 END AS gross_margin_pct,
  CASE WHEN revenue <> 0 THEN ROUND(ebitda / revenue * 100, 2) ELSE 0 END AS ebitda_margin_pct
FROM pl
ORDER BY 1,2;

-- === Account detail view (for drill-down) ===
CREATE OR REPLACE VIEW gold.v_account_detail AS
SELECT
  account_code,
  account_name,
  acct_type,
  acct_subtype,
  report_group,
  report_subgroup,
  statement,
  sign,
  is_active,
  COUNT(CASE WHEN statement = 'PL' THEN 1 END) AS pl_txn_count,
  COUNT(CASE WHEN statement = 'BS' THEN 1 END) AS bs_txn_count,
  SUM(CASE WHEN statement = 'PL' THEN signed_amount ELSE 0 END) AS pl_total,
  SUM(CASE WHEN statement = 'BS' THEN signed_amount ELSE 0 END) AS bs_balance
FROM gold.fact_txn f
RIGHT JOIN gold.dim_account a ON a.account_code = f.account_code
GROUP BY 1,2,3,4,5,6,7,8,9
ORDER BY report_group, report_subgroup, account_code;

-- === Monthly summary (all statements) ===
CREATE OR REPLACE VIEW gold.v_monthly_summary AS
SELECT
  month,
  currency,
  SUM(CASE WHEN statement='PL' AND report_group='Revenue' THEN signed_amount ELSE 0 END) AS total_revenue,
  SUM(CASE WHEN statement='PL' AND report_group IN ('COGS','OPEX','Finance Costs','Tax') THEN signed_amount ELSE 0 END) AS total_expenses,
  SUM(CASE WHEN statement='BS' AND report_group='Assets' THEN signed_amount ELSE 0 END) AS total_assets,
  SUM(CASE WHEN statement='BS' AND report_group='Liabilities' THEN signed_amount ELSE 0 END) AS total_liabilities,
  COUNT(DISTINCT account_code) AS active_accounts,
  COUNT(*) AS total_transactions
FROM gold.fact_txn
GROUP BY 1,2
ORDER BY 1,2;

-- === Optional: export GOLD to Parquet for other tools ===
-- Create output directory first
COPY (SELECT * FROM gold.dim_account)
TO 'data/gold/dim_account.parquet' (FORMAT PARQUET);

COPY (SELECT * FROM gold.fact_txn)
TO 'data/gold/fact_txn.parquet' (FORMAT PARQUET);

COPY (SELECT * FROM gold.v_pl_month)
TO 'data/gold/v_pl_month.parquet' (FORMAT PARQUET);

COPY (SELECT * FROM gold.v_bs_month)
TO 'data/gold/v_bs_month.parquet' (FORMAT PARQUET);

COPY (SELECT * FROM gold.v_kpi_month)
TO 'data/gold/v_kpi_month.parquet' (FORMAT PARQUET);