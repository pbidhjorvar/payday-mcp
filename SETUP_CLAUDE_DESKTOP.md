# Claude Desktop Setup Instructions

This guide will help you configure the Payday MCP Server with DuckDB analytics in Claude Desktop.

## Prerequisites

1. **Node.js** (v16+ required)
2. **Python** (for data pipeline)
3. **Claude Desktop** installed

## Step 1: Install Dependencies

### Install DuckDB for SQL Analytics
```bash
npm install duckdb
```

*Note: If this fails due to compilation issues, the SQL tools will show helpful error messages but other Payday API tools will still work.*

### Install Python Dependencies (for data pipeline)
```bash
pip install -r requirements.txt
```

## Step 2: Configuration

### 1. Environment Setup
```bash
# Copy example environment file
cp .env.example .env

# Edit .env with your Payday credentials
# Either use bearer token OR client credentials
```

### 2. Multi-profile Setup (Optional)
```bash
# Copy example profiles
cp profiles.example.json profiles.json

# Edit profiles.json for test/production environments
```

## Step 3: Build and Test

### Build the MCP Server
```bash
npm run build
```

### Test Locally
```bash
# Test that tools are available
echo '{"jsonrpc": "2.0", "id": 1, "method": "tools/list"}' | node dist/index.js

# Test a Payday API tool
echo '{"jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": {"name": "payday_healthcheck", "arguments": {}}}' | node dist/index.js
```

## Step 4: Claude Desktop Configuration

### 1. Find Configuration File
- **Windows**: `C:\Users\{Username}\AppData\Roaming\Claude\claude_desktop_config.json`
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`

### 2. Add Payday MCP Server

Open the configuration file and add:

```json
{
  "mcpServers": {
    "payday-mcp": {
      "command": "node",
      "args": ["C:\\Projects\\Payday-MCP\\dist\\index.js"],
      "env": {
        "NODE_ENV": "production"
      }
    }
  }
}
```

**Important**: Adjust the path `C:\\Projects\\Payday-MCP\\dist\\index.js` to match your actual project location.

### 3. Restart Claude Desktop

Close and reopen Claude Desktop to load the new MCP server.

## Step 5: Verify Setup

In Claude Desktop, try these commands:

### Test Payday API Tools
```
Can you check the Payday API connection using payday_healthcheck?
```

### Test DuckDB SQL Tools (if DuckDB is installed)
```
Use duckdb_list_objects to show me what data is available in the warehouse.
```

## Step 6: Data Pipeline Setup (Optional)

If you want to use the SQL analytics features:

### 1. Fetch Initial Data
```bash
# Fetch all Payday data to Bronze layer
python scripts/bronze_fetch_full.py
```

### 2. Build Analytics Pipeline
```bash
# Build Silver and Gold layers
python scripts/build_pipeline.py
```

### 3. Test SQL Analytics
In Claude Desktop:
```
Show me the available tables using duckdb_list_objects
```

```
Get monthly KPIs using: duckdb_sql_select with SQL "SELECT month, revenue, ebitda FROM gold.v_kpi_month ORDER BY month DESC LIMIT 6"
```

## Troubleshooting

### DuckDB Installation Issues
If `npm install duckdb` fails:
1. Try running as Administrator/root
2. The Payday API tools will still work without DuckDB
3. SQL tools will show clear error messages explaining the issue

### Claude Desktop Not Seeing Tools
1. Check the path in `claude_desktop_config.json` is correct
2. Ensure you built the project: `npm run build`
3. Check Claude Desktop logs for errors
4. Restart Claude Desktop after configuration changes

### Environment Issues
1. Verify `.env` file has correct Payday credentials
2. Test with `npm run dev` first to see error messages
3. Check that profiles.json exists if using multi-profile setup

### Data Pipeline Issues
1. Ensure Bronze data exists: `ls data/bronze/payday/`
2. Check DuckDB file permissions: `ls -la duckdb/`
3. Run pipeline steps individually to isolate issues

## Available Tools

### Payday API Tools (19 total)
- Company & account information (3)
- Financial data & statements (3)
- Invoices & customer management (5)
- Expenses & payments (4)
- Sales orders & journal entries (4)

### DuckDB SQL Tools (4 total)
- `duckdb_list_objects` - Discover tables and views
- `duckdb_table_info` - Get column information
- `duckdb_explain` - Query execution plans
- `duckdb_sql_select` - Execute SELECT queries

## Security Notes

- All SQL tools are read-only (SELECT/CTE only)
- Database connections use proper cleanup to prevent locks
- Sensitive data (credentials, database files) are in .gitignore
- Row limits prevent large result sets from overwhelming Claude Desktop

## Support

If you encounter issues:
1. Check the troubleshooting section above
2. Review logs in Claude Desktop
3. Test tools individually using the command line method shown above
4. Ensure all dependencies are installed correctly