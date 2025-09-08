import os, json, pathlib, datetime as dt, subprocess
from dotenv import load_dotenv

load_dotenv()

RESOURCES = [x.strip() for x in os.getenv("PAYDAY_RESOURCES","").split(",") if x.strip()]
BRONZE_DIR = pathlib.Path("data/bronze")
TS = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%d_%H%M%S")

def call_mcp_tool(tool_name, args=None):
    """Call MCP tool via Node.js bridge"""
    if args is None:
        args = {}
    
    cmd = [
        "node", 
        "scripts/mcp_bridge.js", 
        tool_name, 
        json.dumps(args)
    ]
    
    try:
        result = subprocess.run(
            cmd, 
            capture_output=True, 
            text=True, 
            check=True,
            cwd=".",
            encoding='utf-8'
        )
        if not result.stdout.strip():
            return {"ok": False, "error": "Empty response from MCP tool"}
        return json.loads(result.stdout)
    except subprocess.CalledProcessError as e:
        print(f"[ERROR] MCP tool {tool_name} failed: {e.stderr}")
        return {"ok": False, "error": e.stderr}
    except json.JSONDecodeError as e:
        print(f"[ERROR] Invalid JSON from {tool_name}: {e}")
        return {"ok": False, "error": f"Invalid JSON: {e}"}

def fetch_all_pages(tool_name, base_args=None):
    """Fetch all pages from a paginated MCP tool"""
    if base_args is None:
        base_args = {}
    
    all_data = []
    page = 1
    max_pages = 1000  # Safety limit
    
    while page <= max_pages:
        args = {**base_args, "page": page, "perpage": 500}
        
        print(f"[INFO] Fetching {tool_name} page {page}...")
        result = call_mcp_tool(tool_name, args)
        
        if not result.get("ok"):
            if page == 1:
                # If first page fails, return error
                return result
            else:
                # If later pages fail, return what we have
                print(f"[WARN] {tool_name} page {page} failed, stopping pagination")
                break
        
        data = result.get("data", [])
        
        # Handle different response formats
        if isinstance(data, dict):
            # Some APIs return {customers: [...], total: N} format
            if "customers" in data:
                items = data["customers"]
            elif "invoices" in data:
                items = data["invoices"] 
            elif "expenses" in data:
                items = data["expenses"]
            else:
                # Single item response, convert to list
                items = [data]
        else:
            items = data if isinstance(data, list) else []
        
        if not items:
            print(f"[INFO] {tool_name} page {page} empty, stopping pagination")
            break
        
        all_data.extend(items)
        print(f"[INFO] {tool_name} page {page}: got {len(items)} items, total: {len(all_data)}")
        
        # Check if we got fewer than requested, indicating last page
        if len(items) < args["perpage"]:
            print(f"[INFO] {tool_name} page {page} had {len(items)} items, stopping pagination")
            break
            
        page += 1
    
    return {"ok": True, "data": all_data, "total_pages": page - 1, "total_items": len(all_data)}

def fetch_single_item(tool_name, args=None):
    """Fetch a single item (like company info)"""
    print(f"[INFO] Fetching {tool_name}...")
    result = call_mcp_tool(tool_name, args or {})
    
    if not result.get("ok"):
        return result
    
    # Wrap single item in array for consistent handling
    data = result.get("data")
    if not isinstance(data, list):
        data = [data] if data else []
    
    return {"ok": True, "data": data, "total_items": len(data)}

