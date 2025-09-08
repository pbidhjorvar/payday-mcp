#!/usr/bin/env python3
"""
Test the DuckDB pipeline with proper connection management
"""
import duckdb
import pathlib

def test_memory_pipeline():
    """Test pipeline in memory to validate SQL without file locks"""
    print("=== TESTING PIPELINE IN MEMORY ===")
    
    con = duckdb.connect(':memory:')
    try:
        # Build Silver
        print("[1/2] Building Silver layer...")
        silver_sql = pathlib.Path('scripts/sql/01_silver_build.sql').read_text(encoding='utf-8')
        con.execute(silver_sql)
        
        # Build Gold (modify SQL to remove ATTACH for memory test)
        print("[2/2] Building Gold layer...")
        gold_sql = pathlib.Path('scripts/sql/02_gold_build.sql').read_text(encoding='utf-8')
        
        # Remove ATTACH statement for in-memory test
        gold_sql_memory = gold_sql.replace("ATTACH 'duckdb/finance.duckdb' (READ_ONLY FALSE);", "")
        
        con.execute(gold_sql_memory)
        
        # Validate
        accounts = con.execute('SELECT COUNT(*) FROM gold.dim_account').fetchone()[0]
        kpis = con.execute('SELECT COUNT(*) FROM gold.v_kpi_month').fetchone()[0]
        
        print(f"✅ Pipeline complete: {accounts} accounts, {kpis} KPI months")
        return True
        
    except Exception as e:
        print(f"❌ Pipeline failed: {e}")
        return False
    finally:
        con.close()

def test_sequential_file():
    """Test sequential file operations with explicit connection management"""
    print("\n=== TESTING SEQUENTIAL FILE OPERATIONS ===")
    
    # Clean slate
    db_path = pathlib.Path('duckdb/finance.duckdb')
    if db_path.exists():
        db_path.unlink()
    
    try:
        # Step 1: Silver
        print("[1/2] Building Silver to file...")
        con = duckdb.connect('duckdb/finance.duckdb')
        try:
            silver_sql = pathlib.Path('scripts/sql/01_silver_build.sql').read_text(encoding='utf-8')
            con.execute(silver_sql)
            print("✅ Silver complete")
        finally:
            con.close()  # ✅ Explicit close
        
        # Step 2: Gold (fresh connection)
        print("[2/2] Building Gold to file...")
        con = duckdb.connect('duckdb/finance.duckdb')
        try:
            gold_sql = pathlib.Path('scripts/sql/02_gold_build.sql').read_text(encoding='utf-8')
            con.execute(gold_sql)
            
            # Validate
            accounts = con.execute('SELECT COUNT(*) FROM gold.dim_account').fetchone()[0]
            kpis = con.execute('SELECT COUNT(*) FROM gold.v_kpi_month').fetchone()[0]
            print(f"✅ Gold complete: {accounts} accounts, {kpis} KPI months")
            
        finally:
            con.close()  # ✅ Explicit close
            
        return True
        
    except Exception as e:
        print(f"❌ Sequential build failed: {e}")
        return False

if __name__ == "__main__":
    # Test both approaches
    memory_ok = test_memory_pipeline()
    file_ok = test_sequential_file()
    
    print("\n=== RESULTS ===")
    print(f"Memory pipeline: {'✅ PASS' if memory_ok else '❌ FAIL'}")
    print(f"Sequential file: {'✅ PASS' if file_ok else '❌ FAIL'}")
    
    if file_ok:
        print("\n✅ DuckDB connection management is fixed!")
        print("Safe to run: Bronze → Silver → Gold sequentially")
    else:
        print("\n❌ File locking issues persist")