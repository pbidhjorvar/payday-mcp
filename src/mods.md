# Modifications Log

This document tracks all changes made to the Payday MCP codebase for standardization, consistency, and improved functionality.

## 2025-09-13 - Implementation of changes.md

Implemented all 6 changes specified in `src/changes.md` for code standardization and consistency improvements.

### 1. Standardize parameter naming to camelCase

**Files Modified:**
- `src/types/schemas.ts`: Updated `updateJournalEntrySchema` to use `journalId` instead of `journal_id`
- `src/tools/journal.ts`: Updated handler to use `input.journalId` in URL construction
- `src/index.ts`: Enhanced parameter validation to catch snake_case usage and provide helpful migration guidance

**Changes:**
- Changed `journal_id` → `journalId` in journal update schema
- Added validation that rejects snake_case parameters with clear error messages
- All tools now consistently use camelCase parameters matching Payday API conventions

### 2. Normalize tool names and docs

**Files Modified:**
- `src/tools/payment-types.ts`: Renamed tool from `payment-types-list` to `payday_get_payment_types`

**Changes:**
- Tool name standardized to follow `payday_*` prefix convention
- No functional changes to tool behavior, only naming consistency

### 3. Unify error return shape for payment types tool

**Files Modified:**
- `src/tools/payment-types.ts`: Added proper error handling with `createApiError`

**Changes:**
- Added `import { createApiError } from '../http/errors.js'`
- Updated catch block to return consistent `ApiError` shape instead of plain string
- Maintains pass-through behavior for existing `ApiError` responses from client

### 4. Improve MCP JSON schema generation

**Files Modified:**
- `src/index.ts`: Enhanced `getSchemaProperties` and `zodTypeToJsonSchema` functions

**Changes:**
- Modified `getSchemaProperties` to return `{ properties, required }` object
- Added `required` array generation based on non-optional Zod fields
- Enhanced `zodTypeToJsonSchema` to include `description` fields from Zod schemas
- Updated tool list handler to include `required` array in JSON schemas
- Improved nested object handling with proper required field detection

### 5. Tame debug logging and avoid payload leakage

**Files Modified:**
- `src/index.ts`: Wrapped verbose debug logs in `DEBUG=1` environment checks
- `src/tools/journal.ts`: Protected detailed logging behind debug flag

**Changes:**
- Added `if (process.env.DEBUG === '1')` guards around verbose logging
- Reduced default log verbosity to prevent payload leakage
- Maintained structured logging for important events
- Debug logs now show counts/types instead of full payloads by default

### 6. README alignment and cleanup

**Files Modified:**
- `README.md`: Comprehensive update to reflect actual tool capabilities

**Changes:**
- Updated feature description from "8 GET-only tools" to "Complete tool suite including read, write, and SQLite tools"
- Replaced outdated dot-style tool names (`payday.get_invoices`) with actual `payday_*` names
- Added comprehensive tool list including:
  - Meta tools (profile, healthcheck, rate limits)
  - Data retrieval tools (customers, invoices, expenses, payments, etc.)
  - Accounting tools (accounts, statements, journal entries)
  - Write operations (invoice updates, journal entry creation)
  - SQLite tools (database access)
- Updated usage examples to use correct tool names and camelCase parameters
- Fixed parameter examples throughout (e.g., `customer_id` → `customerId`)

## Implementation Results

**Acceptance Criteria Met:**
- ✅ All tools accept camelCase params; snake_case yields clear 400 errors with guidance
- ✅ Journal update path uses `journalId` and works end-to-end
- ✅ All tools follow consistent `payday_*` naming convention
- ✅ README accurately reflects current capabilities and naming
- ✅ Payment types tool returns consistent `ApiError` shape on failure
- ✅ JSON schemas include `required` arrays and `description` fields
- ✅ Default logs are minimal and privacy-focused; `DEBUG=1` enables detailed traces

**Backward Compatibility:**
- Snake_case parameters return helpful 400 errors with migration guidance
- Tool name changes require MCP client config updates to use `payday_get_payment_types`
- Journal update callers must switch from `journal_id` to `journalId`

**Technical Improvements:**
- Enhanced MCP tool discoverability with richer JSON schemas
- Improved debugging capabilities with controlled verbose logging
- Consistent error handling across all tools
- Better documentation alignment with actual implementation
- Standardized parameter naming eliminates confusion

All changes maintain existing response format contracts and follow established code style conventions.