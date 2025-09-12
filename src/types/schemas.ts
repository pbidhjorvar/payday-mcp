import { z } from 'zod';

// Common schemas
export const paginationSchema = z.object({
  page: z.number().int().min(1).optional(),
  perpage: z.number().int().min(1).max(500).optional(),
});

export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format');

export const includeSchema = z.array(z.string()).optional();

// Tool input schemas
export const showProfileSchema = z.object({});

export const healthcheckSchema = z.object({});

export const rateLimitStatusSchema = z.object({});

export const getCustomersSchema = z.object({
  query: z.string().optional(),
  page: z.number().int().min(1).optional(),
  perpage: z.number().int().min(1).max(500).optional(),
});

export const getCustomerSchema = z.object({
  customer_id: z.string(),
});

export const getInvoicesSchema = z.object({
  customer_id: z.string().optional(),
  excludeStatus: z.string().optional().describe('Exclude invoices with these statuses. Available values: DRAFT, SENT, PAID, CREDIT, CANCELLED. Use comma "," to separate multiple values. E.g., excludeStatus="DRAFT,PAID,CREDIT,CANCELLED" shows only unpaid invoices (status SENT)'),
  dateFrom: dateSchema.optional().describe('Invoice date from (YYYY-MM-DD)'),
  dateTo: dateSchema.optional().describe('Invoice date to (YYYY-MM-DD)'),
  dueDateFrom: dateSchema.optional().describe('Due date from (YYYY-MM-DD)'),
  dueDateTo: dateSchema.optional().describe('Due date to (YYYY-MM-DD)'),
  finalDueDateFrom: dateSchema.optional().describe('Final due date from (YYYY-MM-DD)'),
  finalDueDateTo: dateSchema.optional().describe('Final due date to (YYYY-MM-DD)'),
  query: z.string().optional().describe('Search query for invoice number, customer name, etc.'),
  order: z.enum(['asc', 'desc']).optional().describe('Sort order'),
  orderBy: z.string().optional().describe('Field to sort by'),
  page: z.number().int().min(1).optional(),
  perpage: z.number().int().min(1).max(500).optional(),
  include: includeSchema,
  // Legacy parameters for backward compatibility
  from: dateSchema.optional().describe('Legacy: use dateFrom instead'),
  to: dateSchema.optional().describe('Legacy: use dateTo instead'),
});

export const getExpensesSchema = z.object({
  from: dateSchema.optional(),
  to: dateSchema.optional(),
  query: z.string().optional(),
  page: z.number().int().min(1).optional(),
  perpage: z.number().int().min(1).max(500).optional(),
  include: includeSchema,
});

export const getPaymentsSchema = z.object({
  from: dateSchema.optional(),
  to: dateSchema.optional(),
  page: z.number().int().min(1).optional(),
  perpage: z.number().int().min(1).max(500).optional(),
});

export const getCompanySchema = z.object({});

export const getAccountsSchema = z.object({
  page: z.number().int().min(1).optional(),
  perpage: z.number().int().min(1).max(500).optional(),
});

export const getAccountStatementSchema = z.object({
  dateFrom: dateSchema.optional().describe('Journal date from (YYYY-MM-DD)'),
  dateTo: dateSchema.optional().describe('Journal date to (YYYY-MM-DD)'),
  createdFrom: dateSchema.optional().describe('Creation date from (YYYY-MM-DD)'),
  createdTo: dateSchema.optional().describe('Creation date to (YYYY-MM-DD)'),
  page: z.number().int().min(1).optional().describe('Starting page (defaults to 1, auto-fetches all pages)'),
  perpage: z.number().int().min(1).max(100).optional().describe('Items per page for API requests (defaults to 100, auto-fetches all)'),
  accountCode: z.string().optional().describe('Account code (e.g., "2100")'),
  accountType: z.string().optional().describe('Account type (e.g., "Expense")'),
  accountSubType: z.string().optional().describe('Account sub type (e.g., "SalaryAndRelatedExpenses")'),
}).refine((data) => {
  // Either both dateFrom/dateTo OR both createdFrom/createdTo must be provided
  const hasJournalDates = data.dateFrom && data.dateTo;
  const hasCreatedDates = data.createdFrom && data.createdTo;
  return hasJournalDates || hasCreatedDates;
}, {
  message: 'Either both dateFrom/dateTo OR both createdFrom/createdTo must be provided',
});

export const getExpenseAccountsSchema = z.object({});

export const getExpensePaymentTypesSchema = z.object({});

export const getPaymentTypesSchema = z.object({});

export const getSalesOrdersSchema = z.object({
  page: z.number().int().min(1).optional(),
  perpage: z.number().int().min(1).max(500).optional(),
  include: includeSchema,
});

export const getInvoiceSchema = z.object({
  invoice_id: z.string().describe('Invoice number (e.g., "1165") or UUID to get'),
  include: z.array(z.string()).optional().describe('Additional data to include (e.g., ["lines"])'),
});

export const updateInvoiceSchema = z.object({
  invoice_id: z.string().describe('Invoice number (e.g., "1165") or UUID to update'),
  status: z.enum(['PAID', 'CANCELLED', 'SENT']).optional().describe('Invoice status'),
  paidDate: z.string().optional().describe('Payment date in ISO format (2019-10-18T17:01:00Z)'),
  paymentType: z.string().optional().describe('Payment type UUID'),
  mode: z.enum(['mark_as_paid', 'resend_email', 'cancel_claim', 'payment_extension', 'cancel_invoice', 'update_draft']).describe('Update mode'),
  // Additional fields for update_draft mode
  draftData: z.record(z.any()).optional().describe('Draft invoice data for update_draft mode'),
});

const journalLineSchema = z.object({
  amount: z.number().describe('Line amount (required)'),
  vatPercentType: z.enum(['NoVAT', 'ReducedVAT', 'StandardVAT', 'NotSet']).optional().describe('VAT percent type - if set, amount includes VAT'),
  ledgerAccountId: z.string().optional().describe('Ledger account UID'),
  customerId: z.string().optional().describe('Customer UID (debtor entry)'),
  creditorId: z.string().optional().describe('Creditor UID'),
  invoiceId: z.string().optional().describe('Invoice UID (can be set if customerId specified)'),
  expenseId: z.string().optional().describe('Expense UID (can be set if creditorId specified)'),
  balancingLedgerAccountId: z.string().optional().describe('Balancing ledger account UID - creates opposite amount line when posting'),
}).refine((data) => {
  // Exactly one of ledgerAccountId, customerId, or creditorId must be set
  const setFields = [data.ledgerAccountId, data.customerId, data.creditorId].filter(Boolean);
  return setFields.length === 1;
}, {
  message: 'Exactly one of ledgerAccountId, customerId, or creditorId must be set',
});

export const createJournalEntrySchema = z.object({
  date: dateSchema.describe('Journal entry date in YYYY-MM-DD format'),
  description: z.string().max(100).describe('Journal entry description (max 100 characters)'),
  status: z.enum(['DRAFT', 'POST']).optional().describe('Entry status - defaults to DRAFT'),
  lines: z.array(journalLineSchema).min(1).describe('Journal entry lines (at least one required)'),
});

export const updateJournalEntrySchema = z.object({
  journal_id: z.string().describe('Journal entry ID to update'),
  status: z.enum(['POST']).describe('Status to update to (currently only supports POST)'),
});

export const getJournalEntriesSchema = z.object({
  page: z.number().int().min(1).optional(),
  perpage: z.number().int().min(1).max(500).optional(),
});