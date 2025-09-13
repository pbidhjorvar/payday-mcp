# Planned Changes

This document describes precise, surgical code changes to standardize parameters, normalize tool names, align docs, and improve consistency. Each item lists target files, exact edits, and acceptance criteria for Claude/code agents to apply and verify.

## 1) Standardize parameter naming to camelCase

Goal: Use camelCase for all tool input parameters. Provide helpful errors when snake_case is used.

- File: `src/types/schemas.ts`
  - Change: In `updateJournalEntrySchema`, rename field `journal_id` → `journalId`.
    - Before: `export const updateJournalEntrySchema = z.object({ journal_id: z.string(), ... })`
    - After:  `export const updateJournalEntrySchema = z.object({ journalId: z.string(), ... })`

- File: `src/tools/journal.ts`
  - Change: Update handler to use `input.journalId` and URL `/accounting/journal/${input.journalId}`.
    - Replace all references to `input.journal_id` with `input.journalId`.

- File: `src/tools/invoices.ts`
  - Change: In `updateInvoiceTool` “helpful error messages” block, invert the guidance to prefer camelCase:
    - Remove the branch that rejects `invoiceId` in favor of `invoice_id`.
    - Add a branch that rejects `invoice_id` and instructs to use `invoiceId`.
    - Keep existing checks guiding `action` → `mode` and `paid_date`/`payment_date` → `paidDate`.
  - No change to schemas (they already use `invoiceId`, `paidDate`, `paymentType`).

- File: `src/index.ts`
  - Keep current underscore-parameter guard, which already points callers toward camelCase (`invoice_id` → `invoiceId`, `customer_id` → `customerId`, etc.). This now aligns with all tool handlers.

Acceptance:
- All tools accept camelCase params; snake_case yields clear 400 errors with guidance to camelCase.
- Journal update path uses `journalId` and works end-to-end.

## 2) Normalize tool names and docs

Goal: Keep a consistent `payday_*` prefix for MCP tool names.

- File: `src/tools/payment-types.ts`
  - Change: Rename tool `name` from `payment-types-list` → `payday_get_payment_types`.
    - Only change the exported object’s `name` field; no import changes are required.

- File: `README.md`
  - Change: Update the “Available Tools” section to reflect actual tool names and include mutating tools and SQLite tools. Replace dot-style names (e.g., `payday.get_invoices`) with the real `payday_*` names.
  - Note that the project contains POST/PUT tools (journal/invoice updates) and SQLite read-only tools.

Acceptance:
- Listing tools via MCP returns `payday_get_payment_types` (no remaining hyphenated, unprefixed outliers).
- README tool list matches live tool names and functionality.

## 3) Unify error return shape for payment types tool

Goal: Ensure all tools return the shared `ApiError` shape on failure.

- File: `src/tools/payment-types.ts`
  - Change: In the `catch` branch of `getPaymentTypes`, return `createApiError(500, 'UNKNOWN_ERROR', message)` instead of a plain string.
  - Add `import { createApiError } from '../http/errors.js'` at top.
  - Keep pass-through behavior if `client.getPaymentTypes()` returns an `ApiError`.

Acceptance:
- Failure responses from payment types tool conform to `{ ok: false, error: { status, label, detail, ... } }`.

## 4) Improve MCP JSON schema generation

Goal: Provide richer `inputSchema` metadata for MCP clients.

- File: `src/index.ts`
  - Enhance `getSchemaProperties`/`zodTypeToJsonSchema` to:
    - Include a top-level `required` array based on non-optional Zod keys.
    - Populate `description` from `zod._def.description` where present.
    - Preserve enum values (`ZodEnum` already handled).
  - Optional (future): replace custom conversion with `zod-to-json-schema` to cover nested/complex Zod types. If adopted, add dev dependency and generator usage.

Acceptance:
- `ListTools` returns JSON Schemas that include `required` and `description` fields matching Zod definitions.

## 5) Tame debug logging and avoid payload leakage

Goal: Keep logs useful without exposing full payloads unless explicitly enabled.

- File: `src/index.ts`
  - Change: Wrap journal-entry debug logs and string-JSON parsing traces in `if (process.env.DEBUG === '1')` checks.
  - Do not log full request bodies; log types/counts and redact arrays/large objects.

- File: `src/tools/journal.ts`
  - Change: Wrap verbose `[JOURNAL]` logs similarly behind `DEBUG` env guard and avoid logging full `lines` arrays.

- File: `src/http/paydayClient.ts`
  - Optional: leave structured `logger` calls intact; remove any stray `console.error` debug statements outside the logger (none required if current usage remains).

Acceptance:
- Default runs emit minimal, structured logs.
- Setting `DEBUG=1` enables detailed traces without printing full sensitive payloads.

## 6) README alignment and cleanup

- File: `README.md`
  - Update claims: not “8 GET-only tools”; list actual tools, including invoice/journal mutating operations and SQLite read-only tools.
  - Fix examples to use camelCase parameters (e.g., `invoiceId`, `paidDate`).
  - Reflect normalized tool names (no dot-style aliases).

Acceptance:
- README accurately reflects current capabilities, naming, and parameter style.

## 7) Optional ergonomics (deferred)

- Invoice lookup efficiency:
  - If the API supports lookup by invoice number directly, replace the 500-item list scan in `getInvoiceTool`/`updateInvoiceTool` with a direct query. Otherwise keep current logic.

- Scripts location:
  - Move `analyze-bank-accounts.ts` to `scripts/` and document invocation in README. Ensure it imports from `src/` (compiled or ts-node/tsx) consistently.

---

## Testing Plan

- Unit tests:
  - Update/add tests for journal update parameter rename (`journalId`).
  - Add tests ensuring snake_case is rejected with clear guidance and camelCase succeeds.
  - Add tests for `payment-types` error shape.
  - Optional: tests for enhanced JSON schema (`required`/`description`).

- Manual checks:
  - Run `ListTools` to verify tool names, and inspect schema `required` and `description` fields.
  - Call `payday_get_payment_types` and verify consistent error shape on simulated failure.
  - Verify logs are quiet by default and verbose with `DEBUG=1`.

## Backward Compatibility

- Param naming: snake_case inputs now return explicit 400 errors with migration guidance.
- Tool rename: MCP clients must call `payday_get_payment_types` (update any config referencing `payment-types-list`).
- Journal update: callers switch from `journal_id` to `journalId`.

## Implementation Notes

- Keep changes minimal and focused; no unrelated refactors.
- Preserve existing response format contracts (`{ ok, data, page?, source? }`).
- Follow existing code style and import conventions.

