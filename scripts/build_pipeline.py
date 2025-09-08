#!/usr/bin/env python3
"""
Sequential build orchestrator for Bronze -> Silver -> Gold pipeline
Ensures only one DuckDB connection at a time to avoid file locks
"""
import subprocess
import sys
import pathlib
import time

def run_step(name, command, description):
    """Run a pipeline step and check for success"""
    print(f"\n=== {name.upper()} ===")
    print(f"[INFO] {description}")
    
    start_time = time.time()
    result = subprocess.run(command, shell=True, capture_output=True, text=True)
    duration = time.time() - start_time
    
    if result.returncode == 0:
        print(f"[OK] {name} completed in {duration:.1f}s")
        if result.stdout:
            print(result.stdout)
        return True
    else:
        print(f"[ERROR] {name} failed after {duration:.1f}s")
        if result.stdout:
            print("STDOUT:", result.stdout)
        if result.stderr:
            print("STDERR:", result.stderr)
        return False

def main():
    print("=== PAYDAY MCP PIPELINE BUILD ===")
    print("Sequential execution: Bronze -> Silver -> Gold")
    
    # Check if Bronze data exists
    bronze_files = list(pathlib.Path("data/bronze/payday").glob("*.jsonl"))
    if not bronze_files:
        print("\n[WARN] No Bronze data found in data/bronze/payday/")
        print("Pipeline will build with empty tables for validation")
    else:
        print(f"[OK] Found {len(bronze_files)} Bronze JSONL files")
    
    # Sequential pipeline steps
    steps = [
        ("Silver", "python scripts/silver_build.ps1", "Building typed Silver tables from Bronze JSONL"),
        ("Gold", "python scripts/gold_build.ps1", "Building business views and KPIs from Silver")
    ]
    
    for name, command, description in steps:
        success = run_step(name, command, description)
        if not success:
            print(f"\n[FATAL] Pipeline stopped at {name} step")
            return False
        
        # Small delay to ensure file handles are released
        time.sleep(0.5)
    
    print("\n=== PIPELINE COMPLETE ===")
    print("✅ Silver layer: Typed, deduplicated tables")
    print("✅ Gold layer: Business views and KPIs")
    print("\n=== USAGE ===")
    print("Export KPIs:     python scripts/export_json.py --view gold.v_kpi_month")
    print("Export P&L:      python scripts/export_json.py --view gold.v_pl_month")
    print("Export accounts: python scripts/export_json.py --view gold.v_account_detail")
    
    return True

if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)