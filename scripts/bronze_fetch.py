import os, json, time, pathlib, datetime as dt
import httpx
import duckdb
from dotenv import load_dotenv

load_dotenv()

BASE_URL = os.getenv("PAYDAY_BASE_URL", "").rstrip("/")
CLIENT_ID = os.getenv("PAYDAY_CLIENT_ID")
CLIENT_SECRET = os.getenv("PAYDAY_CLIENT_SECRET")
TOKEN_URL = os.getenv("PAYDAY_TOKEN_URL")
BEARER = os.getenv("PAYDAY_BEARER_TOKEN")
RESOURCES = [x.strip() for x in os.getenv("PAYDAY_RESOURCES","").split(",") if x.strip()]

BRONZE_DIR = pathlib.Path("data/bronze")
TS = dt.datetime.utcnow().strftime("%Y%m%d_%H%M%S")

def get_token():
    if BEARER:
        return BEARER
    if not (CLIENT_ID and CLIENT_SECRET and TOKEN_URL):
        raise RuntimeError("No auth provided. Set PAYDAY_BEARER_TOKEN or client credentials in .env")
    with httpx.Client(timeout=30) as c:
        resp = c.post(TOKEN_URL, data={
            "grant_type":"client_credentials",
            "client_id":CLIENT_ID,
            "client_secret":CLIENT_SECRET,
            "scope":"api"
        })
        resp.raise_for_status()
        return resp.json()["access_token"]

def paged_get(client, url):
    # Generic pager: supports 'page' & 'pageSize' or 'next' style.
    # Adjust if Payday uses different conventions per resource.
    page = 1
    page_size = 500
    while True:
        r = client.get(url, params={"page":page, "pageSize":page_size})
        r.raise_for_status()
        data = r.json()
        items = data if isinstance(data, list) else data.get("items") or data.get("data") or []
        if not items:
            break
        yield from items
        # naive: stop if fewer than page_size
        if len(items) < page_size:
            break
        page += 1

def fetch_resource(client, resource):
    # Map logical resource → endpoint (update as needed to match Payday)
    # Consult apidoc.payday.is for exact routes; keep these keys stable for downstream.
    routes = {
        "accounts":      f"{BASE_URL}/v1/accounting/accounts",
        "customers":     f"{BASE_URL}/v1/customers",
        "invoices":      f"{BASE_URL}/v1/invoices",
        "transactions":  f"{BASE_URL}/v1/accounting/transactions",
    }
    url = routes.get(resource)
    if not url:
        print(f"[WARN] Unknown resource: {resource}")
        return None

    raw_dir = BRONZE_DIR / "payday" / resource
    raw_dir.mkdir(parents=True, exist_ok=True)
    json_path = raw_dir / f"snapshot_{TS}.jsonl"
    parquet_path = raw_dir / f"snapshot_{TS}.parquet"

    count = 0
    with client as c, open(json_path, "w", encoding="utf-8") as f:
        for item in paged_get(c, url):
            # add ingestion metadata
            item["_ingested_at_utc"] = dt.datetime.utcnow().isoformat()
            item["_source_"] = "payday"
            f.write(json.dumps(item, ensure_ascii=False) + "\n")
            count += 1

    if count == 0:
        print(f"[INFO] {resource}: no records")
        return {"resource":resource, "count":0}

    # Convert JSONL to Parquet via DuckDB for schema inference
    con = duckdb.connect()
    con.execute("""
        CREATE TABLE tmp AS
        SELECT * FROM read_json_auto(?);
    """, [str(json_path)])
    con.execute("""
        COPY tmp TO ? (FORMAT PARQUET);
    """, [str(parquet_path)])
    con.close()
    print(f"[OK] {resource}: {count} rows → {json_path.name} & {parquet_path.name}")
    return {"resource":resource, "count":count, "jsonl":str(json_path), "parquet":str(parquet_path)}

def main():
    token = get_token()
    headers = {"Authorization": f"Bearer {token}"}
    with httpx.Client(timeout=60, headers=headers) as client:
        results = []
        for r in RESOURCES:
            try:
                results.append(fetch_resource(client, r))
            except Exception as e:
                print(f"[ERROR] fetch {r}: {e}")
        print(json.dumps(results, indent=2))

if __name__ == "__main__":
    main()