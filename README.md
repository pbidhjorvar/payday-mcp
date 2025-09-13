# Payday MCP Server

A Model Context Protocol (MCP) server that provides secure, read-only access to the Payday API through Claude Desktop. Built with TypeScript and designed for local development with multi-tenant profile support.

## Features

- 🔐 **OAuth2 authentication** with automatic token refresh
- 👥 **Multi-profile support** for test/production environments  
- 📊 **Complete tool suite** including read, write, and SQLite tools for customers, invoices, expenses, payments, and accounting
- 🚦 **Rate limit tracking** with headers exposed via dedicated tool
- ⚡ **Auto-retry on 401** with token refresh (once per call)
- 🛡️ **Privacy-focused** - no logging of secrets or PII
- ✅ **Production-ready** with comprehensive error handling and tests

## Requirements

- Node.js 18+ 
- npm or yarn
- Claude Desktop

## Installation

1. Clone the repository:
```bash
git clone https://github.com/yourusername/payday-mcp.git
cd payday-mcp
```

2. Install dependencies:
```bash
npm install
```

3. Build the project:
```bash
npm run build
```

## Configuration

### Environment Variables

Copy `.env.example` to `.env` and add your credentials:

```bash
PAYDAY_CLIENT_ID=your_client_id_here
PAYDAY_CLIENT_SECRET=your_client_secret_here
PAYDAY_DEFAULT_PROFILE=test
```

### Profile Configuration

Copy `profiles.example.json` to `profiles.json` for multi-tenant support:

```json
{
  "test": {
    "base_url": "https://api.test.payday.is",
    "company_id": null,
    "read_only": true
  },
  "prod": {
    "base_url": "https://api.payday.is",
    "company_id": null,
    "read_only": true
  }
}
```

## Claude Desktop Integration

Add to your Claude Desktop configuration:

### Windows
`%APPDATA%\Claude\claude_desktop_config.json`
- Example path: `C:\Users\DaníelHjörvar\AppData\Roaming\Claude\claude_desktop_config.json`

### macOS
`~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "payday-mcp": {
      "command": "node",
      "args": ["C:\\path\\to\\payday-mcp\\dist\\index.js"],
      "env": {
        "PAYDAY_DEFAULT_PROFILE": "test"
      }
    }
  }
}
```

Replace `C:\\path\\to\\payday-mcp` with your actual installation path.

## Available Tools

### Meta Tools
- **`payday_show_profile`** - Shows current profile configuration
- **`payday_healthcheck`** - Verifies API connectivity and authentication
- **`payday_rate_limit_status`** - Returns rate limit info from last API call

### Data Retrieval Tools
- **`payday_get_company`** - Get company information
- **`payday_get_customers`** - Fetch customers with pagination and search
  - Parameters: `query?`, `page?=1`, `perpage?=50`
- **`payday_get_customer`** - Get specific customer by ID
  - Parameters: `customerId` (required)
- **`payday_get_invoices`** - Retrieve invoices with flexible filtering
  - Parameters: `customerId?`, `excludeStatus?`, `dateFrom?`, `dateTo?`, `page?=1`, `perpage?=50`, `include?`
- **`payday_get_invoice`** - Get specific invoice by ID
  - Parameters: `invoiceId` (required), `include?`
- **`payday_get_expenses`** - Fetch expenses with date and query filtering
  - Parameters: `from?`, `to?`, `query?`, `page?=1`, `perpage?=100`, `include?`
- **`payday_get_payments`** - Get payments within date range
  - Parameters: `from?`, `to?`, `page?=1`, `perpage?=100`
- **`payday_get_payment_types`** - List all payment types (bank accounts)
- **`payday_get_sales_orders`** - Get sales orders with pagination
  - Parameters: `page?=1`, `perpage?=50`, `include?`

### Accounting Tools
- **`payday_get_accounts`** - Get chart of accounts
  - Parameters: `page?=1`, `perpage?=50`
- **`payday_get_account_statement`** - Get account statement with transactions
  - Parameters: `dateFrom?`, `dateTo?`, `createdFrom?`, `createdTo?`, `accountCode?`, `accountType?`, `accountSubType?`
