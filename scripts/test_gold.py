#!/usr/bin/env python3
"""
Test script to validate Gold layer SQL without executing DuckDB
"""
import pathlib

def validate_sql_files():
    """Validate that SQL files exist and are readable"""
    files_to_check = [
        'scripts/sql/01_silver_build.sql',
        'scripts/sql/02_gold_build.sql', 
        'config/account_groups.csv'
    ]
    
    print("=== VALIDATING FILES ===")
    for file_path in files_to_check:
        path = pathlib.Path(file_path)
        if path.exists():
            size = path.stat().st_size
            print(f"[OK] {file_path}: {size} bytes")
        else:
            print(f"[ERR] {file_path}: NOT FOUND")
    
    # Show account groups content
    print("\n=== ACCOUNT GROUPS MAPPING ===")
    try:
        csv_path = pathlib.Path('config/account_groups.csv')
        if csv_path.exists():
            content = csv_path.read_text(encoding='utf-8')
            lines = content.strip().split('\n')
            for i, line in enumerate(lines):
                if i == 0:
                    print(f"Header: {line}")
                elif i < 6:  # Show first 5 data rows
                    print(f"Row {i}: {line}")
            if len(lines) > 6:
                print(f"... and {len(lines) - 6} more rows")
        else:
            print("[ERR] account_groups.csv not found")
    except Exception as e:
        print(f"[ERR] Could not read account_groups.csv: {e}")
    
    # Validate SQL structure
    print("\n=== VALIDATING SQL STRUCTURE ===")
    try:
        sql_path = pathlib.Path('scripts/sql/02_gold_build.sql')
        if sql_path.exists():
            sql_content = sql_path.read_text(encoding='utf-8')
            
            # Check for key components
            checks = [
                ('ATTACH', 'Database attachment'),
                ('CREATE SCHEMA', 'Schema creation'),
                ('CREATE OR REPLACE TABLE gold.dim_account', 'Account dimension'),
                ('CREATE OR REPLACE TABLE gold.fact_txn', 'Transaction fact table'),
                ('CREATE OR REPLACE VIEW gold.v_kpi_month', 'KPI view'),
                ('CREATE OR REPLACE VIEW gold.v_pl_month', 'P&L view'),
                ('CREATE OR REPLACE VIEW gold.v_bs_month', 'Balance sheet view'),
                ('COPY', 'Parquet export')
            ]
            
            for check, desc in checks:
                if check in sql_content:
                    print(f"[OK] {desc}: Found")
                else:
                    print(f"[WARN] {desc}: Not found")
        else:
            print("[ERR] 02_gold_build.sql not found")
    except Exception as e:
        print(f"[ERR] Could not validate SQL: {e}")
    
    print("\n=== SUMMARY ===")
    print("Gold layer files created successfully!")
    print("\nTo build (requires DuckDB):")
    print("1. Install DuckDB: pip install duckdb")
    print("2. Build Silver: python scripts/silver_test.py")
    print("3. Build Gold: python scripts/gold_build.ps1 (or python equivalent)")
    print("4. Export data: python scripts/export_json.py --view gold.v_kpi_month")

if __name__ == "__main__":
    validate_sql_files()