Write-Host "== Silver build (DuckDB) =="

# Ensure duckdb directory exists
if (-Not (Test-Path "duckdb")) { 
    New-Item -ItemType Directory -Path "duckdb" | Out-Null 
}

# Check if Python has duckdb available
Write-Host "[INFO] Checking DuckDB installation..."
$duckdbCheck = python -c "import duckdb; print('DuckDB available')" 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] DuckDB not available. Please install with: pip install duckdb"
    Write-Host "If installation fails due to permissions, try running as administrator."
    exit 1
}

Write-Host $duckdbCheck

# Run Silver SQL transformation  
Write-Host "[INFO] Building Silver layer..."
python - << 'PYCODE'
import duckdb, pathlib, sys

try:
    # Read SQL file
    sql_path = pathlib.Path('scripts/sql/01_silver_build.sql')
    if not sql_path.exists():
        print(f"[ERROR] SQL file not found: {sql_path}")
        sys.exit(1)
    
    sql = sql_path.read_text(encoding='utf-8')
    
    # Connect to DuckDB and execute
    print("[INFO] Connecting to DuckDB and building Silver layer...")
    con = duckdb.connect('duckdb/finance.duckdb')
    con.execute(sql)
    
    # Print record counts
    print("\n=== SILVER LAYER SUMMARY ===")
    accounts_count = con.execute("SELECT COUNT(*) FROM silver.accounts").fetchone()[0]
    txn_count = con.execute("SELECT COUNT(*) FROM silver.transactions").fetchone()[0]
    
    print(f"Accounts: {accounts_count:,} records")
    print(f"Transactions: {txn_count:,} records")
    
    # Print QC results
    print("\n=== QUALITY CHECKS ===")
    qc1 = con.execute("SELECT COUNT(*) FROM silver.qc_orphan_txn_accounts").fetchone()[0]
    qc2 = con.execute("SELECT COUNT(*) FROM silver.qc_missing_fields").fetchone()[0]
    
    print(f"Orphan txn→account rows: {qc1}")
    print(f"Missing critical fields: {qc2}")
    
    if qc1 > 0:
        print("\n[WARN] Found orphan transactions - checking samples:")
        orphans = con.execute("SELECT * FROM silver.qc_orphan_txn_accounts LIMIT 5").fetchall()
        for row in orphans:
            print(f"  Txn {row[0]}: account_code={row[1]}, account_name={row[2]}")
    
    if qc2 > 0:
        print("\n[WARN] Found transactions with missing fields:")
        missing = con.execute("SELECT issue_type, COUNT(*) FROM silver.qc_missing_fields GROUP BY 1").fetchall()
        for row in missing:
            print(f"  {row[0]}: {row[1]} transactions")
    
    # Show account type summary
    print("\n=== ACCOUNT TYPES ===")
    acct_summary = con.execute("SELECT * FROM silver.v_account_summary ORDER BY account_count DESC").fetchall()
    for row in acct_summary:
        print(f"  {row[0]} | {row[1]} | {row[2]}: {row[3]} total, {row[4]} active")
    
    # Show transaction date range
    print("\n=== TRANSACTION DATE RANGE ===")
    date_range = con.execute("""
        SELECT 
            MIN(txn_date) as earliest,
            MAX(txn_date) as latest,
            COUNT(DISTINCT txn_date) as unique_dates
        FROM silver.transactions
    """).fetchone()
    
    print(f"Date range: {date_range[0]} to {date_range[1]} ({date_range[2]} unique dates)")
    
    # Show monthly summary sample
    print("\n=== MONTHLY TOTALS (Last 6 months) ===")
    monthly = con.execute("""
        SELECT ym, currency, SUM(amount_native_sum) as total_amount, SUM(txn_count) as total_txns
        FROM silver.v_txn_monthly 
        WHERE month >= current_date - interval '6 months'
        GROUP BY 1,2 
        ORDER BY 1 DESC, 2
        LIMIT 10
    """).fetchall()
    
    for row in monthly:
        print(f"  {row[0]} {row[1]}: {row[2]:,.0f} ISK ({row[3]} txns)")
    
    print("\n[SUCCESS] Silver layer built successfully!")
    
except Exception as e:
    print(f"[ERROR] Silver build failed: {e}")
    sys.exit(1)
finally:
    # ✅ Always close connection to release lock
    try:
        con.close()
    except:
        pass
PYCODE

Write-Host "Done."