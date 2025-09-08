import os, pathlib, json
import duckdb

def convert_jsonl_to_parquet():
    """Convert latest JSONL files to Parquet for each resource"""
    bronze_dir = pathlib.Path("data/bronze/payday")
    
    # Find all resource directories
    resource_dirs = [d for d in bronze_dir.iterdir() if d.is_dir()]
    
    results = []
    con = duckdb.connect()
    
    for resource_dir in resource_dirs:
        resource_name = resource_dir.name
        
        # Find the latest JSONL file (by name - they include timestamp)
        jsonl_files = list(resource_dir.glob("*.jsonl"))
        if not jsonl_files:
            print(f"[WARN] No JSONL files found for {resource_name}")
            continue
            
        latest_jsonl = max(jsonl_files, key=lambda f: f.name)
        parquet_file = resource_dir / f"{resource_name}_latest.parquet"
        
        print(f"[INFO] Converting {resource_name}: {latest_jsonl.name} -> {parquet_file.name}")
        
        try:
            # Read JSONL and convert to Parquet via DuckDB
            con.execute(f"""
                CREATE OR REPLACE TABLE temp_{resource_name} AS
                SELECT * FROM read_json_auto('{latest_jsonl}');
            """)
            
            # Check record count
            count = con.execute(f"SELECT COUNT(*) FROM temp_{resource_name}").fetchone()[0]
            
            # Write to Parquet
            con.execute(f"""
                COPY temp_{resource_name} TO '{parquet_file}' (FORMAT PARQUET);
            """)
            
            print(f"[OK] {resource_name}: {count} records -> {parquet_file.name}")
            results.append({
                "resource": resource_name,
                "count": count,
                "jsonl": str(latest_jsonl),
                "parquet": str(parquet_file)
            })
            
        except Exception as e:
            print(f"[ERROR] {resource_name}: {e}")
            results.append({
                "resource": resource_name,
                "count": 0,
                "error": str(e)
            })
    
    con.close()
    return results

if __name__ == "__main__":
    print("Converting JSONL files to Parquet...")
    results = convert_jsonl_to_parquet()
    
    print("\n=== CONVERSION SUMMARY ===")
    total_records = 0
    for result in results:
        count = result.get("count", 0)
        total_records += count
        status = "[OK]" if count > 0 else "[ERR]" if result.get("error") else "[WARN]"
        print(f"{status} {result['resource']}: {count} records")
        if result.get("error"):
            print(f"   Error: {result['error']}")
    
    print(f"\nTotal records converted: {total_records}")