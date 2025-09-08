# Payday MCP Server

A Model Context Protocol (MCP) server that provides secure, read-only access to the Payday API through Claude Desktop. Built with TypeScript and designed for local development with multi-tenant profile support.

## Features

- 🔐 **OAuth2 authentication** with automatic token refresh
- 👥 **Multi-profile support** for test/production environments  
- 📊 **8 GET-only tools** for customers, invoices, expenses, and payments
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

### 1. `payday.show_profile`
Shows current profile configuration.
- **Output**: profile name, base URL, company ID, read-only flag

### 2. `payday.healthcheck`  
Verifies API connectivity and authentication.
- **Output**: status, authentication state, response time

### 3. `payday.rate_limit_status`
Returns rate limit info from the last API call.
- **Output**: limit, remaining, reset timestamp

### 4. `payday.get_customers`
Fetches customers with pagination and search.
- **Input**: `query?`, `page?=1`, `perpage?=50`
- **Output**: customer list with pagination meta

### 5. `payday.get_customer`
Gets a specific customer by ID.
- **Input**: `customer_id` (required)
- **Output**: customer details

### 6. `payday.get_invoices`
Retrieves invoices with flexible filtering.
- **Input**: `customer_id?`, `status?`, `from?`, `to?`, `page?=1`, `perpage?=50`, `include?`
- **Route**: `/customers/:id/invoices` if customer_id provided, else `/invoices`

### 7. `payday.get_expenses`
Fetches expenses with date and query filtering.
- **Input**: `from?`, `to?`, `query?`, `page?=1`, `perpage?=100`, `include?`
- **Output**: expense list with pagination

### 8. `payday.get_payments`
Gets payments within date range.
- **Input**: `from?`, `to?`, `page?=1`, `perpage?=100`
- **Output**: payment list with pagination

## Usage Examples

After configuring Claude Desktop, use natural language prompts:

- **"Use payday.get_invoices for Aug–Sep 2025, unpaid only, include lines, perpage=100; summarize totals by customer."**
- **"Search customers query='Dúfan', perpage=50; show ids and emails only."**
- **"Expenses from 2025-07-01 to 2025-08-31, query='payday', include lines; return first 2 pages."**
- **"Show me the current rate limit status"**
- **"Check if the API is healthy"**

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