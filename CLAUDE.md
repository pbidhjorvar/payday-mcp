# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Payday-MCP** - A Model Context Protocol (MCP) server that provides secure access to the Payday API through Claude Desktop. Built with TypeScript and designed for local development with multi-tenant profile support.

## Development Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Set up environment:**
   - Copy `.env.example` to `.env`
   - Add your Payday API credentials
   - Optionally copy `profiles.example.json` to `profiles.json` for multi-tenant support

3. **Development mode:**
   ```bash
   npm run dev
   ```

## Common Commands

```bash
npm run build         # Compile TypeScript to dist/
npm run dev          # Run with hot reload
npm test             # Run unit tests
npm run lint         # Check code style
npm run format       # Auto-format code
npm run typecheck    # Type check without building
```

## Architecture Notes

### Core Libraries (`src/lib/`)
- **auth.ts**: OAuth2 client credentials flow with automatic token refresh and caching
- **config.ts**: Multi-profile configuration management, reads from env vars and profiles.json
- **http-client.ts**: Axios wrapper with auth interceptors, rate limit tracking, and retry logic

### MCP Tools (`src/tools/`)
Each tool follows the pattern:
- Typed input schema using zod
- Error handling that returns `{ok: false, error: string}` on failure
- Consistent response format with pagination metadata where applicable

### Key Design Decisions
1. **Security**: Credentials stored in .env, never logged. Read-only mode for production profiles.
2. **Error Handling**: All errors caught and returned in consistent format, no exceptions bubble up
3. **Rate Limiting**: Headers tracked and exposed via dedicated tool
4. **Pagination**: Enforced max perpage=500, consistent meta format across all list endpoints

## Testing Strategy

Tests use Vitest with mocked dependencies. Key test files:
- `auth.test.ts`: Token caching, refresh, error scenarios
- `tools.test.ts`: Each tool's success and error paths

Run specific tests: `npm test -- auth.test.ts`

## Claude Desktop Integration

The server communicates via stdio with Claude Desktop. Each tool returns JSON responses that Claude can interpret. Tools are stateless - profile switching would require server restart.

### Configuration File Location
Windows: `C:\Users\DaníelHjörvar\AppData\Roaming\Claude\claude_desktop_config.json`
macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`

## API Reference

The Payday API documentation is available at: **https://apidoc.payday.is/**

Use this reference when:
- Adding new endpoints or tools
- Understanding parameter formats and validation rules
- Debugging API responses and error codes
- Implementing new features or fixing issues

## SQLite Database Query Examples

💎 **Gold database contains 4,029 transactions (2022-2023) ready for analysis!**

### 🔥 Always Use Parameters (Never Direct String Concatenation!)

**✅ CORRECT:**
```json
{
  "sql": "SELECT account_name, SUM(debit) FROM silver_account_statements WHERE account_type = ? AND transaction_date >= ? GROUP BY account_name ORDER BY SUM(debit) DESC LIMIT ?",
  "params": ["Gjöld", "2023-01-01", 10]
}
```

**❌ WRONG:**
```sql
"SELECT * FROM silver_account_statements WHERE account_type = 'Gjöld'"
```

### 📊 Key Tables & Views
- `silver_account_statements` - All transactions with proper typing
- `gold_account_summary` - Account totals and activity 
- `gold_monthly_pl` - Monthly P&L breakdown
- `gold_balance_sheet` - Balance sheet positions
- `dim_accounts` - Chart of accounts

### ⚡ Quick Analysis Examples
```json
// Monthly revenue 2023
{"sql": "SELECT strftime('%Y-%m', transaction_date) as month, SUM(credit-debit) as revenue FROM silver_account_statements WHERE transaction_date >= ? AND account_type = ? GROUP BY month ORDER BY month", "params": ["2023-01-01", "Tekjur"]}

// Top 10 expenses 2023  
{"sql": "SELECT account_name, SUM(debit) as expense FROM silver_account_statements WHERE account_type = ? AND transaction_date LIKE ? GROUP BY account_name ORDER BY expense DESC LIMIT ?", "params": ["Gjöld", "2023%", 10]}

// Account balance over time
{"sql": "SELECT transaction_date, balance FROM silver_account_statements WHERE account_code = ? AND transaction_date >= ? ORDER BY transaction_date", "params": ["3200", "2023-01-01"]}
```

### 🎯 Workflow for Claude Desktop
1. **List tables**: `sqlite_list_objects` with `{"prefix": "gold_"}`
2. **Examine structure**: `sqlite_table_info` with `{"table": "gold_account_summary"}`  
3. **Query with parameters**: `sqlite_sql_select` with proper `params` array
4. **Use markdown format**: `{"format": "markdown"}` for readable results

## Common Issues

1. **Auth failures**: Check CLIENT_ID/SECRET in .env, verify OAuth2 endpoint
2. **Profile not found**: Ensure profiles.json exists and has valid JSON
3. **TypeScript errors**: Run `npm run typecheck` to identify issues before build
4. **API questions**: Refer to https://apidoc.payday.is/ for official documentation