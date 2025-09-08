param(
  [switch]$SkipFetch
)

Write-Host "== Payday-MCP local medallion pipeline =="

# Ensure venv (optional)
if (-Not (Test-Path ".venv")) {
  Write-Host "Creating venv..."
  py -m venv .venv
}
. .\.venv\Scripts\Activate.ps1
pip install -r requirements.txt --quiet

# Load env
if (Test-Path ".env") {
  Write-Host "Loading .env"
} else {
  Copy-Item ".env.example" ".env" -Force
  Write-Host "Created .env from example. Please fill secrets if needed."
}

if (-Not $SkipFetch) {
  Write-Host "`n[1/3] BRONZE fetch ..."
  py scripts/bronze_fetch.py
} else {
  Write-Host "`n[1/3] BRONZE fetch skipped."
}

Write-Host "`n[2/3] SILVER build ..."
py -c "import duckdb; duckdb.sql(open('scripts/sql/01_silver_build.sql','r',encoding='utf-8').read()).fetchall()"

Write-Host "`n[3/3] GOLD build ..."
py -c "import duckdb; duckdb.sql(open('scripts/sql/02_gold_build.sql','r',encoding='utf-8').read()).fetchall()"

Write-Host "`nDone. GOLD Parquet under data/gold and database at duckdb/finance.duckdb"