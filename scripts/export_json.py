#!/usr/bin/env python3
import argparse
import duckdb
import json
import sys
import decimal
from datetime import date, datetime

def decimal_default(obj):
    """JSON serializer for Decimal and date objects"""
    if isinstance(obj, decimal.Decimal):
        return float(obj)
    elif isinstance(obj, (date, datetime)):
        return obj.isoformat()
    raise TypeError(f"Object of type {type(obj)} is not JSON serializable")

def main():
    parser = argparse.ArgumentParser(description="Export DuckDB Gold layer data to JSON")
    parser.add_argument("--view", required=True, help="Gold view/table to export (e.g., gold.v_kpi_month)")
    parser.add_argument("--where", default="", help="Optional WHERE clause")
    parser.add_argument("--limit", type=int, default=2000, help="Maximum rows to export")
    parser.add_argument("--out", default="-", help="Output file path or '-' for stdout")
    parser.add_argument("--order", default="", help="Optional ORDER BY clause (default: first column DESC)")
    
    args = parser.parse_args()

    try:
        # Connect to DuckDB
        con = duckdb.connect('duckdb/finance.duckdb')
        
        # Build SQL query
        sql = f"SELECT * FROM {args.view}"
        
        if args.where:
            sql += f" WHERE {args.where}"
        
        # Default ordering by first column descending
        if args.order:
            sql += f" ORDER BY {args.order}"
        else:
            sql += " ORDER BY 1 DESC"
            
        sql += f" LIMIT {args.limit}"
        
        print(f"[INFO] Executing: {sql}", file=sys.stderr)
        
        # Execute query
        result = con.execute(sql)
        rows = result.fetchall()
        cols = [d[0] for d in result.description]
        
        if not rows:
            print(f"[WARN] No data returned from {args.view}", file=sys.stderr)
            data = []
        else:
            # Convert to list of dictionaries
            data = [dict(zip(cols, row)) for row in rows]
        
        # Serialize to JSON
        payload = json.dumps(data, ensure_ascii=False, indent=2, default=decimal_default)
        
        # Output
        if args.out == "-":
            print(payload)
        else:
            with open(args.out, "w", encoding="utf-8") as f:
                f.write(payload)
            print(f"[OK] Wrote {len(data)} rows to {args.out}", file=sys.stderr)
        
    except Exception as e:
        print(f"[ERROR] Export failed: {e}", file=sys.stderr)
        sys.exit(1)
    finally:
        # ✅ Always close connection to release lock
        try:
            con.close()
        except:
            pass

if __name__ == "__main__":
    main()