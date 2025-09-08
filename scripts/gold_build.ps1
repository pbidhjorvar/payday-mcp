Write-Host "== Gold build (DuckDB) =="

# Check if Python has duckdb available
Write-Host "[INFO] Checking DuckDB installation..."
$duckdbCheck = python -c "import duckdb; print('DuckDB available')" 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] DuckDB not available. Please install with: pip install duckdb"
    Write-Host "If installation fails due to permissions, try running as administrator."
    exit 1
}

Write-Host $duckdbCheck

# Run Gold SQL transformation  
Write-Host "[INFO] Building Gold layer..."
python - << 'PYCODE'
import duckdb, pathlib, sys

try:
    # Read SQL file
    sql_path = pathlib.Path('scripts/sql/02_gold_build.sql')
    if not sql_path.exists():
        print(f"[ERROR] SQL file not found: {sql_path}")
        sys.exit(1)
    
    sql = sql_path.read_text(encoding='utf-8')
    con = duckdb.connect('duckdb/finance.duckdb')
    con.execute(sql)

    print("\n=== GOLD LAYER SUMMARY ===")
    
    # Quick report on main tables and views
    tables = [
        "gold.dim_account",
        "gold.fact_txn", 
        "gold.v_kpi_month",
        "gold.v_pl_month",
        "gold.v_bs_month",
        "gold.v_trial_balance_month",
        "gold.v_account_detail",
        "gold.v_monthly_summary"
    ]
    
    for name in tables:
        try:
            cnt = con.execute(f"SELECT COUNT(*) FROM {name}").fetchone()[0]
            print(f"[OK] {name}: {cnt:,} rows")
        except Exception as e:
            print(f"[ERR] {name}: {e}")

    # Show KPI sample
    print("\n=== KPI SAMPLE (Last 6 months) ===")
    try:
        kpi_sample = con.execute("""
        SELECT 
            month, 
            currency, 
            ROUND(revenue, 0) as revenue,
            ROUND(gross_profit, 0) as gross_profit,
            ROUND(ebitda, 0) as ebitda,
            ROUND(net_income, 0) as net_income,
            gross_margin_pct,
            ebitda_margin_pct
        FROM gold.v_kpi_month
        WHERE month >= current_date - interval '6 months'
        ORDER BY month DESC, currency
        LIMIT 10
        """).fetchall()
        
        if kpi_sample:
            print("Month       Curr  Revenue    GP        EBITDA    Net       GP%    EBITDA%")
            print("-" * 75)
            for row in kpi_sample:
                print(f"{row[0]} {row[1]}  {row[2]:>10.0f} {row[3]:>9.0f} {row[4]:>9.0f} {row[5]:>9.0f} {row[6]:>6.1f}% {row[7]:>7.1f}%")
        else:
            print("No KPI data available")
            
    except Exception as e:
        print(f"Could not fetch KPI sample: {e}")

    # Show account group mapping results  
    print("\n=== ACCOUNT GROUP MAPPING ===")
    try:
        mapping_stats = con.execute("""
        SELECT 
            statement,
            report_group,
            COUNT(*) as account_count,
            COUNT(CASE WHEN is_active THEN 1 END) as active_count
        FROM gold.dim_account 
        GROUP BY 1,2 
        ORDER BY 1,2
        """).fetchall()
        
        print("Statement Report Group             Accounts  Active")
        print("-" * 50)
        for row in mapping_stats:
            print(f"{row[0]:<9} {row[1]:<20} {row[2]:>8} {row[3]:>7}")
            
    except Exception as e:
        print(f"Could not fetch mapping stats: {e}")

    # Show transaction volume by month
    print("\n=== TRANSACTION VOLUME BY MONTH ===")
    try:
        volume_stats = con.execute("""
        SELECT 
            month,
            currency,
            total_transactions,
            active_accounts,
            ROUND(total_revenue, 0) as revenue,
            ROUND(total_expenses, 0) as expenses
        FROM gold.v_monthly_summary
        WHERE month >= current_date - interval '6 months'
        ORDER BY month DESC, currency
        LIMIT 10
        """).fetchall()
        
        if volume_stats:
            print("Month       Curr  Txns   Accts  Revenue    Expenses")
            print("-" * 50)
            for row in volume_stats:
                print(f"{row[0]} {row[1]}  {row[2]:>6} {row[3]:>5} {row[4]:>10.0f} {row[5]:>10.0f}")
        else:
            print("No volume data available")
            
    except Exception as e:
        print(f"Could not fetch volume stats: {e}")

    print("\n[SUCCESS] Gold layer built successfully!")
    print("\n=== USAGE ===")
    print("Export KPIs: python scripts/export_json.py --view gold.v_kpi_month")
    print("Export P&L:  python scripts/export_json.py --view gold.v_pl_month --where \"month >= '2024-01-01'\"")
    
except Exception as e:
    print(f"[ERROR] Gold build failed: {e}")
    import traceback
    traceback.print_exc()
    sys.exit(1)
finally:
    # ✅ Always close connection to release lock
    try:
        con.close()
    except:
        pass
PYCODE

Write-Host "Done."