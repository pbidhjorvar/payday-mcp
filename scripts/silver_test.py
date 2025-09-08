#!/usr/bin/env python3
import os
import pathlib
import sys

# Check if we can import duckdb
try:
    import duckdb
    print("[INFO] DuckDB module found")
except ImportError:
    print("[ERROR] DuckDB not installed. Install with: pip install duckdb")
    sys.exit(1)

def build_silver():
    """Build Silver layer with typing and QC checks"""
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
            try:
                orphans = con.execute("SELECT * FROM silver.qc_orphan_txn_accounts LIMIT 5").fetchall()
                for row in orphans:
                    print(f"  Txn {row[0]}: account_code={row[1]}, account_name={row[2]}")
            except Exception as e:
                print(f"  Could not fetch orphan details: {e}")
        
        if qc2 > 0:
            print("\n[WARN] Found transactions with missing fields:")
            try:
                missing = con.execute("SELECT issue_type, COUNT(*) FROM silver.qc_missing_fields GROUP BY 1").fetchall()
                for row in missing:
                    print(f"  {row[0]}: {row[1]} transactions")
            except Exception as e:
                print(f"  Could not fetch missing field details: {e}")
        
        # Show account type summary
        print("\n=== ACCOUNT TYPES ===")
        try:
            acct_summary = con.execute("SELECT * FROM silver.v_account_summary ORDER BY account_count DESC").fetchall()
            for row in acct_summary:
                print(f"  {row[0]} | {row[1]} | {row[2]}: {row[3]} total, {row[4]} active")
        except Exception as e:
            print(f"  Could not fetch account summary: {e}")
        
        # Show transaction date range
        print("\n=== TRANSACTION DATE RANGE ===")
        try:
            date_range = con.execute("""
                SELECT 
                    MIN(txn_date) as earliest,
                    MAX(txn_date) as latest,
                    COUNT(DISTINCT txn_date) as unique_dates
                FROM silver.transactions
            """).fetchone()
            
            print(f"Date range: {date_range[0]} to {date_range[1]} ({date_range[2]} unique dates)")
        except Exception as e:
            print(f"  Could not fetch date range: {e}")
        
        con.close()
        print("\n[SUCCESS] Silver layer built successfully!")
        
    except Exception as e:
        print(f"[ERROR] Silver build failed: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

if __name__ == "__main__":
    build_silver()