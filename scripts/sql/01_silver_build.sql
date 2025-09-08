-- Attach local warehouse
ATTACH 'duckdb/finance.duckdb' (READ_ONLY FALSE);

-- Ensure schemas
CREATE SCHEMA IF NOT EXISTS bronze;
CREATE SCHEMA IF NOT EXISTS silver;
CREATE SCHEMA IF NOT EXISTS dim;

-- === Bronze views (read JSONL directly) ===
-- Uses latest snapshot files for each resource
CREATE OR REPLACE VIEW bronze.accounts AS
SELECT * FROM read_json_auto('data/bronze/payday/accounts/*.jsonl');

CREATE OR REPLACE VIEW bronze.account_statement AS
SELECT * FROM read_json_auto('data/bronze/payday/account-statement/*.jsonl');

-- === Dimensions (Calendar) ===
CREATE OR REPLACE TABLE dim.calendar AS
WITH d AS (
  SELECT * FROM range(date '2018-01-01', date '2040-12-31', interval 1 day) AS t(d)
)
SELECT
  d AS date,
  date_trunc('month', d)::DATE AS month,
  EXTRACT(YEAR FROM d)::INT AS year,
  EXTRACT(MONTH FROM d)::INT AS month_num,
  strftime(d, '%Y-%m') AS ym
FROM d;

-- ===============================
-- SILVER: ACCOUNTS (typed + dedup)
-- ===============================
-- Maps to actual Payday API fields: id, code, name, type, subType, archived, etc.
CREATE OR REPLACE TABLE silver.accounts AS
WITH base AS (
  SELECT
    CAST(id AS VARCHAR)                           AS account_id,
    CAST(code AS VARCHAR)                         AS account_code,
    CAST(name AS VARCHAR)                         AS account_name,
    CAST(type AS VARCHAR)                         AS acct_type,
    CAST(subType AS VARCHAR)                      AS acct_subtype,
    CAST(NOT COALESCE(archived, false) AS BOOLEAN) AS is_active,
    CAST(taxkey AS INTEGER)                       AS tax_key,
    CAST(defaultVatPercentType AS VARCHAR)        AS vat_type,
    CAST(_ingested_at_utc AS TIMESTAMP)           AS ingested_at_utc
  FROM bronze.accounts
),
dedup AS (
  SELECT
    *,
    ROW_NUMBER() OVER (PARTITION BY account_id ORDER BY ingested_at_utc DESC) AS rn
  FROM base
)
SELECT
  account_id, account_code, account_name, acct_type, acct_subtype, 
  is_active, tax_key, vat_type, ingested_at_utc
FROM dedup
WHERE rn = 1;

-- Index-ish helpers
CREATE INDEX IF NOT EXISTS idx_silver_accounts_id ON silver.accounts(account_id);
CREATE INDEX IF NOT EXISTS idx_silver_accounts_code ON silver.accounts(account_code);

-- ===================================
-- SILVER: TRANSACTIONS (typed + dedup)
-- ===================================
-- Maps to actual account-statement fields: id, date, amount, accountCode, description, etc.
CREATE OR REPLACE TABLE silver.transactions AS
WITH base AS (
  SELECT
    CAST(id AS VARCHAR)                           AS txn_id,
    CAST(date AS DATE)                            AS txn_date,
    CAST(accountCode AS VARCHAR)                  AS account_code,
    CAST(accountName AS VARCHAR)                  AS account_name,
    CAST(currency AS VARCHAR)                     AS currency,
    CAST(amount AS DECIMAL(18,4))                 AS amount_native,
    CAST(balance AS DECIMAL(18,4))                AS running_balance,
    CAST(description AS VARCHAR)                  AS description,
    CAST(voucher AS VARCHAR)                      AS voucher,
    CAST(reference AS VARCHAR)                    AS reference,
    CAST(entryId AS VARCHAR)                      AS entry_id,
    CAST(created AS TIMESTAMP)                    AS created_at,
    CAST(closeFiscalYear AS BOOLEAN)              AS close_fiscal_year,
    CAST(_ingested_at_utc AS TIMESTAMP)           AS ingested_at_utc
  FROM bronze.account_statement
  WHERE date IS NOT NULL
),
dedup AS (
  -- Keep latest record per txn_id
  SELECT
    *,
    ROW_NUMBER() OVER (PARTITION BY txn_id ORDER BY ingested_at_utc DESC) AS rn
  FROM base
)
SELECT
  txn_id, txn_date, account_code, account_name, currency,
  amount_native, running_balance, description, voucher, reference,
  entry_id, created_at, close_fiscal_year, ingested_at_utc
FROM dedup
WHERE rn = 1;

CREATE INDEX IF NOT EXISTS idx_silver_txn_date ON silver.transactions(txn_date);
CREATE INDEX IF NOT EXISTS idx_silver_txn_account ON silver.transactions(account_code);
CREATE INDEX IF NOT EXISTS idx_silver_txn_currency ON silver.transactions(currency);
CREATE INDEX IF NOT EXISTS idx_silver_txn_entry ON silver.transactions(entry_id);

-- =================
-- QUICK QC CHECKS
-- =================
-- 1) Orphans: transactions referencing missing accounts
CREATE OR REPLACE VIEW silver.qc_orphan_txn_accounts AS
SELECT t.txn_id, t.account_code, t.account_name
FROM silver.transactions t
LEFT JOIN silver.accounts a ON a.account_code = t.account_code
WHERE a.account_code IS NULL;

-- 2) Transactions with missing critical fields
CREATE OR REPLACE VIEW silver.qc_missing_fields AS
SELECT 
  txn_id, txn_date, account_code,
  CASE 
    WHEN account_code IS NULL THEN 'missing_account_code'
    WHEN description IS NULL OR description = '' THEN 'missing_description'
    WHEN voucher IS NULL OR voucher = '' THEN 'missing_voucher'
    ELSE 'other'
  END AS issue_type
FROM silver.transactions
WHERE account_code IS NULL 
   OR description IS NULL OR description = ''
   OR voucher IS NULL OR voucher = '';

-- 3) Basic monthly roll-up snapshot (for eyeballing totals)
CREATE OR REPLACE VIEW silver.v_txn_monthly AS
SELECT
  c.month,
  c.ym,
  t.currency,
  t.account_code,
  a.acct_type,
  SUM(t.amount_native) AS amount_native_sum,
  COUNT(*) AS txn_count
FROM silver.transactions t
JOIN dim.calendar c ON c.date = t.txn_date
LEFT JOIN silver.accounts a ON a.account_code = t.account_code
GROUP BY 1,2,3,4,5
ORDER BY 1,3,4;

-- 4) Account type summary
CREATE OR REPLACE VIEW silver.v_account_summary AS
SELECT
  acct_type,
  acct_subtype,
  vat_type,
  COUNT(*) AS account_count,
  COUNT(CASE WHEN is_active THEN 1 END) AS active_count
FROM silver.accounts
GROUP BY 1,2,3
ORDER BY 1,2,3;