- **`payday_get_expense_accounts`** - List expense accounts
- **`payday_get_expense_payment_types`** - List expense payment types
- **`payday_get_journal_entries`** - Get journal entries with pagination
  - Parameters: `page?=1`, `perpage?=50`

### Write Operations (requires read_only: false)
- **`payday_update_invoice`** - Update invoice status, mark as paid, etc.
  - Parameters: `invoiceId`, `mode`, `status?`, `paidDate?`, `paymentType?`
- **`payday_create_journal_entry`** - Create accounting journal entries
  - Parameters: `date`, `description`, `lines[]`, `status?`
- **`payday_update_journal_entry`** - Post draft journal entries
  - Parameters: `journalId`, `status`

### Bank Transaction Tools
- **`payday_get_bank_transactions`** - Get bank account and credit card transactions
  - Parameters: `fromDate?`, `toDate?`, `accountNumber?`, `accountType?`, `limit?=100`
  - Returns: Transaction history with dates, descriptions, amounts, balances, and account details

### SQLite Tools (read-only database access)
- **`sqlite_list_objects`** - List database tables and views
- **`sqlite_table_info`** - Get table structure and column info
  - Parameters: `table_name`
- **`sqlite_explain`** - Explain SQL query execution plan
  - Parameters: `query`
- **`sqlite_sql_select`** - Execute SELECT queries on database
  - Parameters: `query`

## Usage Examples

After configuring Claude Desktop, use natural language prompts:

- **"Use payday_get_invoices for Aug–Sep 2025, unpaid only, include lines, perpage=100; summarize totals by customer."**
- **"Search customers query='Dúfan', perpage=50; show ids and emails only."**
- **"Get expenses from 2025-07-01 to 2025-08-31, query='payday', include lines; return first 2 pages."**
- **"Mark invoice 1165 as paid on 2025-01-15 using payment type from payday_get_payment_types"**
- **"Create a journal entry for office supplies expense of 50,000 ISK with 24% VAT"**
- **"Show me bank transactions from last month for all accounts and credit cards"**
- **"Get transactions from account 0133-26-007035 between 2025-08-01 and 2025-08-31"**
- **"Show me the current rate limit status and check if the API is healthy"**
- **"List all tables in the SQLite database and show invoice data structure"**

## Tool Response Format

All tools return a consistent JSON structure:

```json
{
  "ok": true,
  "data": [...],
  "page": {
    "page": 1,
    "perpage": 50,
    "total": 123,
    "has_next": true
  },
  "source": {
    "endpoint": "/invoices",
    "duration_ms": 234
  }
}
```

Error responses:

```json
{
  "ok": false,
  "error": {
    "status": 401,
    "label": "AUTH_FAILED",
    "detail": "Token expired",
    "fields": {}
  }
}
```

## Development

### Scripts

```bash
npm run dev          # Development mode with hot reload
npm run build        # Build for production
npm run test         # Run unit tests
npm run test:coverage # Generate coverage report
npm run lint         # Lint code
npm run format       # Format with Prettier
npm run typecheck    # Type check without building
```

### Project Structure

```
payday-mcp/
├── src/
│   ├── config/       # Environment and profile management
│   ├── auth/         # OAuth2 authentication client
│   ├── http/         # HTTP client with error mapping
│   ├── tools/        # MCP tool implementations
│   ├── types/        # Zod schemas and TypeScript types
│   ├── util/         # Logger and pagination utilities
│   ├── test/         # Unit tests
│   └── index.ts      # MCP server entry point
├── dist/             # Compiled output (generated)
├── .env              # Your credentials (create from .env.example)
├── profiles.json     # Profile configuration (create from example)
└── package.json      # Dependencies and scripts
```

## Error Handling

The server maps HTTP errors to standardized labels:

- **AUTH_FAILED** (401/403) - Authentication or permission issues
- **VALIDATION_ERROR** (400/422) - Invalid request parameters
- **NOT_FOUND** (404) - Resource not found
- **RATE_LIMITED** (429) - Too many requests
- **SERVER_ERROR** (500+) - Server-side errors

## Security

- Credentials stored in `.env` (never committed)
- No logging of secrets, tokens, or PII
- Read-only mode enforced via profile configuration
- Token caching with automatic expiry handling