def fetch_resource(resource):
    """Fetch a resource using MCP tools"""
    # Map logical resource -> MCP tool name and fetch strategy
    resource_config = {
        "accounts": {
            "tool": "payday_get_accounts",
            "strategy": "paginated"
        },
        "account-statement": {
            "tool": "payday_get_account_statement", 
            "strategy": "special",  # Needs date range
            "args": {
                # Get ALL transactions from company founding (2022) to present
                "dateFrom": "2022-01-01",
                "dateTo": dt.date.today().isoformat()
            }
        },
        "company": {
            "tool": "payday_get_company",
            "strategy": "single"
        },
        "customers": {
            "tool": "payday_get_customers",
            "strategy": "paginated"
        },
        "invoices": {
            "tool": "payday_get_invoices",
            "strategy": "paginated"
        },
        "expenses": {
            "tool": "payday_get_expenses",
            "strategy": "paginated"
        },
        "expense-accounts": {
            "tool": "payday_get_expense_accounts",
            "strategy": "single"  # Usually small list
        },
        "expense-payment-types": {
            "tool": "payday_get_expense_payment_types",
            "strategy": "single"  # Usually small list  
        },
        "payments": {
            "tool": "payday_get_payments",
            "strategy": "paginated"
        }
    }
    
    config = resource_config.get(resource)
    if not config:
        print(f"[WARN] Unknown resource: {resource}")
        return None

    raw_dir = BRONZE_DIR / "payday" / resource
    raw_dir.mkdir(parents=True, exist_ok=True)
    json_path = raw_dir / f"snapshot_{TS}.jsonl"

    # Fetch data based on strategy
    if config["strategy"] == "paginated":
        result = fetch_all_pages(config["tool"])
    elif config["strategy"] == "single":
        result = fetch_single_item(config["tool"])
    elif config["strategy"] == "special":
        # Account statement with date range
        args = config.get("args", {})
        if resource == "account-statement":
            print(f"[INFO] Fetching {resource} from {args['dateFrom']} to {args['dateTo']}")
        result = call_mcp_tool(config["tool"], args)
        # Convert to standard format
        if result.get("ok"):
            data = result.get("data", [])
            result = {"ok": True, "data": data, "total_items": len(data)}

    if not result.get("ok"):
        print(f"[ERROR] Failed to fetch {resource}: {result.get('error')}")
        return {"resource": resource, "count": 0, "error": result.get("error")}

    data = result.get("data", [])
    if not data:
        print(f"[INFO] {resource}: no records")
        return {"resource": resource, "count": 0}

    # Write to JSONL with ingestion metadata
    count = 0
    with open(json_path, "w", encoding="utf-8") as f:
        for item in data:
            # Add ingestion metadata
            item["_ingested_at_utc"] = dt.datetime.now(dt.timezone.utc).isoformat()
            item["_source_"] = "payday-mcp"
            item["_resource_"] = resource
            f.write(json.dumps(item, ensure_ascii=True) + "\n")
            count += 1

    print(f"[OK] {resource}: {count} rows -> {json_path.name}")
    
    return {
        "resource": resource, 
        "count": count, 
        "jsonl": str(json_path), 
        "pages_fetched": result.get("total_pages", 1),
        "mcp_tool": config["tool"]
    }

def main():
    print("[INFO] Using Payday-MCP tools for comprehensive data fetching")
    
    # Ensure we have the compiled JS files
    if not os.path.exists("dist"):
        print("[ERROR] TypeScript not compiled. Run 'npm run build' first.")
        return
    
    results = []
    for r in RESOURCES:
        try:
            print(f"\n=== FETCHING {r.upper()} ===")
            result = fetch_resource(r)
            if result:
                results.append(result)
        except Exception as e:
            print(f"[ERROR] fetch {r}: {e}")
            results.append({"resource": r, "count": 0, "error": str(e)})
    
    print("\n" + "="*50)
    print("FINAL SUMMARY")
    print("="*50)
    
    total_records = 0
    for result in results:
        count = result.get("count", 0)
        total_records += count
        status = "[OK]" if count > 0 else "[ERR]" if result.get("error") else "[WARN]"
        print(f"{status} {result['resource']}: {count} records")
        if result.get("error"):
            print(f"   Error: {result['error']}")
    
    print(f"\nTotal records fetched: {total_records}")
    print(f"Snapshot timestamp: {TS}")
    print(f"Data location: {BRONZE_DIR}/payday/")

if __name__ == "__main__":
    main()