## Date Formats

All date parameters use ISO format: `YYYY-MM-DD`

Example: `from: "2025-01-01", to: "2025-01-31"`

## Pagination Limits

- Default `perpage`: 50 for most endpoints, 100 for expenses/payments
- Maximum `perpage`: 500 (enforced)
- Page numbering starts at 1

## Testing

```bash
npm test                    # Run all tests
npm run test:coverage       # Coverage report
npm test auth.test.ts       # Run specific test
```

## License

MIT - see LICENSE file

## API Documentation

For detailed Payday API documentation, see: **https://apidoc.payday.is/**

This includes endpoint specifications, parameter details, and response formats.

## Support

For issues:
1. Check your `.env` configuration
2. Verify `profiles.json` is valid JSON
3. Ensure Claude Desktop has the correct path
4. Check API connectivity with `payday.healthcheck`
5. Refer to the official Payday API docs: https://apidoc.payday.is/

## Bank Integration (Landsbankinn B2B)

This repo includes a lightweight Landsbankinn B2B client (Landsbankaskema, XML over HTTPS) to fetch bank and credit card data and build a queryable local dataset for monthly reconciliation.

Prerequisites
- Fill `.env` with:
  - `LBIN_BASE_URL` (defaults to `https://b2b.fbl.is/process.ashx`)
  - `LBIN_COMPANY_ID` (10 digits, no hyphen)
  - `LBIN_USERNAME` (8–16 chars) and `LBIN_PASSWORD` (5–12 chars)
  - Optional mTLS: `LBIN_CERT_PATH`, `LBIN_KEY_PATH`, `LBIN_KEY_PASSPHRASE`
- Add your accounts to `Bank/accounts.json` (format: 4-2-6 account numbers with friendly names).

Quick Tests
- Minimal login (verifies credentials):
  - `node Bank/test-lbin-connection.js`
- Test a single bank account (4-2-6 number):
  - `node Bank/test-one-account.js 0133-26-007035`
- List credit cards for the company user:
  - `node Bank/card-list.js`

Fetch Raw XML (Raw Zone)
- Fetch monthly XML for all accounts and credit cards from 2022-01-01 → today and store under `Bank/RawData`:
  - `node Bank/fetch-raw.js`
- Optional: set a different start date
  - PowerShell: `$env:LBIN_FETCH_FROM="2024-01-01"; node Bank/fetch-raw.js`
  - Bash: `LBIN_FETCH_FROM=2024-01-01 node Bank/fetch-raw.js`

Transform to SQLite (Silver Layer + Gold Views)
- Parse all raw XML into `sqlite/finance.db` with idempotent upserts:
  - `node Bank/parse-raw.js`
- List tables and views:
  - `sqlite3 sqlite/finance.db ".tables"`
- Example queries:
  - Bank monthly: `sqlite3 sqlite/finance.db "SELECT * FROM gold_bank_monthly ORDER BY month DESC LIMIT 50;"`
  - Card monthly: `sqlite3 sqlite/finance.db "SELECT * FROM gold_card_monthly ORDER BY month DESC LIMIT 50;"`

Data Layout
- Raw (audit):
  - `Bank/RawData/accounts/<branch-ledger-account>/<YYYY-MM>.xml`
  - `Bank/RawData/cards/<card_id>/<YYYY-MM>.xml`
- SQLite (silver):
  - `silver_bank_accounts`, `silver_bank_transactions`
  - `silver_credit_cards`, `silver_creditcard_transactions`
- SQLite (gold views):
  - `gold_bank_monthly`, `gold_card_monthly`

Notes
- Protocol: Landsbankaskema XML endpoints with session login (`LI_Innskra` → `<seta>`), text/xml headers, and logout (`LI_Utskra`) after batch runs.
- Accounts: use nested `<reikningur><utibu/><hb/><reikningsnr/></reikningur>` per XSD.
- Credit cards: list via `LI_Get_CreditcardList` (v1.2, `<session_id>`), fetch transactions with `LI_Get_Creditcard_Transactions` using `time_period` or `payment_period`.
- Re-running fetch or parse is safe; upserts prevent duplicates and raw XML is never modified.
